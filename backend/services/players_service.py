"""
players_service.py — Business logic for player data fetching and caching.

Coordinates between the nba_api_client (data fetching), stats_assembler
(blob construction), salary_scraper (ESPN data), and Supabase (persistence).

All public functions accept a Supabase client as their last argument so they
remain unit-testable without a live connection.
"""

import logging
import math
from datetime import datetime, timedelta, timezone

from supabase import Client

from services import nba_api_client, salary_scraper
from services.stats_assembler import assemble_stats_blob
from services.supabase_client import run_query

logger = logging.getLogger(__name__)

# Current NBA season — update each season
CURRENT_SEASON = "2025-26"
DEFAULT_MIN_MPG = 15.0

# NBA minimum salary for the current season (0 years of service).
# Update this each offseason when the new CBA minimum is set.
# 2025-26 minimum: $1,119,563
NBA_MINIMUM_SALARY = 1_119_563

# Salary cache TTL — 7 days
_SALARY_TTL_DAYS = 7

# Career cache TTL — 30 days, stored in player_stats with season="career"
_CAREER_TTL_DAYS = 30

# Stats cache TTL for the current season.
# Season averages change slowly — 7 days keeps review workflows fast
# while still reflecting meaningful stat shifts across a week of games.
_STATS_TTL_HOURS = 168  # 7 days


# ---------------------------------------------------------------------------
# GET /api/players
# ---------------------------------------------------------------------------

def get_or_fetch_players(
    season: str,
    min_mpg: float,
    refresh: bool,
    supabase: Client,
) -> list[dict]:
    """
    Return all qualified players for the season.

    If the players table already has rows for this season and refresh=False,
    return those rows filtered by min_mpg.  Otherwise fetch fresh data from
    nba_api (bulk base stats), upsert into Supabase, and return the result.
    """
    if not refresh:
        # Check if Supabase already has player rows for this season
        existing = (
            supabase.table("players")
            .select("id, nba_api_id, name, team, position, height, weight, age, games_played, minutes_per_game, salary, season, draft_round, season_exp")
            .eq("season", season)
            .gte("minutes_per_game", min_mpg)
            .execute()
        )
        if existing.data:
            return enrich_with_rookie_deal(existing.data)

    # Fetch fresh bulk base stats and physical attributes from nba_api
    logger.info("Fetching fresh player list from nba_api for season %s", season)
    bulk_data    = nba_api_client.get_bulk_stats(season)
    base_data    = bulk_data.get("base", {})
    # PlayerIndex gives height, weight, and the most reliable position string
    player_index = nba_api_client.get_player_index(season)

    if not base_data:
        logger.error("No base stats returned from nba_api for season %s", season)
        return []

    # Build player upsert records, merging base stats + physical attributes
    upsert_rows = []
    for pid, row in base_data.items():
        mpg      = float(row.get("MIN") or 0)
        pid_int  = int(pid)
        physical = player_index.get(pid_int, {})

        # Prefer PlayerIndex position (cleaner); fall back to base stats column
        position = (
            physical.get("position")
            or str(row.get("PLAYER_POSITION") or row.get("POSITION") or "")
        )

        # Derive season_exp from draft_year when available.
        # season string is "2025-26" → start year 2025.
        draft_year = physical.get("draft_year")
        season_start = int(season.split("-")[0]) if "-" in season else None
        season_exp = (season_start - draft_year) if (season_start and draft_year) else None

        upsert_rows.append({
            "nba_api_id":       pid_int,
            "name":             str(row.get("PLAYER_NAME", "")),
            "team":             str(row.get("TEAM_ABBREVIATION", "")),
            "position":         position,
            "height":           physical.get("height"),   # e.g. "6-7"
            "weight":           physical.get("weight"),   # lbs as integer
            "age":              _safe_int(row.get("AGE")),
            "games_played":     _safe_int(row.get("GP")),
            "minutes_per_game": round(mpg, 2),
            "season":           season,
            "draft_round":      physical.get("draft_round"),
            "season_exp":       season_exp,
        })

    if upsert_rows:
        # Upsert on nba_api_id conflict to handle existing rows
        supabase.table("players").upsert(upsert_rows, on_conflict="nba_api_id").execute()
        logger.info("Upserted %d players for season %s", len(upsert_rows), season)

    # Return from Supabase (now has fresh data) filtered by min_mpg
    result = (
        supabase.table("players")
        .select("id, nba_api_id, name, team, position, height, weight, age, games_played, minutes_per_game, salary, season, draft_round, season_exp")
        .eq("season", season)
        .gte("minutes_per_game", min_mpg)
        .execute()
    )
    return enrich_with_rookie_deal(result.data or [])


