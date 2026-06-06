"""
api/cohesion_calibration.py — Admin endpoints for cohesion engine calibration.

Blueprint prefix: /api/evaluator (previously /api/cohesion; renamed for UI parity)
All endpoints require @require_admin.

Endpoints:
  GET  /player/<player_id>/composites — Single player's base composites
  GET  /bell-curve/<player_id>        — Bell curve params + pre-computed curve array
  POST /lineup/evaluate               — Run cohesion evaluation on a 5-player lineup
  POST /rotation/evaluate             — Run rotation evaluation with ranked lineup diagnostics
  GET  /weights                       — All engine weight constants
  PUT  /weights                       — Apply partial weight overrides (in-memory)
  GET  /formulas                      — Composite formulas from draft or active version
  POST /distribution-preview          — Histogram of raw composite distribution
"""

from __future__ import annotations

import dataclasses
import logging
from itertools import combinations
from typing import Any

from flask import Blueprint, jsonify, request

from api.auth import require_admin
from services.cohesion_engine.bell_curve import (
    apply_rp_pd_boost,
    compute_bell_params,
    defensive_value_at_height,
    parse_height_inches,
)
from services.cohesion_engine.cohesion import evaluate_lineup
from services.cohesion_engine.composites import compute_player_composites, compute_raw_composites
from services.cohesion_engine.composites import ensure_distributions
from services.cohesion_engine import evaluate_roster
from services.cohesion_engine.engine import CohesionEngine
from services.cohesion_engine.roster import SUBSCORE_ARCHETYPES
from services.cohesion_engine.types import LineupCohesion, PlayerComposites
from services.cohesion_engine.weights import LINEUP_ONLY_ROLLUP_WEIGHTS, ROSTER_ROLLUP_WEIGHTS, STAR_RATING_MAX
from services.evaluation_versions.repo import get_active as get_active_eval_version
from services.rotation_config import MAX_ROTATION_SLOTS
from services.cohesion_engine import weights as weights_module
from services.players_service import CURRENT_SEASON
from services.supabase_client import get_supabase


def _active_values() -> dict[str, Any]:
    """Get the active Evaluation Version's values dict for runtime use."""
    return get_active_eval_version().values


def _active_engine() -> CohesionEngine:
    """Construct a CohesionEngine from the active Evaluation Version."""
    return CohesionEngine(get_active_eval_version())

logger = logging.getLogger(__name__)

cohesion_calibration_bp = Blueprint(
    "cohesion_calibration",
    __name__,
    url_prefix="/api/evaluator",
)

# ---------------------------------------------------------------------------
# Weight overrides retired — runtime values now come from the active
# Evaluation Version row in the database.  See
# services/evaluation_versions/repo.py and the v1 ExecPlan.
# ---------------------------------------------------------------------------

# Height range for bell curve pre-computation (6'0" to 7'4")
_BELL_MIN_IN = 72
_BELL_MAX_IN = 88


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_player_with_skills(player_id: str) -> dict | None:
    """
    Fetch a player's metadata and composite skill profile from Supabase.

    Returns a dict with keys: id, name, height, skills (skill_name → tier string).
    Returns None if the player or their skill profile is not found.
    """
    supabase = get_supabase()

    # Fetch player metadata
    player_res = (
        supabase.table("players")
        .select("id, name, height")
        .eq("id", player_id)
        .limit(1)
        .execute()
    )
    if not player_res.data:
        # Try legends table as fallback
        legend_res = (
            supabase.table("legends")
            .select("id, name, height")
            .eq("id", player_id)
            .limit(1)
            .execute()
        )
        if not legend_res.data:
            return None
        player = legend_res.data[0]
        # Fetch legend skill profile (manual source)
        profile_res = (
            supabase.table("draft_skill_profiles")
            .select("profile")
            .eq("legend_id", player_id)
            .eq("is_legend", True)
            .eq("source", "manual")
            .limit(1)
            .execute()
        )
    else:
        player = player_res.data[0]
        # Fetch composite skill profile for current players
        profile_res = (
            supabase.table("draft_skill_profiles")
            .select("profile")
            .eq("player_id", player_id)
            .eq("source", "composite")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )

    if not profile_res.data:
        return None

    raw_profile = profile_res.data[0].get("profile") or {}
    # Composite profiles store { skill_name: { final_tier: "Elite", ... } }.
    # Legend profiles store { skill_name: "Elite" } (flat strings).
    # Extract the tier string from whichever shape we get.
    skills: dict[str, str] = {}
    for k, v in raw_profile.items():
        if isinstance(v, dict):
            tier = v.get("final_tier")
            if tier is not None:
                skills[k] = str(tier)
        elif isinstance(v, str):
            skills[k] = v

    return {
        "id": player["id"],
        "name": player["name"],
        "height": player.get("height"),
        "skills": skills,
    }


