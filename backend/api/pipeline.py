"""
api/pipeline.py — Pipeline status and stats-fetch endpoints.

Endpoints:
  GET  /api/pipeline/status       — aggregate counts for the pipeline dashboard
  POST /api/pipeline/fetch-stats  — fetch and cache NBA stats for all qualifying players

The skill-mapping and composite pipeline runs use the existing /api/skills/batch
and /api/composite/batch endpoints (called directly from the frontend).
"""

import logging

from flask import Blueprint, jsonify, request

from api.auth import require_admin
from services.supabase_client import get_supabase, run_query
from services.players_service import (
    CURRENT_SEASON,
    DEFAULT_MIN_MPG,
    get_or_fetch_players,
    get_or_fetch_player_stats,
    run_bulk_salary_scrape,
)

logger = logging.getLogger(__name__)

pipeline_bp = Blueprint("pipeline", __name__, url_prefix="/api")


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(msg: str, status: int = 500) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": msg}), status


# ---------------------------------------------------------------------------
# GET /api/pipeline/status
# ---------------------------------------------------------------------------


@pipeline_bp.route("/pipeline/status", methods=["GET"])
def pipeline_status():
    """
    Return aggregate pipeline status for the given season.

    Provides the counts needed to drive the pipeline dashboard:
    how many players have stats, skill profiles, composite profiles,
    and how many flags are outstanding.

    Query params:
      ?season=2025-26  (default: current season)

    Response data:
      {
        "season": str,
        "total_qualifying_players": int,    # players with >= 15 MPG
        "players_with_stats": int,          # players with at least one stats blob
        "players_with_skills": int,         # players with source='stats' skill profile
        "players_with_composite": int,      # players with source='composite' profile
        "unresolved_flags": int,            # skill_flags with resolution IS NULL
        "total_flags": int,                 # all skill_flags (resolved + unresolved)
        "flagged_players": int,             # distinct players with >=1 unresolved flag
      }
    """
    season = request.args.get("season", CURRENT_SEASON)

    try:
        supabase = get_supabase()

        # --- Qualifying players -------------------------------------------------
        qualifying = run_query(lambda: (
            supabase.table("players")
            .select("id")
            .eq("season", season)
            .gte("minutes_per_game", DEFAULT_MIN_MPG)
            .execute()
        ))
        total_qualifying = len(qualifying.data or [])

        # --- Players with stats blobs (distinct) --------------------------------
        stats_rows = run_query(lambda: (
            supabase.table("player_stats")
            .select("player_id")
            .eq("season", season)
            .execute()
        ))
        players_with_stats = len(set(r["player_id"] for r in (stats_rows.data or [])))

        # --- Players with stats skill profiles (distinct) -----------------------
        skills_profiles = run_query(lambda: (
            supabase.table("skill_profiles")
            .select("player_id")
            .eq("season", season)
            .eq("source", "stats")
            .execute()
        ))
        players_with_skills = len(set(r["player_id"] for r in (skills_profiles.data or [])))

        # --- Composite profiles — need id+player_id for flag counting -----------
        composite_profiles = run_query(lambda: (
            supabase.table("skill_profiles")
            .select("id, player_id")
            .eq("season", season)
            .eq("source", "composite")
            .execute()
        ))
        # Map: profile_id → player_id (for resolving flagged player list)
        composite_profile_map: dict[str, str] = {
            r["id"]: r["player_id"]
            for r in (composite_profiles.data or [])
        }
        composite_ids = list(composite_profile_map.keys())
        players_with_composite = len(set(composite_profile_map.values()))

        # --- Flag counts --------------------------------------------------------
        # Batch composite_ids in chunks of 500 to respect PostgREST URL limits.
        unresolved_count = 0
        total_flags_count = 0
        flagged_player_ids: set[str] = set()

        _CHUNK = 500
        for i in range(0, len(composite_ids), _CHUNK):
            chunk = composite_ids[i : i + _CHUNK]

            # Unresolved flags — default arg captures chunk value for the lambda closure
            unresolved = run_query(lambda c=chunk: (
                supabase.table("skill_flags")
                .select("id, skill_profile_id")
                .in_("skill_profile_id", c)
                .is_("resolution", "null")
                .execute()
            ))
            unresolved_count += len(unresolved.data or [])
            for row in (unresolved.data or []):
                pid = composite_profile_map.get(row["skill_profile_id"])
                if pid:
                    flagged_player_ids.add(pid)

            # All flags (for total count)
            all_flags = run_query(lambda c=chunk: (
                supabase.table("skill_flags")
                .select("id")
                .in_("skill_profile_id", c)
                .execute()
            ))
            total_flags_count += len(all_flags.data or [])

        return _ok({
            "season":                     season,
            "total_qualifying_players":   total_qualifying,
            "players_with_stats":         players_with_stats,
            "players_with_skills":        players_with_skills,
            "players_with_composite":     players_with_composite,
            "unresolved_flags":           unresolved_count,
            "total_flags":                total_flags_count,
            "flagged_players":            len(flagged_player_ids),
        })

    except Exception:
        logger.exception("Error in GET /api/pipeline/status")
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/pipeline/fetch-stats
# ---------------------------------------------------------------------------