# ---------------------------------------------------------------------------
# Rookie deal derivation
# ---------------------------------------------------------------------------

def derive_is_rookie_deal(player: dict) -> bool:
    """
    Derive rookie deal status from draft_round and season_exp.

    Per the CBA, rookie scale contracts are 4-year deals signed only by
    first-round picks. SEASON_EXP <= 3 means they're still within that
    window (years 0-3 = seasons 1-4).
    """
    draft_round = player.get("draft_round")
    season_exp = player.get("season_exp")
    if draft_round is None or season_exp is None:
        return False
    return draft_round == 1 and season_exp <= 3


def enrich_with_rookie_deal(players: list[dict]) -> list[dict]:
    """Add is_rookie_deal to each player dict (immutable — returns new list)."""
    return [{**p, "is_rookie_deal": derive_is_rookie_deal(p)} for p in players]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sanitize_floats(obj: object) -> object:
    """
    Recursively walk a JSON-serializable structure and replace any float
    NaN or Inf values with None. Required because Python's json module
    (and httpx's JSON encoder) rejects non-compliant IEEE 754 values.
    """
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_floats(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/stats
# ---------------------------------------------------------------------------

def get_or_fetch_player_stats(
    player_id: str,
    season: str,
    supabase: Client,
    refresh: bool = False,
    cached_only: bool = False,
) -> dict | None:
    """
    Return the stats blob for a player/season, using Supabase as the cache.

    Cache TTL:
      - Current season: 24 hours (stats change game to game)
      - Prior seasons: indefinite (historical data doesn't change)

    Pass refresh=True to bypass the cache and force a fresh NBA API fetch.
    Useful when a previous fetch timed out and left incomplete data cached.

    Pass cached_only=True to return whatever is cached WITHOUT ever triggering a
    live nba_api fetch (~18s of ShotChartDetail + matchup calls). The review/QA
    path uses this — a stale-but-instant blob beats blocking the page on a cold
    fetch. Stats refresh belongs to the draft fetch-stats pipeline stage, not a
    read-only review view. Returns the cached blob, or None when nothing is cached.

    Returns None if the player is not found.
    """
    # Resolve player record (need nba_api_id)
    player = _get_player_by_id(player_id, supabase)
    if not player:
        return None

    nba_api_id = int(player["nba_api_id"])
    gp = int(player.get("games_played") or 0)
    mpg = float(player.get("minutes_per_game") or 0)

    # Check cache: look for a player_stats row for this player + season
    cutoff = _stats_cache_cutoff(season)
    cached = run_query(lambda: (
        supabase.table("player_stats")
        .select("stats, fetched_at")
        .eq("player_id", player_id)
        .eq("season", season)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    ))
    if cached.data and not refresh:
        row = cached.data[0]
        fetched_at = _parse_ts(row["fetched_at"])
        if cutoff is None or (fetched_at and fetched_at > cutoff):
            # Cache is fresh — return without hitting nba_api
            return row["stats"]

    # cached_only: never trigger the ~18s live fetch. Return the stale cached
    # blob if one exists; otherwise signal "no cached stats" with None.
    if cached_only:
        return cached.data[0]["stats"] if cached.data else None

    # Cache miss — fetch fresh stats
    logger.info("Fetching fresh stats for player %s (nba_api_id=%d, season=%s)", player_id, nba_api_id, season)

    bulk_data    = nba_api_client.get_bulk_stats(season)
    # PlayerIndex is already cached from the bulk fetch; reuse it for position
    # lookups in matchup defense so we avoid per-player CommonPlayerInfo calls.
    player_index = nba_api_client.get_player_index(season)

    # Lazy per-player fetches
    shot_chart_df = nba_api_client.get_player_shot_chart(nba_api_id, season)
    matchup_df    = nba_api_client.get_player_matchups(nba_api_id, season)

    # Get salary and physical attributes from players table
    salary = player.get("salary")
    weight = player.get("weight")  # lbs integer from PlayerIndex

    blob = assemble_stats_blob(
        nba_api_id=nba_api_id,
        bulk_data=bulk_data,
        shot_chart_df=shot_chart_df,
        matchup_df=matchup_df,
        salary=salary,
        season=season,
        games_played=gp,
        minutes_per_game=mpg,
        player_index=player_index,
        weight=weight,
    )

    # Ensure salary is written to players.salary as well as the blob (AC #7)
    if salary is not None:
        run_query(lambda: supabase.table("players").update({"salary": salary}).eq("id", player_id).execute())

    # Sanitize the blob before persisting — replace NaN/Inf floats with None
    # so the JSON encoder doesn't raise on non-compliant float values (e.g. when
    # a partial fetch like LeagueSeasonMatchups times out and leaves NaN in the data).
    blob = _sanitize_floats(blob)

    # Persist stats blob to Supabase (blob already contains salary section)
    run_query(lambda: supabase.table("player_stats").insert({
        "player_id": player_id,
        "season":    season,
        "stats":     blob,
    }).execute())

    return blob


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/salary
# ---------------------------------------------------------------------------

def get_player_salary(player_id: str, supabase: Client) -> int | None:
    """
    Return the player's current salary.

    If the cached salary in the players table is still fresh (< 7 days),
    return it directly.  Otherwise trigger an ESPN scrape for the player's
    team and update all players on that team.
    """
    player = _get_player_by_id(player_id, supabase)
    if not player:
        return None

    salary = player.get("salary")
    updated_at = _parse_ts(player.get("updated_at"))
    cache_cutoff = datetime.now(timezone.utc) - timedelta(days=_SALARY_TTL_DAYS)

    if salary is not None and updated_at and updated_at > cache_cutoff:
        return salary

    # Cache miss — scrape ESPN for this player's team
    team = player.get("team", "")
    if not team:
        return salary  # No team, return whatever we have

    logger.info("Salary cache miss for player %s (team=%s) — scraping ESPN", player_id, team)
    salary_map = salary_scraper.scrape_team_salaries(team)
    if not salary_map:
        return salary  # Scrape failed, return cached value (may be None)

    # Update all players on this team in Supabase
    _update_team_salaries(team, salary_map, supabase)

    # Re-fetch the updated player record
    updated_player = _get_player_by_id(player_id, supabase)
    return updated_player.get("salary") if updated_player else None


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/career
# ---------------------------------------------------------------------------

def get_or_fetch_career(player_id: str, supabase: Client) -> dict | None:
    """
    Return career metadata for a player.

    Cached in the player_stats table using season="career" (30-day TTL).
    Returns: career_games_played, seasons_played, all_star_appearances,
             all_nba_selections, mvp_top5_finishes, dpoy_top5_finishes, award_winner.
    """
    player = _get_player_by_id(player_id, supabase)
    if not player:
        return None

    nba_api_id = int(player["nba_api_id"])

    # Check cache (season="career" is the sentinel key)
    cache_cutoff = datetime.now(timezone.utc) - timedelta(days=_CAREER_TTL_DAYS)
    cached = (
        supabase.table("player_stats")
        .select("stats, fetched_at")
        .eq("player_id", player_id)
        .eq("season", "career")
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    if cached.data:
        row = cached.data[0]
        fetched_at = _parse_ts(row["fetched_at"])
        if fetched_at and fetched_at > cache_cutoff:
            return row["stats"]

    # Fetch fresh career data
    career_raw = nba_api_client.get_player_career_stats(nba_api_id)
    awards_df  = nba_api_client.get_player_awards(nba_api_id)

    career_data = _build_career_dict(career_raw, awards_df)

    # Persist
    supabase.table("player_stats").insert({
        "player_id": player_id,
        "season":    "career",
        "stats":     career_data,
    }).execute()

    return career_data


# ---------------------------------------------------------------------------
# GET /api/salaries/bulk
# ---------------------------------------------------------------------------

def run_bulk_salary_scrape(
    team_abbrev: str | None,
    supabase: Client,
    player_ids: list[str] | None = None,
) -> dict:
    """
    Scrape salary data from ESPN and upsert into Supabase.

    If team_abbrev is provided, scrape only that team's roster page.
    Otherwise scrape the full league via paginated salary listing.

    If player_ids is provided, only those players are matched and updated —
    other players on the scraped page(s) are left untouched (#76 subset runs).

    Returns {"matched": int, "unmatched": int, "total": int}.
    """
    if team_abbrev:
        salary_map = salary_scraper.scrape_team_salaries(team_abbrev)
        target_label = team_abbrev
    else:
        salary_map = salary_scraper.scrape_all_salaries()
        target_label = "all teams"

    if not salary_map:
        logger.warning("No salary data scraped for %s", target_label)
        return {"matched": 0, "unmatched": 0, "total": 0}

    # Fetch all players from Supabase (current season)
    all_players = (
        supabase.table("players")
        .select("id, name, team, salary")
        .eq("season", CURRENT_SEASON)
        .execute()
    )
    players = all_players.data or []

    if team_abbrev:
        players = [p for p in players if p.get("team", "").upper() == team_abbrev.upper()]

    # Subset run (#76): restrict matching/updates to exactly the selected players.
    if player_ids is not None:
        wanted = set(player_ids)
        players = [p for p in players if p["id"] in wanted]

    # Snapshot salaries before matching so we only PATCH rows that actually changed.
    pre_match = {p["id"]: p.get("salary") for p in players}

    # Match salary map to player records (updates salary field in-place)
    matched, unmatched = salary_scraper.match_salaries_to_players(salary_map, players)

    # Only PATCH players whose salary was newly set by this scrape — not players
    # that already had a salary value (which would cause redundant writes).
    update_count = 0
    for p in players:
        new_salary = p.get("salary")
        if new_salary is not None and new_salary != pre_match.get(p["id"]):
            supabase.table("players").update({"salary": p["salary"]}).eq("id", p["id"]).execute()
            update_count += 1
    if update_count:
        logger.info("Updated salaries for %d players (%s)", update_count, target_label)

    total = len(players)
    logger.info("Salary bulk scrape: %d matched, %d unmatched, %d total", matched, unmatched, total)

    # Assign the NBA minimum salary to players we couldn't match on ESPN.
    # All unmatched players are confirmed to be on minimum/two-way contracts,
    # so this is a safe fallback rather than leaving salary as NULL.
    min_salary_count = 0
    for p in players:
        if p.get("salary") is None:
            p["salary"] = NBA_MINIMUM_SALARY
            # Only PATCH if the DB value is not already the minimum (avoids spurious writes).
            if pre_match.get(p["id"]) != NBA_MINIMUM_SALARY:
                supabase.table("players").update({"salary": NBA_MINIMUM_SALARY}).eq("id", p["id"]).execute()
                min_salary_count += 1

    if min_salary_count:
        logger.info(
            "Assigned NBA minimum salary ($%d) to %d unmatched players",
            NBA_MINIMUM_SALARY,
            min_salary_count,
        )

    return {"matched": matched, "unmatched": unmatched, "total": total}


# ---------------------------------------------------------------------------
# Bio / team sync (A-10)
# ---------------------------------------------------------------------------


def run_bulk_bio_team_sync(season: str, supabase: Client) -> dict:
    """
    Re-sync bio and team data (name, team, position, physical attributes)
    for all qualifying players by re-fetching from nba_api with refresh=True.

    Returns {"refreshed": int, "errors": int}.
    """
    logger.info("run_bulk_bio_team_sync: refreshing all players for season %s", season)
    errors = 0
    try:
        players = get_or_fetch_players(season, DEFAULT_MIN_MPG, refresh=True, supabase=supabase)
        return {"refreshed": len(players), "errors": 0}
    except Exception:
        logger.exception("run_bulk_bio_team_sync: bulk refresh failed")
        return {"refreshed": 0, "errors": 1}


def run_player_bio_team_sync(player_id: str, supabase: Client) -> dict:
    """
    Re-sync bio and team data for a single player by forcing a fresh stats fetch.

    Returns {"refreshed": int, "errors": int}.
    """
    logger.info("run_player_bio_team_sync: refreshing player %s", player_id)
    try:
        blob = get_or_fetch_player_stats(player_id, CURRENT_SEASON, supabase, refresh=True)
        refreshed = 1 if blob else 0
        return {"refreshed": refreshed, "errors": 0 if blob else 1}
    except Exception:
        logger.exception("run_player_bio_team_sync: refresh failed for %s", player_id)
        return {"refreshed": 0, "errors": 1}


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_player_by_id(player_id: str, supabase: Client) -> dict | None:
    """Fetch a single player row by Supabase UUID."""
    result = (
        supabase.table("players")
        .select("id, nba_api_id, name, team, position, height, weight, age, games_played, minutes_per_game, salary, updated_at")
        .eq("id", player_id)
        .limit(1)
        .execute()
    )
    return result.data[0] if result.data else None


def _stats_cache_cutoff(season: str) -> datetime | None:
    """
    Return the minimum acceptable fetched_at timestamp for cached stats.
    Returns None for prior seasons (cache forever).
    """
    if season == CURRENT_SEASON:
        return datetime.now(timezone.utc) - timedelta(hours=_STATS_TTL_HOURS)
    return None  # Prior season: never expires


def _parse_ts(ts_str: str | None) -> datetime | None:
    """Parse an ISO timestamp string from Supabase into a timezone-aware datetime."""
    if not ts_str:
        return None
    try:
        # Supabase returns timestamps with timezone; handle both formats
        ts_str = ts_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _update_team_salaries(team: str, salary_map: dict[str, int], supabase: Client) -> None:
    """Update salary for all players on a given team using scraped data."""
    team_players = (
        supabase.table("players")
        .select("id, name, salary")
        .eq("team", team)
        .execute()
    )
    players = team_players.data or []

    salary_scraper.match_salaries_to_players(salary_map, players)

    # Use individual UPDATE calls (not upsert) to avoid NOT NULL violations on
    # columns we're not touching — we're updating existing rows, not inserting.
    for p in players:
        if p.get("salary") is not None:
            supabase.table("players").update({"salary": p["salary"]}).eq("id", p["id"]).execute()


def _build_career_dict(career_raw: dict | None, awards_df) -> dict:
    """
    Build the career metadata dict from PlayerCareerStats and PlayerAwards data.
    """
    career_gp     = career_raw.get("career_games_played", 0) if career_raw else 0
    seasons_played = career_raw.get("seasons_played", 0) if career_raw else 0

    all_star_count = 0
    all_nba_count  = 0
    mvp_top5       = 0
    dpoy_top5      = 0
    award_winner   = False

    if awards_df is not None and not awards_df.empty:
        for _, award_row in awards_df.iterrows():
            desc = str(award_row.get("DESCRIPTION", "")).lower()

            if "all-star" in desc:
                all_star_count += 1
            if "all-nba" in desc:
                all_nba_count += 1
            if "most valuable player" in desc or "mvp" in desc:
                award_winner = True
                mvp_top5 += 1
            if "defensive player of the year" in desc or "dpoy" in desc:
                award_winner = True
                dpoy_top5 += 1
            if any(t in desc for t in ("champion", "finals mvp", "rookie of the year")):
                award_winner = True

    return {
        "career_games_played":  career_gp,
        "seasons_played":       seasons_played,
        "all_star_appearances":  all_star_count,
        "all_nba_selections":    all_nba_count,
        "mvp_top5_finishes":    mvp_top5,
        "dpoy_top5_finishes":   dpoy_top5,
        "award_winner":         award_winner,
    }


def _safe_int(val) -> int | None:
    """Safely convert a value to int, returning None on failure."""
    try:
        return int(val) if val is not None else None
    except (ValueError, TypeError):
        return None
