"""
api/players.py — Player-related API routes.

Endpoints:
  GET /api/players                       — list all qualifying players
  GET /api/players/search                — fast name search (lightweight, DB-only)
  GET /api/players/<player_id>/stats     — full stats blob for a player
  GET /api/players/<player_id>/salary    — salary lookup with ESPN fallback
  GET /api/players/<player_id>/career    — career metadata (All-Star, awards, etc.)
  GET /api/players/<player_id>/profile   — canonical profile page data (player + composite skills)

All responses use the standard envelope: {success, data, error}.
player_id params are Supabase UUIDs; nba_api_id resolution happens in the service layer.
"""

import logging
import uuid as _uuid_mod

import httpx
from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase, reset_client
from services import players_service
from services.players_service import CURRENT_SEASON


def _validate_uuid(val: str) -> bool:
    """Return True if val is a valid UUID string."""
    try:
        _uuid_mod.UUID(val)
        return True
    except (ValueError, AttributeError):
        return False

logger = logging.getLogger(__name__)

players_bp = Blueprint("players", __name__, url_prefix="/api")


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(message: str, status: int = 500) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": message}), status


# ---------------------------------------------------------------------------
# GET /api/players
# ---------------------------------------------------------------------------

@players_bp.route("/players", methods=["GET"])
def list_players():
    """
    Return all players for the given season who meet the minimum MPG threshold.

    Query params:
      ?season=2025-26   (default: current season)
      ?min_mpg=15       (default: 15 — configurable per the spec)
      ?refresh=true     (force a fresh nba_api fetch even if Supabase has data)
    """
    season  = request.args.get("season",  players_service.CURRENT_SEASON)
    min_mpg = float(request.args.get("min_mpg", players_service.DEFAULT_MIN_MPG))
    refresh = request.args.get("refresh", "false").lower() == "true"

    try:
        supabase = get_supabase()
        result = players_service.get_or_fetch_players(season, min_mpg, refresh, supabase)
        return _ok(result)
    except Exception as exc:
        logger.exception("Error in GET /api/players")
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/stats
# ---------------------------------------------------------------------------

@players_bp.route("/players/<player_id>/stats", methods=["GET"])
def player_stats(player_id: str):
    """
    Return the full statistical profile (stats blob) for a player.

    Query params:
      ?season=2025-26   (default: current season; supports prior seasons for historical weighting)

    Cache behaviour:
      - Current season: 24-hour TTL in player_stats table
      - Prior seasons: indefinite (historical data doesn't change)

    First call per player triggers ~5-10s of additional per-player nba_api fetches
    (ShotChartDetail, LeagueSeasonMatchups). Subsequent calls within TTL are instant.
    """
    season = request.args.get("season", players_service.CURRENT_SEASON)
    refresh = request.args.get("refresh", "false").lower() == "true"

    try:
        supabase = get_supabase()
        blob = players_service.get_or_fetch_player_stats(player_id, season, supabase, refresh=refresh)
        if blob is None:
            return _err(f"Player {player_id} not found", status=404)
        return _ok(blob)
    except Exception as exc:
        logger.exception("Error in GET /api/players/%s/stats", player_id)
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/salary
# ---------------------------------------------------------------------------

@players_bp.route("/players/<player_id>/salary", methods=["GET"])
def player_salary(player_id: str):
    """
    Return the player's current annual salary in dollars.

    Salary is cached in the players.salary column for 7 days.
    On cache miss, triggers ESPN scraping for the player's team and
    updates all players on that team before returning.

    Returns null salary if ESPN data is unavailable for this player.
    """
    try:
        supabase = get_supabase()
        salary = players_service.get_player_salary(player_id, supabase)
        return _ok({"salary": salary})
    except Exception as exc:
        logger.exception("Error in GET /api/players/%s/salary", player_id)
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/career
# ---------------------------------------------------------------------------