def _serialize_composites(pc: PlayerComposites) -> dict[str, float]:
    """Extract normalized composite scores from a PlayerComposites dataclass."""
    return {
        name: getattr(pc, name)
        for name in weights_module.COMPOSITE_NAMES
    }


def _serialize_raw_composites(skills: dict[str, str], values: dict[str, Any]) -> dict[str, float]:
    """Return raw composite formula outputs before percentile normalization."""
    return {key: round(value, 3) for key, value in compute_raw_composites(skills, values).items()}


def _get_all_weights() -> dict[str, Any]:
    """
    Build a view of all weight constants from weights.py.

    Runtime values now come from the active Evaluation Version row in the
    database, but this helper continues to serve the GET /weights endpoint
    for the calibration UI until the Editor fully binds to the Version blob.
    """
    result: dict[str, Any] = {}
    for name in dir(weights_module):
        if name.startswith("_") or not name.isupper():
            continue
        value = getattr(weights_module, name)
        if isinstance(value, (dict, tuple, list, float, int)):
            result[name] = value
    return result


def _inches_to_display(inches: int) -> str:
    """Convert height in inches to display format (e.g. 74 → 6'2\")."""
    ft = inches // 12
    inch = inches % 12
    return f"{ft}'{inch}\""


def _rp_pd_boost_details(
    original_lineup: list[dict[str, Any]],
    boosted_lineup: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Describe RP-to-PD teammate boosts applied before defensive curves are scored."""
    provider_index: int | None = None
    provider_value = 0.0
    for index, player in enumerate(original_lineup):
        tier = player.get("skills", {}).get("rim_protector", "None")
        value = weights_module.AMPLITUDE_MAP.get(tier, 0.0)
        if value > provider_value:
            provider_index = index
            provider_value = value

    if provider_index is None:
        return []

    provider = original_lineup[provider_index]
    provider_tier = provider.get("skills", {}).get("rim_protector", "None")
    boost = weights_module.RP_PD_BOOST.get(provider_tier, 0.0)
    if boost <= 0:
        return []

    details: list[dict[str, Any]] = []
    provider_name = provider.get("name") or f"Player {provider_index + 1}"
    for index, player in enumerate(original_lineup):
        if index == provider_index:
            continue

        original_tier = player.get("skills", {}).get("perimeter_disruptor", "None")
        effective_tier = boosted_lineup[index].get("skills", {}).get("perimeter_disruptor", "None")
        original_value = weights_module.AMPLITUDE_MAP.get(original_tier, 0.0)
        effective_value = weights_module.AMPLITUDE_MAP.get(effective_tier, 0.0)
        if effective_value <= original_value:
            continue

        details.append({
            "player_index": index,
            "player_name": player.get("name") or f"Player {index + 1}",
            "provider_index": provider_index,
            "provider_name": provider_name,
            "provider_rim_protector_tier": provider_tier,
            "boost": boost,
            "original_pd_tier": original_tier,
            "effective_pd_tier": effective_tier,
            "original_pd_value": original_value,
            "effective_pd_value": effective_value,
        })

    return details


def _player_key(player: dict[str, Any], index: int) -> str:
    """Return a stable identity used for duplicate checks and lineup matching."""
    return str(player.get("id") or player.get("player_id") or player.get("name") or f"player-{index}")


def _compact_rotation_players(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop empty placeholders and compact selected players by submitted slot order."""
    selected = [player for player in players if isinstance(player, dict) and player]
    return [
        {
            **player,
            "slot": index + 1,
            "is_cornerstone": False,
        }
        for index, (_original_index, player) in enumerate(
            sorted(
                enumerate(selected),
                key=lambda item: (item[1].get("slot", 999), item[0]),
            )
        )
    ]


def _validate_rotation_players(players: Any) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Validate calibration rotation input and return compacted players."""
    if not isinstance(players, list):
        return None, "'players' must be an array"
    if len(players) > MAX_ROTATION_SLOTS:
        return None, f"'players' must contain at most {MAX_ROTATION_SLOTS} entries"
    for index, player in enumerate(players):
        if player and not isinstance(player, dict):
            return None, f"Player {index} must be an object"

    compacted = _compact_rotation_players(players)
    if len(compacted) < _MAX_LINEUP_SIZE:
        return None, f"At least {_MAX_LINEUP_SIZE} players required"
    if len(compacted) > MAX_ROTATION_SLOTS:
        return None, f"At most {MAX_ROTATION_SLOTS} selected players allowed"

    seen: set[str] = set()
    for index, player in enumerate(compacted):
        if not isinstance(player, dict):
            return None, f"Player {index} must be an object"
        name = player.get("name")
        if not isinstance(name, str) or not name:
            return None, f"Player {index} must have a non-empty 'name'"
        if len(name) > _MAX_NAME_LENGTH:
            return None, f"Player {index} name too long"
        skills = player.get("skills")
        if skills is not None and not isinstance(skills, dict):
            return None, f"Player {index} 'skills' must be an object"
        if isinstance(skills, dict) and len(skills) > _MAX_SKILLS:
            return None, f"Player {index} has too many skills"

        key = _player_key(player, index)
        if key in seen:
            return None, "Duplicate players are not allowed"
        seen.add(key)

    return compacted, None


def _resolve_player_skills(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Hydrate real skill profiles when callers provide only lightweight metadata."""
    resolved_players: list[dict[str, Any]] = []
    for player in players:
        player_id = player.get("id") or player.get("player_id")
        skills = player.get("skills") or {}
        if player_id and not skills:
            fetched = _fetch_player_with_skills(str(player_id))
            if fetched:
                resolved_players.append({
                    **player,
                    "height": player.get("height") or fetched.get("height"),
                    "skills": fetched["skills"],
                })
                continue
        resolved_players.append(player)
    return resolved_players


def _boosted_bell_curves_payload(lineup_players: list[dict[str, Any]], values: dict[str, Any]) -> tuple[list[dict[str, Any] | None], list[dict[str, Any]]]:
    """Compute the boosted bell curves used by a specific lineup evaluation."""
    boosted_lineup = apply_rp_pd_boost(lineup_players, values)
    boosted_bell_curves: list[dict[str, Any] | None] = []
    for player in boosted_lineup:
        height_inches = parse_height_inches(player.get("height"))
        if height_inches is None:
            boosted_bell_curves.append(None)
            continue
        params = compute_bell_params(player.get("skills", {}), height_inches, values)
        boosted_bell_curves.append({
            "amplitude": params["amplitude"],
            "peak": params["peak_center"],
            "range_down": params["range_down"],
            "range_up": params["range_up"],
            "flat_down": params["flat_top_down"],
            "flat_up": params["flat_top_up"],
        })
    return boosted_bell_curves, _rp_pd_boost_details(lineup_players, boosted_lineup)


def _serialize_lineup_result(lineup: LineupCohesion, lineup_players: list[dict[str, Any]], values: dict[str, Any]) -> dict[str, Any]:
    """Serialize one five-player lineup result for calibration diagnostics."""
    boosted_bell_curves, rp_pd_boosts = _boosted_bell_curves_payload(lineup_players, values)
    archetype_details = _lineup_archetype_details(lineup)
    return {
        "cohesion_score": lineup.score,
        "subscores": lineup.subscores,
        "category_scores": lineup.category_scores,
        "synergies_applied": list(lineup.synergies_applied),
        "accentuation": {
            "strength_amplification": lineup.accentuation_strength,
            "weakness_coverage": lineup.accentuation_weakness,
        },
        "accentuation_details": lineup.accentuation_details,
        "boosted_bell_curves": boosted_bell_curves,
        "rp_pd_boosts": rp_pd_boosts,
        "archetype_labels": [detail["archetype"] for detail in archetype_details],
        "archetype_details": archetype_details,
    }


def _lineup_archetype_details(lineup: LineupCohesion) -> list[dict[str, Any]]:
    """
    Explain the 2-3 lineup archetypes selected from strongest mapped subscores.

    This mirrors services.cohesion_engine.roster._archetypes_for_lineup while
    preserving the triggering subscore/value for calibration diagnostics.
    """
    details: list[dict[str, Any]] = []
    seen: set[str] = set()
    for subscore, value in sorted(lineup.subscores.items(), key=lambda item: item[1], reverse=True):
        archetype = SUBSCORE_ARCHETYPES.get(subscore)
        if not archetype or archetype in seen:
            continue
        details.append({
            "archetype": archetype,
            "subscore_key": subscore,
            "subscore_value": value,
        })
        seen.add(archetype)
        if len(details) >= 3:
            break

    return details or ([{
        "archetype": "balanced",
        "subscore_key": None,
        "subscore_value": 0.0,
    }] if lineup.subscores else [])


def _serialize_player_composites(player: PlayerComposites) -> dict[str, Any]:
    """Serialize backend-scored player composites in the builder-compatible shape."""
    return {
        "player_id": player.player_id,
        "name": player.name,
        "base": {
            name: getattr(player, name)
            for name in weights_module.COMPOSITE_NAMES
        },
        "bell_curve": {
            "amplitude": player.bell_amplitude,
            "peak": player.bell_peak,
            "range_down": player.bell_range_down,
            "range_up": player.bell_range_up,
            "flat_down": player.bell_flat_down,
            "flat_up": player.bell_flat_up,
        },
    }


def _ranked_lineup_combinations(players: list[dict[str, Any]], engine: CohesionEngine, values: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate, sort, and serialize every five-player combination."""
    starting_keys = tuple(_player_key(player, index) for index, player in enumerate(players[:_MAX_LINEUP_SIZE]))
    evaluated: list[dict[str, Any]] = []
    for combo_index, lineup_players_tuple in enumerate(combinations(players, _MAX_LINEUP_SIZE)):
        lineup_players = list(lineup_players_tuple)
        lineup = evaluate_lineup(lineup_players, engine)
        lineup_keys = tuple(_player_key(player, index) for index, player in enumerate(lineup_players))
        evaluated.append({
            **_serialize_lineup_result(lineup, lineup_players, values),
            "combination_index": combo_index,
            "is_viable": lineup.score >= weights_module.VIABLE_LINEUP_THRESHOLD,
            "player_ids": [_player_key(player, index) for index, player in enumerate(lineup_players)],
            "player_names": [str(player.get("name") or _player_key(player, index)) for index, player in enumerate(lineup_players)],
            "is_starting_lineup": lineup_keys == starting_keys,
        })

    evaluated.sort(key=lambda item: (-item["cohesion_score"], item["combination_index"]))
    for rank, item in enumerate(evaluated, start=1):
        item["rank"] = rank
    return evaluated


def _theoretical_best_starting_rating(
    actual_breakdown: dict[str, float],
    lineup_combinations: list[dict[str, Any]],
) -> tuple[float, dict[str, float]]:
    """Return the rotation rating if the best lineup occupied the starting-five factor."""
    best_score = lineup_combinations[0]["cohesion_score"] if lineup_combinations else 0.0
    breakdown = {
        **actual_breakdown,
        "starting_5": round(min(1.0, best_score / STAR_RATING_MAX), 3),
    }
    weights = LINEUP_ONLY_ROLLUP_WEIGHTS if len(lineup_combinations) == 1 else ROSTER_ROLLUP_WEIGHTS
    weighted = sum(weights[key] * breakdown.get(key, 0.0) for key in weights)
    return round(STAR_RATING_MAX * weighted, 2), breakdown


# ---------------------------------------------------------------------------
# GET /player/<player_id>/composites
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/player/<player_id>/composites")
@require_admin
def get_player_composites(player_id: str) -> tuple:
    """Return a single player's base composites (no lineup synergies)."""
    values = _active_values()
    ensure_distributions(CURRENT_SEASON, values)
    player = _fetch_player_with_skills(player_id)
    if not player:
        return jsonify({"success": False, "data": None, "error": "Player not found"}), 404

    height_inches = parse_height_inches(player.get("height"))
    try:
        pc = compute_player_composites(
            player["skills"],
            player_id=player["id"],
            name=player["name"],
            values=values,
            height_inches=height_inches,
        )
    except Exception:
        logger.exception("Error computing composites for player %s", player_id)
        return jsonify({"success": False, "data": None, "error": "Internal server error"}), 500

    return jsonify({
        "success": True,
        "data": {
            "player_id": player["id"],
            "name": player["name"],
            "height": player.get("height"),
            "skills": player["skills"],
            "composites_raw": _serialize_raw_composites(player["skills"], values),
            "composites_normalized": _serialize_composites(pc),
            "bell_curve": {
                "amplitude": pc.bell_amplitude,
                "peak": pc.bell_peak,
                "range_down": pc.bell_range_down,
                "range_up": pc.bell_range_up,
                "flat_down": pc.bell_flat_down,
                "flat_up": pc.bell_flat_up,
            },
        },
        "error": None,
    }), 200


# ---------------------------------------------------------------------------
# GET /bell-curve/<player_id>
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/bell-curve/<player_id>")
@require_admin
def get_bell_curve(player_id: str) -> tuple:
    """
    Return bell curve parameters plus a pre-computed value-at-height array
    for direct chart rendering (one point per inch from 6'0" to 7'4").
    """
    player = _fetch_player_with_skills(player_id)
    if not player:
        return jsonify({"success": False, "data": None, "error": "Player not found"}), 404

    height_inches = parse_height_inches(player.get("height"))
    # Compute raw bell params from skills + height.
    # player["skills"] has already filtered None tiers in _fetch_player_with_skills.
    values = _active_values()
    skills_str = {k: str(v) for k, v in player["skills"].items() if v is not None}
    try:
        params = compute_bell_params(skills_str, height_inches or 78, values)
    except Exception:
        logger.exception("Error computing bell curve for player %s", player_id)
        return jsonify({"success": False, "data": None, "error": "Internal server error"}), 500

    # Pre-compute the curve array for every inch in the chart range.
    # Cast int-typed params explicitly — compute_bell_params returns float | int.
    curve = []
    for h in range(_BELL_MIN_IN, _BELL_MAX_IN + 1):
        value = defensive_value_at_height(
            target_height=h,
            amplitude=params["amplitude"],
            peak_center=int(params["peak_center"]),
            range_down=int(params["range_down"]),
            range_up=int(params["range_up"]),
            flat_top_down=int(params["flat_top_down"]),
            flat_top_up=int(params["flat_top_up"]),
            player_height=int(params["player_height"]),
            values=values,
        )
        curve.append({
            "height": h,
            "height_display": _inches_to_display(h),
            "value": round(value, 3),
        })

    return jsonify({
        "success": True,
        "data": {
            "player_id": player["id"],
            "name": player["name"],
            "params": params,
            "curve": curve,
        },
        "error": None,
    }), 200


# ---------------------------------------------------------------------------
# POST /lineup/evaluate
# ---------------------------------------------------------------------------

# Validation limits for lineup evaluation
_MAX_LINEUP_SIZE = 5
_MAX_NAME_LENGTH = 100
_MAX_SKILLS = 25


@cohesion_calibration_bp.route("/rotation/evaluate", methods=["POST"])
@require_admin
def evaluate_rotation_endpoint() -> tuple:
    """
    Evaluate a calibration rotation and return rotation-level plus per-lineup diagnostics.

    Request body:
      {
        "players": [
          { "id": "...", "name": "...", "slot": 1, "height": "6-7", "skills": { ... } },
          ...
        ]
      }
    """
    body = request.get_json(silent=True) or {}
    engine = _active_engine()
    values = engine.version.values
    ensure_distributions(CURRENT_SEASON, values)

    compacted_players, error = _validate_rotation_players(body.get("players"))
    if error:
        return jsonify({"success": False, "data": None, "error": error}), 400
    assert compacted_players is not None

    resolved_players = _resolve_player_skills(compacted_players)

    try:
        rotation = evaluate_roster(resolved_players, engine, mode="live")
        lineup_combinations = _ranked_lineup_combinations(resolved_players, engine, values)
    except Exception:
        logger.exception("Error evaluating rotation")
        return jsonify({"success": False, "data": None, "error": "Internal server error"}), 500

    starting_lineup = next(
        (lineup for lineup in lineup_combinations if lineup["is_starting_lineup"]),
        lineup_combinations[0],
    )
    theoretical_rating, theoretical_breakdown = _theoretical_best_starting_rating(
        rotation.star_breakdown,
        lineup_combinations,
    )

    return jsonify({
        "success": True,
        "data": {
            "star_rating": rotation.star_rating,
            "star_rating_breakdown": rotation.star_breakdown,
            "theoretical_best_starting_rating": theoretical_rating,
            "theoretical_best_starting_breakdown": theoretical_breakdown,
            "starting_lineup": starting_lineup,
            "player_composites": [
                _serialize_player_composites(player)
                for player in rotation.player_composites
            ],
            "lineup_summary": rotation.lineup_summary,
            "lineup_combinations": lineup_combinations,
            "notes": [dataclasses.asdict(note) for note in rotation.notes],
            "team_description": None,
        },
        "error": None,
    }), 200


@cohesion_calibration_bp.route("/lineup/evaluate", methods=["POST"])
@require_admin
def evaluate_lineup_endpoint() -> tuple:
    """
    Evaluate a 5-player lineup and return cohesion score + subscores.

    Request body:
      {
        "players": [
          { "name": "...", "height": "6-2", "skills": { ... } },
          ...
        ]
      }
    """
    body = request.get_json(silent=True) or {}
    engine = _active_engine()
    values = engine.version.values
    ensure_distributions(CURRENT_SEASON, values)
    players = body.get("players")

    if not isinstance(players, list):
        return jsonify({"success": False, "data": None, "error": "'players' must be an array"}), 400
    if len(players) != _MAX_LINEUP_SIZE:
        return jsonify({"success": False, "data": None, "error": f"Exactly {_MAX_LINEUP_SIZE} players required"}), 400

    # Validate each player dict
    for i, p in enumerate(players):
        if not isinstance(p, dict):
            return jsonify({"success": False, "data": None, "error": f"Player {i} must be an object"}), 400
        name = p.get("name")
        if not isinstance(name, str) or not name:
            return jsonify({"success": False, "data": None, "error": f"Player {i} must have a non-empty 'name'"}), 400
        if len(name) > _MAX_NAME_LENGTH:
            return jsonify({"success": False, "data": None, "error": f"Player {i} name too long"}), 400
        skills = p.get("skills")
        if skills is not None and not isinstance(skills, dict):
            return jsonify({"success": False, "data": None, "error": f"Player {i} 'skills' must be an object"}), 400
        if isinstance(skills, dict) and len(skills) > _MAX_SKILLS:
            return jsonify({"success": False, "data": None, "error": f"Player {i} has too many skills"}), 400

    # Recover real skill profiles when the client submits a player id with an
    # empty skill map. This keeps calibration scores meaningful even if a UI
    # caller only has lightweight player metadata in hand.
    resolved_players: list[dict[str, Any]] = []
    for p in players:
        player_id = p.get("id") or p.get("player_id")
        skills = p.get("skills") or {}
        if player_id and not skills:
            fetched = _fetch_player_with_skills(str(player_id))
            if fetched:
                resolved_players.append({
                    **p,
                    "height": p.get("height") or fetched.get("height"),
                    "skills": fetched["skills"],
                })
                continue
        resolved_players.append(p)

    # Run cohesion evaluation on the lineup
    try:
        result = evaluate_lineup(resolved_players, engine)
    except Exception:
        logger.exception("Error evaluating lineup")
        return jsonify({"success": False, "data": None, "error": "Internal server error"}), 500

    data = _serialize_lineup_result(result, resolved_players, values)

    return jsonify({
        "success": True,
        "data": data,
        "error": None,
    }), 200


# ---------------------------------------------------------------------------
# GET /weights
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/weights")
@require_admin
def get_weights() -> tuple:
    """Return all engine weight constants merged with any runtime overrides."""
    return jsonify({
        "success": True,
        "data": _get_all_weights(),
        "error": None,
    }), 200


# ---------------------------------------------------------------------------
# PUT /weights
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/weights", methods=["PUT"])
@require_admin
def update_weights() -> tuple:
    """
    Apply partial weight overrides. Stored in-memory (reset on restart).

    Request body: a dict of section_name → { key: value } overrides.
    Example:
      {
        "COHESION_ROLLUP_WEIGHTS": { "defensive_coverage": 0.18 },
        "COMPOSITE_COEFFICIENTS": { "paint_touch_vertical_spacer": 0.5 }
      }
    """
    body = request.get_json(silent=True) or {}

    if not isinstance(body, dict):
        return jsonify({"success": False, "data": None, "error": "Request body must be a JSON object"}), 400

    # Weight overrides retired — callers should use the Evaluation Version
    # draft API (/api/evaluation-versions/drafts) instead.  This endpoint
    # now returns a 410 Gone with guidance.
    logger.warning("PUT /weights called but _WEIGHT_OVERRIDES retired — use Evaluation Version draft API")

    return jsonify({
        "success": False,
        "data": None,
        "error": "Weight overrides are retired. Use the Evaluation Version draft API at /api/evaluation-versions/drafts instead.",
    }), 410


# ---------------------------------------------------------------------------
# GET /formulas
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/formulas")
@require_admin
def get_formulas() -> tuple:
    """Return composite formulas from draft (if exists) or active Evaluation Version.

    If neither version has ``composite_formulas`` in its values, generates them
    on the fly from the current coefficients via ``export_formulas``.
    """
    from services.evaluation_versions.repo import get_draft as get_draft_version
    from services.cohesion_engine.formula_export import export_formulas

    try:
        draft = get_draft_version()
        if draft and draft.values.get("composite_formulas"):
            return jsonify({
                "success": True,
                "data": {"formulas": draft.values["composite_formulas"], "source": "draft"},
                "error": None,
            }), 200

        active = get_active_eval_version()
        if active.values.get("composite_formulas"):
            return jsonify({
                "success": True,
                "data": {"formulas": active.values["composite_formulas"], "source": "active"},
                "error": None,
            }), 200

        # Neither version has formulas — generate from coefficients.
        coefficients = active.values.get("composite_coefficients", {})
        formulas = export_formulas(coefficients)
        return jsonify({
            "success": True,
            "data": {"formulas": formulas, "source": "active"},
            "error": None,
        }), 200
    except Exception:
        logger.exception("Error fetching composite formulas")
        return jsonify({
            "success": False, "data": None,
            "error": "Failed to load composite formulas",
        }), 500


# ---------------------------------------------------------------------------
# POST /distribution-preview
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/distribution-preview", methods=["POST"])
@require_admin
def distribution_preview() -> tuple:
    """Return a histogram of raw composite values across the player pool.

    Accepts an optional formula override to preview how changes would shift
    the distribution. Request body:

        {
          "composite_key": "spacing",
          "formula_override": { ... } | null
        }
    """
    import copy

    from services.cohesion_engine.formula_export import export_formulas
    from services.cohesion_engine.formula_engine import compute_raw_from_formulas, topological_sort
    from services.cohesion_engine.composites import _with_default_skills, _extract_skills
    from services.evaluation_versions.validator import _validate_composite_formulas

    body = request.get_json(silent=True) or {}
    composite_key = body.get("composite_key")
    if not composite_key or not isinstance(composite_key, str):
        return jsonify({
            "success": False, "data": None,
            "error": "composite_key is required",
        }), 400

    values = _active_values()
    tier_values = values["tier_values"]

    # Resolve formulas — use override for target composite if provided.
    base_formulas = values.get("composite_formulas")
    if not base_formulas:
        base_formulas = export_formulas(values.get("composite_coefficients", {}))

    if composite_key not in base_formulas:
        return jsonify({
            "success": False, "data": None,
            "error": f"Unknown composite key: {composite_key}",
        }), 400

    formula_override = body.get("formula_override")
    formulas = copy.deepcopy(base_formulas)
    if formula_override and isinstance(formula_override, dict):
        # Validate override before computing.
        override_violations = _validate_composite_formulas({composite_key: formula_override})
        errors = [v for v in override_violations if v.severity == "error"]
        if errors:
            return jsonify({
                "success": False, "data": None,
                "error": f"Invalid formula override: {errors[0].message}",
            }), 400
        formulas[composite_key] = formula_override

    # Pre-compute sort order once — avoids re-sorting per player.
    formula_order = topological_sort(formulas)

    # Fetch all player skill profiles.
    client = get_supabase()
    raw_values: list[float] = []

    # Issue #72: scope composite profiles to the working draft's season (or the
    # active Release's season when no draft is open), not a hardcoded 2025-26, so
    # this calibration read tracks the same Player set the publish RPC freezes.
    from services.snapshot_versions import repo as _sv_repo
    working_season = _sv_repo.get_working_season()

    for source_query in [
        lambda: client.table("draft_skill_profiles")
            .select("profile")
            .eq("season", working_season)
            .eq("source", "composite")
            .execute(),
        lambda: client.table("draft_skill_profiles")
            .select("profile")
            .eq("source", "manual")
            .eq("is_legend", True)
            .execute(),
    ]:
        from services.supabase_client import run_query
        result = run_query(source_query)
        for row in result.data:
            skills = _with_default_skills(_extract_skills(row["profile"]))
            raw = compute_raw_from_formulas(skills, formulas, tier_values, order=formula_order)
            raw_values.append(raw.get(composite_key, 0.0))

    if not raw_values:
        return jsonify({
            "success": True,
            "data": {"bins": [], "total_players": 0, "mean": 0, "median": 0, "p90": 0},
            "error": None,
        }), 200

    # Bin into 20 equal-width bins.
    sorted_vals = sorted(raw_values)
    n = len(sorted_vals)
    val_min = sorted_vals[0]
    val_max = sorted_vals[-1]
    num_bins = 20

    if val_max <= val_min:
        bins = [{"min": val_min, "max": val_max, "count": n}]
    else:
        bin_width = (val_max - val_min) / num_bins
        bins = []
        for i in range(num_bins):
            b_min = val_min + i * bin_width
            b_max = val_min + (i + 1) * bin_width
            count = sum(1 for v in sorted_vals if b_min <= v < b_max) if i < num_bins - 1 else sum(1 for v in sorted_vals if b_min <= v <= b_max)
            bins.append({"min": round(b_min, 2), "max": round(b_max, 2), "count": count})

    mean = sum(sorted_vals) / n
    median = sorted_vals[n // 2] if n % 2 == 1 else (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
    p90_idx = min(int(n * 0.9), n - 1)

    return jsonify({
        "success": True,
        "data": {
            "bins": bins,
            "total_players": n,
            "mean": round(mean, 2),
            "median": round(median, 2),
            "p90": round(sorted_vals[p90_idx], 2),
        },
        "error": None,
    }), 200
