"""
api/players.py — Player-related API routes.

Endpoints:
  GET /api/players                       — list all qualifying players
  GET /api/players/<player_id>/stats     — full stats blob for a player
  GET /api/players/<player_id>/salary    — salary lookup with ESPN fallback
  GET /api/players/<player_id>/career    — career metadata (All-Star, awards, etc.)

All responses use the standard envelope: {success, data, error}.
player_id params are Supabase UUIDs; nba_api_id resolution happens in the service layer.
"""

import logging

from flask import Blueprint, jsonify, request

from services.supabase_client import get_supabase
from services import players_service

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

    try:
        supabase = get_supabase()
        blob = players_service.get_or_fetch_player_stats(player_id, season, supabase)
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
