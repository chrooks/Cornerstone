"""
api/calibration.py — Calibration tool endpoints.

Endpoints:
  GET    /api/skills/thresholds                  — all skill threshold rules
  PUT    /api/skills/thresholds/<skill_name>     — upsert a rule + bust cache
  POST   /api/skills/test-thresholds             — run rule engine against anchors
  GET    /api/anchors                            — all anchors grouped by skill
  POST   /api/anchors                            — create or update an anchor
  DELETE /api/anchors/<anchor_id>                — remove an anchor

All responses use the standard {success, data, error} envelope.
"""

import logging
import os
import threading
import uuid as _uuid_mod
from functools import wraps

from flask import Blueprint, jsonify, request, g

from api.auth import require_admin, require_open_draft
from services.supabase_client import get_supabase
from services.skill_engine.cache import get_thresholds, get_league_averages
from services.skill_engine.evaluator import evaluate_skill, collect_condition_results
from services.players_service import CURRENT_SEASON

logger = logging.getLogger(__name__)

calibration_bp = Blueprint("calibration", __name__, url_prefix="/api")

# ---------------------------------------------------------------------------
# Write-endpoint guard: require X-Calibration-Key header on all mutating
# requests (PUT/POST/DELETE). Set CALIBRATION_API_KEY in .env to enable.
# If the env var is not set, writes are blocked in non-DEBUG mode and allowed
# in debug mode (so local dev still works without configuring the key).
# ---------------------------------------------------------------------------

_CALIBRATION_API_KEY = os.environ.get("CALIBRATION_API_KEY", "")


