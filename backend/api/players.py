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

from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase
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
