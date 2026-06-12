"""
api/pipeline.py — Pipeline status and ingestion trigger endpoints.

Endpoints:
  GET  /api/pipeline/status                  — aggregate counts for the pipeline dashboard
  POST /api/pipeline/fetch-stats             — kick off background stats fetch
  GET  /api/pipeline/runs/<run_id>           — poll a specific pipeline run
  POST /api/pipeline/salary-scrape           — kick off bulk salary scrape
  POST /api/pipeline/salary-scrape/<player_id> — single-player salary scrape
  POST /api/pipeline/bio-team-sync           — kick off bulk bio/team sync
  POST /api/pipeline/bio-team-sync/<player_id> — single-player bio/team sync

Pipeline run state is persisted in pipeline_runs (not in-process memory).
A-4: only write to pipeline_runs at start / complete / error.
A-9: salary scrape is NOT implicit in fetch-stats; it is a first-class trigger.
"""

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, g, jsonify, request

from api.auth import require_admin, require_open_draft
from services.supabase_client import get_supabase, run_query
from services.players_service import (
    CURRENT_SEASON,
    DEFAULT_MIN_MPG,
    get_or_fetch_players,
    get_or_fetch_player_stats,
    run_bulk_salary_scrape,
    run_bulk_bio_team_sync,
    run_player_bio_team_sync,
)
from services.pipeline_runs import repo as runs_repo
from services.snapshot_versions import repo as snap_repo

logger = logging.getLogger(__name__)

pipeline_bp = Blueprint("pipeline", __name__, url_prefix="/api")


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(msg: str, status: int = 500) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": msg}), status


def _get_draft_id() -> str | None:
    """Return the open draft's id, or None."""
    try:
        draft = snap_repo.get_draft()
        return draft.id if draft else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# GET /api/pipeline/status
# ---------------------------------------------------------------------------


