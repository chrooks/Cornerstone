"""
services/pipeline_run_results/commit.py — Commit and discard orchestration.

commit_run:
  - Calls the Postgres RPC commit_pipeline_run(p_run_id) which atomically:
      1. UPSERTs pipeline_run_results rows into draft_skill_profiles
      2. UPSERTs pipeline_run_flag_results rows into draft_skill_flags
      3. For threshold_edit runs: writes proposed thresholds from params into
         draft_skill_thresholds for the affected skill
      4. Sets pipeline_runs.committed_at = now() and returns the canonical value
      5. Deletes staged rows
  - For threshold_edit runs: refreshes the in-memory threshold cache.
  - Returns the committed_at timestamp (canonical Postgres value) as a string.

discard_run:
  - Deletes staged rows from both staging tables.
  - Marks the run status='discarded'.
"""

from __future__ import annotations

import logging

from services.supabase_client import get_supabase, run_query
from services.pipeline_run_results.repo import discard_staged_rows
from services.pipeline_runs import repo as runs_repo

logger = logging.getLogger(__name__)


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


def commit_run(run_id: str) -> str:
    """Commit a staged pipeline run into the draft working tables.

    Calls the Postgres RPC commit_pipeline_run which handles the atomic
    upsert + threshold write + staged-row cleanup in a single transaction,
    and returns the canonical committed_at timestamp written to pipeline_runs.

    For threshold_edit runs, also refreshes the in-memory threshold cache
    so the next evaluation uses the newly committed thresholds without
    waiting for the 5-minute TTL.

    Returns:
        The committed_at timestamp as a string. This is the canonical Postgres
        value — either returned directly by the RPC, or read back from
        pipeline_runs.committed_at if the RPC's return value is unavailable.

    Raises:
        Propagates any exception from the RPC. The RPC is the sole Contract
        for commits; there is no Python-side fallback.
    """
    client = _get_client()

    rpc_result = run_query(
        lambda: client.rpc(
            "commit_pipeline_run",
            {"p_run_id": run_id},
        ).execute()
    )

    committed_at = _extract_committed_at(rpc_result, run_id, client)

    # Check if this was a threshold_edit run; if so, refresh threshold cache
    try:
        run_row = runs_repo.get_run(run_id, client=client)
        if run_row and run_row.get("pipeline_name") == "threshold_edit":
            from services.skill_engine.cache import get_thresholds
            get_thresholds(client, refresh=True)
            logger.info("Refreshed threshold cache after threshold_edit commit for run %s", run_id)
    except Exception:
        logger.exception("Failed to refresh threshold cache after commit for run %s", run_id)

    return committed_at


def _extract_committed_at(rpc_result, run_id: str, client) -> str:
    """Pull the canonical committed_at out of the RPC response.

    The hardened commit_pipeline_run RPC returns TIMESTAMPTZ. Supabase-py
    surfaces scalar function returns in result.data. If the value is missing
    for any reason (older RPC deployed, unexpected response shape), fall
    forward by reading pipeline_runs.committed_at directly — still the
    canonical Postgres value, never datetime.now().
    """
    data = getattr(rpc_result, "data", None)
    if isinstance(data, str) and data:
        return data
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            for key in ("commit_pipeline_run", "committed_at"):
                value = first.get(key)
                if isinstance(value, str) and value:
                    return value

    run_row = runs_repo.get_run(run_id, client=client)
    if not run_row or not run_row.get("committed_at"):
        raise RuntimeError(
            f"commit_pipeline_run returned no committed_at and run {run_id} "
            "has no committed_at after RPC — refusing to fabricate a timestamp."
        )
    return run_row["committed_at"]


def discard_run(run_id: str) -> None:
    """Discard all staged rows for a run and mark the run as discarded.

    Safe to call on runs in any status (running, success, error).
    Cannot be called on already-committed runs (caller must check).
    """
    # Remove staged rows from both tables
    discard_staged_rows(run_id)

    # Mark the run itself as discarded
    runs_repo.mark_discarded(run_id)

    logger.info("Discarded pipeline run %s", run_id)
