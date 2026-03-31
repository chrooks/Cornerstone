"""
skill_mapping_service.py — Service entry points for skill evaluation.

This module is intentionally thin. All rule-engine logic lives in the
skill_engine/ sub-package; this file only exposes the public service API
(get_player_skills, batch_evaluate_skills) and the DB upsert helper.

Sub-package layout:
  skill_engine/cache.py      — TTL-cached threshold + league-average reads
  skill_engine/conditions.py — stat resolution and condition evaluation
  skill_engine/transforms.py — pre-adjustments, derived stats, stabilization
  skill_engine/evaluator.py  — per-skill and all-skill evaluation, auto-promotions
  skill_engine/history.py    — multi-season historical blending

All public names from those modules are re-exported here so that existing
import paths (e.g. "from services.skill_mapping_service import resolve_stat")
continue to work without modification.
"""

import logging

from supabase import Client

from services.players_service import CURRENT_SEASON, DEFAULT_MIN_MPG
from services.skill_engine import (  # noqa: F401 — re-export for backwards compat
    _blend_blobs,
    _collect_driving_stats,
    _HISTORY_WEIGHTS,
    _prev_season,
    _PREV_SEASON,
    _TWO_AGO_SEASON,
    apply_auto_promotions,
    apply_pre_adjustments,
    apply_stabilization,
    compute_and_store_league_averages,
    compute_derived_stats,
    evaluate_all_skills,
    evaluate_condition,
    evaluate_conditions_block,
    evaluate_skill,
    get_league_averages,
    get_thresholds,
    get_weighted_stats,
    resolve_stat,
)

logger = logging.getLogger(__name__)


# ===========================================================================
# Service entry points
# ===========================================================================


def get_player_skills(
    player_id: str,
    season: str,
    use_history: bool,
    supabase: Client,
    refresh: bool = False,
    debug: bool = False,
) -> dict:
    """
    Evaluate all skills for a single player and return the full skills result.

    Pipeline:
      1. Load thresholds (cached, 5-min TTL)
      2. Load league averages (cached, 24-hr TTL)
      3. Get stats blob — weighted blend if use_history=True, else single-season
      4. Evaluate all skills
      5. Apply auto-promotions (second pass)

    Returns: { skill_name: evaluate_skill_result_dict, ... }
    """
    # Load rule definitions and league averages (both cached)
    thresholds = get_thresholds(supabase, refresh=refresh)
    league_avgs = get_league_averages(season, supabase, refresh=refresh)

    # Get the stats blob — optionally blended across multiple seasons
    if use_history:
        stats_blob = get_weighted_stats(player_id, season, supabase)
    else:
        row = (
            supabase.table("player_stats")
            .select("stats")
            .eq("player_id", player_id)
            .eq("season", season)
            .order("fetched_at", desc=True)
            .limit(1)
            .execute()
        )
        stats_blob = (row.data[0].get("stats") or {}) if row.data else {}

    if not stats_blob:
        logger.warning("No stats blob available for player %s season %s", player_id, season)
        return {}

    # Run evaluation across all skills
    skills_result = evaluate_all_skills(stats_blob, thresholds, league_avgs, debug=debug)

    # Second pass: apply cross-skill auto-promotions
    skills_result = apply_auto_promotions(skills_result, thresholds)

    return skills_result


def batch_evaluate_skills(
    player_ids: list[str],
    season: str,
    use_history: bool,
    supabase: Client,
) -> dict[str, dict]:
    """
    Evaluate skills for a list of players sequentially and persist to skill_profiles.

    If player_ids is empty, fetches all qualifying players (>= DEFAULT_MIN_MPG)
    for the season and processes them all (full league run — may take minutes).

    For each player:
      1. Evaluate skills via evaluate_all_skills
      2. Apply auto-promotions
      3. Upsert the full skills_result into skill_profiles table

    The skill_profiles upsert uses (player_id, season, source) as the unique key.
    source is always "stats" for this automated pipeline.

    Returns: { player_id: skills_result_dict, ... }
    """
    # Resolve player list — empty means "all qualifying players"
    if not player_ids:
        logger.info(
            "batch_evaluate_skills: no player_ids provided — fetching all qualifying players"
        )
        qualifying = (
            supabase.table("players")
            .select("id")
            .eq("season", season)
            .gte("minutes_per_game", DEFAULT_MIN_MPG)
            .execute()
        )
        player_ids = [row["id"] for row in (qualifying.data or [])]
        logger.info("Found %d qualifying players for season %s", len(player_ids), season)

    # Pre-load thresholds and league averages once for the whole batch
    thresholds = get_thresholds(supabase)
    league_avgs = get_league_averages(season, supabase)

    results: dict[str, dict] = {}
    total = len(player_ids)

    for idx, player_id in enumerate(player_ids, start=1):
        logger.info("Processing player %d/%d: %s", idx, total, player_id)

        try:
            # Fetch stats blob for this player
            if use_history:
                stats_blob = get_weighted_stats(player_id, season, supabase)
            else:
                row = (
                    supabase.table("player_stats")
                    .select("stats")
                    .eq("player_id", player_id)
                    .eq("season", season)
                    .order("fetched_at", desc=True)
                    .limit(1)
                    .execute()
                )
                stats_blob = (row.data[0].get("stats") or {}) if row.data else {}

            if not stats_blob:
                logger.warning("No stats for player %s — skipping", player_id)
                continue

            # Run the full evaluation pipeline for this player
            skills_result = evaluate_all_skills(stats_blob, thresholds, league_avgs)
            skills_result = apply_auto_promotions(skills_result, thresholds)

            # Persist to skill_profiles — upsert on (player_id, season, source)
            _upsert_skill_profile(player_id, season, skills_result, supabase)

            results[player_id] = skills_result

        except Exception:
            logger.exception("Error evaluating skills for player %s — continuing", player_id)

    logger.info(
        "batch_evaluate_skills complete: %d/%d players processed", len(results), total
    )
    return results


def _upsert_skill_profile(
    player_id: str,
    season: str,
    skills_result: dict,
    supabase: Client,
) -> None:
    """
    Upsert a skill profile record into the skill_profiles table.

    Unique constraint: (player_id, season, source). If a row already exists
    for this combination, it is updated in-place (profile and timestamps).
    source is always "stats" for automated pipeline runs.
    """
    # Determine review_required: True if any skill has review_recommended=True
    review_required = any(
        v.get("review_recommended", False) for v in skills_result.values()
    )

    profile_row = {
        "player_id": player_id,
        "season": season,
        "source": "stats",
        "profile": skills_result,
        "review_required": review_required,
        "reviewed": False,
        "reviewed_at": None,
        # is_legend=False: this endpoint only processes active-roster players fetched
        # from the NBA API. Legends have their own profile pipeline (Prompt 8) and
        # are inserted directly — they never flow through batch_evaluate_skills.
        "is_legend": False,
    }

    # Use upsert with on_conflict specifying the unique column combination
    supabase.table("skill_profiles").upsert(
        profile_row, on_conflict="player_id,season,source"
    ).execute()

    logger.debug("Upserted skill profile for player %s season %s", player_id, season)
