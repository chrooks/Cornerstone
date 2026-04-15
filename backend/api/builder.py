"""
api/builder.py — Roster evaluation endpoint.

Endpoint:
  POST /api/builder/evaluate
    Body:  { players: list, mode: "live"|"final", debug: bool }
    Returns: RosterEvaluation as JSON
    Auth: none required (debug output is computation-only, no sensitive data)

The debug flag controls trace verbosity. The UI is responsible for
restricting the debug flag to admin users — the backend trusts the caller.
"""

from __future__ import annotations

import dataclasses
import logging
from typing import Any

from flask import Blueprint, jsonify, request

from services.roster_evaluator.evaluator import evaluate_roster
from services.roster_evaluator.types import RosterEvaluation, ScoreTrace

logger = logging.getLogger(__name__)

builder_bp = Blueprint("builder", __name__, url_prefix="/api/builder")

_VALID_MODES = {"live", "final"}

# Input size limits — prevents CPU amplification on this unauthenticated endpoint
_MAX_PLAYERS = 20
_MAX_NAME_LENGTH = 100
_MAX_SKILLS = 30


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

def _serialize_trace(trace: ScoreTrace) -> dict:
    """Convert a ScoreTrace dataclass to a plain dict for JSON output."""
    return {
        "score":       trace.score,
        "components":  trace.components,
        "multipliers": trace.multipliers,
        "label":       trace.label,
    }


def _serialize_player_traces(player_traces: dict | None) -> dict | None:
    """
    Convert per-player trace dict to JSON-serializable form.

    Each player's traces dict contains ScoreTrace instances and booleans.
    ScoreTrace → dict; booleans pass through unchanged.
    """
    if player_traces is None:
        return None
    result: dict = {}
    for name, traces in player_traces.items():
        result[name] = {
            key: (_serialize_trace(val) if isinstance(val, ScoreTrace) else val)
            for key, val in traces.items()
        }
    return result


def _serialize_aggregate_traces(agg_traces: dict | None) -> dict | None:
    """
    Convert aggregate trace dict to JSON-serializable form.

    Values are ScoreTrace or bool.
    """
    if agg_traces is None:
        return None
    return {
        key: (_serialize_trace(val) if isinstance(val, ScoreTrace) else val)
        for key, val in agg_traces.items()
    }


def _serialize_evaluation(evaluation: RosterEvaluation) -> dict:
    """Serialize a RosterEvaluation to a plain dict."""
    return {
        "notes": [dataclasses.asdict(note) for note in evaluation.notes],
        "player_traces":    _serialize_player_traces(evaluation.player_traces),
        "aggregate_traces": _serialize_aggregate_traces(evaluation.aggregate_traces),
    }


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def _validate_player(player: Any) -> str | None:
    """Return an error message string if the player dict is invalid, else None."""
    if not isinstance(player, dict):
        return "each player must be an object"
    name = player.get("name")
    if not isinstance(name, str) or not name:
        return "each player must have a non-empty 'name' string"
    if len(name) > _MAX_NAME_LENGTH:
        return f"player 'name' must be {_MAX_NAME_LENGTH} characters or fewer"
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
    Evaluate a roster and return GM notes.

    Request body:
      {
        "players": [{ "name": str, "height": str|null, "skills": {...} }, ...],
        "mode":    "live" | "final",   # default: "live"
        "debug":   bool                # default: false
      }

    Response:
      {
        "success": true,
        "data": {
          "notes": [{ "severity", "category", "text", "trace_key" }, ...],
          "player_traces":    null | { player_name: { trace_key: {...} } },
          "aggregate_traces": null | { agg_name: {...} }
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

    # --- validate mode ---
    mode = body.get("mode", "live")
    if mode not in _VALID_MODES:
        return _err(f"'mode' must be one of: {', '.join(sorted(_VALID_MODES))}")

    # --- validate debug ---
    debug = body.get("debug", False)
    if not isinstance(debug, bool):
        return _err("'debug' must be a boolean")

    try:
        result = evaluate_roster(body["players"], mode=mode, debug=debug)
        return _ok(_serialize_evaluation(result))
    except Exception:
        logger.exception("Error in POST /api/builder/evaluate")
        return _err("Internal server error", status=500)
