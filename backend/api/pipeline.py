"""
api/pipeline.py — Pipeline status and stats-fetch endpoints.

Endpoints:
  GET  /api/pipeline/status              — aggregate counts for the pipeline dashboard
  POST /api/pipeline/fetch-stats         — kick off background stats fetch, returns job_id
  GET  /api/pipeline/job-status/<job_id> — poll progress of a background fetch job

The skill-mapping and composite pipeline runs use the existing /api/skills/batch
and /api/composite/batch endpoints (called directly from the frontend).
"""

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

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

# ---------------------------------------------------------------------------
# In-memory background job registry.
# Each job is a dict with: status, progress, total, result, error, started_at,
# finished_at.  Only one fetch-stats job runs at a time (guarded by _job_lock).
# ---------------------------------------------------------------------------
_jobs: dict[str, dict[str, Any]] = {}
_job_lock = threading.Lock()


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


def _run_fetch_stats_job(
    job_id: str,
    player_ids: list[str],
    season: str,
    refresh: bool,
) -> None:
    """Background worker: fetch stats for each player and update job progress."""
    job = _jobs[job_id]
    try:
        supabase = get_supabase()

        # Resolve player list if none supplied (all qualifying players)
        if not player_ids:
            all_players = get_or_fetch_players(
                season, DEFAULT_MIN_MPG, False, supabase,
            )
            player_ids = [p["id"] for p in all_players]
            logger.info(
                "fetch-stats [%s]: %d qualifying players for season %s",
                job_id, len(player_ids), season,
            )

        total   = len(player_ids)
        fetched = 0
        errors  = 0

        # Store total so the polling endpoint can report progress
        job["total"] = total

        for idx, pid in enumerate(player_ids, start=1):
            logger.info("fetch-stats [%s] %d/%d: player %s", job_id, idx, total, pid)
            try:
                blob = get_or_fetch_player_stats(pid, season, supabase, refresh=refresh)
                if blob:
                    fetched += 1
                else:
                    errors += 1
            except Exception:
                logger.exception(
                    "fetch-stats [%s]: error fetching player %s", job_id, pid,
                )
                errors += 1

            # Update progress after each player so polls see real-time counts
            job["progress"] = idx
            job["fetched"]  = fetched
            job["errors"]   = errors

        logger.info(
            "fetch-stats [%s] complete: %d fetched, %d errors out of %d",
            job_id, fetched, errors, total,
        )

        # Scrape salaries from ESPN (~30-45s) and upsert into Supabase
        salary_matched   = 0
        salary_unmatched = 0
        try:
            salary_result    = run_bulk_salary_scrape(None, supabase)
            salary_matched   = salary_result.get("matched", 0)
            salary_unmatched = salary_result.get("unmatched", 0)
            logger.info(
                "fetch-stats [%s] salary scrape: %d matched, %d unmatched",
                job_id, salary_matched, salary_unmatched,
            )
        except Exception:
            logger.exception(
                "fetch-stats [%s]: salary scrape failed (non-fatal)", job_id,
            )

        # Mark job complete with final results
        job["status"] = "complete"
        job["result"] = {
            "total":            total,
            "fetched":          fetched,
            "skipped":          0,
            "errors":           errors,
            "salary_matched":   salary_matched,
            "salary_unmatched": salary_unmatched,
        }

    except Exception as exc:
        logger.exception("fetch-stats [%s]: fatal error", job_id)
        job["status"] = "error"
        job["error"]  = str(exc)

    finally:
        job["finished_at"] = datetime.now(timezone.utc).isoformat()


@pipeline_bp.route("/pipeline/fetch-stats", methods=["POST"])
@require_admin
def fetch_stats_batch():
    """
    Kick off a background stats fetch for all qualifying players.

    Returns immediately with a job_id. Poll GET /api/pipeline/job-status/<job_id>
    to track progress.

    Request body (JSON, all optional):
      {
        "player_ids": ["uuid1", ...],  // empty = all qualifying players
        "season":     "2025-26",       // default: current season
        "refresh":    false            // force re-fetch even if stats are cached
      }

    Response data:
      { "job_id": str }
    """
    # Only allow one fetch-stats job at a time
    with _job_lock:
        active = [
            jid for jid, j in _jobs.items()
            if j.get("status") == "running"
        ]
        if active:
            return _err(
                f"A stats fetch is already running (job {active[0]}). "
                "Wait for it to finish or check its status.",
                409,
            )

        body       = request.get_json(silent=True) or {}
        player_ids = body.get("player_ids") or []
        season     = body.get("season", CURRENT_SEASON)
        refresh    = bool(body.get("refresh", False))

        job_id = str(uuid.uuid4())
        _jobs[job_id] = {
            "status":      "running",
            "progress":    0,
            "total":       0,
            "fetched":     0,
            "errors":      0,
            "result":      None,
            "error":       None,
            "started_at":  datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        }

    # Spawn background thread — Flask's threaded=True lets this run
    # without blocking other request handlers
    thread = threading.Thread(
        target=_run_fetch_stats_job,
        args=(job_id, player_ids, season, refresh),
        daemon=True,
    )
    thread.start()

    return _ok({"job_id": job_id})


# ---------------------------------------------------------------------------
# GET /api/pipeline/job-status/<job_id>
# ---------------------------------------------------------------------------


@pipeline_bp.route("/pipeline/job-status/<job_id>", methods=["GET"])
def job_status(job_id: str):
    """
    Poll the progress of a background fetch-stats job.

    Response data:
      {
        "status":      "running" | "complete" | "error",
        "progress":    int,    // players processed so far
        "total":       int,    // total players to process
        "fetched":     int,    // successful fetches so far
        "errors":      int,    // fetch errors so far
        "result":      {...},  // final result dict (null while running)
        "error":       str,    // error message if status == "error"
        "started_at":  str,
        "finished_at": str | null,
      }
    """
    job = _jobs.get(job_id)
    if not job:
        return _err(f"Unknown job: {job_id}", 404)
    return _ok(dict(job))