@players_bp.route("/players/<player_id>/career", methods=["GET"])
def player_career(player_id: str):
    """
    Return career metadata for a player.

    Includes: career_games_played, seasons_played, all_star_appearances,
    all_nba_selections, mvp_top5_finishes, dpoy_top5_finishes, award_winner.

    Cached in player_stats table (season="career") with a 30-day TTL.
    Used by Prompt 5's notability scoring function.
    """
    try:
        supabase = get_supabase()
        career = players_service.get_or_fetch_career(player_id, supabase)
        if career is None:
            return _err(f"Player {player_id} not found", status=404)
        return _ok(career)
    except Exception as exc:
        logger.exception("Error in GET /api/players/%s/career", player_id)
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/stats-bulk
# ---------------------------------------------------------------------------

# NOTE: All literal-segment routes (/bulk, /search, /stats-bulk) must be
# registered BEFORE the <player_id> dynamic route so Flask doesn't swallow
# them as UUIDs.

def _flatten_stats_blob(blob: dict) -> tuple[dict, dict]:
    """
    Given a raw player_stats blob (keyed by section), return two dicts:
      - flat_stats:  {"section.key": value, ...} for all sections EXCEPT
                     "stabilized" and most of "metadata" (only allowlisted
                     metadata keys like "weight" are included)
      - stabilized:  the stabilized sub-dict as-is (already in "section.key"
                     format coming out of the skill engine)

    Sections like box_score, advanced, play_type, etc. each contain a flat
    dict of {key: numeric_value}, so we just prefix them with the section name.
    """
    flat_stats: dict = {}
    stabilized: dict = {}

    # metadata keys to include in flat_stats (e.g. weight used by screen_setter)
    metadata_allowlist = {"weight"}

    # Sections to skip entirely — stabilized is handled separately; remaining
    # metadata keys are selectively included via metadata_allowlist above.
    skip_sections = {"stabilized", "metadata"}

    for section, section_data in blob.items():
        if section in skip_sections:
            continue
        if not isinstance(section_data, dict):
            continue
        # Prefix each stat key with the section name to produce "section.key" format
        for key, value in section_data.items():
            flat_stats[f"{section}.{key}"] = value

    # Selectively include allowed metadata keys so stats like metadata.weight
    # appear as columns in the Stat Leaders table without exposing all metadata.
    raw_metadata = blob.get("metadata")
    if isinstance(raw_metadata, dict):
        for key in metadata_allowlist:
            if key in raw_metadata:
                flat_stats[f"metadata.{key}"] = raw_metadata[key]

    # Extract stabilized separately — the blob stores it as {"section.key": value}
    raw_stab = blob.get("stabilized")
    if isinstance(raw_stab, dict):
        stabilized = raw_stab

    return flat_stats, stabilized


def _fetch_stats_bulk(season: str, min_mpg: float, supabase) -> list:
    """
    Fetch all qualifying players with their flattened stats for the calibration
    Stat Leaders table.

    Steps:
    1. Query the players table filtered by season + min_mpg, ordered by name
    2. Batch-fetch player_stats rows (chunks of 100, same pattern as _fetch_bulk_players)
    3. Flatten each stats blob into "section.key" format (excluding metadata/stabilized)
    4. Extract the stabilized dict separately
    5. Return list of {id, name, team, position, stats, stabilized}
    """
    # Step 1: Fetch qualifying player records (id + display fields only, no bloat)
    players_rows = (
        supabase.table("players")
        .select("id, name, team, position")
        .eq("season", season)
        .gte("minutes_per_game", min_mpg)
        .order("name")
        .execute()
    )
    players_data = players_rows.data or []
    if not players_data:
        return []

    player_ids = [p["id"] for p in players_data]

    # Step 2: Batch-fetch player_stats rows in chunks of 100 (PostgREST URL limit safe)
    _BATCH = 100
    stats_by_player: dict = {}
    for i in range(0, len(player_ids), _BATCH):
        batch = player_ids[i : i + _BATCH]
        rows = (
            supabase.table("player_stats")
            .select("player_id, stats, fetched_at")
            .in_("player_id", batch)
            .eq("season", season)
            .order("fetched_at", desc=True)  # newest first so we keep the latest row
            .limit(5000)                     # generous cap — insert (not upsert) means
                                             # players with many views have many rows
            .execute()
        )
        # Only keep the first (most recent) row per player
        for row in (rows.data or []):
            pid = row["player_id"]
            if pid not in stats_by_player:
                stats_by_player[pid] = row.get("stats") or {}

    # Step 3+4: Build the response list, flattening each player's stats blob
    result = []
    for player in players_data:
        blob = stats_by_player.get(player["id"], {})
        flat_stats, stabilized = _flatten_stats_blob(blob)
        result.append({
            "id":         player["id"],
            "name":       player["name"],
            "team":       player.get("team"),
            "position":   player.get("position"),
            "stats":      flat_stats,
            "stabilized": stabilized,
        })

    return result


