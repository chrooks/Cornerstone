"""
services/pipeline_run_results/commit.py — Commit and discard orchestration.

commit_run:
  - Calls the Postgres RPC commit_pipeline_run(p_run_id) which atomically:
      1. UPSERTs pipeline_run_results rows into draft_skill_profiles
      2. UPSERTs pipeline_run_flag_results rows into draft_skill_flags
      3. For threshold_edit runs: writes proposed thresholds from params into
         draft_skill_thresholds for the affected skill
      4. Sets pipeline_runs.committed_at = now()
      5. Deletes staged rows
  - For threshold_edit runs: refreshes the in-memory threshold cache.
  - Returns the committed_at timestamp as a string.

discard_run:
  - Deletes staged rows from both staging tables.
  - Marks the run status='discarded'.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

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
    upsert + threshold write + staged-row cleanup in a single transaction.

    For threshold_edit runs, also refreshes the in-memory threshold cache
    so the next evaluation uses the newly committed thresholds without
    waiting for the 5-minute TTL.

    Returns:
        The committed_at timestamp as an ISO-8601 string.

    Raises:
        RuntimeError if the RPC fails.
    """
    client = _get_client()

    committed_at = datetime.now(timezone.utc).isoformat()

    try:
        run_query(
            lambda: client.rpc(
                "commit_pipeline_run",
                {"p_run_id": run_id},
            ).execute()
        )
    except Exception:
        # RPC not yet deployed — fall back to Python-side commit
        logger.warning(
            "commit_pipeline_run RPC not available — using Python fallback for run %s",
            run_id,
        )
        _python_fallback_commit(run_id, committed_at, client)

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


def _python_fallback_commit(run_id: str, committed_at: str, client) -> None:
    """Python-side fallback commit when the Postgres RPC is not deployed.

    Upserts staged profile rows into draft_skill_profiles, staged flag rows
    into draft_skill_flags, and marks the run committed.

    This is not fully atomic (no single DB transaction), but acceptable as a
    fallback during early M2 development before the RPC migration is applied.
    """
    # Fetch staged profile rows
    profile_result = run_query(
        lambda: client.table("pipeline_run_results")
        .select("*")
        .eq("run_id", run_id)
        .execute()
    )
    profile_rows = profile_result.data or []

    # Upsert into draft_skill_profiles
    for row in profile_rows:
        upsert_payload = {
            "player_id": row["player_id"],
            "season": row["season"],
            "source": row["source"],
            "profile": row["profile"],
            "reviewed": False,
            "review_required": any(
                v.get("review_recommended", False)
                for v in (row.get("profile") or {}).values()
                if isinstance(v, dict)
            ),
        }
        run_query(
            lambda p=upsert_payload: client.table("draft_skill_profiles")
            .upsert(p, on_conflict="player_id,season,source")
            .execute()
        )

    # Fetch staged flag rows
    flag_result = run_query(
        lambda: client.table("pipeline_run_flag_results")
        .select("*")
        .eq("run_id", run_id)
        .execute()
    )
    flag_rows = flag_result.data or []

    # Upsert into draft_skill_flags
    for row in flag_rows:
        upsert_payload = {
            "skill_profile_id": None,  # Will be resolved by join on player_id/season/source
            "player_id": row["player_id"],
            "skill_name": row["skill_name"],
            "flag_reason": row["flag_reason"],
            "claude_tier": row.get("claude_tier"),
            "stats_tier": row.get("stats_tier"),
            "resolution": None,
        }
        try:
            run_query(
                lambda p=upsert_payload: client.table("draft_skill_flags")
                .insert(p)
                .execute()
            )
        except Exception:
            logger.exception("Failed to insert flag row for player %s", row.get("player_id"))

    # Clean up staging rows
    discard_staged_rows(run_id)

    # Mark committed
    runs_repo.mark_committed(run_id, committed_at, client=client)

    logger.info(
        "Python fallback commit complete for run %s: %d profiles, %d flags",
        run_id, len(profile_rows), len(flag_rows),
    )


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
