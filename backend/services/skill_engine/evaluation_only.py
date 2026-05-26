"""
skill_engine/evaluation_only.py — Evaluation-only pipeline path.

Reads existing player_stats, evaluates against draft thresholds (or override),
and stages results in pipeline_run_results. Does NOT call the NBA API.
Does NOT call Claude (source='stats' only per blueprint Q1 default).

Public Surface:
  evaluate_skills_for_run(run_id, player_ids, season, skill_filter, thresholds_override) -> None
"""

from __future__ import annotations

import logging
from typing import Optional

from services.supabase_client import get_supabase, run_query
from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import evaluate_all_skills, apply_auto_promotions
from services.pipeline_run_results.repo import (
    StagedProfileRow,
    StagedFlagRow,
    stage_profile_rows,
    stage_flag_rows,
)

# Import referenced here only for patching in tests (never called in this module)
from services.players_service import get_or_fetch_player_stats  # noqa: F401

logger = logging.getLogger(__name__)


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


def evaluate_skills_for_run(
    run_id: str,
    player_ids: list[str],
    season: str,
    skill_filter: Optional[list[str]] = None,
    thresholds_override: Optional[dict] = None,
) -> None:
    """Evaluate skills for the given players and stage results for the pipeline run.

    Args:
        run_id:              The pipeline_runs.id to attach staged rows to.
        player_ids:          List of player UUIDs to evaluate. Empty list → no-op.
        season:              Season string (e.g. '2025-26').
        skill_filter:        If provided, only include these skills in the staged profile.
                             Other skills are omitted from the staging row.
        thresholds_override: If provided, use these thresholds instead of the live
                             draft_skill_thresholds. Used by threshold_edit runs.

    Side effects:
        - Reads player_stats from Supabase.
        - Calls evaluate_all_skills + apply_auto_promotions.
        - Calls stage_profile_rows (writes to pipeline_run_results).
        - Does NOT call NBA API.
        - Does NOT call Claude.
    """
    if not player_ids:
        stage_profile_rows(run_id, [])
        return

    client = _get_client()

    # Resolve thresholds — override wins; otherwise load from draft_skill_thresholds
    if thresholds_override is not None:
        thresholds = thresholds_override
    else:
        thresholds = get_thresholds(client)

    league_avgs = get_league_averages(season, client)

    # Batch-fetch stats for all players in one query
    stats_result = run_query(
        lambda: client.table("player_stats")
        .select("player_id, season, stats")
        .eq("season", season)
        .in_("player_id", player_ids)
        .execute()
    )
    stats_rows = stats_result.data or []

    # Build lookup: player_id -> stats_blob
    stats_by_player: dict[str, dict] = {}
    for row in stats_rows:
        pid = row["player_id"]
        if pid not in stats_by_player:
            stats_by_player[pid] = row.get("stats") or {}

    staged_profiles: list[StagedProfileRow] = []
    staged_flags: list[StagedFlagRow] = []

    for player_id in player_ids:
        stats_blob = stats_by_player.get(player_id)
        if not stats_blob:
            logger.warning(
                "evaluate_skills_for_run: no stats for player %s season %s — skipping",
                player_id, season,
            )
            continue

        try:
            skills_result = evaluate_all_skills(stats_blob, thresholds, league_avgs)
            skills_result = apply_auto_promotions(skills_result, thresholds)
        except Exception:
            logger.exception(
                "evaluate_skills_for_run: error evaluating player %s — skipping", player_id
            )
            continue

        # Apply skill filter — only keep requested skills in the staged profile
        if skill_filter:
            filtered_profile = {
                skill_name: data
                for skill_name, data in skills_result.items()
                if skill_name in skill_filter
            }
        else:
            filtered_profile = skills_result

        staged_profiles.append(StagedProfileRow(
            player_id=player_id,
            season=season,
            source="stats",
            profile=filtered_profile,
        ))

    stage_profile_rows(run_id, staged_profiles)

    if staged_flags:
        stage_flag_rows(run_id, staged_flags)

    logger.info(
        "evaluate_skills_for_run [%s]: staged %d profile rows, %d flag rows",
        run_id, len(staged_profiles), len(staged_flags),
    )