def require_write_key(fn):
    """
    Decorator that enforces the X-Calibration-Key header on write endpoints.
    Allows unauthenticated writes only when CALIBRATION_API_KEY is not configured
    AND the app is running in debug mode (local development only).
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _CALIBRATION_API_KEY:
            # No key configured — allow in dev, block in prod
            from flask import current_app
            if not current_app.debug:
                return jsonify({
                    "success": False,
                    "data": None,
                    "error": "CALIBRATION_API_KEY is not configured on this server.",
                }), 503
            # Debug mode: allow without key (local development)
            return fn(*args, **kwargs)

        provided = request.headers.get("X-Calibration-Key", "")
        if provided != _CALIBRATION_API_KEY:
            logger.warning(
                "Rejected calibration write: invalid or missing X-Calibration-Key"
            )
            return jsonify({
                "success": False,
                "data": None,
                "error": "Unauthorized — X-Calibration-Key header is required for write operations.",
            }), 401

        return fn(*args, **kwargs)
    return wrapper

# Valid values for tier names and JSONB operators
_VALID_TIERS = {"None", "Capable", "Proficient", "Elite", "All-Time Great"}
_VALID_OPERATORS = {">=", "<=", ">", "<", "==", "!="}
_VALID_LOGIC = {"AND", "OR"}


def _ok(data) -> tuple:
    """Standard success envelope."""
    return jsonify({"success": True, "data": data, "error": None}), 200


def _err(message: str, status: int = 400) -> tuple:
    """Standard error envelope."""
    return jsonify({"success": False, "data": None, "error": message}), status


def _validate_uuid(value: str) -> bool:
    """Return True if value is a valid UUID string."""
    try:
        _uuid_mod.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def _validate_conditions_block(block: dict, path: str = "") -> str | None:
    """
    Recursively validate a conditions block within a threshold rule.
    Returns None if valid, or an error message string if invalid.
    """
    if not isinstance(block, dict):
        return f"Block at '{path}' must be an object"

    logic = block.get("logic", "AND")
    if logic not in _VALID_LOGIC:
        return f"Invalid logic '{logic}' at '{path}' — must be AND or OR"

    conditions = block.get("conditions", [])
    if not isinstance(conditions, list):
        return f"'conditions' at '{path}' must be a list"

    for i, cond in enumerate(conditions):
        cond_path = f"{path}.conditions[{i}]"
        if not isinstance(cond, dict):
            return f"Condition at '{cond_path}' must be an object"

        # Nested block — recurse
        if "conditions" in cond or "logic" in cond:
            err = _validate_conditions_block(cond, cond_path)
            if err:
                return err
        else:
            # Leaf condition — validate operator if present
            op = cond.get("operator")
            if op and op not in _VALID_OPERATORS:
                return f"Invalid operator '{op}' at '{cond_path}' — must be one of {sorted(_VALID_OPERATORS)}"

    return None


def _validate_threshold_rule(rule: dict) -> str | None:
    """
    Validate the structure of a threshold JSONB rule before persisting.
    Returns None if valid, or an error message string if invalid.

    Checks:
      - Rule is a JSON object
      - 'tiers' key is present and is a dict
      - Each tier block passes block validation
      - volume_gate (if present) passes block validation
      - Operator values (if present) are from the allowed set
    """
    if not isinstance(rule, dict):
        return "Rule must be a JSON object"

    # 'tiers' is required — the skill engine cannot classify without it
    if "tiers" not in rule:
        return "Missing required key: 'tiers'"

    tiers = rule["tiers"]
    if not isinstance(tiers, dict):
        return "'tiers' must be an object"

    # Validate each tier block
    for tier_name, tier_block in tiers.items():
        err = _validate_conditions_block(tier_block, f"tiers.{tier_name}")
        if err:
            return err

    # Validate volume_gate if present
    volume_gate = rule.get("volume_gate")
    if volume_gate is not None:
        err = _validate_conditions_block(volume_gate, "volume_gate")
        if err:
            return err

    # Validate stabilization array structure if present
    stabilization = rule.get("stabilization")
    if stabilization is not None:
        if not isinstance(stabilization, list):
            return "'stabilization' must be a list"
        for i, item in enumerate(stabilization):
            if not isinstance(item, dict):
                return f"stabilization[{i}] must be an object"
            if "k" in item and not isinstance(item["k"], (int, float)):
                return f"stabilization[{i}].k must be a number"

    return None


# ---------------------------------------------------------------------------
# GET /api/skills/thresholds
# ---------------------------------------------------------------------------

@calibration_bp.route("/skills/thresholds", methods=["GET"])
@require_admin
def get_all_thresholds():
    """
    Return all skill threshold rules from the draft_skill_thresholds table.
    Includes the full JSONB blob (volume gates, tier conditions, stabilization
    config, tier bumps, pre-adjustments, auto-promotions, stat_confidence, etc.).

    Returns a list so the UI can iterate in order.
    """
    try:
        supabase = get_supabase()
        rows = (
            supabase.table("draft_skill_thresholds")
            .select("id, skill_name, thresholds, updated_at")
            .order("skill_name")
            .execute()
        )
        return _ok(rows.data or [])

    except Exception:
        logger.exception("Error in GET /api/skills/thresholds")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# PUT /api/skills/thresholds/<skill_name>
# ---------------------------------------------------------------------------

# INTENTIONAL ESCAPE SEAM — no @require_open_draft on this route.
#
# Without ?force=true: returns 409 so callers use /save for draft-aware staging.
# With ?force=true:    writes directly to draft_skill_thresholds, bypassing the
#   pipeline-run / diff-preview / commit workflow entirely.
#
# This is a documented emergency direct-write path for situations where the
# normal draft workflow is unavailable (e.g., no open draft exists, or an urgent
# production fix is needed). It is intentional that this route does NOT gate on
# an open draft — callers who supply ?force=true have explicitly acknowledged
# the bypass. The test suite locks this Contract in
# test_put_thresholds_force_true_bypasses_draft_gate_with_explicit_intent.
@calibration_bp.route("/skills/thresholds/<skill_name>", methods=["PUT"])
@require_admin
@require_write_key
def upsert_threshold(skill_name: str):
    """
    Upsert a threshold rule for the given skill.

    In draft-aware mode this endpoint requires ?force=true to write directly.
    Without ?force=true, returns 409 directing the caller to use /save instead
    (which stages a threshold_edit pipeline run for diff preview + commit).

    Validates the JSONB structure before persisting — rejects rules missing
    the 'tiers' key, using invalid operators, or with malformed block structure.

    After a successful save, busts the in-memory threshold cache (5-min TTL)
    so the next /skills call picks up the updated rules without waiting for TTL expiry.
    """
    if not skill_name or len(skill_name) > 100:
        return _err("Invalid skill_name")

    force = request.args.get("force", "").lower() in ("true", "1", "yes")
    if not force:
        return _err(
            "Direct threshold updates require ?force=true. "
            "Use POST /api/skills/thresholds/<skill_name>/save to stage a draft run.",
            409,
        )

    body = request.get_json(silent=True)
    if body is None:
        return _err("Request body must be valid JSON")

    # Validate structure before persisting — fail fast with a descriptive message
    validation_error = _validate_threshold_rule(body)
    if validation_error:
        return _err(f"Invalid threshold rule: {validation_error}")

    try:
        supabase = get_supabase()

        # Upsert on skill_name conflict — insert if new, update if exists
        supabase.table("draft_skill_thresholds").upsert(
            {"skill_name": skill_name, "thresholds": body},
            on_conflict="skill_name",
        ).execute()

        # Bust the in-memory threshold cache so the next evaluation uses the new rules
        get_thresholds(supabase, refresh=True)

        # Audit: record a synchronous pipeline_run row for traceability.
        # snapshot_release_id=None — intentional. ?force=true writes directly to
        # draft_skill_thresholds outside any draft lifecycle. The audit row documents
        # the emergency write even when no Snapshot Release draft is open.
        try:
            from services.pipeline_runs import repo as runs_repo
            from dataclasses import asdict
            from services.pipeline_runs.repo import ThresholdEditParams
            audit_params = asdict(ThresholdEditParams(skill_name=skill_name, thresholds=body))
            runs_repo.record_force_audit(
                pipeline_name="threshold_edit",
                params=audit_params,
                snapshot_release_id=None,
            )
        except Exception:
            logger.exception(
                "Failed to record force-audit pipeline_run for skill '%s' — "
                "write already succeeded; audit failure is non-fatal",
                skill_name,
            )

        logger.info("Upserted threshold for skill '%s' and refreshed cache", skill_name)
        return _ok({"skill_name": skill_name, "message": "Threshold saved and cache refreshed"})

    except Exception:
        logger.exception("Error in PUT /api/skills/thresholds/%s", skill_name)
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# POST /api/skills/thresholds/<skill_name>/save
# (draft-aware threshold staging — creates a threshold_edit pipeline run)
# ---------------------------------------------------------------------------


@calibration_bp.route("/skills/thresholds/<skill_name>/save", methods=["POST"])
@require_admin
@require_write_key
@require_open_draft
def save_threshold_edit(skill_name: str):
    """
    Stage a threshold edit as a threshold_edit pipeline run.

    This is the draft-aware alternative to PUT /api/skills/thresholds/<skill_name>.
    Instead of writing directly to draft_skill_thresholds, this endpoint:
      1. Creates a pipeline_runs row (pipeline_name='threshold_edit').
      2. Spawns a background worker that applies the proposed thresholds in-memory
         (not persisted yet), re-evaluates every Player for that Skill, and stages
         results in pipeline_run_results.
      3. Returns the run_id immediately so the caller can poll for completion and
         preview the diff before committing.

    Request body: full proposed thresholds JSONB for the skill (same shape as PUT).
    Response: { "run_id": "<uuid>" }
    """
    if not skill_name or len(skill_name) > 100:
        return _err("Invalid skill_name")

    # Allowlist check against the canonical 21-skill taxonomy.
    # Without this, a typo (or worse, a malicious caller) could create a
    # threshold_edit run whose params reference a Skill that does not exist,
    # which never lands cleanly in draft_skill_thresholds on commit.
    from services.skills import ALL_SKILLS
    if skill_name not in ALL_SKILLS:
        return _err("unknown_skill", 400)

    body = request.get_json(silent=True)
    if body is None:
        return _err("Request body must be valid JSON")

    validation_error = _validate_threshold_rule(body)
    if validation_error:
        return _err(f"Invalid threshold rule: {validation_error}")

    draft_id = g.draft_id

    from dataclasses import asdict
    from services.pipeline_runs import repo as runs_repo
    from services.pipeline_runs.repo import ThresholdEditParams
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    # Pre-check: a staged run flips to success only at completion, so the
    # one-pending-commit unique index would otherwise fire in the worker and
    # surface as a raw 23505. Reject up front with a friendly code instead.
    if runs_repo.any_pending_commit(draft_id):
        return _err(
            "pending_commit_run_exists — commit or discard the current staged run first",
            409,
        )

    try:
        run_id = runs_repo.start_run(
            name="threshold_edit",
            scope="bulk",
            snapshot_release_id=draft_id,
            params=asdict(ThresholdEditParams(skill_name=skill_name, thresholds=body)),
        )
    except Exception as exc:
        err_msg = str(exc).lower()
        if "unique" in err_msg or "duplicate" in err_msg:
            return _err("pending_commit_run_exists — commit or discard the current run first", 409)
        logger.exception("Failed to start threshold_edit run for skill '%s'", skill_name)
        return _err("Failed to start threshold_edit run", 500)

    def _worker():
        try:
            supabase = get_supabase()
            # Fetch all qualifying players for this season
            from services.players_service import CURRENT_SEASON, DEFAULT_MIN_MPG
            result = supabase.table("players").select("id").eq("season", CURRENT_SEASON).gte("minutes_per_game", DEFAULT_MIN_MPG).execute()
            player_ids = [r["id"] for r in (result.data or [])]

            # Use override thresholds so draft_skill_thresholds is NOT modified yet
            override = {skill_name: body}
            evaluate_skills_for_run(
                run_id=run_id,
                player_ids=player_ids,
                season=CURRENT_SEASON,
                skill_filter=[skill_name],
                thresholds_override=override,
            )
            runs_repo.complete_run(run_id, rows_processed=len(player_ids))
        except Exception as exc:
            logger.exception("threshold_edit [%s]: fatal error", run_id)
            runs_repo.complete_run(run_id, rows_processed=0, error=str(exc))

    threading.Thread(target=_worker, daemon=True).start()

    return _ok({"run_id": run_id})


# ---------------------------------------------------------------------------
# POST /api/skills/test-thresholds
# ---------------------------------------------------------------------------

@calibration_bp.route("/skills/test-thresholds", methods=["POST"])
@require_admin
def test_thresholds():
    """
    Run the rule engine against anchor players and return pass/fail results.

    Request body:
      {
        "skill_name": "spot_up_shooter" | "all",
        "override_thresholds": { "spot_up_shooter": {...} }  // optional — test unsaved edits
      }

    The override_thresholds field allows testing threshold changes before saving them.
    Overrides are applied on top of the current saved thresholds.

    For each anchor of the target skill(s):
      1. Loads the anchor's stats blob from player_stats
      2. Runs evaluate_skill with the working thresholds
      3. Compares actual_tier to expected_tier
      4. Returns pass/fail with driving stats for transparency

    Returns single-skill result when skill_name is a specific skill,
    or a list of per-skill summaries when skill_name is "all".
    """
    body = request.get_json(silent=True) or {}
    skill_name = body.get("skill_name", "").strip()
    override_thresholds = body.get("override_thresholds")  # optional — unsaved edits

    if not skill_name:
        return _err("'skill_name' is required — pass a skill name or 'all'")

    try:
        supabase = get_supabase()
        season = CURRENT_SEASON

        # Load the latest saved thresholds (bypass cache to get current DB state)
        current_thresholds = get_thresholds(supabase, refresh=True)
        league_avgs = get_league_averages(season, supabase)

        # Merge any override thresholds (for testing unsaved changes)
        # Validate each override rule before merging so test failures return a clear error
        # rather than a misleading 500 from the evaluator.
        working_thresholds = dict(current_thresholds)
        if override_thresholds and isinstance(override_thresholds, dict):
            for sname, rule in override_thresholds.items():
                if not isinstance(rule, dict):
                    return _err(f"override_thresholds['{sname}'] must be a JSON object")
                validation_error = _validate_threshold_rule(rule)
                if validation_error:
                    return _err(f"Invalid override rule for '{sname}': {validation_error}")
                working_thresholds[sname] = rule

        # Determine which skills to test and fetch their anchors
        if skill_name == "all":
            anchor_rows = (
                supabase.table("anchor_players")
                .select("id, player_id, skill_name, expected_tier, notes, players(name)")
                .execute()
            )
            anchors_by_skill: dict[str, list] = {}
            for row in anchor_rows.data or []:
                sn = row["skill_name"]
                anchors_by_skill.setdefault(sn, []).append(row)
            skills_to_test = list(working_thresholds.keys())
        else:
            anchor_rows = (
                supabase.table("anchor_players")
                .select("id, player_id, skill_name, expected_tier, notes, players(name)")
                .eq("skill_name", skill_name)
                .execute()
            )
            anchors_by_skill = {skill_name: anchor_rows.data or []}
            skills_to_test = [skill_name]

        # Pre-load stats blobs for all anchors in a single batched query.
        # This avoids N+1 round-trips when testing "all" (19 skills × ~5 anchors = ~95 queries).
        # We collect all distinct player_ids across skills, fetch their stats in one .in_() call,
        # and build a lookup dict keyed by player_id.
        all_anchor_player_ids: list[str] = []
        for skill_anchors_list in anchors_by_skill.values():
            for anchor in skill_anchors_list:
                pid = anchor.get("player_id")
                if pid and pid not in all_anchor_player_ids:
                    all_anchor_player_ids.append(pid)

        # Batch-fetch the most recent stats row per player.
        # Supabase doesn't support DISTINCT ON via the client SDK, so we fetch all rows
        # for qualifying players and keep the most recently fetched row per player_id.
        stats_lookup: dict[str, dict] = {}
        if all_anchor_player_ids:
            batch_stats = (
                supabase.table("player_stats")
                .select("player_id, stats, fetched_at")
                .eq("season", season)
                .in_("player_id", all_anchor_player_ids)
                .order("fetched_at", desc=True)
                .execute()
            )
            # Keep only the newest row per player_id
            for row in batch_stats.data or []:
                pid = row["player_id"]
                if pid not in stats_lookup:
                    stats_lookup[pid] = row.get("stats") or {}

        # Build results for each skill
        all_skill_results = []

        for sn in skills_to_test:
            skill_anchors = anchors_by_skill.get(sn, [])
            rule = working_thresholds.get(sn)

            if not rule:
                logger.debug("No threshold rule for skill '%s' — skipping", sn)
                continue

            anchor_results = []
            passed_count = 0

            for anchor in skill_anchors:
                player_id = anchor["player_id"]
                player_name = (anchor.get("players") or {}).get("name", "Unknown")
                expected_tier = anchor["expected_tier"]

                # Look up pre-fetched stats blob — no additional round-trip needed
                stats_blob = stats_lookup.get(player_id, {})

                if not stats_blob:
                    anchor_results.append({
                        "player_id": player_id,
                        "player_name": player_name,
                        "expected_tier": expected_tier,
                        "actual_tier": "Unknown",
                        "passed": False,
                        "error": "No stats available for this player",
                        "driving_stats": {},
                    })
                    continue

                # Run the single-skill rule engine evaluation
                eval_result = evaluate_skill(sn, rule, stats_blob, league_avgs)
                actual_tier = eval_result.get("tier", "None")
                passed = actual_tier == expected_tier
                if passed:
                    passed_count += 1

                # Collect per-condition pass/fail for the calibration UI breakdown
                condition_results = collect_condition_results(rule, stats_blob, league_avgs)

                anchor_results.append({
                    "player_id": player_id,
                    "player_name": player_name,
                    "expected_tier": expected_tier,
                    "actual_tier": actual_tier,
                    "passed": passed,
                    "driving_stats": eval_result.get("driving_stats", {}),
                    "volume_gate_passed": eval_result.get("volume_gate_passed", False),
                    "data_missing": eval_result.get("data_missing", False),
                    "condition_results": condition_results,
                })

            all_skill_results.append({
                "skill_name": sn,
                "anchors_tested": len(anchor_results),
                "passed": passed_count,
                "failed": len(anchor_results) - passed_count,
                "results": anchor_results,
            })

        # Return single-skill result or full list for "all"
        if skill_name == "all":
            return _ok(all_skill_results)
        else:
            single = all_skill_results[0] if all_skill_results else {
                "skill_name": skill_name,
                "anchors_tested": 0,
                "passed": 0,
                "failed": 0,
                "results": [],
            }
            return _ok(single)

    except Exception:
        logger.exception("Error in POST /api/skills/test-thresholds")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# GET /api/anchors
# ---------------------------------------------------------------------------

@calibration_bp.route("/anchors", methods=["GET"])
@require_admin
def get_anchors():
    """
    Return all anchor players grouped by skill name.

    Each anchor includes: id, player_id, player_name, team, skill_name,
    expected_tier, notes, created_at.
    """
    try:
        supabase = get_supabase()

        rows = (
            supabase.table("anchor_players")
            .select("id, player_id, skill_name, expected_tier, notes, created_at, players(name, team)")
            .order("skill_name")
            .execute()
        )

        # Group anchors by skill name and flatten the nested player join
        grouped: dict[str, list] = {}
        for row in rows.data or []:
            sn = row["skill_name"]
            player_info = row.pop("players", {}) or {}
            row["player_name"] = player_info.get("name", "Unknown")
            row["team"] = player_info.get("team")
            grouped.setdefault(sn, []).append(row)

        return _ok(grouped)

    except Exception:
        logger.exception("Error in GET /api/anchors")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# POST /api/anchors
# ---------------------------------------------------------------------------

@calibration_bp.route("/anchors", methods=["POST"])
@require_admin
@require_open_draft
def create_anchor():
    """
    Create or update an anchor player entry for a given skill.

    If an anchor already exists for this player+skill combination, the existing
    record is updated with the new expected_tier and notes (upsert on the unique
    constraint added by the 20260401 migration).

    Request body:
      {
        "player_id": "uuid",
        "skill_name": "spot_up_shooter",
        "expected_tier": "Elite",
        "notes": "optional notes string"
      }
    """
    body = request.get_json(silent=True) or {}

    player_id = body.get("player_id", "")
    skill_name = body.get("skill_name", "").strip()
    expected_tier = body.get("expected_tier", "")
    notes = body.get("notes", "")

    if not _validate_uuid(player_id):
        return _err("Invalid player_id — must be a UUID")

    if not skill_name:
        return _err("'skill_name' is required")

    if expected_tier not in _VALID_TIERS:
        return _err(f"'expected_tier' must be one of: {', '.join(sorted(_VALID_TIERS))}")

    try:
        supabase = get_supabase()

        # Upsert on the unique (player_id, skill_name) constraint
        # This handles both "create new anchor" and "update existing anchor" in one call
        result = supabase.table("anchor_players").upsert(
            {
                "player_id": player_id,
                "skill_name": skill_name,
                "expected_tier": expected_tier,
                "notes": notes or None,
            },
            on_conflict="player_id,skill_name",
        ).execute()

        new_row = result.data[0] if result.data else {}
        logger.info(
            "Upserted anchor: player=%s skill=%s tier=%s",
            player_id, skill_name, expected_tier,
        )
        return _ok(new_row)

    except Exception:
        logger.exception("Error in POST /api/anchors")
        return _err("Internal server error", status=500)


# ---------------------------------------------------------------------------
# DELETE /api/anchors/<anchor_id>
# ---------------------------------------------------------------------------

@calibration_bp.route("/anchors/<anchor_id>", methods=["DELETE"])
@require_admin
@require_open_draft
def delete_anchor(anchor_id: str):
    """Remove an anchor player entry by its UUID."""
    if not _validate_uuid(anchor_id):
        return _err("Invalid anchor_id — must be a UUID")

    try:
        supabase = get_supabase()
        supabase.table("anchor_players").delete().eq("id", anchor_id).execute()
        logger.info("Deleted anchor %s", anchor_id)
        return _ok({"deleted": anchor_id})

    except Exception:
        logger.exception("Error in DELETE /api/anchors/%s", anchor_id)
        return _err("Internal server error", status=500)
