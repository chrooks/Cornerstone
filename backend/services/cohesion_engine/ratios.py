"""
Balance scoring helpers for lineup cohesion.

Ratios answer a different question than raw totals: not "how much do you have",
but "do the paired traits make sense together?" The harmonic mean rewards teams
that have both sides and punishes one-sided constructions.
"""

from __future__ import annotations

from typing import Any


def ratio_score(
    a: float,
    b: float,
    values: dict[str, Any],
    dead_zone: float | None = None,
    asymmetric: bool = False,
) -> float:
    """Return a 0-10 balance score for two normalized values."""
    if dead_zone is None:
        dead_zone = values["ratio_dead_zone"]
    ratio_asymmetric_full_penalty: float = values["ratio_asymmetric_full_penalty"]
    ratio_default_penalty: float = values["ratio_default_penalty"]
    ratio_min_denominator: float = values["ratio_min_denominator"]

    if a <= 0 and b <= 0:
        return 0.0
    if a <= 0 or b <= 0:
        return 0.0

    harmonic = 2 * a * b / (a + b)
    base_score = harmonic / max(a, b) * 10

    gap = abs(a - b)
    threshold = dead_zone * max(a, b)
    if gap <= threshold:
        return round(min(10.0, base_score), 1)

    excess = gap - threshold
    if asymmetric and b > a:
        penalty = ratio_asymmetric_full_penalty * excess / max(b, ratio_min_denominator)
    else:
        penalty = ratio_default_penalty * excess / max(a, ratio_min_denominator)

    return round(max(0.0, min(10.0, base_score - penalty * 10)), 1)


def spacing_creation_ratio(spacing: float, shot_creation: float, values: dict[str, Any]) -> float:
    """Score whether spacing and creation are in usable balance."""
    return ratio_score(spacing, shot_creation, values)


def spacing_paint_touch_ratio(spacing: float, paint_touch: float, values: dict[str, Any]) -> float:
    """Score inside-out balance, penalizing rim pressure without spacing harder."""
    return ratio_score(spacing, paint_touch, values, asymmetric=True)


def rebound_transition_ratio(rebounding: float, transition: float, values: dict[str, Any]) -> float:
    """Score whether rebounding can feed the transition game."""
    return ratio_score(rebounding, transition, values)


def creation_offball_ratio(shot_creation: float, off_ball_impact: float, values: dict[str, Any]) -> float:
    """Score whether on-ball creation is balanced with off-ball gravity."""
    return ratio_score(shot_creation, off_ball_impact, values)
