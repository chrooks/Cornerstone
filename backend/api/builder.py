"""
api/builder.py — Roster evaluation endpoint.

Endpoint:
  POST /api/builder/evaluate
    Body:  { players: list, mode: "live"|"final", debug: bool }
    Returns: RosterEvaluation as JSON
    Auth: none required (debug output is computation-only, no sensitive data)

The debug flag controls trace verbosity. The UI is responsible for
restricting the debug flag to admin users — the backend trusts the caller.

Validation enforces:
  - Each player has a required 'slot' (integer 0–9)
  - Each player has a required 'is_cornerstone' (boolean)
  - Exactly one player must have is_cornerstone=True
"""

from __future__ import annotations

import dataclasses
import logging
from itertools import combinations
from typing import Any

from flask import Blueprint, jsonify, request

from services.cohesion_engine import evaluate_roster
from services.cohesion_engine import weights as cohesion_weights
from services.cohesion_engine.bell_curve import apply_rp_pd_boost, compute_bell_params, parse_height_inches
from services.cohesion_engine.cohesion import evaluate_lineup
from services.cohesion_engine.composites import ensure_distributions
from services.cohesion_engine.roster import SUBSCORE_ARCHETYPES
from services.cohesion_engine.types import RosterEvaluation
from services.players_service import CURRENT_SEASON

logger = logging.getLogger(__name__)

builder_bp = Blueprint("builder", __name__, url_prefix="/api/builder")

_VALID_MODES = {"live", "final"}

# Input size limits — prevents CPU amplification on this unauthenticated endpoint
_MAX_PLAYERS = 20
_MAX_NAME_LENGTH = 100
_MAX_SKILLS = 30
_MAX_LINEUP_SIZE = 5


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------

def _ok(data: Any, status: int = 200) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------

