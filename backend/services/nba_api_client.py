"""
nba_api_client.py — Low-level NBA API fetch functions.

Wraps the nba_api library with:
  - 1.5-second delays between calls to respect rate limits
  - try/except around every call (returns None on failure)
  - In-memory bulk data cache with 24-hour TTL
  - Indefinite in-memory position lookup cache (CommonPlayerInfo)

All bulk endpoints return {nba_api_player_id: row_dict} for O(1) player lookups.
"""

import logging
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from curl_cffi.requests import Session as CffiSession
from nba_api.library.http import NBAHTTP

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Patch nba_api's HTTP session with a curl_cffi session that impersonates
# Chrome 131. This bypasses Cloudflare's TLS fingerprint (JA3) blocking,
# which rejects Python's urllib3 TLS handshake regardless of User-Agent.
# ---------------------------------------------------------------------------
_cffi_session = CffiSession(impersonate="chrome131")
NBAHTTP.set_session(_cffi_session)

# ---------------------------------------------------------------------------
# Updated request headers — nba_api defaults use Firefox 72 (2020) which
# NBA.com now blocks. Use a current Chrome UA + required NBA stats tokens.
# ---------------------------------------------------------------------------
_NBA_HEADERS = {
    "Host": "stats.nba.com",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
    "Origin": "https://www.nba.com",
    "Referer": "https://www.nba.com/",
    "Connection": "keep-alive",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
}

_REQUEST_TIMEOUT = 15          # seconds — default for most endpoints
_MATCHUPS_TIMEOUT = 60         # leagueseasonmatchups is consistently slow; needs extra headroom

# ---------------------------------------------------------------------------
# In-memory caches
# ---------------------------------------------------------------------------

# Bulk league-wide cache: {season: {"base": {player_id: row_dict}, ...}}
_bulk_cache: dict[str, dict[str, dict[int, dict]]] = {}
_bulk_cache_ts: dict[str, datetime] = {}
_BULK_TTL_HOURS = 24

# Position lookup cache: {nba_api_player_id: position_group}
# Values: "PG" | "SG" | "SF" | "PF" | "C" | None
_position_cache: dict[int, str | None] = {}

_API_DELAY = 1.5  # seconds between nba_api calls


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _sleep() -> None:
    """Pause between API calls to avoid rate limiting."""
    time.sleep(_API_DELAY)


def _flatten_multiindex(df: pd.DataFrame) -> pd.DataFrame:
    """
    Flatten a MultiIndex column DataFrame into single-level column names.
    Used for LeagueDashPlayerShotLocations which returns zone×stat tuples.
    e.g. ('Restricted Area', 'FGA') → 'RESTRICTED_AREA_FGA'
         ('', 'PLAYER_ID')          → 'PLAYER_ID'
    """
    import re
    if not isinstance(df.columns, pd.MultiIndex):
        return df
    new_cols = []
    for col in df.columns:
        zone, stat = str(col[0]).strip(), str(col[1]).strip()
        if not zone:
            new_cols.append(stat)
        else:
            # Uppercase, replace non-alphanumeric with _, collapse repeats
            zone_flat = re.sub(r"[^A-Z0-9]+", "_", zone.upper()).strip("_")
            new_cols.append(f"{zone_flat}_{stat}")
    df = df.copy()
    df.columns = new_cols
    return df


def _df_to_player_dict(df: pd.DataFrame) -> dict[int, dict]:
    """Convert a DataFrame to {PLAYER_ID: row_dict} for fast player lookups.
    Handles alternate player ID column names across different endpoints."""
    if df is None or df.empty:
        return {}
    # Flatten MultiIndex columns (e.g. LeagueDashPlayerShotLocations)
    df = _flatten_multiindex(df)
    # Different endpoints use different player ID column names
    for id_col in ("PLAYER_ID", "CLOSE_DEF_PERSON_ID", "PERSON_ID"):
        if id_col in df.columns:
            return {int(row[id_col]): row.to_dict() for _, row in df.iterrows()}
    logger.warning("No player ID column found in DataFrame; columns: %s", list(df.columns[:5]))
    return {}


