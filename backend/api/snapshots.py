"""
api/snapshots.py — Snapshot Release lifecycle endpoints.

Blueprint prefix: /api/snapshots
All endpoints require @require_admin (reads via service-role client per A-6).
"""

from __future__ import annotations

import dataclasses
import logging
from uuid import UUID

from flask import Blueprint, g, jsonify, request

from api.auth import require_admin
from services.snapshot_versions import repo, validator, summary
from services.season import SEASON_FORMAT_MESSAGE, validate_nba_season

logger = logging.getLogger(__name__)

snapshots_bp = Blueprint("snapshots", __name__, url_prefix="/api/snapshots")


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _release_dict(r) -> dict:
    return {
        "id": r.id,
        "label": r.label,
        "season": r.season,
        "status": r.status,
        "is_active": r.is_active,
        "published_at": r.published_at,
        "created_at": r.created_at,
        "published_with_open_flags": getattr(r, "published_with_open_flags", None),
    }


def _ok(data, status: int = 200):
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 500):
    return jsonify({"success": False, "data": None, "error": msg}), status


def _validate_uuid(value: str, label: str = "id"):
    try:
        UUID(value)
        return None
    except (ValueError, AttributeError):
        return f"Invalid {label}: {value}"


# ---------------------------------------------------------------------------
# GET /api/snapshots/active
# ---------------------------------------------------------------------------


