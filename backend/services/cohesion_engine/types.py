"""
Immutable value objects for the cohesion engine.

These dataclasses intentionally hold data only. The engine computes player
composites, lineup cohesion, notes, and final roster ratings in separate
modules, then returns these shapes to the API serializer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class PlayerComposites:
    """
    Normalized player-level composite scores plus defensive bell parameters.

    Composite fields are normalized to 0.0-10.0. Bell fields are geometric
    parameters used by lineup defense and are not themselves composite scores.
    """

    player_id: str
    name: str
    spacing: float
    finishing: float
    paint_touch: float
    anchor: float
    post_game: float
    pnr_screener: float
    off_ball_impact: float
    shot_creation: float
    rebounding: float
    transition: float
    bell_amplitude: float
    bell_peak: int
    bell_range_down: int
    bell_range_up: int
    bell_flat_down: int
    bell_flat_up: int


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