_RETRY_ATTEMPTS = 2
_RETRY_DELAY = 5  # seconds between retry attempts


def _safe_fetch(label: str, fetch_fn, *args, **kwargs) -> pd.DataFrame | None:
    """
    Call fetch_fn(*args, **kwargs).get_data_frames()[0], sleeping before the call.
    Injects updated browser headers and extended timeout into every call.
    Retries once on timeout (5s wait) before giving up.
    Returns None and logs a warning on total failure.
    """
    kwargs.setdefault("headers", _NBA_HEADERS)
    kwargs.setdefault("timeout", _REQUEST_TIMEOUT)

    for attempt in range(_RETRY_ATTEMPTS):
        _sleep()
        try:
            endpoint = fetch_fn(*args, **kwargs)
            frames = endpoint.get_data_frames()
            if not frames or frames[0].empty:
                logger.warning("Empty result from %s", label)
                return None
            return frames[0]
        except Exception as exc:
            if attempt < _RETRY_ATTEMPTS - 1:
                logger.warning("Attempt %d failed for %s (%s) — retrying in %ds",
                               attempt + 1, label, exc, _RETRY_DELAY)
                time.sleep(_RETRY_DELAY)
            else:
                logger.warning("Failed to fetch %s after %d attempts: %s",
                               label, _RETRY_ATTEMPTS, exc)

    return None


def _is_bulk_fresh(season: str) -> bool:
    """Return True if bulk cache for this season is still within TTL."""
    ts = _bulk_cache_ts.get(season)
    if ts is None:
        return False
    return datetime.now(timezone.utc) - ts < timedelta(hours=_BULK_TTL_HOURS)


# ---------------------------------------------------------------------------
# Bulk league-wide fetch (28 calls, ~42 seconds)
# ---------------------------------------------------------------------------

def get_player_index(season: str = "2025-26") -> dict[int, dict]:
    """
    Fetch height, weight, and position for all players via PlayerIndex.
    Returns {nba_api_player_id: {"height": "6-7", "weight": 210, "position": "F"}}.

    Called once alongside get_bulk_stats() and merged into player upsert rows.
    Uses the same in-memory cache as bulk stats (24-hour TTL keyed on season).
    """
    cache_key = f"__player_index_{season}"
    if cache_key in _bulk_cache:
        return _bulk_cache[cache_key]

    from nba_api.stats.endpoints import PlayerIndex

    df = _safe_fetch(
        "PlayerIndex",
        PlayerIndex,
        season=season,
        league_id="00",
    )
    if df is None:
        return {}

    result: dict[int, dict] = {}
    for _, row in df.iterrows():
        pid = int(row["PERSON_ID"])
        weight_raw = row.get("WEIGHT")
        result[pid] = {
            "height":   str(row.get("HEIGHT") or "").strip() or None,
            "weight":   int(weight_raw) if weight_raw and str(weight_raw).strip().isdigit() else None,
            "position": str(row.get("POSITION") or "").strip() or None,
        }

    _bulk_cache[cache_key] = result
    return result