@snapshots_bp.route("/active", methods=["GET"])
@require_admin
def get_active():
    """Return the active published Snapshot Release."""
    try:
        release = repo.get_active_release()
        return _ok(_release_dict(release))
    except Exception:
        logger.exception("Failed to fetch active Snapshot Release")
        return _err("Failed to fetch active Snapshot Release", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/draft
# ---------------------------------------------------------------------------


@snapshots_bp.route("/draft", methods=["GET"])
@require_admin
def get_draft():
    """Return the current open draft/review, or null."""
    try:
        draft = repo.get_draft()
        if draft is None:
            return _ok(None)

        data = _release_dict(draft)
        # Augment with has_running_jobs
        from services.pipeline_runs import repo as runs_repo
        data["has_running_jobs"] = runs_repo.any_running(draft.id)
        return _ok(data)
    except Exception:
        logger.exception("Failed to fetch draft Snapshot Release")
        return _err("Failed to fetch draft Snapshot Release", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/releases
# ---------------------------------------------------------------------------


@snapshots_bp.route("/releases", methods=["GET"])
@require_admin
def list_releases():
    """Return recent published Snapshot Releases."""
    limit = min(int(request.args.get("limit", 20)), 100)
    try:
        releases = repo.list_releases(limit=limit)
        return _ok([_release_dict(r) for r in releases])
    except Exception:
        logger.exception("Failed to list Snapshot Releases")
        return _err("Failed to list Snapshot Releases", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/releases/<release_id>
# ---------------------------------------------------------------------------


@snapshots_bp.route("/releases/<release_id>", methods=["GET"])
@require_admin
def get_release(release_id: str):
    """Return a single published Snapshot Release by ID."""
    uuid_err = _validate_uuid(release_id, "release_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        release = repo.get_release(release_id)
        if release.status != "published":
            return _err("not_found", 404)
        return _ok(_release_dict(release))
    except Exception:
        logger.exception("Failed to fetch Snapshot Release %s", release_id)
        return _err("Snapshot Release not found", 404)


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts", methods=["POST"])
@require_admin
def create_draft():
    """Create a new draft Snapshot Release."""
    try:
        draft = repo.create_draft()
        return _ok(_release_dict(draft), 201)
    except ValueError as exc:
        code = str(exc)
        status = 409 if code == "draft_already_exists" else 400
        return _err(code, status)
    except Exception:
        logger.exception("Failed to create draft Snapshot Release")
        return _err("Failed to create draft", 500)


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts/<draft_id>/move-to-review
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/move-to-review", methods=["POST"])
@require_admin
def move_to_review(draft_id: str):
    """Flip draft → review. Blocked if pipeline runs are in flight."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        release = repo.move_to_review(draft_id)
        return _ok(_release_dict(release))
    except ValueError as exc:
        code = str(exc)
        status = 409 if code in ("pipeline_runs_in_flight", "draft_not_found_or_not_draft") else 400
        return _err(code, status)
    except Exception:
        logger.exception("Failed to move draft to review")
        return _err("Failed to move to review", 500)


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts/<draft_id>/move-to-draft
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/move-to-draft", methods=["POST"])
@require_admin
def move_to_draft(draft_id: str):
    """Flip review → draft."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        release = repo.move_to_draft(draft_id)
        return _ok(_release_dict(release))
    except ValueError as exc:
        return _err(str(exc), 400)
    except Exception:
        logger.exception("Failed to move review to draft")
        return _err("Failed to move to draft", 500)


# ---------------------------------------------------------------------------
# DELETE /api/snapshots/drafts/<draft_id>
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>", methods=["DELETE"])
@require_admin
def discard_draft(draft_id: str):
    """Hard-delete a draft/review row. Live tables are untouched."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        repo.discard_draft(draft_id)
        return _ok(None)
    except ValueError:
        return _err("draft_not_found", 404)
    except Exception:
        logger.exception("Failed to discard draft %s", draft_id)
        return _err("Failed to discard draft", 500)


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts/<draft_id>/publish
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/publish", methods=["POST"])
@require_admin
def publish_draft(draft_id: str):
    """Validate and atomically publish a draft Snapshot Release."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)

    body = request.get_json(silent=True) or {}
    label = body.get("label", "").strip()

    # Strict bool validation: reject truthy non-bool values (e.g. "true",
    # 1, "yes"). The RPC's gate is binary so we keep the Contract binary
    # at the HTTP Surface too.
    raw_allow_missing = body.get("allow_missing_composite", False)
    if not isinstance(raw_allow_missing, bool):
        return _err("invalid_allow_missing_composite", 400)
    allow_missing_composite = raw_allow_missing

    raw_allow_open_flags = body.get("allow_open_flags", False)
    if not isinstance(raw_allow_open_flags, bool):
        return _err("invalid_allow_open_flags", 400)
    allow_open_flags = raw_allow_open_flags

    # Issue #71: the open-flags count the admin acknowledged when arming the
    # override. Optional (direct callers may omit it → unbounded), but when
    # present it must be a non-negative int. bool is an int subclass, so reject
    # it explicitly.
    raw_ack = body.get("acknowledged_open_flags", None)
    acknowledged_open_flags: int | None = None
    if raw_ack is not None:
        if isinstance(raw_ack, bool) or not isinstance(raw_ack, int) or raw_ack < 0:
            return _err("invalid_acknowledged_open_flags", 400)
        acknowledged_open_flags = raw_ack

    # Issue #71: arming the override REQUIRES an acknowledged count. Without this
    # the RPC's NULL path is an unbounded blanket bypass (the pre-#71 behavior),
    # reachable by any direct caller. The HTTP Surface must not expose that — the
    # count is what binds the bypass to what the admin reviewed.
    if allow_open_flags and acknowledged_open_flags is None:
        return _err("acknowledged_open_flags_required", 400)

    if not label:
        return _err("label_required", 400)

    # Issue #72: the draft owns its NBA season; the publish dialog may correct it
    # inline. When a season is sent, validate the YYYY-YY format at this Boundary
    # and persist it back to the draft BEFORE the freeze, so the RPC reads a
    # trusted column. The publish RPC still hard-refuses a NULL/blank season.
    raw_season = body.get("season", None)
    if raw_season is not None:
        if not isinstance(raw_season, str):
            return _err(SEASON_FORMAT_MESSAGE, 400)
        season = raw_season.strip()
        try:
            validate_nba_season(season)
        except ValueError:
            return _err(SEASON_FORMAT_MESSAGE, 400)
        try:
            repo.update_draft_season(draft_id, season)
        except ValueError:
            return _err("draft_not_found", 404)

    try:
        published = repo.publish_draft(
            draft_id,
            label=label,
            allow_missing_composite=allow_missing_composite,
            allow_open_flags=allow_open_flags,
            acknowledged_open_flags=acknowledged_open_flags,
        )
        # Audit trail (issue #71): record the override only AFTER it succeeds, and
        # log the RPC's own authoritative count (frozen on the Release row), not a
        # separate pre-read or the admin's acknowledged number. This keeps the
        # durable audit and the durable column in agreement, and avoids logging
        # phantom overrides for attempts the RPC refused (open_flags_changed).
        bypassed = getattr(published, "published_with_open_flags", None)
        if allow_open_flags and bypassed:
            logger.warning(
                "publish_draft: open-flags override by admin user_id=%s draft_id=%s "
                "bypassed=%s acknowledged=%s",
                getattr(g, "user_id", "unknown"),
                draft_id,
                bypassed,
                acknowledged_open_flags,
            )
        return _ok(_release_dict(published))
    except ValueError as exc:
        code = str(exc)
        if "pipeline_runs_in_flight" in code:
            return _err(code, 409)
        if "pending_commits_exist" in code:
            return _err(code, 409)
        # Issue #67: publishing a non-review-state release is a state conflict,
        # not a malformed request — map to 409 so clients can distinguish it.
        if "draft_not_in_review_state" in code:
            return _err(code, 409)
        # Issue #71: the override count-pin tripped — open flags changed under the
        # admin. State conflict; the admin must re-confirm against the new count.
        if "open_flags_changed" in code:
            return _err(code, 409)
        # Issue #74: a Legend has no canonical_players row and can't be frozen into
        # released_players. State conflict (409), not a malformed request — the
        # validation Surface surfaces this up front via legends_missing_canonical.
        if "legends_missing_canonical_player" in code:
            return _err(code, 409)
        # Issue #72: the draft's season is NULL/blank — a state conflict (the
        # draft is not publishable until a season is set), not a malformed
        # request. The API now persists a validated season before publish, so
        # this is the backstop for direct callers / drafts created without one.
        if "season_missing" in code:
            return _err(code, 409)
        if "missing_composite_not_acknowledged" in code:
            return _err(code, 422)
        if "open_flags_not_acknowledged" in code:
            return _err(code, 422)
        return _err(code, 400)
    except Exception:
        logger.exception("Failed to publish draft %s", draft_id)
        return _err("Failed to publish draft", 500)


# ---------------------------------------------------------------------------
# POST /api/snapshots/releases/<release_id>/reactivate (#53)
# ---------------------------------------------------------------------------


@snapshots_bp.route("/releases/<release_id>/reactivate", methods=["POST"])
@require_admin
def reactivate_release(release_id: str):
    """Atomically reactivate a previously published Snapshot Release.

    Wraps repo.reactivate_release which calls the reactivate_snapshot_release
    Postgres RPC and forces a cohesion distribution cache rewarm.
    """
    uuid_err = _validate_uuid(release_id, "release_id")
    if uuid_err:
        return _err(uuid_err, 400)
    body = request.get_json(silent=True) or {}
    allow_stale = body.get("allow_stale") is True
    try:
        release = repo.reactivate_release(release_id, allow_stale=allow_stale)
        return _ok(_release_dict(release))
    except ValueError as exc:
        code = str(exc)
        if code == "release_not_found":
            return _err(code, 404)
        if code in ("draft_in_flight", "release_structurally_stale"):
            return _err(code, 409)
        return _err(code, 400)
    except Exception:
        logger.exception("Failed to reactivate Snapshot Release %s", release_id)
        return _err("Failed to reactivate Snapshot Release", 500)


# ---------------------------------------------------------------------------
# POST /api/snapshots/reset-working-state
# ---------------------------------------------------------------------------


@snapshots_bp.route("/reset-working-state", methods=["POST"])
@require_admin
def reset_working_state():
    """Reset live draft_skill_profiles and players from the active Snapshot."""
    try:
        repo.reset_working_state_from_active()
        return _ok({"ok": True})
    except ValueError as exc:
        return _err(str(exc), 400)
    except Exception:
        logger.exception("Failed to reset working state")
        return _err("Failed to reset working state", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/drafts/<draft_id>/validation
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/validation", methods=["GET"])
@require_admin
def get_validation(draft_id: str):
    """Return pre-publish validation counts for the publish modal."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        counts = validator.validate_publishable(draft_id)
        return _ok(counts)
    except Exception:
        logger.exception("Failed to validate draft %s", draft_id)
        return _err("Failed to validate draft", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/drafts/<draft_id>/summary
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/summary", methods=["GET"])
@require_admin
def get_summary(draft_id: str):
    """Return count summary for the review-state Surface."""
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        counts = summary.count_summary(draft_id)
        return _ok(counts)
    except Exception:
        logger.exception("Failed to summarize draft %s", draft_id)
        return _err("Failed to summarize draft", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/diff (#8)
# ---------------------------------------------------------------------------


@snapshots_bp.route("/diff", methods=["GET"])
@require_admin
def get_release_diff():
    """Diff the open draft against the active published Snapshot Release.

    Read-only pre-publish review Surface: players added/removed, per-Player
    skill tier deltas, and contract/bio deltas. Mirrors the publish RPC's
    freeze selection so the diff predicts the publish truthfully.
    """
    try:
        from services.snapshot_versions import release_diff
        data = release_diff.compute_release_diff()
        return _ok(data)
    except ValueError as exc:
        code = str(exc)
        # State conflicts (no open draft / no active release), not malformed
        # requests — map to 409 per this file's error-mapping convention.
        if code in ("no_open_draft", "no_active_release"):
            return _err(code, 409)
        return _err(code, 400)
    except Exception:
        logger.exception("Failed to compute draft-vs-published diff")
        return _err("Failed to compute draft-vs-published diff", 500)


# ---------------------------------------------------------------------------
# GET /api/snapshots/drafts/<draft_id>/pipeline-runs
# ---------------------------------------------------------------------------


@snapshots_bp.route("/drafts/<draft_id>/pipeline-runs", methods=["GET"])
@require_admin
def list_draft_pipeline_runs(draft_id: str):
    """Return all pipeline runs scoped to this draft, newest first.

    Read-only history for the draft workspace Pipeline tab. Runs are triggered
    from the ingestion Surfaces (stat fetch / salary scrape / bio-team sync) and
    the threshold_edit staging Surface; this only lists them.
    """
    uuid_err = _validate_uuid(draft_id, "draft_id")
    if uuid_err:
        return _err(uuid_err, 400)
    try:
        from services.pipeline_runs import repo as runs_repo
        runs = runs_repo.list_for_draft(draft_id)
        return _ok(runs)
    except Exception:
        logger.exception("Failed to list pipeline runs for draft %s", draft_id)
        return _err("Failed to list pipeline runs", 500)
