"""
roster_evaluator/types.py — Core dataclasses for the roster rule engine.

ScoreTrace: every calculation returns one of these — score + full breakdown.
Note: a single GM note with severity, category, text, and a trace link.
RosterEvaluation: the final output of evaluate_roster().
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class ScoreTrace:
    """
    Wraps a computed score with a full audit trail.

    frozen=True prevents attribute reassignment after construction.
    Note: dict fields (components, multipliers) are still mutable by Python's
    rules — treat them as read-only by convention.

    components  — maps each input (skill name, factor) to its contribution
    multipliers — maps each amplifier applied to its value
    label       — one-line human summary for the debug UI
    """

    score: float
    components: dict[str, float]
    multipliers: dict[str, float]
    label: str


@dataclass(frozen=True)
class Note:
    """
    A single GM note surfaced to the user.

    severity  — critical / warning / tip / strength
    category  — broad bucket for grouping in the UI
    text      — user-facing prose; names players currently on the roster
    trace_key — which aggregate in RosterEvaluation.aggregate_traces drove this
    """

    severity: Literal["critical", "warning", "tip", "strength"]
    category: Literal["offense", "defense", "two_way", "roster_balance"]
    # WARNING: text may contain user-supplied player names. Callers must
    # render this as text content (not raw HTML) to prevent XSS.
    text: str
    trace_key: str


@dataclass(frozen=True)
class RosterEvaluation:
    """
    Output of evaluate_roster().

    notes            — prioritized list of GM notes
    player_traces    — per-player score breakdowns (only populated when debug=True)
    aggregate_traces — cross-roster aggregate breakdowns (only when debug=True)
    """

    notes: list[Note]
    player_traces: dict[str, dict] | None = field(default=None)
    aggregate_traces: dict[str, ScoreTrace] | None = field(default=None)
