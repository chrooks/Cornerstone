"""
roster_evaluator/types.py — Core dataclasses for the 4-layer scoring pipeline.

ScoreTrace: full audit trail for a single computed score.
Scores: the 9-dimension output of the pipeline.
Note: a single GM note with severity, category, text, trace link, and presence type.
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
class Scores:
    """
    The 9 numeric dimension scores produced by the pipeline (all 0–100).

    overall      — weighted composite across offense, defense, optionality, robustness
    offense      — composite of spacing + creation + paint + transition
    defense      — aggregate defensive skill coverage
    spacing      — floor-spacing and shooting depth
    creation     — on-ball threat generation
    paint        — interior scoring and lob threat
    transition   — fast-break opportunity generation
    optionality  — skill redundancy and lineup flexibility
    robustness   — depth and consistency across 5-man combinations
    """

    overall: float
    offense: float
    defense: float
    spacing: float
    creation: float
    paint: float
    transition: float
    optionality: float
    robustness: float


@dataclass(frozen=True)
class Note:
    """
    A single GM note surfaced to the user.

    severity      — critical / warning / suggestion / strength
    category      — broad bucket for grouping in the UI
    text          — user-facing prose; names players currently on the roster
    trace_key     — which modifier or hard check produced this note
    presence_type — "presence" fires on what IS on the roster;
                    "absence" fires on what is MISSING (suppressed in live mode
                    below ABSENCE_NOTE_MIN_PLAYERS supporting players)
    """

    severity: Literal["critical", "warning", "suggestion", "strength"]
    category: Literal["offense", "defense", "two_way", "roster_balance"]
    # WARNING: text may contain user-supplied player names. Callers must
    # render this as text content (not raw HTML) to prevent XSS.
    text: str
    trace_key: str
    presence_type: Literal["presence", "absence"] = "presence"


@dataclass(frozen=True)
class RosterEvaluation:
    """
    Output of evaluate_roster().

    scores           — the 9 numeric dimension scores (0–100 each)
    notes            — prioritized list of GM notes
    player_traces    — per-player score breakdowns (only populated when debug=True)
    aggregate_traces — cross-roster aggregate breakdowns (only when debug=True)
    height_coverage  — per-player guard ranges + holes across 6'0"–7'2" (always populated)
    """

    scores: Scores
    notes: list[Note]
    player_traces: dict[str, dict] | None = field(default=None)
    aggregate_traces: dict[str, object] | None = field(default=None)
    height_coverage: dict | None = field(default=None)