@pipeline_bp.route("/pipeline/fetch-stats", methods=["POST"])
@require_admin
def fetch_stats_batch():
    """
    Fetch and cache NBA stats for all qualifying players.

    This is Step 0 of the pipeline — it must be run before /api/skills/batch
    because the skill mapping service reads from the player_stats table.

    For each qualifying player the endpoint calls get_or_fetch_player_stats,
    which:
      - Pulls league-wide bulk stats (one bulk nba_api call, ~10s, then cached)
      - Fetches per-player ShotChartDetail and LeagueSeasonMatchups (~5–15s each)
      - Assembles and persists the full stats blob to player_stats

    WARNING: This is a long-running synchronous request. For a full league sweep
    (~300 players) it can take 30–60 minutes due to per-player API calls.
    Pass player_ids to process a subset first as a spot-check.

    Request body (JSON, all optional):
      {
        "player_ids": ["uuid1", ...],  // empty = all qualifying players
        "season":     "2025-26",       // default: current season
        "refresh":    false            // force re-fetch even if stats are cached
      }

    Response data:
      {
        "total":            int,   // players attempted
        "fetched":          int,   // stats blobs successfully retrieved/cached
        "skipped":          int,   // already cached (and refresh=false)
        "errors":           int,   // fetch failures
        "salary_matched":   int,   // players whose salary was updated from ESPN
        "salary_unmatched": int,   // qualifying players with no ESPN salary match
      }
    """
    body       = request.get_json(silent=True) or {}
    player_ids = body.get("player_ids") or []
    season     = body.get("season", CURRENT_SEASON)
    refresh    = bool(body.get("refresh", False))

    try:
        supabase = get_supabase()

        # Resolve player list — empty means "all qualifying players"
        if not player_ids:
            # Ensure the players table is populated first (lightweight bulk fetch)
            all_players = get_or_fetch_players(season, DEFAULT_MIN_MPG, False, supabase)
            player_ids = [p["id"] for p in all_players]
            logger.info(
                "fetch-stats: %d qualifying players for season %s",
                len(player_ids), season,
            )

        total   = len(player_ids)
        fetched = 0
        skipped = 0
        errors  = 0

        for idx, pid in enumerate(player_ids, start=1):
            logger.info("fetch-stats %d/%d: player %s", idx, total, pid)
            try:
                blob = get_or_fetch_player_stats(pid, season, supabase, refresh=refresh)
                if blob:
                    fetched += 1
                else:
                    # Player not found in DB (shouldn't happen if we got it from players table)
                    errors += 1
            except Exception:
                logger.exception("fetch-stats: error fetching player %s", pid)
                errors += 1

        logger.info(
            "fetch-stats complete: %d fetched, %d skipped, %d errors out of %d",
            fetched, skipped, errors, total,
        )

        # Scrape salaries from ESPN for all teams (~30–45s) and upsert into Supabase.
        # We run this after stats so both steps complete in one pipeline trigger.
        salary_matched   = 0
        salary_unmatched = 0
        try:
            salary_result    = run_bulk_salary_scrape(None, supabase)
            salary_matched   = salary_result.get("matched", 0)
            salary_unmatched = salary_result.get("unmatched", 0)
            logger.info(
                "fetch-stats salary scrape: %d matched, %d unmatched",
                salary_matched, salary_unmatched,
            )
        except Exception:
            logger.exception("fetch-stats: salary scrape failed (non-fatal)")

        return _ok({
            "total":            total,
            "fetched":          fetched,
            "skipped":          skipped,
            "errors":           errors,
            "salary_matched":   salary_matched,
            "salary_unmatched": salary_unmatched,
        })

    except Exception:
        logger.exception("Error in POST /api/pipeline/fetch-stats")
        return _err("Internal server error")