@players_bp.route("/players/stats-bulk", methods=["GET"])
def list_players_stats_bulk():
    """
    Return all qualifying players with flattened stats for the calibration Stat
    Leaders table.

    Stats are returned in "section.key" format (e.g. "box_score.pts": 25.3).
    Stabilized values (Bayesian-adjusted) are returned as a separate dict using
    the same "section.key" keys — the frontend toggles between raw and stabilized
    per-cell without double-fetching.

    Query params:
      ?season=2025-26   (default: current season)
      ?min_mpg=15       (default: 15)

    Response data: list of {id, name, team, position, stats, stabilized}
    """
    season = request.args.get("season", players_service.CURRENT_SEASON)
    try:
        min_mpg = float(request.args.get("min_mpg", players_service.DEFAULT_MIN_MPG))
    except (ValueError, TypeError):
        return _err("'min_mpg' must be a number", status=400)

    try:
        supabase = get_supabase()
        result = _fetch_stats_bulk(season, min_mpg, supabase)
        return _ok(result)
    except Exception as exc:
        logger.exception("Error in GET /api/players/stats-bulk")
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/bulk
# ---------------------------------------------------------------------------

# NOTE: All literal-segment routes (/bulk, /search) must be registered BEFORE
# the <player_id> dynamic route so Flask doesn't swallow them as UUIDs.

