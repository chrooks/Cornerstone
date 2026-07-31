"""
snapshot_versions/drift_audit.py — Report-only stale-tier drift detector (issue #86).

A player's stored composite skill tier is only ever recomputed when something
re-runs the pipeline for that exact player/skill (a threshold_edit run, a
single-player re-evaluation, etc.). Nothing does that automatically when a
threshold or stat blob changes — so a stored tier can silently go stale and
survive every later publish (the Giannis offensive_rebounder bug behind #86).

This module recomputes a player's stat-source skill tiers from their latest
player_stats row + live thresholds — the same evaluate_all_skills +
apply_auto_promotions path evaluate_skills_for_run() uses (see
skill_engine/evaluation_only.py) — and diffs the result against the stored
composite tier.

Source-aware: only entries whose stored `source` is 'stats_only' are ever
compared. That is the exact value compositing.py's composite_skill() assigns
to HIGH_CONFIDENCE_SKILLS (no Claude call, no human review) — the only case
where a stored final_tier is nothing but stat-evaluator output. Any other
source ('auto_accepted' / 'flagged' — Claude-influenced, or 'resolved' /
'manual_override' — a human's call per issue #120) legitimately diverges from
a pure stat recompute and is never reported as drift.

REPORT-ONLY — this module never writes to the database.

Public Surface:
  find_tier_drift(season, client=None, player_ids=None) -> list[DriftEntry]
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from services.supabase_client import get_supabase, run_query
from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import evaluate_all_skills, apply_auto_promotions
from services.players_service import _blob_has_data

logger = logging.getLogger(__name__)

# The only `source` value a comparison is valid against — see module docstring.
_STATS_DERIVED_SOURCE = "stats_only"


@dataclass(frozen=True)
class DriftEntry:
    """One stored, stats-derived tier that disagrees with a fresh recompute."""

    player_id: str
    player_name: str
    skill_name: str
    stored_tier: Optional[str]
    recomputed_tier: str
    source: str


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


def _fetch_composite_profiles(
    client, season: str, player_ids: Optional[list[str]]
) -> dict[str, dict]:
    """player_id -> composite profile dict (draft_skill_profiles, source='composite').

    player_ids=None fetches every player with a composite profile for the
    season — the full-sweep case.
    """

    def build_query():
        q = (
            client.table("draft_skill_profiles")
            .select("player_id, profile")
            .eq("source", "composite")
            .eq("season", season)
        )
        if player_ids:
            q = q.in_("player_id", player_ids)
        return q

    result = run_query(lambda: build_query().execute())
    return {row["player_id"]: row.get("profile") or {} for row in (result.data or [])}


def _fetch_latest_stats(client, season: str, player_ids: list[str]) -> dict[str, dict]:
    """player_id -> latest usable stats blob.

    Mirrors evaluate_skills_for_run()'s newest-first / skip-empty-row logic
    (skill_engine/evaluation_only.py) — load-bearing for the same reason:
    player_stats is insert-only, so a player accumulates one row per fetch,
    and an unordered "first row wins" pick can land on a stale or all-null
    row. Ordering fetched_at desc and skipping empty blobs makes "first row
    wins" mean "newest usable row wins".
    """
    stats_result = run_query(
        lambda: client.table("player_stats")
        .select("player_id, stats, fetched_at")
        .eq("season", season)
        .in_("player_id", player_ids)
        .order("fetched_at", desc=True)
        .execute()
    )
    stats_by_player: dict[str, dict] = {}
    for row in stats_result.data or []:
        pid = row["player_id"]
        if pid in stats_by_player:
            continue
        blob = row.get("stats") or {}
        if not _blob_has_data(blob):
            continue
        stats_by_player[pid] = blob
    return stats_by_player


def _fetch_player_names(client, player_ids: list[str]) -> dict[str, str]:
    result = run_query(
        lambda: client.table("players").select("id, name").in_("id", player_ids).execute()
    )
    return {row["id"]: row.get("name") for row in (result.data or [])}


def find_tier_drift(
    season: str,
    client=None,
    player_ids: Optional[list[str]] = None,
) -> list[DriftEntry]:
    """Recompute stat tiers and diff them against stored composite tiers.

    REPORT-ONLY — never mutates data.

    Args:
        season:      Season to recompute + compare against (e.g. '2025-26').
        client:      Optional Supabase client (tests inject a fake).
        player_ids:  Restrict the check to these players. None (default)
                     sweeps every player with a stored composite profile for
                     the season.

    Returns:
        One DriftEntry per (player, skill) whose stored, stats-derived tier
        ('source' == 'stats_only') disagrees with the fresh recompute.
    """
    c = client or _get_client()

    composites_by_player = _fetch_composite_profiles(c, season, player_ids)
    if not composites_by_player:
        return []

    scoped_ids = list(composites_by_player.keys())
    thresholds = get_thresholds(c)
    league_avgs = get_league_averages(season, c)
    stats_by_player = _fetch_latest_stats(c, season, scoped_ids)
    names_by_player = _fetch_player_names(c, scoped_ids)

    drift: list[DriftEntry] = []
    for player_id in scoped_ids:
        stats_blob = stats_by_player.get(player_id)
        composite = composites_by_player.get(player_id) or {}
        if not stats_blob:
            continue

        try:
            skills_result = evaluate_all_skills(stats_blob, thresholds, league_avgs)
            skills_result = apply_auto_promotions(skills_result, thresholds)
        except Exception:
            logger.exception(
                "find_tier_drift: error recomputing player %s — skipping", player_id
            )
            continue

        for skill_name, recomputed in skills_result.items():
            stored_entry = composite.get(skill_name)
            if not isinstance(stored_entry, dict):
                continue
            if stored_entry.get("source") != _STATS_DERIVED_SOURCE:
                continue

            stored_tier = stored_entry.get("final_tier")
            recomputed_tier = recomputed.get("tier")
            if stored_tier == recomputed_tier:
                continue

            drift.append(
                DriftEntry(
                    player_id=player_id,
                    player_name=names_by_player.get(player_id) or player_id,
                    skill_name=skill_name,
                    stored_tier=stored_tier,
                    recomputed_tier=recomputed_tier,
                    source=stored_entry.get("source"),
                )
            )

    return drift