def get_bulk_stats(season: str = "2025-26") -> dict[str, dict[int, dict]]:
    """
    Fetch all league-wide bulk endpoints for the given season.
    Results are keyed by data category name, then by nba_api PLAYER_ID.

    Uses an in-memory cache (24-hour TTL).  The first call takes ~42 seconds;
    subsequent calls within the TTL window return instantly.

    Returns an empty dict on catastrophic failure (individual endpoint failures
    are silently skipped — callers should check for missing keys).
    """
    if _is_bulk_fresh(season):
        logger.debug("Returning bulk stats from in-memory cache for %s", season)
        return _bulk_cache[season]

    logger.info("Fetching bulk nba_api stats for season %s (28 calls, ~42s)...", season)
    data: dict[str, dict[int, dict]] = {}

    # Import here to avoid slow startup; nba_api imports can take a moment
    from nba_api.stats.endpoints import (
        LeagueDashPlayerStats,
        LeagueDashPtStats,
        LeagueDashPlayerShotLocations,
        LeagueDashPtDefend,
        LeagueHustleStatsPlayer,
        SynergyPlayTypes,
    )

    # --- 1. Base box-score stats (per game) ---
    df = _safe_fetch(
        "LeagueDashPlayerStats/Base",
        LeagueDashPlayerStats,
        season=season,
        measure_type_detailed_defense="Base",
        per_mode_detailed="PerGame",
    )
    data["base"] = _df_to_player_dict(df)

    # --- 2. Advanced metrics ---
    df = _safe_fetch(
        "LeagueDashPlayerStats/Advanced",
        LeagueDashPlayerStats,
        season=season,
        measure_type_detailed_defense="Advanced",
        per_mode_detailed="PerGame",
    )
    data["advanced"] = _df_to_player_dict(df)

    # --- 3–13. Tracking stats via LeagueDashPtStats ---
    pt_types = [
        ("CatchShoot",    "catchshoot"),
        ("PullUpShot",    "pullupshot"),
        ("Drives",        "drives"),
        ("Passing",       "passing"),
        ("Defense",       "defense"),
        ("Possessions",   "possessions"),
        ("Rebounding",    "rebounding"),
        ("SpeedDistance", "speeddistance"),
        ("PaintTouch",    "painttouch"),
        ("PostTouch",     "posttouch"),
        ("ElbowTouch",    "elbowtouch"),
    ]
    for api_type, key in pt_types:
        df = _safe_fetch(
            f"LeagueDashPtStats/{api_type}",
            LeagueDashPtStats,
            season=season,
            pt_measure_type=api_type,
            per_mode_simple="PerGame",  # correct param name in nba_api 1.9
            player_or_team="Player",
        )
        data[key] = _df_to_player_dict(df)

    # --- 14. Hustle stats ---
    df = _safe_fetch(
        "LeagueHustleStatsPlayer",
        LeagueHustleStatsPlayer,
        season=season,
        per_mode_time="PerGame",  # correct param name in nba_api 1.9
    )
    data["hustle"] = _df_to_player_dict(df)

    # --- 15. Shot zone locations ---
    df = _safe_fetch(
        "LeagueDashPlayerShotLocations",
        LeagueDashPlayerShotLocations,
        season=season,
        per_mode_detailed="PerGame",  # correct param name in nba_api 1.9
    )
    data["shot_locations"] = _df_to_player_dict(df)

    # --- 16–19. Defensive tracking by distance ---
    defend_cats = [
        ("Less Than 6Ft",     "defend_less_than_6ft"),
        ("Less Than 10Ft",    "defend_less_than_10ft"),
        ("Greater Than 15Ft", "defend_greater_than_15ft"),
        ("3 Pointers",        "defend_3_pointers"),
    ]
    for cat, key in defend_cats:
        df = _safe_fetch(
            f"LeagueDashPtDefend/{cat}",
            LeagueDashPtDefend,
            season=season,
            defense_category=cat,
            per_mode_simple="PerGame",  # correct param name in nba_api 1.9
        )
        data[key] = _df_to_player_dict(df)

    # --- 20–28. Synergy play types ---
    play_types = [
        ("Spotup",        "synergy_spotup"),
        ("OffScreen",     "synergy_offscreen"),
        ("Handoff",       "synergy_handoff"),
        ("PRBallHandler", "synergy_prballhandler"),
        ("PRRollman",     "synergy_prrollman"),
        ("Postup",        "synergy_postup"),
        ("Cut",           "synergy_cut"),
        ("Transition",    "synergy_transition"),
        ("Isolation",     "synergy_isolation"),
    ]
    for pt, key in play_types:
        df = _safe_fetch(
            f"SynergyPlayTypes/{pt}",
            SynergyPlayTypes,
            season=season,
            play_type_nullable=pt,
            player_or_team_abbreviation="P",
            type_grouping_nullable="offensive",
            per_mode_simple="PerGame",  # correct param names in nba_api 1.9
        )
        data[key] = _df_to_player_dict(df)

    # Store in cache
    _bulk_cache[season] = data
    _bulk_cache_ts[season] = datetime.now(timezone.utc)
    logger.info("Bulk stats cached for season %s (%d data sources)", season, len(data))

    return data


