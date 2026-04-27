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


def compute_accentuation_details(lineup_composites: list[PlayerComposites]) -> dict:
    """Compute accentuation scores and return equation-friendly detail."""
    if len(lineup_composites) < 2:
        return {
            "strength": {"score": 0.0, "credit": 0.0, "checks": 0, "terms": []},
            "weakness": {"score": 0.0, "credit": 0.0, "checks": 0, "terms": []},
        }

    strengths_by_player = [_strengths(player) for player in lineup_composites]
    weaknesses_by_player = [_weaknesses(player) for player in lineup_composites]

    strength_credit = 0.0
    strength_checks = 0
    strength_terms: list[dict] = []
    for player_index, strengths in enumerate(strengths_by_player):
        for composite, value in strengths.items():
            complements = _complements(composite)
            if not complements:
                continue
            best_teammate = 0.0
            best_teammate_index: int | None = None
            best_teammate_composite: str | None = None
            for teammate_index, teammate_strengths in enumerate(strengths_by_player):
                if teammate_index == player_index:
                    continue
                for name in complements:
                    teammate_value = teammate_strengths.get(name, 0.0)
                    if teammate_value > best_teammate:
                        best_teammate = teammate_value
                        best_teammate_index = teammate_index
                        best_teammate_composite = name
            if best_teammate > 0:
                contribution = (value / 10.0) * (best_teammate / 10.0) * 10.0
                strength_credit += contribution
                strength_checks += 1
                strength_terms.append({
                    "player": lineup_composites[player_index].name,
                    "composite": composite,
                    "value": round(value, 1),
                    "teammate": lineup_composites[best_teammate_index].name if best_teammate_index is not None else "",
                    "teammate_composite": best_teammate_composite or "",
                    "teammate_value": round(best_teammate, 1),
                    "contribution": round(contribution, 2),
                })

    weakness_credit = 0.0
    weakness_checks = 0
    weakness_terms: list[dict] = []
    for player_index, weaknesses in enumerate(weaknesses_by_player):
        for composite, weakness_depth in weaknesses.items():
            best_cover = 0.0
            best_cover_index: int | None = None
            for teammate_index, teammate_strengths in enumerate(strengths_by_player):
                if teammate_index == player_index:
                    continue
                cover_value = teammate_strengths.get(composite, 0.0)
                if cover_value > best_cover:
                    best_cover = cover_value
                    best_cover_index = teammate_index
            if best_cover > 0:
                contribution = (weakness_depth / 10.0) * (best_cover / 10.0) * 10.0
                weakness_credit += contribution
                weakness_checks += 1
                weakness_terms.append({
                    "player": lineup_composites[player_index].name,
                    "composite": composite,
                    "weakness_depth": round(weakness_depth, 1),
                    "teammate": lineup_composites[best_cover_index].name if best_cover_index is not None else "",
                    "cover_value": round(best_cover, 1),
                    "contribution": round(contribution, 2),
                })

    strength_score = strength_credit / strength_checks if strength_checks else 0.0
    weakness_score = weakness_credit / weakness_checks if weakness_checks else 0.0
    return {
        "strength": {
            "score": round(min(10.0, strength_score), 1),
            "credit": round(strength_credit, 2),
            "checks": strength_checks,
            "terms": strength_terms,
        },
        "weakness": {
            "score": round(min(10.0, weakness_score), 1),
            "credit": round(weakness_credit, 2),
            "checks": weakness_checks,
            "terms": weakness_terms,
        },
    }


def compute_accentuation(lineup_composites: list[PlayerComposites]) -> tuple[float, float]:
    """Compute strength amplification and weakness coverage on 0-10 scales."""
    details = compute_accentuation_details(lineup_composites)
    return details["strength"]["score"], details["weakness"]["score"]
