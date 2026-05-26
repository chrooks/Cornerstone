"""
skill_engine/pipeline.py — Orchestration: fetch stats → evaluate → persist.

Entry points:
  - get_player_skills:      evaluate all skills for a single player
  - batch_evaluate_skills:  evaluate + persist for a list of players
"""

import logging

from supabase import Client

from services.players_service import DEFAULT_MIN_MPG
from services.skill_engine.cache import get_league_averages, get_thresholds
from services.skill_engine.evaluator import apply_auto_promotions, evaluate_all_skills
from services.skill_engine.history import get_weighted_stats

logger = logging.getLogger(__name__)


# ===========================================================================
# Public entry points
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
    Evaluate skills for a list of players sequentially and persist to draft_skill_profiles.

    If player_ids is empty, fetches all qualifying players (>= DEFAULT_MIN_MPG)
    for the season and processes them all (full league run — may take minutes).

    For each player:
      1. Evaluate skills via evaluate_all_skills
      2. Apply auto-promotions
      3. Upsert the full skills_result into draft_skill_profiles table

    The draft_skill_profiles upsert uses (player_id, season, source) as the unique key.
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

            # Persist to draft_skill_profiles — upsert on (player_id, season, source).
            # Low-confidence skills are preserved from the existing profile so that
            # hand-tuned or manually reviewed values aren't blown away on every run.
            _upsert_skill_profile(player_id, season, skills_result, supabase, thresholds)

            results[player_id] = skills_result

        except Exception:
            logger.exception("Error evaluating skills for player %s — continuing", player_id)

    logger.info(
        "batch_evaluate_skills complete: %d/%d players processed", len(results), total
    )
    return results


# ===========================================================================
# Internal helpers
# ===========================================================================


def _upsert_skill_profile(
    player_id: str,
    season: str,
    skills_result: dict,
    supabase: Client,
    thresholds: dict | None = None,
) -> None:
    """
    Upsert a skill profile record into the draft_skill_profiles table.

    Unique constraint: (player_id, season, source). If a row already exists
    for this combination, it is updated in-place (profile and timestamps).
    source is always "stats" for automated pipeline runs.

    If thresholds are provided, skills marked stat_confidence="low" are preserved
    from the existing profile rather than overwritten. This protects hand-tuned
    low-confidence skills (e.g. high_flyer) from being reset on every pipeline run.
    """
    # Merge low-confidence skill results from existing profile when thresholds are available
    if thresholds:
        low_confidence_skills = {
            skill_name
            for skill_name, rule in thresholds.items()
            if rule.get("stat_confidence") == "low"
        }

        if low_confidence_skills:
            existing_row = (
                supabase.table("draft_skill_profiles")
                .select("profile")
                .eq("player_id", player_id)
                .eq("season", season)
                .eq("source", "stats")
                .maybe_single()
                .execute()
            )
            existing_profile = (
                (existing_row.data or {}).get("profile") or {}
                if existing_row.data
                else {}
            )

            # Preserve existing low-confidence skill entries; fall back to newly computed
            # value only when no existing entry is found (e.g. first-ever run).
            for skill_name in low_confidence_skills:
                if skill_name in existing_profile:
                    skills_result[skill_name] = existing_profile[skill_name]

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
    supabase.table("draft_skill_profiles").upsert(
        profile_row, on_conflict="player_id,season,source"
    ).execute()

    logger.debug("Upserted skill profile for player %s season %s", player_id, season)
