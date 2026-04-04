"""
skill_engine/cache.py — Module-level TTL caches for thresholds and league averages.

Provides:
  - get_thresholds:                     5-min TTL cache, reads skill_thresholds table
  - get_league_averages:                24-hr TTL cache, reads league_averages table
  - compute_and_store_league_averages:  compute from player_stats, persist, refresh cache
"""

import logging
import time
from typing import Any

from supabase import Client

from services.players_service import DEFAULT_MIN_MPG
from services.skill_engine.conditions import resolve_stat

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# The 17 stat keys (dot notation) for which we compute league averages.
# These cover the most commonly stabilized percentage and PPP stats.
# ---------------------------------------------------------------------------

_LEAGUE_AVG_STAT_KEYS: list[str] = [
    "tracking_shooting.catch_shoot_fg3_pct",
    "tracking_shooting.pullup_fg3_pct",
    "tracking_shooting.pullup_fg2_pct",
    "tracking_drives.drive_fg_pct",
    "shot_zones.paint_non_ra_fg_pct",
    "shot_zones.mid_range_fg_pct",
    "shot_zones.restricted_area_fg_pct",
    "tracking_post_touch.post_touch_fg_pct",
    "tracking_defense.defended_at_rim_fg_pct",
    "shot_detail.floating_jump_shot_fg_pct",
    "play_type.spotup_ppp",
    "play_type.offscreen_ppp",
    "play_type.handoff_ppp",
    "play_type.pr_ball_handler_ppp",
    "play_type.pr_roll_man_ppp",
    "play_type.cut_ppp",
    "play_type.transition_ppp",
    "play_type.postup_ppp",
]

# ---------------------------------------------------------------------------
# Module-level caches: (data_dict, timestamp_float) tuples.
# Not thread-safe — Flask runs single-threaded in dev; add a lock for prod.
# ---------------------------------------------------------------------------

_thresholds_cache: tuple[dict, float] | None = None
_THRESHOLDS_TTL_SECS = 300  # 5 minutes

_league_avg_cache: dict[str, tuple[dict, float]] = {}  # season -> (data, ts)
_LEAGUE_AVG_TTL_SECS = 86400  # 24 hours


def get_thresholds(supabase: Client, refresh: bool = False) -> dict[str, Any]:
    """
    Return all skill thresholds keyed by skill_name.

    Uses a module-level cache with a 5-minute TTL. Pass refresh=True to force
    a fresh read from Supabase (e.g., after editing rules in the database).

    Returns: { skill_name: thresholds_dict, ... }
    """
    global _thresholds_cache

    now = time.monotonic()

    # Return cached data if still within TTL and not forced refresh
    if (
        not refresh
        and _thresholds_cache is not None
        and (now - _thresholds_cache[1]) < _THRESHOLDS_TTL_SECS
    ):
        return _thresholds_cache[0]

    logger.info("Loading skill thresholds from Supabase")
    rows = (
        supabase.table("skill_thresholds")
        .select("skill_name, thresholds")
        .execute()
    )

    result: dict[str, Any] = {}
    for row in rows.data or []:
        # skill_name is the lookup key; thresholds is the full JSONB rule object
        result[row["skill_name"]] = row["thresholds"]

    _thresholds_cache = (result, now)
    logger.info("Loaded %d skill threshold rules", len(result))
    return result


def get_league_averages(
    season: str, supabase: Client, refresh: bool = False
) -> dict[str, float]:
    """
    Return league average values keyed by stat_key for the given season.

    Uses a module-level cache with a 24-hour TTL. On cache miss or refresh,
    reads from the league_averages table (which is pre-populated by
    compute_and_store_league_averages). If the table is empty for the season,
    returns an empty dict (stabilization will still work, just with no prior).

    Returns: { stat_key: float_value, ... }
    """
    now = time.monotonic()

    # Check TTL for this specific season's cache entry
    cached = _league_avg_cache.get(season)
    if (
        not refresh
        and cached is not None
        and (now - cached[1]) < _LEAGUE_AVG_TTL_SECS
    ):
        return cached[0]

    logger.info("Loading league averages from Supabase for season %s", season)
    rows = (
        supabase.table("league_averages")
        .select("stat_key, value")
        .eq("season", season)
        .execute()
    )

    result: dict[str, float] = {}
    for row in rows.data or []:
        val = row.get("value")
        if val is not None:
            result[row["stat_key"]] = float(val)

    _league_avg_cache[season] = (result, now)
    logger.info("Loaded %d league average stats for season %s", len(result), season)
    return result


def compute_and_store_league_averages(season: str, supabase: Client) -> dict[str, float]:
    """
    Compute league average values from the player_stats table and persist them.

    Only includes players with minutes_per_game >= DEFAULT_MIN_MPG (15).
    Computes the mean for each of the 17 required stat keys, ignoring nulls.
    Upserts into league_averages on (season, stat_key) conflict.

    Returns the computed averages dict (same shape as get_league_averages).
    """
    logger.info("Computing league averages for season %s from player_stats", season)

    # Fetch all player stats rows for the season; we need the stats JSONB blob
    # and the player's minutes_per_game from the players table via a join.
    # Supabase doesn't support direct joins in the client, so we do two queries:
    # 1) Get qualifying player_ids (min MPG filter from the players table)
    # 2) Fetch their stats blobs and compute averages in Python.

    qualifying = (
        supabase.table("players")
        .select("id")
        .eq("season", season)
        .gte("minutes_per_game", DEFAULT_MIN_MPG)
        .execute()
    )
    qualifying_ids = {row["id"] for row in (qualifying.data or [])}

    if not qualifying_ids:
        logger.warning("No qualifying players found for season %s", season)
        return {}

    # Fetch stats blobs only for qualifying players using an IN filter.
    # This avoids pulling the entire player_stats table over the network.
    stats_rows = (
        supabase.table("player_stats")
        .select("player_id, stats")
        .eq("season", season)
        .in_("player_id", list(qualifying_ids))
        .execute()
    )

    # Accumulate per-stat values across qualifying players
    # Each key maps to a list of non-null float values
    accumulator: dict[str, list[float]] = {k: [] for k in _LEAGUE_AVG_STAT_KEYS}

    for row in stats_rows.data or []:
        # Only include qualifying players (min MPG filter)
        if row["player_id"] not in qualifying_ids:
            continue

        blob = row.get("stats") or {}
        for stat_key in _LEAGUE_AVG_STAT_KEYS:
            val = resolve_stat(blob, stat_key)
            if val is not None:
                accumulator[stat_key].append(val)

    # Compute means and build upsert records
    averages: dict[str, float] = {}
    upsert_rows: list[dict] = []

    for stat_key, values in accumulator.items():
        if not values:
            logger.debug("No values found for stat_key=%s in season %s", stat_key, season)
            continue

        mean_val = sum(values) / len(values)
        averages[stat_key] = mean_val
        upsert_rows.append({
            "season": season,
            "stat_key": stat_key,
            "value": mean_val,
            "sample_size": len(values),
        })

    if upsert_rows:
        supabase.table("league_averages").upsert(
            upsert_rows, on_conflict="season,stat_key"
        ).execute()
        logger.info(
            "Upserted %d league averages for season %s", len(upsert_rows), season
        )

    # Refresh the in-memory cache immediately so callers don't need a round-trip
    _league_avg_cache[season] = (averages, time.monotonic())
    return averages