# ---------------------------------------------------------------------------
# Per-player endpoints (lazy, called on first /stats request per player)
# ---------------------------------------------------------------------------

def get_player_shot_chart(nba_api_id: int, season: str = "2025-26") -> pd.DataFrame | None:
    """
    Fetch all shot attempts for a player via ShotChartDetail.
    Returns the full shot log DataFrame (unfiltered); the assembler
    extracts alley-oops, driving dunks, and floaters from ACTION_TYPE.
    """
    from nba_api.stats.endpoints import ShotChartDetail

    return _safe_fetch(
        f"ShotChartDetail/{nba_api_id}",
        ShotChartDetail,
        team_id=0,       # 0 = all teams (required param in nba_api 1.9)
        player_id=nba_api_id,
        season_nullable=season,
        context_measure_simple="FGA",
    )


def get_player_matchups(nba_api_id: int, season: str = "2025-26") -> pd.DataFrame | None:
    """
    Fetch all offensive players guarded by this defender via LeagueSeasonMatchups.
    Returns OFF_PLAYER_ID, MATCHUP_MIN, PARTIAL_POSS, MATCHUP_FG_PCT per row.
    Returns None if the endpoint fails or returns insufficient data.

    Note: calls the API directly via _cffi_session because the nba_api 1.9 parser
    for this endpoint looks for 'resultSet' (singular) but the API returns 'resultSets'.
    """
    _sleep()
    try:
        resp = _cffi_session.get(
            "https://stats.nba.com/stats/leagueseasonmatchups",
            params={
                "Season":               season,
                "SeasonType":           "Regular Season",
                "LeagueID":             "00",
                "PerMode":              "Totals",
                "DefPlayerIDNullable":  str(nba_api_id),
                "OffPlayerIDNullable":  "",
            },
            headers=_NBA_HEADERS,
            timeout=_MATCHUPS_TIMEOUT,
        )
        data = resp.json()
        result_sets = data.get("resultSets", [])
        if not result_sets:
            logger.warning("Empty resultSets from LeagueSeasonMatchups for %d", nba_api_id)
            return None
        rs = result_sets[0]
        headers = rs["headers"]
        rows = rs["rowSet"]
        if not rows:
            return None
        return pd.DataFrame(rows, columns=headers)
    except Exception as exc:
        logger.warning("LeagueSeasonMatchups failed for %d: %s", nba_api_id, exc)
        return None


def get_player_career_stats(nba_api_id: int) -> dict | None:
    """
    Fetch career totals for a player via PlayerCareerStats.
    Returns a dict with career_games_played and seasons_played.
    """
    from nba_api.stats.endpoints import PlayerCareerStats

    _sleep()
    try:
        career = PlayerCareerStats(player_id=nba_api_id)
        frames = career.get_data_frames()

        # Frame 0: SeasonTotalsRegularSeason (per-season rows)
        # Frame 1: CareerTotalsRegularSeason (single summary row)
        if len(frames) < 2:
            return None

        season_df = frames[0]
        career_df = frames[1]

        seasons_played = len(season_df) if not season_df.empty else 0
        career_gp = int(career_df["GP"].iloc[0]) if not career_df.empty else 0

        return {"career_games_played": career_gp, "seasons_played": seasons_played}

    except Exception as exc:
        logger.warning("PlayerCareerStats failed for %d: %s", nba_api_id, exc)
        return None


def get_player_awards(nba_api_id: int) -> pd.DataFrame | None:
    """
    Fetch all awards for a player via PlayerAwards.
    Returns a DataFrame with DESCRIPTION and SEASON columns.
    """
    from nba_api.stats.endpoints import PlayerAwards

    return _safe_fetch(
        f"PlayerAwards/{nba_api_id}",
        PlayerAwards,
        player_id=nba_api_id,
    )


