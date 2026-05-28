"""
Database access for pipeline_runs table.

Persists start/complete/error for stat_fetch, salary_scrape, and bio_team_sync
pipeline invocations. Only writes at start, complete, and error per A-4.

Per-pipeline_name params shape:
  - threshold_edit: use ThresholdEditParams — serialized as
      {"skill_name": str, "thresholds": dict}
    The commit_pipeline_run RPC reads params->>'skill_name' and params->'thresholds'.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Literal, Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

PipelineName = Literal["stat_fetch", "salary_scrape", "bio_team_sync", "skill_evaluation", "threshold_edit"]


@dataclass(frozen=True)
class ThresholdEditParams:
    """Typed params blob for pipeline_name='threshold_edit' pipeline runs.

    The commit_pipeline_run RPC reads:
      - params->>'skill_name'  to know which draft_skill_thresholds row to upsert
      - params->'thresholds'   for the proposed JSONB threshold rule

    Always pass asdict(ThresholdEditParams(...)) as the params= argument to
    start_run() for threshold_edit runs so the shape stays synchronized with
    this dataclass definition.
    """

    skill_name: str
    thresholds: dict
PipelineScope = Literal["bulk", "player"]


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


def start_run(
    name: PipelineName,
    scope: PipelineScope,
    snapshot_release_id: Optional[str],
    player_id: Optional[str] = None,
    params: Optional[dict] = None,
    client=None,
) -> str:
    """Insert a new running pipeline_run row and return the run_id.

    Args:
        params: Optional JSONB column for run-specific metadata (e.g. proposed
                thresholds for threshold_edit runs). Requires the params column
                migration (20260527000005_pipeline_runs_params.sql) to be applied.
    """
    c = client or _get_client()
    payload: dict = {
        "pipeline_name": name,
        "scope": scope,
        "status": "running",
        "rows_processed": 0,
    }
    if snapshot_release_id:
        payload["snapshot_release_id"] = snapshot_release_id
    if player_id:
        payload["player_id"] = player_id
    if params is not None:
        payload["params"] = params

    result = run_query(
        lambda: c.table("pipeline_runs").insert(payload).execute()
    )
    return str(result.data[0]["id"])


def complete_run(
    run_id: str,
    rows_processed: int,
    error: Optional[str] = None,
    client=None,
) -> None:
    """Mark a run as success or error and record the final row count."""
    c = client or _get_client()
    status = "error" if error else "success"
    update: dict = {
        "status": status,
        "rows_processed": rows_processed,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "error_tail": error,
    }
    run_query(
        lambda: c.table("pipeline_runs")
        .update(update)
        .eq("id", run_id)
        .execute()
    )


def any_running(snapshot_release_id: Optional[str], client=None) -> bool:
    """Return True if any pipeline_run with status='running' exists for the draft.

    When snapshot_release_id is None, returns False immediately. No draft means
    there is no Invariant to enforce — querying for any global running row would
    spuriously block future draft transitions.
    """
    if snapshot_release_id is None:
        return False

    c = client or _get_client()
    query = (
        c.table("pipeline_runs")
        .select("id")
        .eq("status", "running")
        .eq("snapshot_release_id", snapshot_release_id)
    )
    result = run_query(lambda: query.limit(1).execute())
    return bool(result.data)


def any_pending_commit(snapshot_release_id: Optional[str], client=None) -> bool:
    """Return True if any Pipeline run has status='success', committed_at=NULL,
    and snapshot_release_id matches the given draft.

    A pending-commit run holds staged results that have not yet been committed
    into the draft working tables. Publishing while pending-commit runs exist
    would silently discard those staged results. The caller (publish_draft) must
    raise ValueError('pending_commits_exist') when this returns True so the admin
    can commit or discard the run before publishing.

    When snapshot_release_id is None, returns False immediately — no draft means
    no pending-commit Invariant to enforce.
    """
    if snapshot_release_id is None:
        return False

    c = client or _get_client()
    query = (
        c.table("pipeline_runs")
        .select("id")
        .eq("status", "success")
        .is_("committed_at", "null")
        .eq("snapshot_release_id", snapshot_release_id)
    )
    result = run_query(lambda: query.limit(1).execute())
    return bool(result.data)


def get_run(run_id: str, client=None) -> Optional[dict]:
    """Return a single pipeline_run row by id, or None if not found.

    Catches only postgrest PGRST116 (no rows found) and returns None.
    All other errors (transient DB errors, auth failures, etc.) propagate so
    callers surface a real 500 instead of a misleading 404.
    """
    import postgrest.exceptions

    c = client or _get_client()
    try:
        result = run_query(
            lambda: c.table("pipeline_runs")
            .select("*")
            .eq("id", run_id)
            .single()
            .execute()
        )
        return result.data
    except postgrest.exceptions.APIError as exc:
        if exc.code == "PGRST116":
            return None
        raise


def mark_committed(run_id: str, committed_at: str, client=None) -> None:
    """Set committed_at on a pipeline_run row to record a successful commit."""
    c = client or _get_client()
    run_query(
        lambda: c.table("pipeline_runs")
        .update({"committed_at": committed_at})
        .eq("id", run_id)
        .execute()
    )


def mark_discarded(run_id: str, client=None) -> None:
    """Set status='discarded' on a pipeline_run row."""
    c = client or _get_client()
    run_query(
        lambda: c.table("pipeline_runs")
        .update({"status": "discarded"})
        .eq("id", run_id)
        .execute()
    )


def list_recent(
    name: Optional[PipelineName] = None,
    limit: int = 10,
    client=None,
) -> list[dict]:
    """Return recent pipeline runs, optionally filtered by pipeline name."""
    c = client or _get_client()
    query = (
        c.table("pipeline_runs")
        .select("*")
        .order("started_at", desc=True)
        .limit(limit)
    )
    if name:
        query = query.eq("pipeline_name", name)
    result = run_query(lambda: query.execute())
    return result.data or []


def list_for_draft(snapshot_release_id: str, client=None) -> list[dict]:
    """Return all pipeline runs scoped to a draft, newest first.

    Powers the draft workspace Pipeline tab. Columns map 1:1 to the frontend
    PipelineRun type, so the route can return rows as-is.
    """
    c = client or _get_client()
    query = (
        c.table("pipeline_runs")
        .select("*")
        .eq("snapshot_release_id", snapshot_release_id)
        .order("started_at", desc=True)
    )
    result = run_query(lambda: query.execute())
    return result.data or []


def record_force_audit(
    pipeline_name: PipelineName,
    params: dict,
    snapshot_release_id: Optional[str] = None,
    client=None,
) -> str:
    """Insert a synchronous audit-only pipeline_run row for ?force=true writes.

    This is NOT a real Pipeline run — no background worker is spawned and no
    staging rows are created. It is a write-audit record so admins can trace
    emergency direct writes to draft_skill_thresholds that bypass the normal
    draft lifecycle.

    Row shape:
      - pipeline_name: passed through (typically 'threshold_edit')
      - status: 'success' (the write already happened; this is the audit)
      - committed_at: now() (already realized; not staged)
      - started_at / finished_at: now() (synchronous — no async duration)
      - rows_processed: 0 (audit only; no profile rows staged)
      - snapshot_release_id: None for out-of-lifecycle writes, or an explicit
        release id if the caller wants to associate this with an active release.
        Intentionally NOT the current draft — ?force=true writes go directly to
        draft_skill_thresholds and bypass the draft lifecycle entirely.
      - params: caller-provided metadata (skill_name, thresholds for threshold_edit)

    Returns the new run_id string.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    c = client or _get_client()
    payload: dict = {
        "pipeline_name": pipeline_name,
        "scope": "bulk",
        "status": "success",
        "committed_at": now_iso,
        "started_at": now_iso,
        "finished_at": now_iso,
        "rows_processed": 0,
        "params": params,
    }
    if snapshot_release_id is not None:
        payload["snapshot_release_id"] = snapshot_release_id

    result = run_query(
        lambda: c.table("pipeline_runs").insert(payload).execute()
    )
    return str(result.data[0]["id"])
