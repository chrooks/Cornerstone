"""
api/pipeline_runs.py — Pipeline run management endpoints.

HTTP Surface:
  GET  /api/pipeline-runs/<id>         — run metadata
  GET  /api/pipeline-runs/<id>/diff    — staged diff vs current draft tables
  POST /api/pipeline-runs/<id>/commit  — commit staged rows into draft tables
  POST /api/pipeline-runs/<id>/discard — discard staged rows, mark run discarded

All endpoints require admin auth.
"""

import logging

from flask import Blueprint, jsonify

from api.auth import require_admin
from services.pipeline_runs import repo as runs_repo
from services.pipeline_run_results import repo as prr_repo
from services.pipeline_run_results import commit as commit_module

logger = logging.getLogger(__name__)

pipeline_runs_bp = Blueprint("pipeline_runs", __name__, url_prefix="/api")


def _ok(data) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


# ---------------------------------------------------------------------------
# GET /api/pipeline-runs/<id>
# ---------------------------------------------------------------------------


@pipeline_runs_bp.route("/pipeline-runs/<run_id>", methods=["GET"])
@require_admin
def get_pipeline_run(run_id: str):
    """Return metadata for a single pipeline run."""
    run = runs_repo.get_run(run_id)
    if run is None:
        return _err(f"Run not found: {run_id}", 404)
    return _ok(run)


# ---------------------------------------------------------------------------
# GET /api/pipeline-runs/<id>/diff
# ---------------------------------------------------------------------------


@pipeline_runs_bp.route("/pipeline-runs/<run_id>/diff", methods=["GET"])
@require_admin
def get_pipeline_run_diff(run_id: str):
    """Return the diff for a pipeline run.

    A committed run's staged rows are deleted by the commit RPC, so a live
    recompute would be empty. For committed runs we return the diff snapshot
    persisted at commit time (committed_diff); only when that snapshot is
    absent (legacy runs) or the run is uncommitted do we recompute live.
    """
    try:
        run = runs_repo.get_run(run_id)
        # `is not None` (not truthiness): a committed run that staged zero changes
        # has a real, empty-but-present snapshot — serve it rather than recomputing
        # live. Only NULL (legacy / never-persisted) falls through to live recompute.
        if run and run.get("committed_at") and run.get("committed_diff") is not None:
            return _ok(run["committed_diff"])
        diff = prr_repo.get_diff(run_id)
        return _ok(diff)
    except Exception:
        logger.exception("Error computing diff for run %s", run_id)
        return _err("Failed to compute diff", 500)


# ---------------------------------------------------------------------------
# POST /api/pipeline-runs/<id>/commit
# ---------------------------------------------------------------------------


@pipeline_runs_bp.route("/pipeline-runs/<run_id>/commit", methods=["POST"])
@require_admin
def commit_pipeline_run(run_id: str):
    """Commit a staged pipeline run's rows into the draft working tables."""
    run = runs_repo.get_run(run_id)
    if run is None:
        return _err(f"Run not found: {run_id}", 404)

    if run.get("committed_at"):
        return _err("already_committed — run has already been committed", 409)

    try:
        committed_at = commit_module.commit_run(run_id)
        return _ok({"committed_at": committed_at})
    except Exception as exc:
        exc_str = str(exc).lower()
        if "run_not_in_success_state" in exc_str:
            return _err("run_not_in_success_state — run must have status=success to commit", 409)
        logger.exception("Error committing run %s", run_id)
        return _err("Failed to commit run", 500)


# ---------------------------------------------------------------------------
# POST /api/pipeline-runs/<id>/discard
# ---------------------------------------------------------------------------


@pipeline_runs_bp.route("/pipeline-runs/<run_id>/discard", methods=["POST"])
@require_admin
def discard_pipeline_run(run_id: str):
    """Discard a pipeline run's staged rows and mark the run as discarded."""
    run = runs_repo.get_run(run_id)
    if run is None:
        return _err(f"Run not found: {run_id}", 404)

    if run.get("committed_at"):
        return _err("already_committed — cannot discard an already-committed run", 409)

    if run.get("status") == "discarded":
        return _err("run_already_discarded — run has already been discarded", 409)

    try:
        commit_module.discard_run(run_id)
        return _ok({"discarded": run_id})
    except Exception:
        logger.exception("Error discarding run %s", run_id)
        return _err("Failed to discard run", 500)
