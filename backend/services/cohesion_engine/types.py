"""
Immutable value objects for the cohesion engine.

These dataclasses intentionally hold data only. The engine computes player
composites, lineup cohesion, notes, and final roster ratings in separate
modules, then returns these shapes to the API serializer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


@dataclass(frozen=True)
class PlayerComposites:
    """
    Normalized player-level composite scores plus defensive bell parameters.

    Composite fields are normalized to 0.0-10.0. Bell fields are geometric
    parameters used by lineup defense and are not themselves composite scores.

    ``raw`` carries the pre-normalization values. Since #114 a normalized 0.0 no
    longer means "absent" — a zero is ranked against the league, so a player who
    never screens still scores ~3.3 on pnr_screener because two thirds of the
    league never screens either. Gates that need to ask "does anybody here do
    this *at all*?" must read ``raw``, where absent really is 0.0.
    """

    player_id: str
    name: str
    spacing: float
    finishing: float
    paint_touch: float
    post_game: float
    pnr_screener: float
    off_ball_impact: float
    shot_creation: float
    pnr_orchestration: float
    ball_security: float
    defensive_rebounding: float
    offensive_rebounding: float
    transition: float
    perimeter_defense: float
    interior_defense: float
    bell_amplitude: float
    bell_peak: int
    bell_range_down: int
    bell_range_up: int
    bell_flat_down: int
    bell_flat_up: int
    raw: dict[str, float] = field(default_factory=dict)
    # #100: playmaking composite. Optional/defaulted because a pre-#100
    # Evaluation Version (declarative-formula blob without a ``passing`` entry)
    # computes no value — the spoke renders as an honest gap, never a fake 0.
    passing: float | None = None


@dataclass(frozen=True)
class LineupCohesion:
    """
    Cohesion result for one five-player lineup.

    The score is on a 0.0-5.0 star scale. Subscores remain on 0.0-10.0 so
    downstream modules can explain which lineup traits drove the result.
    """

    score: float
    subscores: dict[str, float]
    synergies_applied: list[str]
    accentuation_strength: float
    accentuation_weakness: float
    accentuation_details: dict = field(default_factory=dict)
    category_scores: dict[str, float] = field(default_factory=dict)
    # Attribution Ledgers (#93): populated only when evaluate_lineup runs with
    # with_attribution=True (the Starting Lineup); None for score-only combos.
    subscore_breakdowns: dict[str, dict] | None = None


@dataclass(frozen=True)
class Note:
    """
    Structured feedback surfaced to the roster builder.

    The text may include user-provided player names, so API/UI callers should
    render it as plain text rather than HTML.
    """

    type: Literal["strength", "weakness", "suggestion"]
    category: str
    severity: float
    raw_value: float
    text: str


@dataclass(frozen=True)
class RosterEvaluation:
    """
    Final cohesion-engine response before API serialization.

    Later phases populate this from player composites, all eligible lineups,
    generated notes, and the optional team narrative.
    """

    star_rating: float
    star_breakdown: dict[str, float]
    starting_lineup: LineupCohesion
    player_composites: list[PlayerComposites]
    lineup_summary: dict
    notes: list[Note]
    team_description: str | None