def _cohesion_players_in_slot_order(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Match cohesion roster.py ordering so starting-lineup debug data lines up."""
    return [
        player
        for _index, player in sorted(
            enumerate(players),
            key=lambda item: (item[1].get("slot", 999), item[0]),
        )
    ]


def _player_key(player: dict[str, Any], index: int) -> str:
    """Return a stable identity used for lineup matching."""
    return str(player.get("id") or player.get("player_id") or player.get("name") or f"player-{index}")


def _rp_pd_boost_details(
    original_lineup: list[dict[str, Any]],
    boosted_lineup: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Describe RP-to-PD boosts used by boosted defensive bell curves."""
    provider_index: int | None = None
    provider_value = 0.0
    for index, player in enumerate(original_lineup):
        tier = player.get("skills", {}).get("rim_protector", "None")
        value = cohesion_weights.AMPLITUDE_MAP.get(tier, 0.0)
        if value > provider_value:
            provider_index = index
            provider_value = value

    if provider_index is None:
        return []

    provider = original_lineup[provider_index]
    provider_tier = provider.get("skills", {}).get("rim_protector", "None")
    boost = cohesion_weights.RP_PD_BOOST.get(provider_tier, 0.0)
    if boost <= 0:
        return []

    details: list[dict[str, Any]] = []
    provider_name = provider.get("name") or f"Player {provider_index + 1}"
    for index, player in enumerate(original_lineup):
        if index == provider_index:
            continue
        original_tier = player.get("skills", {}).get("perimeter_disruptor", "None")
        effective_tier = boosted_lineup[index].get("skills", {}).get("perimeter_disruptor", "None")
        original_value = cohesion_weights.AMPLITUDE_MAP.get(original_tier, 0.0)
        effective_value = cohesion_weights.AMPLITUDE_MAP.get(effective_tier, 0.0)
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


def _boosted_bell_curve_payload(starting_players: list[dict[str, Any]]) -> tuple[list[dict[str, Any] | None], list[dict[str, Any]]]:
    """Compute the boosted defensive curves used by the cohesion engine."""
    boosted_lineup = apply_rp_pd_boost(starting_players)
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
    return boosted_bell_curves, _rp_pd_boost_details(starting_players, boosted_lineup)


def _serialize_lineup(lineup, starting_players: list[dict[str, Any]] | None = None) -> dict:
    """Serialize a cohesion LineupCohesion dataclass."""
    boosted_bell_curves: list[dict[str, Any] | None] = []
    rp_pd_boosts: list[dict[str, Any]] = []
    if starting_players:
        boosted_bell_curves, rp_pd_boosts = _boosted_bell_curve_payload(starting_players)

    return {
        "cohesion_score": lineup.score,
        "subscores": lineup.subscores,
        "synergies_applied": lineup.synergies_applied,
        "accentuation": {
            "strength_amplification": lineup.accentuation_strength,
            "weakness_coverage": lineup.accentuation_weakness,
        },
        "accentuation_details": lineup.accentuation_details,
        "boosted_bell_curves": boosted_bell_curves,
        "rp_pd_boosts": rp_pd_boosts,
    }


def _lineup_archetype_details(lineup) -> list[dict[str, Any]]:
    """Explain the 2-3 archetypes selected from strongest mapped subscores."""
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


def _serialize_lineup_combination(lineup, lineup_players: list[dict[str, Any]]) -> dict[str, Any]:
    """Serialize one five-player Lineup Combination for builder Feedback."""
    archetype_details = _lineup_archetype_details(lineup)
    return {
        **_serialize_lineup(lineup, lineup_players),
        "archetype_labels": [detail["archetype"] for detail in archetype_details],
        "archetype_details": archetype_details,
    }


def _ranked_lineup_combinations(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Evaluate, sort, and serialize every current five-player combination."""
    if len(players) < _MAX_LINEUP_SIZE:
        return []

    starting_keys = tuple(
        _player_key(player, index)
        for index, player in enumerate(players[:_MAX_LINEUP_SIZE])
    )
    evaluated: list[dict[str, Any]] = []
    for combo_index, lineup_players_tuple in enumerate(combinations(players, _MAX_LINEUP_SIZE)):
        lineup_players = list(lineup_players_tuple)
        lineup = evaluate_lineup(lineup_players)
        lineup_keys = tuple(_player_key(player, index) for index, player in enumerate(lineup_players))
        evaluated.append({
            **_serialize_lineup_combination(lineup, lineup_players),
            "combination_index": combo_index,
            "is_viable": lineup.score >= cohesion_weights.VIABLE_LINEUP_THRESHOLD,
            "player_ids": [
                _player_key(player, index)
                for index, player in enumerate(lineup_players)
            ],
            "player_names": [
                str(player.get("name") or _player_key(player, index))
                for index, player in enumerate(lineup_players)
            ],
            "is_starting_lineup": lineup_keys == starting_keys,
        })

    evaluated.sort(key=lambda item: (-item["cohesion_score"], item["combination_index"]))
    for rank, item in enumerate(evaluated, start=1):
        item["rank"] = rank
    return evaluated


def _serialize_player_composites(player) -> dict:
    """Serialize cohesion player composites with display scores grouped under base."""
    return {
        "player_id": player.player_id,
        "name": player.name,
        "base": {
            "spacing": player.spacing,
            "finishing": player.finishing,
            "paint_touch": player.paint_touch,
            "anchor": player.anchor,
            "post_game": player.post_game,
            "pnr_screener": player.pnr_screener,
            "off_ball_impact": player.off_ball_impact,
            "shot_creation": player.shot_creation,
            "rebounding": player.rebounding,
            "transition": player.transition,
            "perimeter_defense": player.perimeter_defense,
            "interior_defense": player.interior_defense,
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


def _serialize_evaluation(evaluation: RosterEvaluation, players: list[dict[str, Any]]) -> dict:
    """Serialize a RosterEvaluation to the API response shape."""
    ordered_players = _cohesion_players_in_slot_order(players)
    starting_players = ordered_players[:5]
    return {
        "star_rating": evaluation.star_rating,
        "star_rating_breakdown": evaluation.star_breakdown,
        "starting_lineup": _serialize_lineup(evaluation.starting_lineup, starting_players),
        "player_composites": [
            _serialize_player_composites(player)
            for player in evaluation.player_composites
        ],
        "lineup_summary": evaluation.lineup_summary,
        "lineup_combinations": _ranked_lineup_combinations(ordered_players),
        "notes": [dataclasses.asdict(note) for note in evaluation.notes],
        "team_description": evaluation.team_description,
    }


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def _validate_player(player: Any) -> str | None:
    """
    Return an error message string if the player dict is invalid, else None.

    New required fields vs. original API:
      - slot: integer 0–9
      - is_cornerstone: boolean
    """
    if not isinstance(player, dict):
        return "each player must be an object"

    # name
    name = player.get("name")
    if not isinstance(name, str) or not name:
        return "each player must have a non-empty 'name' string"
    if len(name) > _MAX_NAME_LENGTH:
        return f"player 'name' must be {_MAX_NAME_LENGTH} characters or fewer"

    # slot — required, integer 0–9
    if "slot" not in player:
        return "each player must have a 'slot' field"
    slot = player.get("slot")
    if not isinstance(slot, int) or isinstance(slot, bool):
        return "player 'slot' must be an integer"
    if slot < 0 or slot > 9:
        return "player 'slot' must be between 0 and 9"

    # is_cornerstone — required boolean
    if "is_cornerstone" not in player:
        return "each player must have an 'is_cornerstone' field"
    is_cornerstone = player.get("is_cornerstone")
    if not isinstance(is_cornerstone, bool):
        return "player 'is_cornerstone' must be a boolean"

    # skills
    skills = player.get("skills")
    if skills is not None and not isinstance(skills, dict):
        return "player 'skills' must be an object if provided"
    if isinstance(skills, dict) and len(skills) > _MAX_SKILLS:
        return f"player 'skills' may not contain more than {_MAX_SKILLS} entries"

    return None


# ---------------------------------------------------------------------------
# POST /api/builder/evaluate
# ---------------------------------------------------------------------------

@builder_bp.route("/evaluate", methods=["POST"])
def evaluate():
    """
    Evaluate a roster and return GM notes + dimension scores.

    Request body:
      {
        "players": [{
          "name": str,
          "slot": int (0–9),
          "is_cornerstone": bool,
          "height": str|null,
          "skills": {...}
        }, ...],
        "mode":  "live" | "final",   # default: "live"
        "debug": bool                 # default: false
      }

    Response:
      {
        "success": true,
        "data": {
          "scores": { "overall": 72.4, "offense": ..., ... },
          "notes": [{ "severity", "category", "text", "trace_key", "presence_type" }, ...],
          "player_traces":    null | { player_name: { ... } },
          "aggregate_traces": null | { ... }
        },
        "error": null
      }
    """
    body = request.get_json(silent=True) or {}

    # --- validate players ---
    if "players" not in body:
        return _err("'players' is required")
    if not isinstance(body["players"], list):
        return _err("'players' must be an array")
    if len(body["players"]) > _MAX_PLAYERS:
        return _err(f"'players' must contain at most {_MAX_PLAYERS} entries")

    for player in body["players"]:
        err = _validate_player(player)
        if err:
            return _err(err)

    # --- validate exactly one cornerstone ---
    cornerstone_count = sum(
        1 for p in body["players"]
        if isinstance(p, dict) and p.get("is_cornerstone") is True
    )
    if cornerstone_count != 1:
        return _err(
            f"exactly one player must have is_cornerstone: true "
            f"(found {cornerstone_count})"
        )

    # --- validate mode ---
    mode = body.get("mode", "live")
    if mode not in _VALID_MODES:
        return _err(f"'mode' must be one of: {', '.join(sorted(_VALID_MODES))}")

    # --- validate debug ---
    debug = body.get("debug", False)
    if not isinstance(debug, bool):
        return _err("'debug' must be a boolean")

    try:
        ensure_distributions(CURRENT_SEASON)
        result = evaluate_roster(body["players"], mode=mode)
        return _ok(_serialize_evaluation(result, body["players"]))
    except Exception:
        logger.exception("Error in POST /api/builder/evaluate")
        return _err("Internal server error", status=500)