def _fetch_bulk_players(season: str, min_mpg: float) -> list:
    """
    Execute all three Supabase queries needed for the bulk players response
    (players → skill_profiles → skill_flags) and join them in Python.

    Isolated into a standalone function so the route handler can retry the
    entire sequence on an HTTP/2 connection reset (RemoteProtocolError) by
    simply calling get_supabase() again for a fresh connection pool.
    """
    supabase = get_supabase()

    # 1. Fetch all qualifying players for this season
    players_rows = (
        supabase.table("players")
        .select(
            "id, name, team, position, age, height, weight, salary, "
            "games_played, minutes_per_game, season"
        )
        .eq("season", season)
        .gte("minutes_per_game", min_mpg)
        .order("name")
        .execute()
    )
    players_data = players_rows.data or []
    if not players_data:
        return []

    player_ids = [p["id"] for p in players_data]

    # 2. Fetch composite skill profiles — chunked in batches of 100 to stay
    #    within PostgREST URL length limits (~8 KB default in most proxies).
    _BATCH = 100
    profiles_data: list = []
    for i in range(0, len(player_ids), _BATCH):
        batch = player_ids[i : i + _BATCH]
        rows = (
            supabase.table("skill_profiles")
            .select("id, player_id, profile")
            .in_("player_id", batch)
            .eq("season", season)
            .eq("source", "composite")
            .limit(_BATCH + 1)  # +1 lets us detect unexpected overflow
            .execute()
        )
        profiles_data.extend(rows.data or [])

    # Index profiles by player_id for O(1) lookup
    profiles_by_player: dict = {}
    profile_id_to_player_id: dict = {}
    for row in profiles_data:
        profiles_by_player[row["player_id"]] = row
        profile_id_to_player_id[row["id"]] = row["player_id"]

    # 3. Fetch flag counts — chunked by the same batch size.
    #    Counts are accumulated in Python; we log a warning if any batch hits
    #    the limit, which would signal silent truncation of flag counts.
    profile_ids = list(profile_id_to_player_id.keys())
    flags_by_profile_id: dict = {}
    _FLAG_BATCH_LIMIT = 1000  # per-batch row ceiling
    if profile_ids:
        for i in range(0, len(profile_ids), _BATCH):
            batch = profile_ids[i : i + _BATCH]
            flags_rows = (
                supabase.table("skill_flags")
                .select("skill_profile_id, resolution")
                .in_("skill_profile_id", batch)
                .limit(_FLAG_BATCH_LIMIT)
                .execute()
            )
            flags_batch = flags_rows.data or []
            if len(flags_batch) >= _FLAG_BATCH_LIMIT:
                logger.warning(
                    "Flag batch hit row limit (%d) — flag counts may be understated. "
                    "Consider aggregating via an RPC instead.",
                    _FLAG_BATCH_LIMIT,
                )
            for flag in flags_batch:
                pid = flag["skill_profile_id"]
                if pid not in flags_by_profile_id:
                    flags_by_profile_id[pid] = {"total": 0, "unresolved": 0}
                flags_by_profile_id[pid]["total"] += 1
                if flag.get("resolution") is None:
                    flags_by_profile_id[pid]["unresolved"] += 1

    # 4. Join everything and build the response list
    result = []
    for player in players_data:
        profile_row = profiles_by_player.get(player["id"])
        skills = None
        flag_summary = {"total": 0, "unresolved": 0}

        if profile_row:
            raw_profile = profile_row.get("profile") or {}
            # Condense to just final_tier per skill — keeps payload light
            skills = {
                skill: (details.get("final_tier") if isinstance(details, dict) else details)
                for skill, details in raw_profile.items()
            }
            flag_summary = flags_by_profile_id.get(
                profile_row["id"], {"total": 0, "unresolved": 0}
            )

        result.append({
            **player,
            "skills": skills,
            "flag_summary": flag_summary,
        })

    return result


@players_bp.route("/players/bulk", methods=["GET"])
def list_players_bulk():
    """
    Return all qualifying players for the season with their composite skill
    tiers and flag summaries embedded inline — one request, no N+1.

    This is the primary data source for the /players explorer page.

    Query params:
      ?season=2025-26   (default: current season)
      ?min_mpg=15       (default: 15)

    Response data: list of player objects, each containing:
      { id, name, team, position, age, height, weight, salary,
        games_played, minutes_per_game, season,
        skills: { skill_name: final_tier_string, ... } | null,
        flag_summary: { total: int, unresolved: int } }

    Skills are condensed to just final_tier per skill — full composite details
    are available via GET /api/players/<id>/profile.
    """
    season = request.args.get("season", players_service.CURRENT_SEASON)

    # Validate min_mpg before entering the try block so we can return a proper 400
    try:
        min_mpg = float(request.args.get("min_mpg", players_service.DEFAULT_MIN_MPG))
    except (ValueError, TypeError):
        return _err("'min_mpg' must be a number", status=400)

    try:
        result = _fetch_bulk_players(season, min_mpg)
        return _ok(result)
    except (httpx.ReadError, httpx.RemoteProtocolError) as exc:
        # Supabase PostgREST closes HTTP/2 connections after ~34 streams
        # (GOAWAY frame). Reset the singleton so the retry gets a fresh pool.
        logger.warning(
            "HTTP/2 connection reset on /api/players/bulk — "
            "resetting Supabase client and retrying once: %s",
            exc,
        )
        reset_client()
        try:
            result = _fetch_bulk_players(season, min_mpg)
            return _ok(result)
        except Exception as retry_exc:
            logger.exception("Error in GET /api/players/bulk (retry also failed)")
            return _err(str(retry_exc))
    except Exception as exc:
        logger.exception("Error in GET /api/players/bulk")
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/search
# ---------------------------------------------------------------------------

# NOTE: This route must be registered BEFORE the <player_id> dynamic route
# so Flask matches "search" as the literal path segment, not as a player_id.

