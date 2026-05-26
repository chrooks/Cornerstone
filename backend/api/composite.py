"""
api/composite.py — Claude assessment and composite profile endpoints.

Endpoints:
  POST /api/players/<player_id>/claude-assessment   — Run Claude assessment (no persist)
  POST /api/players/<player_id>/composite-profile   — Full pipeline + persist
  POST /api/composite/batch                         — Batch composite for many players

All responses use the standard envelope: {success, data, error}.
Claude calls are rate-limited to max 5 concurrent with ≥200ms between starts
(rate limiter lives in claude_assessment.call_claude, not here).
"""

import logging
import re
import threading
import uuid as _uuid_mod
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, jsonify, request
from supabase import Client

from api.auth import require_admin
from services.supabase_client import get_supabase
from services.players_service import CURRENT_SEASON, DEFAULT_MIN_MPG
from services import skill_engine
from services.notability import get_notability_score, notability_tier
from services.claude_assessment import (
    get_claude_assessment,
    estimate_cost_usd,
)
from services.compositing import composite_profile, persist_profiles

logger = logging.getLogger(__name__)

# Valid season format: "YYYY-YY"
_SEASON_RE = re.compile(r"^\d{4}-\d{2}$")

# Batch concurrency: max 5 parallel Claude requests (rate limiting is inside call_claude)
_MAX_WORKERS = 5

# Upper bound on explicit player_ids per batch request — matches skills batch endpoint
_BATCH_MAX_IDS = 500


composite_bp = Blueprint("composite", __name__, url_prefix="/api")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _validate_uuid(val: str) -> bool:
    try:
        _uuid_mod.UUID(val)
        return True
    except (ValueError, AttributeError):
        return False


def _validate_season(val: str) -> bool:
    return bool(_SEASON_RE.match(val))


def _ok(data) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(msg: str, status: int = 500) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


def _get_stat_skills(player_id: str, season: str, supabase: Client) -> dict:
    """
    Fetch the stat-based skill profile.

    First tries the draft_skill_profiles DB cache (source='stats'). If not found,
    computes fresh via the skill mapping service and persists it.
    """
    try:
        row = (
            supabase.table("draft_skill_profiles")
            .select("profile")
            .eq("player_id", player_id)
            .eq("season", season)
            .eq("source", "stats")
            .limit(1)
            .execute()
        )
        if row.data and row.data[0].get("profile"):
            return row.data[0]["profile"]
    except Exception:
        logger.exception("DB lookup failed for stat profile — will recompute")

    # Recompute from the skill mapping service
    return skill_engine.get_player_skills(
        player_id=player_id,
        season=season,
        use_history=False,
        supabase=supabase,
    )


# ---------------------------------------------------------------------------
# POST /api/players/<player_id>/claude-assessment
# ---------------------------------------------------------------------------


