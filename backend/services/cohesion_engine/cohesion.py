"""
Lineup-level cohesion orchestration.

This module is the Phase 3 bridge from player-level composites to one five-man
fit score. It applies lineup context, computes player composites, derives the
13 cohesion subscores, then rolls them up with configured weights.
"""

from __future__ import annotations

from typing import Any

from .accentuation import compute_accentuation
from .bell_curve import (
    apply_rp_pd_boost,
    compute_lineup_coverage_by_height,
    compute_lineup_defense,
    parse_height_inches,
)
from .composites import compute_player_composites, tier_value
from .ratios import (
    rebound_transition_ratio,
    rebounding_spacing_deficit_ratio,
    spacing_creation_ratio,
    spacing_paint_touch_ratio,
)
from .synergies import apply_synergies
from .types import LineupCohesion, PlayerComposites
from .weights import (
    COHESION_ROLLUP_WEIGHTS,
    DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE,
    DEFENSIVE_REBOUNDING_MINIMUM,
    DEFENSIVE_REBOUNDING_PENALTY_SCALE,
    DEFENSIVE_TRANSITION_BOOST_CAP,
    DEFENSIVE_TRANSITION_BOOST_DIVISOR,
    STAR_RATING_MAX,
)


def _player_id(player: dict[str, Any], index: int) -> str:
    """Pick a stable ID from common API shapes, falling back to lineup index."""
    return str(player.get("id") or player.get("player_id") or f"lineup-player-{index}")


def _average(composites: list[PlayerComposites], field: str) -> float:
    """Average a normalized composite across the lineup."""
    if not composites:
        return 0.0
    return sum(float(getattr(player, field)) for player in composites) / len(composites)


def _collective_passing(lineup: list[dict[str, Any]]) -> float:
    """Average passer tier across the lineup on the same 0-10 scale."""
    if not lineup:
        return 0.0
    return sum(tier_value(player.get("skills", {}), "passer") for player in lineup) / len(lineup)


def _defensive_transition_boost(lineup: list[dict[str, Any]]) -> float:
    """Compute DEF-10: guard-height defensive density creates transition chances."""
    coverage = compute_lineup_coverage_by_height(lineup)
    start, stop = DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE
    guard_density = sum(coverage.get(height, 0.0) for height in range(start, stop))
    return min(DEFENSIVE_TRANSITION_BOOST_CAP, guard_density / DEFENSIVE_TRANSITION_BOOST_DIVISOR)


def _compute_player_composites(lineup: list[dict[str, Any]]) -> list[PlayerComposites]:
    """Compute effective composites for every player in a lineup."""
    computed: list[PlayerComposites] = []
    for index, player in enumerate(lineup):
        height_inches = parse_height_inches(player.get("height"))
        computed.append(
            compute_player_composites(
                player.get("skills", {}),
                player_id=_player_id(player, index),
                name=str(player.get("name") or _player_id(player, index)),
                height_inches=height_inches,
            )
        )
    return computed


def _clamp_subscore(value: float) -> float:
    """Keep cohesion subscores in the 0-10 range used by the rollup."""
    return round(max(0.0, min(10.0, value)), 1)


def _rollup_score(subscores: dict[str, float], accentuation_strength: float, accentuation_weakness: float) -> float:
    """Convert normalized subscores into a 0-5 lineup score."""
    weighted_sum = 0.0
    for key, weight in COHESION_ROLLUP_WEIGHTS.items():
        if key == "accentuation_strength":
            value = accentuation_strength
        elif key == "accentuation_weakness":
            value = accentuation_weakness
        else:
            value = subscores.get(key, 0.0)
        weighted_sum += weight * (value / 10.0)
    return round(STAR_RATING_MAX * weighted_sum, 2)


def evaluate_lineup(players: list[dict[str, Any]]) -> LineupCohesion:
    """Evaluate one lineup and return its cohesion score plus explanations."""
    rp_boosted = apply_rp_pd_boost(players)
    synergy_players, synergies_applied = apply_synergies(rp_boosted)
    player_composites = _compute_player_composites(synergy_players)

    spacing = _average(player_composites, "spacing")
    shot_creation = _average(player_composites, "shot_creation")
    paint_touch = _average(player_composites, "paint_touch")
    post_game = _average(player_composites, "post_game")
    pnr_screener = _average(player_composites, "pnr_screener")
    anchor = _average(player_composites, "anchor")
    rebounding = _average(player_composites, "rebounding")
    transition = _average(player_composites, "transition")
    collective_passing = _collective_passing(synergy_players)

    defensive_coverage, gap_penalty, _gap_positions = compute_lineup_defense(synergy_players)
    if rebounding < DEFENSIVE_REBOUNDING_MINIMUM:
        defensive_coverage -= (DEFENSIVE_REBOUNDING_MINIMUM - rebounding) * DEFENSIVE_REBOUNDING_PENALTY_SCALE
    defensive_gaps = 10.0 + gap_penalty
    transition += _defensive_transition_boost(synergy_players)

    accentuation_strength, accentuation_weakness = compute_accentuation(player_composites)

    subscores = {
        "spacing_creation_ratio": spacing_creation_ratio(spacing, shot_creation),
        "spacing_paint_touch_ratio": spacing_paint_touch_ratio(spacing, paint_touch),
        "paint_touch_total": _clamp_subscore(paint_touch),
        "post_game_total": _clamp_subscore(post_game),
        "pnr_screener_total": _clamp_subscore(pnr_screener),
        "anchor_total": _clamp_subscore(anchor),
        "collective_passing": _clamp_subscore(collective_passing),
        "rebounding": _clamp_subscore(rebounding),
        "transition": _clamp_subscore(transition),
        "rebound_transition_ratio": rebound_transition_ratio(rebounding, transition),
        "rebounding_spacing_deficit": rebounding_spacing_deficit_ratio(rebounding, spacing),
        "defensive_coverage": _clamp_subscore(defensive_coverage),
        "defensive_gaps": _clamp_subscore(defensive_gaps),
    }

    return LineupCohesion(
        score=_rollup_score(subscores, accentuation_strength, accentuation_weakness),
        subscores=subscores,
        synergies_applied=synergies_applied,
        accentuation_strength=accentuation_strength,
        accentuation_weakness=accentuation_weakness,
    )