@players_bp.route("/players/search", methods=["GET"])
def search_players():
    """
    Fast, DB-only player name search returning lightweight records.

    Unlike GET /api/players (which may trigger nba_api fetches), this endpoint
    only reads the players table and never hits the NBA API. Designed for
    typeahead / autocomplete use cases.

    Query params:
      ?q=name        — search term (min 2 chars; case-insensitive substring match)
      ?season=2025-26 — default: current season
      ?limit=20       — max results to return (default 20, max 50)

    Response data: list of { id, name, team, position }
    """
    q      = request.args.get("q", "").strip()
    season = request.args.get("season", CURRENT_SEASON)

    # Validate 'limit' before entering the try block to return a proper error envelope
    try:
        limit = min(int(request.args.get("limit", 20)), 50)
    except (ValueError, TypeError):
        return _err("'limit' must be an integer", status=400)

    if len(q) < 2:
        return _ok([])  # Require at least 2 chars to avoid huge result sets

    try:
        supabase = get_supabase()
        rows = (
            supabase.table("players")
            .select("id, name, team, position")
            .eq("season", season)
            .ilike("name", f"%{q}%")
            .order("name")
            .limit(limit)
            .execute()
        )
        return _ok(rows.data or [])

    except Exception as exc:
        logger.exception("Error in GET /api/players/search")
        return _err(str(exc))


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/profile
# ---------------------------------------------------------------------------


@players_bp.route("/players/<player_id>/profile", methods=["GET"])
def player_profile(player_id: str):
    """
    Return the canonical player profile page data.

    Combines player metadata with their composite skill profile and flag summary.
    If no composite profile exists yet, skills and flags will be empty/null.

    Path params:
      player_id — Supabase UUID

    Query params:
      ?season=2025-26  (default: current season)

    Response data:
      {
        "player": { id, name, team, position, age, games_played, minutes_per_game,
                    salary, height, weight, season },
        "skills": {                              // composite skill data (null if no profile yet)
          skill_name: { final_tier, stat_tier, claude_tier, source, flagged, stat_confidence }
        } | null,
        "flag_summary": {
          "total": int,
          "unresolved": int,
        }
      }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID", status=400)

    season = request.args.get("season", CURRENT_SEASON)

    try:
        supabase = get_supabase()

        # Fetch player metadata
        player_row = (
            supabase.table("players")
            .select(
                "id, name, team, position, age, games_played, "
                "minutes_per_game, salary, height, weight, season"
            )
            .eq("id", player_id)
            .eq("season", season)
            .limit(1)
            .execute()
        )
        if not player_row.data:
            return _err(f"Player {player_id} not found for season {season}", status=404)
        player = player_row.data[0]

        # Fetch composite skill profile (if it exists)
        profile_row = (
            supabase.table("skill_profiles")
            .select("id, profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .eq("source", "composite")
            .limit(1)
            .execute()
        )

        skills_data = None
        flag_summary = {"total": 0, "unresolved": 0}
        composite_profile_id = None

        if profile_row.data:
            composite_profile_id = profile_row.data[0]["id"]
            raw_profile = profile_row.data[0]["profile"] or {}
            # Return the full composite result dict per skill so the UI can show
            # stat_tier, claude_tier, source, and flagged state
            skills_data = raw_profile

            # Fetch flag summary counts
            flag_rows = (
                supabase.table("skill_flags")
                .select("id, resolution")
                .eq("skill_profile_id", composite_profile_id)
                .execute()
            )
            all_flags     = flag_rows.data or []
            total_flags   = len(all_flags)
            unresolved    = sum(1 for f in all_flags if f.get("resolution") is None)
            flag_summary  = {"total": total_flags, "unresolved": unresolved}

        return _ok({
            "player":       player,
            "skills":       skills_data,
            "flag_summary": flag_summary,
        })

    except Exception as exc:
        logger.exception("Error in GET /api/players/%s/profile", player_id)
        return _err(str(exc))