@composite_bp.route("/players/<player_id>/claude-assessment", methods=["POST"])
@require_admin
def claude_assessment(player_id: str):
    """
    Run Claude's skill assessment for a single player.

    Fetches the stat profile, builds the Claude prompt, calls the API,
    and returns Claude's ratings. Does NOT composite or persist.

    Path params:
      player_id — Supabase UUID

    Request body (JSON, optional):
      { "season": "2025-26" }

    Response data:
      {
        "player_id":       str,
        "season":          str,
        "notability_score": int,
        "notability_tier": str,
        "claude_skills":   { skill_key: { tier, justification, confidence } },
        "claude_failed":   bool,
        "input_tokens":    int,
        "output_tokens":   int,
      }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID", status=400)

    body   = request.get_json(silent=True) or {}
    season = body.get("season", CURRENT_SEASON)

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    try:
        supabase = get_supabase()

        # Fetch or recompute the stat-based skill profile (required for informed section)
        stat_skills = _get_stat_skills(player_id, season, supabase)
        if not stat_skills:
            return _err(
                f"No stat profile found for player {player_id} season {season}. "
                "Run the stat skill pipeline (POST /api/skills/batch) first.",
                status=422,
            )

        # Compute notability — controls Claude's weight and affects the response metadata
        notability = get_notability_score(player_id, season, supabase)

        # Run Claude assessment (14 skills: 11 moderate + 3 low confidence)
        assessment = get_claude_assessment(player_id, season, stat_skills, supabase)

        return _ok({
            "player_id":        player_id,
            "season":           season,
            "notability_score": notability,
            "notability_tier":  notability_tier(notability),
            "claude_skills":    assessment.get("skills", {}),
            "claude_failed":    assessment.get("claude_failed", True),
            "input_tokens":     assessment.get("input_tokens", 0),
            "output_tokens":    assessment.get("output_tokens", 0),
        })

    except RuntimeError as exc:
        # RuntimeError from _get_anthropic_client when ANTHROPIC_API_KEY is missing
        logger.error("Claude config error: %s", exc)
        return _err(str(exc), status=503)
    except Exception:
        logger.exception("Error in POST /api/players/%s/claude-assessment", player_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/players/<player_id>/composite-profile
# ---------------------------------------------------------------------------


@composite_bp.route("/players/<player_id>/composite-profile", methods=["POST"])
@require_admin
def composite_profile_endpoint(player_id: str):
    """
    Run the full composite pipeline for a single player and persist results.

    Pipeline:
      1. Fetch stat-based skill profile (or compute if missing)
      2. Compute notability score
      3. Run Claude assessment (14 skills)
      4. Composite all 19 skills
      5. Persist stats / claude / composite draft_skill_profiles and draft_skill_flags

    Path params:
      player_id — Supabase UUID

    Request body (JSON, optional):
      { "season": "2025-26" }

    Response data:
      {
        "player_id":        str,
        "season":           str,
        "notability_score": int,
        "notability_tier":  str,
        "review_required":  bool,
        "composite":        { skill_key: composite_skill_result },
        "persistence":      { stats_profile_id, claude_profile_id,
                              composite_profile_id, flags_created },
        "token_usage":      { input_tokens, output_tokens, estimated_cost_usd },
      }
    """
    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID", status=400)

    body   = request.get_json(silent=True) or {}
    season = body.get("season", CURRENT_SEASON)

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    try:
        supabase = get_supabase()

        stat_skills = _get_stat_skills(player_id, season, supabase)
        if not stat_skills:
            return _err(
                f"No stat profile found for player {player_id} season {season}. "
                "Run the stat skill pipeline (POST /api/skills/batch) first.",
                status=422,
            )

        notability = get_notability_score(player_id, season, supabase)

        assessment = get_claude_assessment(player_id, season, stat_skills, supabase)
        claude_skills = assessment.get("skills", {})

        composite = composite_profile(stat_skills, claude_skills, notability)

        review_required = any(v.get("flagged", False) for v in composite.values())

        persistence = persist_profiles(
            player_id=player_id,
            season=season,
            stat_skills_result=stat_skills,
            claude_skills=claude_skills,
            composite=composite,
            supabase=supabase,
        )

        input_tok  = assessment.get("input_tokens", 0)
        output_tok = assessment.get("output_tokens", 0)

        return _ok({
            "player_id":        player_id,
            "season":           season,
            "notability_score": notability,
            "notability_tier":  notability_tier(notability),
            "review_required":  review_required,
            "composite":        composite,
            "persistence":      persistence,
            "token_usage": {
                "input_tokens":      input_tok,
                "output_tokens":     output_tok,
                "estimated_cost_usd": round(estimate_cost_usd(input_tok, output_tok), 4),
            },
        })

    except RuntimeError as exc:
        logger.error("Claude config error: %s", exc)
        return _err(str(exc), status=503)
    except Exception:
        logger.exception("Error in POST /api/players/%s/composite-profile", player_id)
        return _err("Internal server error")


# ---------------------------------------------------------------------------
# POST /api/composite/batch
# ---------------------------------------------------------------------------


@composite_bp.route("/composite/batch", methods=["POST"])
@require_admin
def composite_batch():
    """
    Run the full composite pipeline for many players concurrently.

    Claude API calls run in parallel (max 5 concurrent) with ≥200ms between
    request starts to respect Anthropic rate limits.

    Request body (JSON):
      {
        "player_ids": ["uuid1", ...],  // empty = all qualifying players
        "season":     "2025-26"         // optional, default current season
      }

    Response data:
      {
        "total":                int,
        "processed":            int,
        "claude_calls_made":    int,
        "claude_calls_skipped": int,
        "auto_accepted":        int,
        "flagged_for_review":   int,
        "errors":               int,
        "estimated_cost_usd":   float,
      }
    """
    body       = request.get_json(silent=True) or {}
    player_ids = body.get("player_ids") or []
    season     = body.get("season") or CURRENT_SEASON

    if not isinstance(player_ids, list):
        return _err("'player_ids' must be a list of UUID strings", status=400)

    if len(player_ids) > _BATCH_MAX_IDS:
        return _err(
            f"'player_ids' exceeds the maximum of {_BATCH_MAX_IDS} per request. "
            "Pass an empty list to process all qualifying players.",
            status=400,
        )

    for pid in player_ids:
        if not _validate_uuid(pid):
            return _err(f"Invalid player_id '{pid}' — all entries must be UUIDs", status=400)

    if not _validate_season(season):
        return _err("Invalid season format — expected 'YYYY-YY' e.g. '2025-26'", status=400)

    try:
        # Use a dedicated client for the main thread (qualifying lookup, cache preload).
        # Each worker thread creates its own client to avoid concurrency issues with
        # shared httpx connections inside supabase-py.
        main_supabase = get_supabase()

        # Resolve the full player list when none provided
        if not player_ids:
            qualifying = (
                main_supabase.table("players")
                .select("id")
                .eq("season", season)
                .gte("minutes_per_game", DEFAULT_MIN_MPG)
                .execute()
            )
            player_ids = [row["id"] for row in (qualifying.data or [])]
            logger.info(
                "composite/batch: found %d qualifying players for season %s",
                len(player_ids), season,
            )

        total = len(player_ids)
        if total == 0:
            return _ok({
                "total": 0, "processed": 0, "claude_calls_made": 0,
                "claude_calls_skipped": 0, "auto_accepted": 0,
                "flagged_for_review": 0, "errors": 0, "estimated_cost_usd": 0.0,
            })

        # Pre-load thresholds and league averages once for the batch
        thresholds  = skill_engine.get_thresholds(main_supabase)
        league_avgs = skill_engine.get_league_averages(season, main_supabase)

        # Thread-safe accumulators — all mutations happen inside results_lock
        results_lock      = threading.Lock()
        processed_count   = 0
        errors_count      = 0
        auto_accepted     = 0
        flagged_review    = 0
        claude_calls_made = 0
        claude_calls_failed = 0
        total_input_tok   = 0
        total_output_tok  = 0

        def _process_player(pid: str) -> None:
            """
            Worker: run the full composite pipeline for one player.

            Each worker creates its own Supabase client to avoid shared
            connection state across threads (supabase-py thread safety is
            not officially documented).
            """
            nonlocal processed_count, errors_count, auto_accepted, flagged_review
            nonlocal claude_calls_made, claude_calls_failed, total_input_tok, total_output_tok

            # Per-thread client — avoids sharing httpx transport state across threads
            worker_supabase = get_supabase()

            try:
                # Fetch stats blob for this player
                stats_row = (
                    worker_supabase.table("player_stats")
                    .select("stats")
                    .eq("player_id", pid)
                    .eq("season", season)
                    .order("fetched_at", desc=True)
                    .limit(1)
                    .execute()
                )
                stats_blob = (stats_row.data[0].get("stats") or {}) if stats_row.data else {}
                if not stats_blob:
                    logger.warning("No stats blob for player %s — skipping", pid)
                    with results_lock:
                        errors_count += 1
                    return

                # Evaluate stat skills using pre-loaded thresholds/averages
                stat_skills = skill_engine.evaluate_all_skills(
                    stats_blob, thresholds, league_avgs
                )
                stat_skills = skill_engine.apply_auto_promotions(stat_skills, thresholds)

                # Compute notability (result cached in-process after first call)
                notability = get_notability_score(pid, season, worker_supabase)

                # Claude call — rate limiter fires inside call_claude right before the HTTP request
                assessment    = get_claude_assessment(pid, season, stat_skills, worker_supabase)
                claude_skills = assessment.get("skills", {})
                in_tok        = assessment.get("input_tokens", 0)
                out_tok       = assessment.get("output_tokens", 0)
                claude_failed = assessment.get("claude_failed", True)

                # Composite
                composite = composite_profile(stat_skills, claude_skills, notability)

                # Count outcomes
                player_auto    = sum(1 for v in composite.values() if v.get("source") == "auto_accepted")
                player_flagged = sum(1 for v in composite.values() if v.get("flagged"))

                # Persist
                persist_profiles(
                    player_id=pid,
                    season=season,
                    stat_skills_result=stat_skills,
                    claude_skills=claude_skills,
                    composite=composite,
                    supabase=worker_supabase,
                )

                with results_lock:
                    processed_count   += 1
                    auto_accepted     += player_auto
                    flagged_review    += player_flagged
                    total_input_tok   += in_tok
                    total_output_tok  += out_tok
                    if not claude_failed:
                        claude_calls_made += 1
                    else:
                        claude_calls_failed += 1

            except Exception:
                logger.exception("Error processing player %s in composite batch", pid)
                with results_lock:
                    errors_count += 1

        # Run all players concurrently (max _MAX_WORKERS parallel Claude requests)
        with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
            futures = {executor.submit(_process_player, pid): pid for pid in player_ids}
            for fut in as_completed(futures):
                pid = futures[fut]
                exc = fut.exception()
                if exc:
                    logger.error("Future for player %s raised: %s", pid, exc)

        estimated_cost = estimate_cost_usd(total_input_tok, total_output_tok)

        logger.info(
            "composite/batch complete: %d/%d processed, %d errors, "
            "%d claude calls made, %d claude calls failed, ~$%.4f cost",
            processed_count, total, errors_count, claude_calls_made, claude_calls_failed, estimated_cost,
        )

        return _ok({
            "total":                total,
            "processed":            processed_count,
            "claude_calls_made":    claude_calls_made,
            # claude_calls_skipped counts players where Claude was called but failed
            # (they fall back to stat-only ratings rather than blocking the batch)
            "claude_calls_skipped": claude_calls_failed,
            "auto_accepted":        auto_accepted,
            "flagged_for_review":   flagged_review,
            "errors":               errors_count,
            "estimated_cost_usd":   round(estimated_cost, 4),
        })

    except RuntimeError as exc:
        logger.error("Claude config error: %s", exc)
        return _err(str(exc), status=503)
    except Exception:
        logger.exception("Error in POST /api/composite/batch")
        return _err("Internal server error")