def search_players_static(query: str) -> list[dict]:
    """
    Search the nba_api static player roster by full name (no API call).
    Returns up to 20 matches as [{nba_api_id, full_name, is_active}].
    Used by the manual-include search flow to find players who haven't
    played this season and aren't yet in the players table.
    """
    from nba_api.stats.static import players as nba_players

    # find_players_by_full_name does a case-insensitive substring match
    results = nba_players.find_players_by_full_name(query)
    return [
        {
            "nba_api_id": p["id"],
            "full_name":  p["full_name"],
            "is_active":  p.get("is_active", False),
        }
        for p in results[:20]
    ]


def get_player_info(nba_api_id: int) -> dict | None:
    """
    Fetch current player metadata via CommonPlayerInfo.
    Returns {name, team, position, height, weight, age} or None on failure.
    Used when manually adding a player who has no stats row this season.
    """
    from nba_api.stats.endpoints import CommonPlayerInfo
    from datetime import date as _date

    _sleep()
    try:
        info = CommonPlayerInfo(player_id=nba_api_id, headers=_NBA_HEADERS, timeout=_REQUEST_TIMEOUT)
        df = info.get_data_frames()[0]
        if df.empty:
            return None

        row = df.iloc[0]

        # Derive age from birthdate (BIRTHDATE is an ISO string like "1999-02-29T00:00:00")
        age: int | None = None
        bd_raw = str(row.get("BIRTHDATE") or "").split("T")[0]
        if bd_raw:
            try:
                bd = _date.fromisoformat(bd_raw)
                today = _date.today()
                age = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
            except ValueError:
                pass

        weight_raw = row.get("WEIGHT")
        return {
            "name":     str(row.get("DISPLAY_FIRST_LAST") or "").strip() or None,
            "team":     str(row.get("TEAM_ABBREVIATION") or "").strip() or None,
            "position": str(row.get("POSITION") or "").strip() or None,
            "height":   str(row.get("HEIGHT") or "").strip() or None,
            "weight":   int(weight_raw) if weight_raw and str(weight_raw).strip().isdigit() else None,
            "age":      age,
        }

    except Exception as exc:
        logger.warning("CommonPlayerInfo failed for %d: %s", nba_api_id, exc)
        return None


def get_player_position(nba_api_id: int) -> str | None:
    """
    Look up a player's position via CommonPlayerInfo and map to a
    canonical positional group: PG | SG | SF | PF | C.

    Results are cached indefinitely (positions don't change mid-season).
    Returns None if the lookup fails.
    """
    if nba_api_id in _position_cache:
        return _position_cache[nba_api_id]

    from nba_api.stats.endpoints import CommonPlayerInfo

    _sleep()
    try:
        info = CommonPlayerInfo(player_id=nba_api_id)
        df = info.get_data_frames()[0]
        if df.empty:
            _position_cache[nba_api_id] = None
            return None

        raw_pos = str(df["POSITION"].iloc[0]).strip()
        group = _map_position(raw_pos)
        _position_cache[nba_api_id] = group
        return group

    except Exception as exc:
        logger.warning("CommonPlayerInfo failed for %d: %s", nba_api_id, exc)
        _position_cache[nba_api_id] = None
        return None


def _map_position(raw: str) -> str | None:
    """
    Map a raw ESPN/nba_api position string to one of PG, SG, SF, PF, C.
    Handles combo strings like 'G-F', 'F-C'.
    """
    mapping = {
        "Point Guard":    "PG",
        "Shooting Guard": "SG",
        "Small Forward":  "SF",
        "Power Forward":  "PF",
        "Center":         "C",
        "PG": "PG", "SG": "SG", "SF": "SF", "PF": "PF", "C": "C",
        "G":  "SG",   # Generic guard → shooting guard
        "F":  "SF",   # Generic forward → small forward
        "F-C": "PF",  # Forward-center hybrid → power forward
        "G-F": "SF",  # Guard-forward hybrid → small forward
        "C-F": "PF",
    }
    return mapping.get(raw)