@pipeline_bp.route("/pipeline/status", methods=["GET"])
def pipeline_status():
    """Return aggregate pipeline status for the given season."""
    season = request.args.get("season", CURRENT_SEASON)

    try:
        supabase = get_supabase()

        qualifying = run_query(lambda: (
            supabase.table("players")
            .select("id")
            .eq("season", season)
            .gte("minutes_per_game", DEFAULT_MIN_MPG)
            .execute()
        ))
        total_qualifying = len(qualifying.data or [])

        stats_rows = run_query(lambda: (
            supabase.table("player_stats")
            .select("player_id")
            .eq("season", season)
            .execute()
        ))
        players_with_stats = len(set(r["player_id"] for r in (stats_rows.data or [])))

        skills_profiles = run_query(lambda: (
            supabase.table("draft_skill_profiles")
            .select("player_id")
            .eq("season", season)
            .eq("source", "stats")
            .execute()
        ))
        players_with_skills = len(set(r["player_id"] for r in (skills_profiles.data or [])))

        composite_profiles = run_query(lambda: (
            supabase.table("draft_skill_profiles")
            .select("id, player_id")
            .eq("season", season)
            .eq("source", "composite")
            .execute()
        ))
        composite_profile_map: dict[str, str] = {
            r["id"]: r["player_id"]
            for r in (composite_profiles.data or [])
        }
        composite_ids = list(composite_profile_map.keys())
        players_with_composite = len(set(composite_profile_map.values()))

        unresolved_count = 0
        total_flags_count = 0
        flagged_player_ids: set[str] = set()

        _CHUNK = 500
        for i in range(0, len(composite_ids), _CHUNK):
            chunk = composite_ids[i: i + _CHUNK]
            unresolved = run_query(lambda c=chunk: (
                supabase.table("draft_skill_flags")
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

            all_flags = run_query(lambda c=chunk: (
                supabase.table("draft_skill_flags")
                .select("id")
                .in_("skill_profile_id", c)
                .execute()
            ))
            total_flags_count += len(all_flags.data or [])

        # Include recent pipeline runs in the response
        recent_runs = runs_repo.list_recent(limit=5)

        return _ok({
            "season":                     season,
            "total_qualifying_players":   total_qualifying,
            "players_with_stats":         players_with_stats,
            "players_with_skills":        players_with_skills,
            "players_with_composite":     players_with_composite,
            "unresolved_flags":           unresolved_count,
            "total_flags":                total_flags_count,
            "flagged_players":            len(flagged_player_ids),
            "recent_runs":                recent_runs,
        })

    except Exception:
        logger.exception("Error in GET /api/pipeline/status")
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/pipeline/fetch-stats
# ---------------------------------------------------------------------------


def _run_fetch_stats_job(run_id: str, player_ids: list[str], season: str, refresh: bool) -> None:
    """Background worker: fetch stats. A-9: no implicit salary scrape."""
    supabase = get_supabase()
    fetched = 0
    errors = 0

    try:
        if not player_ids:
            all_players = get_or_fetch_players(season, DEFAULT_MIN_MPG, False, supabase)
            player_ids = [p["id"] for p in all_players]
            logger.info("fetch-stats [%s]: %d qualifying players", run_id, len(player_ids))

        total = len(player_ids)
        # Seed total up front so the card shows "0 / N" immediately, then update
        # the running count periodically (throttled to ~40 writes max).
        runs_repo.update_progress(run_id, 0, total)
        step = max(1, total // 40)

        for idx, pid in enumerate(player_ids, start=1):
            try:
                blob = get_or_fetch_player_stats(pid, season, supabase, refresh=refresh)
                if blob:
                    fetched += 1
                else:
                    errors += 1
            except Exception:
                logger.exception("fetch-stats [%s]: error player %s", run_id, pid)
                errors += 1
            if idx % step == 0 or idx == total:
                runs_repo.update_progress(run_id, idx, total)

        logger.info("fetch-stats [%s] complete: %d/%d fetched", run_id, fetched, total)
        runs_repo.complete_run(run_id, rows_processed=fetched)

    except Exception as exc:
        logger.exception("fetch-stats [%s]: fatal error", run_id)
        runs_repo.complete_run(run_id, rows_processed=fetched, error=str(exc))


@pipeline_bp.route("/pipeline/fetch-stats", methods=["POST"])
@require_admin
@require_open_draft
def fetch_stats_batch():
    """Kick off a background stats fetch. Returns run_id (was job_id)."""
    body = request.get_json(silent=True) or {}
    player_ids = body.get("player_ids") or []
    season = body.get("season", CURRENT_SEASON)
    refresh = bool(body.get("refresh", False))

    draft_id = g.draft_id
    scope = "player" if player_ids else "bulk"

    try:
        run_id = runs_repo.start_run(
            name="stat_fetch",
            scope=scope,
            snapshot_release_id=draft_id,
            player_id=player_ids[0] if len(player_ids) == 1 else None,
        )
    except Exception:
        logger.exception("Failed to start pipeline run")
        return _err("Failed to start pipeline run", 500)

    thread = threading.Thread(
        target=_run_fetch_stats_job,
        args=(run_id, player_ids, season, refresh),
        daemon=True,
    )
    thread.start()

    return _ok({"run_id": run_id})


# ---------------------------------------------------------------------------
# POST /api/pipeline/salary-scrape
# ---------------------------------------------------------------------------


def _run_salary_scrape_job(run_id: str, player_ids: list[str]) -> None:
    """Background worker: scrape salaries.

    Empty player_ids → full-league scrape (bulk, unchanged behavior).
    Subset (#76) → resolve the subset's teams, scrape each distinct team page
    once, and match/update only the selected players.
    """
    supabase = get_supabase()
    rows = 0
    try:
        if player_ids:
            rows_result = run_query(lambda: (
                supabase.table("players")
                .select("id, team")
                .in_("id", player_ids)
                .execute()
            ))
            team_map: dict[str, list[str]] = {}
            for row in (rows_result.data or []):
                team = row.get("team")
                if team:
                    team_map.setdefault(team, []).append(row["id"])

            teams = sorted(team_map.keys())
            total_teams = len(teams)
            runs_repo.update_progress(run_id, 0, total_teams)
            errors: list[str] = []
            for idx, team in enumerate(teams, start=1):
                # Isolate per-team failures so one bad team doesn't abandon the
                # rest of the subset (matches the fetch-stats per-item pattern).
                try:
                    result = run_bulk_salary_scrape(team, supabase, player_ids=team_map[team])
                    rows += result.get("matched", 0)
                except Exception as team_exc:
                    logger.exception("salary-scrape [%s]: team %s failed", run_id, team)
                    errors.append(f"{team}: {team_exc}")
                runs_repo.update_progress(run_id, idx, total_teams)
            error = "; ".join(errors) if errors else None
            runs_repo.complete_run(run_id, rows_processed=rows, error=error)
        else:
            # #70: forward the per-player match loop's progress to the run so
            # the full-league bulk card renders a determinate bar (X / N).
            result = run_bulk_salary_scrape(
                None,
                supabase,
                progress_cb=lambda processed, total: runs_repo.update_progress(
                    run_id, processed, total
                ),
            )
            rows = result.get("matched", 0)
            runs_repo.complete_run(run_id, rows_processed=rows)
    except Exception as exc:
        logger.exception("salary-scrape [%s]: fatal error", run_id)
        runs_repo.complete_run(run_id, rows_processed=rows, error=str(exc))


@pipeline_bp.route("/pipeline/salary-scrape", methods=["POST"])
@require_admin
@require_open_draft
def salary_scrape_bulk():
    """Kick off a salary scrape — bulk, or scoped to an optional player_ids subset.

    Request body (optional): { "player_ids": ["<uuid>", ...] }
    Empty/omitted player_ids = full-league scrape, same convention as fetch-stats.
    """
    body = request.get_json(silent=True) or {}
    player_ids = body.get("player_ids") or []
    if not isinstance(player_ids, list):
        return _err("'player_ids' must be a list of UUID strings", 400)

    draft_id = g.draft_id
    scope = "player" if player_ids else "bulk"

    try:
        run_id = runs_repo.start_run(
            "salary_scrape", scope,
            snapshot_release_id=draft_id,
            player_id=player_ids[0] if len(player_ids) == 1 else None,
        )
    except Exception:
        return _err("Failed to start salary scrape run", 500)

    threading.Thread(
        target=_run_salary_scrape_job,
        args=(run_id, player_ids),
        daemon=True,
    ).start()

    return _ok({"run_id": run_id})


@pipeline_bp.route("/pipeline/salary-scrape/<player_id>", methods=["POST"])
@require_admin
@require_open_draft
def salary_scrape_player(player_id: str):
    """Kick off a per-player salary scrape."""
    draft_id = g.draft_id
    try:
        run_id = runs_repo.start_run(
            "salary_scrape", "player",
            snapshot_release_id=draft_id,
            player_id=player_id,
        )
    except Exception:
        return _err("Failed to start salary scrape run", 500)

    threading.Thread(
        target=_run_salary_scrape_job,
        args=(run_id, [player_id]),
        daemon=True,
    ).start()

    return _ok({"run_id": run_id})


# ---------------------------------------------------------------------------
# POST /api/pipeline/bio-team-sync
# ---------------------------------------------------------------------------


def _run_bio_team_sync_job(run_id: str, player_ids: list[str], season: str) -> None:
    """Background worker: bio/team sync.

    Empty player_ids → bulk refresh of all qualifying players (unchanged behavior).
    Subset (#76) → per-player sync loop with fetch-stats-style progress bookkeeping.
    """
    supabase = get_supabase()
    rows = 0
    try:
        if player_ids:
            total = len(player_ids)
            runs_repo.update_progress(run_id, 0, total)
            errors: list[str] = []
            for idx, pid in enumerate(player_ids, start=1):
                # Isolate per-player failures so one bad player doesn't abandon
                # the rest of the subset (matches the fetch-stats per-item pattern).
                try:
                    result = run_player_bio_team_sync(pid, supabase)
                    rows += result.get("refreshed", 0)
                except Exception as player_exc:
                    logger.exception("bio-team-sync [%s]: player %s failed", run_id, pid)
                    errors.append(f"{pid}: {player_exc}")
                runs_repo.update_progress(run_id, idx, total)
            error = "; ".join(errors) if errors else None
            runs_repo.complete_run(run_id, rows_processed=rows, error=error)
        else:
            result = run_bulk_bio_team_sync(season, supabase)
            rows = result.get("refreshed", 0)
            runs_repo.complete_run(run_id, rows_processed=rows)
    except Exception as exc:
        logger.exception("bio-team-sync [%s]: fatal error", run_id)
        runs_repo.complete_run(run_id, rows_processed=rows, error=str(exc))


@pipeline_bp.route("/pipeline/bio-team-sync", methods=["POST"])
@require_admin
@require_open_draft
def bio_team_sync_bulk():
    """Kick off a bio/team sync — bulk, or scoped to an optional player_ids subset.

    Request body (optional): { "player_ids": ["<uuid>", ...], "season": "2025-26" }
    Empty/omitted player_ids = all qualifying players, same convention as fetch-stats.
    """
    body = request.get_json(silent=True) or {}
    season = body.get("season", CURRENT_SEASON)
    player_ids = body.get("player_ids") or []
    if not isinstance(player_ids, list):
        return _err("'player_ids' must be a list of UUID strings", 400)

    draft_id = g.draft_id
    scope = "player" if player_ids else "bulk"

    try:
        run_id = runs_repo.start_run(
            "bio_team_sync", scope,
            snapshot_release_id=draft_id,
            player_id=player_ids[0] if len(player_ids) == 1 else None,
        )
    except Exception:
        return _err("Failed to start bio/team sync run", 500)

    threading.Thread(
        target=_run_bio_team_sync_job,
        args=(run_id, player_ids, season),
        daemon=True,
    ).start()

    return _ok({"run_id": run_id})


@pipeline_bp.route("/pipeline/skill-evaluation", methods=["POST"])
@require_admin
@require_open_draft
def skill_evaluation_batch():
    """Kick off a background skill-evaluation run scoped to the current open draft.

    Request body (all optional):
      {
        "player_ids": ["<uuid>", ...],  // empty = all qualifying players
        "season": "2025-26",
        "skill_filter": ["Scorer", "Playmaker"]  // omit = all 21 skills
      }

    Side effect: spawns a background worker that reads existing player_stats,
    evaluates each player against draft thresholds, stages results in
    pipeline_run_results, then marks the run success.

    Returns: { "run_id": "<uuid>", "status": "running" }
    """
    from flask import g
    from services.skill_engine.evaluation_only import evaluate_skills_for_run
    from services.skills import ALL_SKILLS

    body = request.get_json(silent=True) or {}
    player_ids: list[str] = body.get("player_ids") or []
    season: str = body.get("season", CURRENT_SEASON)
    skill_filter: list[str] | None = body.get("skill_filter") or None

    # Validate skill_filter entries against the canonical 21-skill taxonomy.
    if skill_filter:
        unknown = [s for s in skill_filter if s not in ALL_SKILLS]
        if unknown:
            return _err(f"unknown_skill: {unknown[0]}", 400)

    draft_id = g.draft_id

    # Check for a pending-commit run before starting a new one
    try:
        run_id = runs_repo.start_run(
            name="skill_evaluation",
            scope="player" if player_ids else "bulk",
            snapshot_release_id=draft_id,
            player_id=player_ids[0] if len(player_ids) == 1 else None,
        )
    except Exception as exc:
        err_msg = str(exc).lower()
        if "unique" in err_msg or "duplicate" in err_msg:
            return _err("pending_commit_run_exists — commit or discard the current run first", 409)
        logger.exception("Failed to start skill-evaluation run")
        return _err("Failed to start skill-evaluation run", 500)

    def _worker():
        try:
            # Resolve player_ids if empty
            resolved_ids = player_ids
            if not resolved_ids:
                supabase = get_supabase()
                result = run_query(
                    lambda: supabase.table("players")
                    .select("id")
                    .eq("season", season)
                    .gte("minutes_per_game", DEFAULT_MIN_MPG)
                    .execute()
                )
                resolved_ids = [r["id"] for r in (result.data or [])]
                logger.info("skill-evaluation [%s]: %d qualifying players", run_id, len(resolved_ids))

            evaluate_skills_for_run(
                run_id=run_id,
                player_ids=resolved_ids,
                season=season,
                skill_filter=skill_filter,
            )
            runs_repo.complete_run(run_id, rows_processed=len(resolved_ids))
        except Exception as exc:
            logger.exception("skill-evaluation [%s]: fatal error", run_id)
            runs_repo.complete_run(run_id, rows_processed=0, error=str(exc))

    threading.Thread(target=_worker, daemon=True).start()

    return _ok({"run_id": run_id, "status": "running"})


@pipeline_bp.route("/pipeline/bio-team-sync/<player_id>", methods=["POST"])
@require_admin
@require_open_draft
def bio_team_sync_player(player_id: str):
    """Kick off a per-player bio/team sync."""
    body = request.get_json(silent=True) or {}
    season = body.get("season", CURRENT_SEASON)
    draft_id = g.draft_id

    try:
        run_id = runs_repo.start_run(
            "bio_team_sync", "player",
            snapshot_release_id=draft_id,
            player_id=player_id,
        )
    except Exception:
        return _err("Failed to start bio/team sync run", 500)

    threading.Thread(
        target=_run_bio_team_sync_job,
        args=(run_id, [player_id], season),
        daemon=True,
    ).start()

    return _ok({"run_id": run_id})
