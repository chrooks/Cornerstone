"""
Balance scoring helpers for lineup cohesion.

Ratios answer a different question than raw totals: not "how much do you have",
but "do the paired traits make sense together?" The harmonic mean rewards teams
that have both sides and punishes one-sided constructions.
"""

from __future__ import annotations

from .weights import (
    RATIO_ASYMMETRIC_FULL_PENALTY,
    RATIO_DEAD_ZONE,
    RATIO_DEFAULT_PENALTY,
    RATIO_MIN_DENOMINATOR,
    REBOUNDING_SPACING_DEFICIT_THRESHOLD,
)


def ratio_score(
    a: float,
    b: float,
    dead_zone: float = RATIO_DEAD_ZONE,
    asymmetric: bool = False,
) -> float:
    """Return a 0-10 balance score for two normalized values."""
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
        penalty = RATIO_ASYMMETRIC_FULL_PENALTY * excess / max(b, RATIO_MIN_DENOMINATOR)
    else:
        penalty = RATIO_DEFAULT_PENALTY * excess / max(a, RATIO_MIN_DENOMINATOR)

    return round(max(0.0, min(10.0, base_score - penalty * 10)), 1)


def spacing_creation_ratio(spacing: float, shot_creation: float) -> float:
    """Score whether spacing and creation are in usable balance."""
    return ratio_score(spacing, shot_creation)


def spacing_paint_touch_ratio(spacing: float, paint_touch: float) -> float:
    """Score inside-out balance, penalizing paint touch without spacing harder."""
    return ratio_score(spacing, paint_touch, asymmetric=True)


def rebound_transition_ratio(rebounding: float, transition: float) -> float:
    """Score whether rebounding can feed the transition game."""
    return ratio_score(rebounding, transition)


def creation_offball_ratio(shot_creation: float, off_ball_impact: float) -> float:
    """Score whether on-ball creation is balanced with off-ball gravity."""
    return ratio_score(shot_creation, off_ball_impact)


def rebounding_spacing_deficit_ratio(rebounding: float, spacing: float) -> float:
    """Reward offensive rebounding as a partial offset only when spacing is low."""
    if spacing >= REBOUNDING_SPACING_DEFICIT_THRESHOLD:
        return 0.0
    spacing_deficit = max(0.0, REBOUNDING_SPACING_DEFICIT_THRESHOLD - spacing)
    return ratio_score(rebounding, spacing_deficit)
