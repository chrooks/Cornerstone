"""
Accentuation scoring for complementary lineup fit.

Strength amplification rewards teammates whose best composites make each other
more valuable. Weakness coverage rewards lineups where one player's hole is
covered by another player's strength in the same composite.
"""

from __future__ import annotations

from .types import PlayerComposites
from .weights import (
    ACCENTUATION_COMPLEMENTARY_PAIRS,
    ACCENTUATION_STRENGTH_THRESHOLD,
    ACCENTUATION_TOP_N,
    ACCENTUATION_WEAKNESS_THRESHOLD,
    COMPOSITE_NAMES,
)


def _composite_values(player: PlayerComposites) -> dict[str, float]:
    """Return the named composite scores that participate in accentuation."""
    return {name: float(getattr(player, name)) for name in COMPOSITE_NAMES}


def _strengths(player: PlayerComposites) -> dict[str, float]:
    """Top qualifying composites, with at least the player's best composite."""
    values = _composite_values(player)
    ordered = sorted(values.items(), key=lambda item: item[1], reverse=True)
    qualifying = [(name, value) for name, value in ordered if value >= ACCENTUATION_STRENGTH_THRESHOLD]
    selected = qualifying[:ACCENTUATION_TOP_N] or ordered[:1]
    return dict(selected)


def _weaknesses(player: PlayerComposites) -> dict[str, float]:
    """Bottom qualifying composites, using weakness depth as the stored value."""
    values = _composite_values(player)
    ordered = sorted(values.items(), key=lambda item: item[1])
    qualifying = [(name, 10.0 - value) for name, value in ordered if value <= ACCENTUATION_WEAKNESS_THRESHOLD]
    return dict(qualifying[:ACCENTUATION_TOP_N])


def _complements(composite: str) -> set[str]:
    """Return bidirectional complementary composites for one composite name."""
    related: set[str] = set()
    for left, right in ACCENTUATION_COMPLEMENTARY_PAIRS:
        if left == composite:
            related.add(right)
        if right == composite:
            related.add(left)
    return related


def compute_accentuation(lineup_composites: list[PlayerComposites]) -> tuple[float, float]:
    """Compute strength amplification and weakness coverage on 0-10 scales."""
    if len(lineup_composites) < 2:
        return 0.0, 0.0

    strengths_by_player = [_strengths(player) for player in lineup_composites]
    weaknesses_by_player = [_weaknesses(player) for player in lineup_composites]

    strength_credit = 0.0
    strength_checks = 0
    for player_index, strengths in enumerate(strengths_by_player):
        for composite, value in strengths.items():
            complements = _complements(composite)
            if not complements:
                continue
            best_teammate = 0.0
            for teammate_index, teammate_strengths in enumerate(strengths_by_player):
                if teammate_index == player_index:
                    continue
                best_teammate = max(
                    best_teammate,
                    max((teammate_strengths.get(name, 0.0) for name in complements), default=0.0),
                )
            if best_teammate > 0:
                strength_credit += (value / 10.0) * (best_teammate / 10.0) * 10.0
                strength_checks += 1

    weakness_credit = 0.0
    weakness_checks = 0
    for player_index, weaknesses in enumerate(weaknesses_by_player):
        for composite, weakness_depth in weaknesses.items():
            best_cover = 0.0
            for teammate_index, teammate_strengths in enumerate(strengths_by_player):
                if teammate_index == player_index:
                    continue
                best_cover = max(best_cover, teammate_strengths.get(composite, 0.0))
            if best_cover > 0:
                weakness_credit += (weakness_depth / 10.0) * (best_cover / 10.0) * 10.0
                weakness_checks += 1

    strength_score = strength_credit / strength_checks if strength_checks else 0.0
    weakness_score = weakness_credit / weakness_checks if weakness_checks else 0.0
    return round(min(10.0, strength_score), 1), round(min(10.0, weakness_score), 1)
