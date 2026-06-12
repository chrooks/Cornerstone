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
from services.compositing import composite_skill
from services.notability import get_notability_score
from services.skills import HIGH_CONFIDENCE_SKILLS
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


def _merge_composite_for_skills(
    skills_result: dict,
    affected_skills: list[str],
    existing_composite: dict,
    notability_score: int,
) -> dict:
    """Recompute the affected skills' composite entries, merged into the existing profile.

    The commit RPC replaces the whole composite JSONB, so the returned profile
    must carry every skill — start from the player's existing composite and
    overwrite only the affected skills. Claude context is reconstructed from the
    existing composite entry (None for high-confidence skills, which composite
    purely from stats).
    """
    merged = dict(existing_composite)
    for skill_name in affected_skills:
        stat_result = skills_result.get(skill_name)
        if stat_result is None:
            continue
        if skill_name in HIGH_CONFIDENCE_SKILLS:
            claude_result = None
        else:
            existing_entry = existing_composite.get(skill_name) or {}
            claude_tier = existing_entry.get("claude_tier")
            claude_result = {
                "tier": claude_tier,
                "confidence": existing_entry.get("claude_confidence"),
                "claude_failed": claude_tier is None,
            }
        merged[skill_name] = composite_skill(
            skill_name, stat_result, claude_result, notability_score
        )
    return merged


def evaluate_skills_for_run(
    run_id: str,
    player_ids: list[str],
    season: str,
    skill_filter: Optional[list[str]] = None,
    thresholds_override: Optional[dict] = None,
    recompute_composite: bool = False,
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
        recompute_composite: If True, stage source='composite' rows instead of
                             source='stats'. The affected skills' composite is
                             recomputed and merged into each player's existing
                             composite profile, so commit updates what the Player
                             Pool / publish read. Players without an existing
                             composite are skipped (never stage a partial profile,
                             which the replace-on-commit RPC would clobber).
                             Used by threshold_edit runs.

    Side effects:
        - Reads player_stats from Supabase.
        - Calls evaluate_all_skills + apply_auto_promotions.
        - Calls stage_profile_rows (writes to pipeline_run_results).
        - When recompute_composite: also reads draft_skill_profiles (composite)
          and notability, and calls composite_skill.
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

    # When recomputing composite, batch-fetch each player's existing composite
    # profile to merge the affected skills into (preserving untouched skills).
    existing_composite_by_player: dict[str, dict] = {}
    affected_skills: list[str] = []
    needs_notability = False
    if recompute_composite:
        affected_skills = list(skill_filter) if skill_filter else []
        needs_notability = any(s not in HIGH_CONFIDENCE_SKILLS for s in affected_skills)
        comp_result = run_query(
            lambda: client.table("draft_skill_profiles")
            .select("player_id, profile")
            .eq("source", "composite")
            .eq("season", season)
            .in_("player_id", player_ids)
            .execute()
        )
        for row in (comp_result.data or []):
            existing_composite_by_player[row["player_id"]] = row.get("profile") or {}

    staged_profiles: list[StagedProfileRow] = []
    staged_flags: list[StagedFlagRow] = []
    skipped_no_composite = 0

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

        if recompute_composite:
            # Stage the merged composite (what the Player Pool / publish read).
            existing_composite = existing_composite_by_player.get(player_id)
            if not existing_composite:
                skipped_no_composite += 1
                logger.warning(
                    "evaluate_skills_for_run: no existing composite for player %s "
                    "season %s — skipping (won't stage a partial profile)",
                    player_id, season,
                )
                continue
            notability = (
                get_notability_score(player_id, season, client)
                if needs_notability else 0
            )
            merged_composite = _merge_composite_for_skills(
                skills_result, affected_skills, existing_composite, notability
            )
            staged_profiles.append(StagedProfileRow(
                player_id=player_id,
                season=season,
                source="composite",
                profile=merged_composite,
            ))
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
        "evaluate_skills_for_run [%s]: staged %d profile rows, %d flag rows"
        "%s",
        run_id, len(staged_profiles), len(staged_flags),
        f", skipped {skipped_no_composite} player(s) with no existing composite"
        if skipped_no_composite else "",
    )
