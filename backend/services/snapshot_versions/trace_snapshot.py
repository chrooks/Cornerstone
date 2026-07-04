"""
services/snapshot_versions/trace_snapshot.py — freeze the per-skill stat trace
and resolved override history into released_players.skill_trace_snapshot at
Snapshot Release publish time.

See feature_requests/player-skill-provenance-plan.md (issue #82) for the full
design: why this reads the draft workspace once at publish instead of on every
public profile view, and why the response shape is {computed, skills} rather
than a bare {} on failure.
"""

import logging

from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import collect_condition_results
from services.skills import ALL_SKILLS

logger = logging.getLogger(__name__)

_BATCH = 100  # PostgREST IN(...) URL-length limit — same constant as
              # released_repo.py's fetch_profiles_by_source_player_ids and
              # players.py's _fetch_stats_bulk.


def snapshot_skill_traces(release_id: str, season: str, *, client) -> int:
    """Freeze skill_trace_snapshot for every non-legend released_players row
    in this release. Never raises — a failure for one player leaves that
    player's trace as computed=False rather than aborting the whole publish.

    Returns the number of rows processed (attempted).
    """
    rows = (
        client.table("released_players")
        .select("id, source_player_id, source_skill_profile_id, stat_season")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", False)
        .execute()
    ).data or []

    thresholds = get_thresholds(client)
    league_avgs = get_league_averages(season, client)

    flags_by_profile = _load_flags_grouped_by_profile(
        client, [row["source_skill_profile_id"] for row in rows]
    )
    stats_by_player = _load_stats_bulk(
        client, [row["source_player_id"] for row in rows], season
    )

    updated = 0
    for row in rows:
        try:
            _freeze_one_player(client, row, thresholds, league_avgs, stats_by_player, flags_by_profile)
            updated += 1
        except Exception:
            logger.exception("Trace freeze failed for released_players row %s — skipping, publish continues", row["id"])

    if updated != len(rows):
        logger.warning(
            "Trace freeze incomplete for release %s: %d/%d rows updated",
            release_id, updated, len(rows),
        )

    return updated


def _freeze_one_player(client, row, thresholds, league_avgs, stats_by_player, flags_by_profile) -> None:
    """Compute and write skill_trace_snapshot for one released_players row.
    Raises on any failure — the caller decides how to log/tolerate it."""
    stats_blob = stats_by_player.get(row["source_player_id"])
    overrides = flags_by_profile.get(row["source_skill_profile_id"], {})

    if stats_blob is None:
        logger.warning("No player_stats for %s — marking computed=False", row["source_player_id"])
        skills = {s: {"condition_results": [], "override": None} for s in ALL_SKILLS}
        trace = {"computed": False, "skills": skills}
    else:
        skills = {}
        for skill_name in ALL_SKILLS:
            rule = thresholds.get(skill_name)
            skills[skill_name] = {
                "condition_results": collect_condition_results(rule, stats_blob, league_avgs) if rule else [],
                "override": overrides.get(skill_name),
            }
        trace = {"computed": True, "skills": skills}

    client.table("released_players").update({"skill_trace_snapshot": trace}).eq("id", row["id"]).execute()


def _load_flags_grouped_by_profile(client, skill_profile_ids: list[str]) -> dict[str, dict[str, dict]]:
    """Return {skill_profile_id: {skill_name: {resolution, resolved_value, resolved_at}}}
    for every resolved flag. Never selects `notes` — it must never reach the
    public trace. When more than one row exists for the same
    (skill_profile_id, skill_name), the row with the latest resolved_at wins."""
    ids = sorted(set(skill_profile_ids))
    by_profile: dict[str, dict[str, dict]] = {}

    for i in range(0, len(ids), _BATCH):
        batch = ids[i : i + _BATCH]
        rows = (
            client.table("draft_skill_flags")
            .select("skill_profile_id, skill_name, resolution, resolved_value, resolved_at")
            .in_("skill_profile_id", batch)
            .execute()
        ).data or []

        for flag in rows:
            if flag.get("resolution") is None:
                continue
            skill_map = by_profile.setdefault(flag["skill_profile_id"], {})
            existing = skill_map.get(flag["skill_name"])
            if existing is None or (flag.get("resolved_at") or "") >= (existing.get("resolved_at") or ""):
                skill_map[flag["skill_name"]] = {
                    "resolution": flag["resolution"],
                    "resolved_value": flag["resolved_value"],
                    "resolved_at": flag["resolved_at"],
                }

    return by_profile


def _load_stats_bulk(client, player_ids: list[str], season: str) -> dict[str, dict]:
    """Return {player_id: stats_blob} using each player's most recent
    player_stats row for the season, batched like _fetch_stats_bulk
    (backend/api/players.py) instead of one query per player."""
    ids = sorted(set(player_ids))
    stats_by_player: dict[str, dict] = {}

    for i in range(0, len(ids), _BATCH):
        batch = ids[i : i + _BATCH]
        rows = (
            client.table("player_stats")
            .select("player_id, stats, fetched_at")
            .in_("player_id", batch)
            .eq("season", season)
            .order("fetched_at", desc=True)
            .execute()
        ).data or []

        for row in rows:
            pid = row["player_id"]
            if pid not in stats_by_player:
                stats_by_player[pid] = row.get("stats") or {}

    return stats_by_player
