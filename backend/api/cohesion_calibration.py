"""
api/cohesion_calibration.py — Admin endpoints for cohesion engine calibration.

Blueprint prefix: /api/cohesion
All endpoints require @require_admin.

Endpoints:
  GET  /player/<player_id>/composites — Single player's base composites
  GET  /bell-curve/<player_id>        — Bell curve params + pre-computed curve array
  POST /lineup/evaluate               — Run cohesion evaluation on a 5-player lineup
  GET  /weights                       — All engine weight constants
  PUT  /weights                       — Apply partial weight overrides (in-memory)
"""

from __future__ import annotations

import dataclasses
import logging
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
from services.cohesion_engine.types import PlayerComposites
from services.cohesion_engine import weights as weights_module
from services.players_service import CURRENT_SEASON
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

cohesion_calibration_bp = Blueprint(
    "cohesion_calibration",
    __name__,
    url_prefix="/api/cohesion",
)

# ---------------------------------------------------------------------------
# In-memory weight overrides (reset on server restart — safe default)
# ---------------------------------------------------------------------------

_WEIGHT_OVERRIDES: dict[str, dict[str, Any]] = {}

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
            supabase.table("skill_profiles")
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
            supabase.table("skill_profiles")
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
    """Extract the 10 normalized composite scores from a PlayerComposites dataclass."""
    return {
        "spacing": pc.spacing,
        "finishing": pc.finishing,
        "paint_touch": pc.paint_touch,
        "anchor": pc.anchor,
        "post_game": pc.post_game,
        "pnr_screener": pc.pnr_screener,
        "off_ball_impact": pc.off_ball_impact,
        "shot_creation": pc.shot_creation,
        "rebounding": pc.rebounding,
        "transition": pc.transition,
    }


def _serialize_raw_composites(skills: dict[str, str]) -> dict[str, float]:
    """Return raw composite formula outputs before percentile normalization."""
    return {key: round(value, 3) for key, value in compute_raw_composites(skills).items()}


def _get_all_weights() -> dict[str, Any]:
    """
    Build a merged view of all weight constants: defaults from weights.py
    overlaid with any runtime overrides from _WEIGHT_OVERRIDES.
    """
    # Collect all uppercase dict/tuple/float/int constants from the weights module
    result: dict[str, Any] = {}
    for name in dir(weights_module):
        if name.startswith("_") or not name.isupper():
            continue
        value = getattr(weights_module, name)
        if isinstance(value, (dict, tuple, list, float, int)):
            result[name] = value

    # Apply overrides on top
    for section, overrides in _WEIGHT_OVERRIDES.items():
        if section in result and isinstance(result[section], dict):
            # Merge partial overrides into the dict copy
            result[section] = {**result[section], **overrides}
        else:
            result[section] = overrides

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


# ---------------------------------------------------------------------------
# GET /player/<player_id>/composites
# ---------------------------------------------------------------------------

@cohesion_calibration_bp.route("/player/<player_id>/composites")
@require_admin
def get_player_composites(player_id: str) -> tuple:
    """Return a single player's base composites (no lineup synergies)."""
    ensure_distributions(CURRENT_SEASON)
    player = _fetch_player_with_skills(player_id)
    if not player:
        return jsonify({"success": False, "data": None, "error": "Player not found"}), 404

    height_inches = parse_height_inches(player.get("height"))
    try:
        pc = compute_player_composites(
            player["skills"],
            player_id=player["id"],
            name=player["name"],
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
            "composites_raw": _serialize_raw_composites(player["skills"]),
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
    skills_str = {k: str(v) for k, v in player["skills"].items() if v is not None}
    try:
        params = compute_bell_params(skills_str, height_inches or 78)
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
    ensure_distributions(CURRENT_SEASON)
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
        result = evaluate_lineup(resolved_players)
    except Exception:
        logger.exception("Error evaluating lineup")
        return jsonify({"success": False, "data": None, "error": "Internal server error"}), 500

    # Compute RP-PD boosted bell curves so the frontend chart reflects the
    # same defensive picture the engine actually uses for scoring.
    boosted_lineup = apply_rp_pd_boost(resolved_players)
    rp_pd_boosts = _rp_pd_boost_details(resolved_players, boosted_lineup)
    boosted_bell_curves: list[dict[str, Any] | None] = []
    for player in boosted_lineup:
        height_inches = parse_height_inches(player.get("height"))
        if height_inches is None:
            boosted_bell_curves.append(None)
            continue
        params = compute_bell_params(player.get("skills", {}), height_inches)
        boosted_bell_curves.append({
            "amplitude": params["amplitude"],
            "peak": params["peak_center"],
            "range_down": params["range_down"],
            "range_up": params["range_up"],
            "flat_down": params["flat_top_down"],
            "flat_up": params["flat_top_up"],
        })

    return jsonify({
        "success": True,
        "data": {
            "cohesion_score": result.score,
            "subscores": result.subscores,
            "synergies_applied": list(result.synergies_applied),
            "accentuation": {
                "strength_amplification": result.accentuation_strength,
                "weakness_coverage": result.accentuation_weakness,
            },
            "accentuation_details": result.accentuation_details,
            "boosted_bell_curves": boosted_bell_curves,
            "rp_pd_boosts": rp_pd_boosts,
        },
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

    # Merge each section's overrides into the in-memory store (immutable replace)
    for section, overrides in body.items():
        if not isinstance(section, str):
            continue
        if not isinstance(overrides, dict):
            return jsonify({
                "success": False,
                "data": None,
                "error": f"Override for '{section}' must be an object",
            }), 400
        # Validate all override values are numeric
        for key, val in overrides.items():
            if not isinstance(val, (int, float)):
                return jsonify({
                    "success": False,
                    "data": None,
                    "error": f"Override value for '{section}.{key}' must be a number",
                }), 400
        # Immutable merge — create new dict rather than mutating in-place
        _WEIGHT_OVERRIDES[section] = {**_WEIGHT_OVERRIDES.get(section, {}), **overrides}

    logger.info("Weight overrides updated: %s", list(body.keys()))

    return jsonify({
        "success": True,
        "data": _get_all_weights(),
        "error": None,
    }), 200
