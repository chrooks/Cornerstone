"""
roster_evaluator/evaluator.py — Phase 4 orchestration.

evaluate_roster() is the single public entry point for the rule engine.
It normalizes input, runs all phases in order, and returns a RosterEvaluation.

Public API:
  normalize_player(player)           → dict  (sanitized unified player dict)
  compute_player_traces(player)      → dict  (all Phase 1 traces for one player)
  evaluate_roster(players, mode, debug) → RosterEvaluation
"""

from __future__ import annotations

from typing import Literal

from .aggregates import compute_aggregates
from .player_scores import (
    effective_on_ball_threat,
    is_exclusively_onball,
    is_offensive_blackhole,
    is_twoway,
    off_ball_gravity,
    on_ball_scoring_threat,
    size_modifier,
)
from .rules import ALL_RULES, STRENGTH_RULES
from .types import RosterEvaluation
from .weights import SEVERITY_ORDER, LIVE_NOTE_LIMIT


# ---------------------------------------------------------------------------
# normalize_player
# ---------------------------------------------------------------------------

def normalize_player(player: dict) -> dict:
    """
    Sanitize a raw player dict into the unified shape expected by Phase 1+.

    Guarantees:
      - "name" is present (string)
      - "height" is present (string or None)
      - "skills" is a dict with no None values (None → "None")

    Returns a new dict; does not mutate the original.
    """
    raw_skills: dict = player.get("skills") or {}
    clean_skills = {
        k: (v if v is not None else "None")
        for k, v in raw_skills.items()
    }
    return {
        "name":   player.get("name", ""),
        "height": player.get("height"),
        "skills": clean_skills,
    }


# ---------------------------------------------------------------------------
# compute_player_traces
# ---------------------------------------------------------------------------

def compute_player_traces(player: dict) -> dict:
    """
    Run all Phase 1 scoring functions for a single player.

    Returns a dict keyed by function name. ScoreTrace values expose
    .score, .components, .multipliers, and .label for the debug UI.
    Boolean classifiers are stored as plain bool under their function name.
    """
    return {
        "size_modifier":           size_modifier(player),
        "on_ball_scoring_threat":  on_ball_scoring_threat(player),
        "off_ball_gravity":        off_ball_gravity(player),
        "effective_on_ball_threat": effective_on_ball_threat(player),
        "is_exclusively_onball":   is_exclusively_onball(player),
        "is_twoway":               is_twoway(player),
        "is_offensive_blackhole":  is_offensive_blackhole(player),
    }


# ---------------------------------------------------------------------------
# evaluate_roster
# ---------------------------------------------------------------------------

def evaluate_roster(
    players: list[dict],
    mode: Literal["live", "final"] = "live",
    debug: bool = False,
) -> RosterEvaluation:
    """
    Orchestrate all evaluation phases and return a RosterEvaluation.

    Phase 1 → per-player traces
    Phase 2 → cross-roster aggregates
    Phase 3 → rule engine → notes
    Phase 4 (this) → sort, cap, and assemble output

    live mode:  critical/warning/tip notes, capped at 7
    final mode: same + strength notes, no cap

    debug=True populates player_traces and aggregate_traces in the result.
    """
    # Normalize all inputs before any computation
    normalized = [normalize_player(p) for p in players]

    # Phase 1 — per-player
    player_traces = {p["name"]: compute_player_traces(p) for p in normalized}

    # Phase 2 — cross-roster
    agg = compute_aggregates(normalized)

    # Phase 3 — rule evaluation
    notes = [note for rule in ALL_RULES if (note := rule(normalized, agg))]
    if mode == "final":
        notes += [note for rule in STRENGTH_RULES if (note := rule(normalized, agg))]

    # Sort by severity priority; stable sort preserves rule-list order within tier
    notes.sort(key=lambda n: SEVERITY_ORDER[n.severity])

    # Live mode cap
    if mode == "live":
        notes = notes[:LIVE_NOTE_LIMIT]

    return RosterEvaluation(
        notes=notes,
        player_traces=player_traces if debug else None,
        aggregate_traces=agg if debug else None,
    )
