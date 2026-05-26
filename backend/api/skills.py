"""
api/skills.py — Skill evaluation API routes.

Endpoints:
  GET  /api/players/<player_id>/skills   — evaluate all skills for a player
  POST /api/skills/batch                 — batch-evaluate skills for many players
  GET  /api/league-averages              — retrieve or recompute league average stats

All responses use the standard envelope: {success, data, error}.
player_id params are Supabase UUIDs.

The skill engine is fully data-driven: all tier logic lives in the
draft_skill_thresholds table, not in this file. See skill_engine.py.
"""

import logging
import re
import uuid as _uuid_mod

from flask import Blueprint, jsonify, request

from api.auth import require_admin
from services.supabase_client import get_supabase
from services import skill_engine
from services.players_service import CURRENT_SEASON

# Maximum number of player_ids accepted by the batch endpoint in a single request.
# A full league run uses player_ids=[] (empty = all qualifying players).
_BATCH_MAX_IDS = 500

# Valid season format: "YYYY-YY" e.g. "2025-26"
_SEASON_RE = re.compile(r"^\d{4}-\d{2}$")


def _validate_uuid(value: str) -> bool:
    """Return True if value is a valid UUID string."""
    try:
        _uuid_mod.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def _validate_season(value: str) -> bool:
    """Return True if value matches the expected season format (e.g. '2025-26')."""
    return bool(_SEASON_RE.match(value))

logger = logging.getLogger(__name__)

skills_bp = Blueprint("skills", __name__, url_prefix="/api")


# ---------------------------------------------------------------------------
# Response helpers — mirror the pattern established in players.py
# ---------------------------------------------------------------------------


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(message: str, status: int = 500) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": message}), status


# ---------------------------------------------------------------------------
# GET /api/players/<player_id>/skills
# ---------------------------------------------------------------------------


@skills_bp.route("/players/<player_id>/skills", methods=["GET"])
def player_skills(player_id: str):
    """
    Evaluate and return all skill tiers for a single player.

    Loads the player's stats blob (optionally blended across 3 seasons),
    runs the full rule-engine evaluation, applies auto-promotions, and
    returns the complete skills result.

    Query params:
      ?season=2025-26        (default: current season)
      ?use_history=true      (default: false — blend 3 seasons when true)
      ?refresh=true          (default: false — bypass threshold/league-avg cache)
      ?debug=true            (default: false — include rule + decision debug info)

    Response data: { skill_name: skill_result_dict, ... }
    """
    # Parse and validate query params
    season = request.args.get("season", CURRENT_SEASON)
    use_history = request.args.get("use_history", "false").lower() == "true"
    refresh = request.args.get("refresh", "false").lower() == "true"
    debug = request.args.get("debug", "false").lower() == "true"

    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID", status=400)

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    try:
        supabase = get_supabase()

        skills_result = skill_engine.get_player_skills(
            player_id=player_id,
            season=season,
            use_history=use_history,
            supabase=supabase,
            refresh=refresh,
            debug=debug,
        )

        if not skills_result:
            # No skills result means no stats blob was found for this player/season
            return _err(
                f"No stats found for player {player_id} in season {season}",
                status=404,
            )

        return _ok(skills_result)

    except Exception:
        logger.exception("Error in GET /api/players/%s/skills", player_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/skills/batch
# ---------------------------------------------------------------------------


@skills_bp.route("/skills/batch", methods=["POST"])
@require_admin
def batch_skills():
    """
    Batch-evaluate skills for multiple players and persist results to draft_skill_profiles.

    Processes players sequentially (not in parallel) — a full league run
    (all qualifying players) may take several minutes.

    If player_ids is empty or omitted, all qualifying players (>= 15 MPG)
    for the given season are processed.

    Request body (JSON):
      {
        "player_ids": ["uuid1", "uuid2", ...],   // optional — empty = all players
        "season": "2025-26",                       // optional — default current season
        "use_history": false                        // optional — blend 3 seasons
      }

    Response data:
      {
        "total": int,                              // number of player_ids requested
        "processed": int,                          // successfully evaluated
        "results": { player_id: skills_result }   // full evaluation output
      }
    """
    body = request.get_json(silent=True) or {}

    player_ids: list[str] = body.get("player_ids") or []
    season: str = body.get("season") or CURRENT_SEASON
    use_history: bool = bool(body.get("use_history", False))

    # Validate inputs before touching the database
    if not isinstance(player_ids, list):
        return _err("'player_ids' must be a list of UUID strings", status=400)

    if len(player_ids) > _BATCH_MAX_IDS:
        return _err(
            f"'player_ids' exceeds the maximum of {_BATCH_MAX_IDS} per request. "
            "Pass an empty list to process all qualifying players.",
            status=400,
        )

    # Validate each provided UUID — reject the whole request on first bad value
    for pid in player_ids:
        if not _validate_uuid(pid):
            return _err(f"Invalid player_id '{pid}' — all entries must be UUID strings", status=400)

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    logger.info(
        "POST /api/skills/batch — season=%s, use_history=%s, player_ids_count=%d",
        season, use_history, len(player_ids),
    )

    try:
        supabase = get_supabase()

        results = skill_engine.batch_evaluate_skills(
            player_ids=player_ids,
            season=season,
            use_history=use_history,
            supabase=supabase,
        )

        # The batch function resolves the full player list when player_ids is empty,
        # so we report "total" as the number actually attempted (len of results).
        total_requested = len(player_ids) if player_ids else len(results)

        return _ok({
            "total": total_requested,
            "processed": len(results),
            "results": results,
        })

    except Exception:
        logger.exception("Error in POST /api/skills/batch")
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# GET /api/league-averages
# ---------------------------------------------------------------------------


@skills_bp.route("/league-averages", methods=["GET"])
def league_averages():
    """
    Return league average stat values for the given season.

    On refresh=true or when the league_averages table is empty for the season,
    recomputes averages from the player_stats table and persists them before
    returning. Normal reads hit the 24-hour in-memory cache, then the DB.

    Query params:
      ?season=2025-26    (default: current season)
      ?refresh=true      (default: false — recompute and store fresh averages)

    Response data:
      [
        { "stat_key": "tracking_shooting.catch_shoot_fg3_pct",
          "value": 0.372,
          "sample_size": 142,
          "updated_at": "2025-12-01T10:00:00+00:00" },
        ...
      ]
    """
    season = request.args.get("season", CURRENT_SEASON)
    refresh = request.args.get("refresh", "false").lower() == "true"

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    try:
        supabase = get_supabase()

        if refresh:
            # Recompute league averages from source data and persist
            logger.info("Recomputing league averages for season %s", season)
            skill_engine.compute_and_store_league_averages(season, supabase)

        # Fetch the full rows from the league_averages table (includes sample_size/updated_at)
        rows = (
            supabase.table("league_averages")
            .select("stat_key, value, sample_size, updated_at")
            .eq("season", season)
            .order("stat_key")
            .execute()
        )

        data = rows.data or []

        # If no data and we haven't already refreshed, try computing on-the-fly
        if not data and not refresh:
            logger.info(
                "No league averages found for season %s — computing on-the-fly", season
            )
            skill_engine.compute_and_store_league_averages(season, supabase)

            rows = (
                supabase.table("league_averages")
                .select("stat_key, value, sample_size, updated_at")
                .eq("season", season)
                .order("stat_key")
                .execute()
            )
            data = rows.data or []

        return _ok(data)

    except Exception:
        logger.exception("Error in GET /api/league-averages for season %s", season)
        return _err("Internal server error")
