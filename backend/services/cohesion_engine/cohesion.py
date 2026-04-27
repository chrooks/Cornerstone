"""
Lineup-level cohesion orchestration.

This module is the Phase 3 bridge from player-level composites to one five-man
fit score. It applies lineup context, computes player composites, derives the
cohesion subscores, then rolls them up with configured weights.
"""

from __future__ import annotations

from math import exp, sqrt
from typing import Any

from .accentuation import compute_accentuation_details
from .bell_curve import (
    apply_rp_pd_boost,
    compute_lineup_coverage_by_height,
    compute_lineup_defense,
    parse_height_inches,
)
from .composites import compute_player_composites, tier_value
from .ratios import (
    creation_offball_ratio,
    rebound_transition_ratio,
    rebounding_spacing_deficit_ratio,
    ratio_score,
    spacing_creation_ratio,
    spacing_paint_touch_ratio,
)
from .synergies import apply_synergies
from .types import LineupCohesion, PlayerComposites
from .weights import (
    ANCHOR_DEPTH_WEIGHT,
    ANCHOR_PRIMARY_WEIGHT,
    ANCHOR_SECONDARY_WEIGHT,
    POST_GAME_PRIMARY_WEIGHT,
    POST_GAME_SECONDARY_WEIGHT,
    POST_GAME_DEPTH_WEIGHT,
    COHESION_ROLLUP_WEIGHTS,
    DEFENSIVE_COVERAGE_SATURATION_RAW,
    DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE,
    DEFENSIVE_REBOUNDING_MINIMUM,
    DEFENSIVE_REBOUNDING_PENALTY_SCALE,
    DEFENSIVE_TRANSITION_BOOST_CAP,
    DEFENSIVE_TRANSITION_BOOST_DIVISOR,
    PASSING_DEPTH_WEIGHT,
    PASSING_PRIMARY_CREATOR_WEIGHT,
    PNR_HANDLER_DEPTH_WEIGHT,
    PNR_HANDLER_PRIMARY_WEIGHT,
    PNR_HANDLER_SECONDARY_WEIGHT,
    PNR_HANDLER_SUPPORT_SCALE,
    PNR_PAIRING_QUALITY_GATE_FLOOR,
    PNR_PAIRING_QUALITY_GATE_SCALE,
    PNR_SCREENER_DEPTH_WEIGHT,
    PNR_SCREENER_PRIMARY_WEIGHT,
    PNR_SCREENER_SECONDARY_WEIGHT,
    REBOUNDING_DEPTH_WEIGHT,
    REBOUNDING_PRIMARY_WEIGHT,
    REBOUNDING_SECONDARY_WEIGHT,
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
    """Blend primary creator quality with lineup-wide passing depth."""
    if not lineup:
        return 0.0
    passer_values = [tier_value(player.get("skills", {}), "passer") for player in lineup]
    primary_creator = max(passer_values)
    depth = sum(passer_values) / len(passer_values)
    return primary_creator * PASSING_PRIMARY_CREATOR_WEIGHT + depth * PASSING_DEPTH_WEIGHT


def _collective_rebounding(composites: list[PlayerComposites]) -> float:
    """Blend the top two rebounders with team rebounding depth."""
    return _top_two_plus_depth(
        composites,
        "rebounding",
        REBOUNDING_PRIMARY_WEIGHT,
        REBOUNDING_SECONDARY_WEIGHT,
        REBOUNDING_DEPTH_WEIGHT,
    )


def _top_two_plus_depth(
    composites: list[PlayerComposites],
    field: str,
    primary_weight: float,
    secondary_weight: float,
    depth_weight: float,
) -> float:
    """Score concentrated lineup roles by top option, helper, and depth."""
    if not composites:
        return 0.0
    values = sorted((float(getattr(player, field)) for player in composites), reverse=True)
    primary = values[0] if values else 0.0
    secondary = values[1] if len(values) > 1 else 0.0
    depth = sum(values) / len(values)
    return primary * primary_weight + secondary * secondary_weight + depth * depth_weight


def _top_two_plus_depth_values(
    values: list[float],
    primary_weight: float,
    secondary_weight: float,
    depth_weight: float,
) -> float:
    """Score numeric lineup roles by top option, helper, and depth."""
    if not values:
        return 0.0
    sorted_values = sorted(values, reverse=True)
    primary = sorted_values[0]
    secondary = sorted_values[1] if len(sorted_values) > 1 else 0.0
    depth = sum(sorted_values) / len(sorted_values)
    return primary * primary_weight + secondary * secondary_weight + depth * depth_weight


def _collective_anchor(composites: list[PlayerComposites]) -> float:
    """Blend primary interior anchor quality with secondary support and depth."""
    return _top_two_plus_depth(
        composites,
        "anchor",
        ANCHOR_PRIMARY_WEIGHT,
        ANCHOR_SECONDARY_WEIGHT,
        ANCHOR_DEPTH_WEIGHT,
    )


def _collective_post_game(composites: list[PlayerComposites]) -> float:
    """Blend primary post player quality with secondary option and depth."""
    return _top_two_plus_depth(
        composites,
        "post_game",
        POST_GAME_PRIMARY_WEIGHT,
        POST_GAME_SECONDARY_WEIGHT,
        POST_GAME_DEPTH_WEIGHT,
    )


def _pnr_handler_value(player: dict[str, Any]) -> float:
    """
    Score how complete a player's PnR handling package is without replacing
    broad shot creation. The PnR handler skill is the gate; passing, driving,
    and off-dribble shooting add a modest multiplier.
    """
    skills = player.get("skills", {})
    base = tier_value(skills, "pnr_ball_handler")
    if base <= 0:
        return 0.0

    support = (
        tier_value(skills, "passer")
        + tier_value(skills, "driver")
        + tier_value(skills, "off_dribble_shooter")
    ) / 3.0
    return min(10.0, base * (1.0 + PNR_HANDLER_SUPPORT_SCALE * support / 10.0))


def _pnr_pairing(lineup: list[dict[str, Any]], composites: list[PlayerComposites]) -> float:
    """Score whether PnR handlers and screeners are both good and balanced."""
    handler_quality = _top_two_plus_depth_values(
        [_pnr_handler_value(player) for player in lineup],
        PNR_HANDLER_PRIMARY_WEIGHT,
        PNR_HANDLER_SECONDARY_WEIGHT,
        PNR_HANDLER_DEPTH_WEIGHT,
    )
    screener_quality = _top_two_plus_depth(
        composites,
        "pnr_screener",
        PNR_SCREENER_PRIMARY_WEIGHT,
        PNR_SCREENER_SECONDARY_WEIGHT,
        PNR_SCREENER_DEPTH_WEIGHT,
    )

    if handler_quality <= 0 or screener_quality <= 0:
        return 0.0

    balance = ratio_score(handler_quality, screener_quality)
    raw_quality_gate = sqrt(handler_quality * screener_quality) / 10.0
    quality_gate = min(
        1.0,
        PNR_PAIRING_QUALITY_GATE_FLOOR + PNR_PAIRING_QUALITY_GATE_SCALE * raw_quality_gate,
    )
    return min(10.0, balance * quality_gate)


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


def _defensive_coverage_subscore(raw_coverage: float) -> float:
    """
    Normalize raw stacked bell-curve coverage onto the 0-10 subscore scale.

    A saturating curve gives strong defensive lineups real lift without making
    every good overlapping coverage profile immediately max out at 10.
    """
    if raw_coverage <= 0:
        return 0.0
    saturation = max(0.1, DEFENSIVE_COVERAGE_SATURATION_RAW)
    return 10.0 * (1.0 - exp(-raw_coverage / saturation))


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
    off_ball_impact = _average(player_composites, "off_ball_impact")
    paint_touch = _average(player_composites, "paint_touch")
    post_game = _collective_post_game(player_composites)
    pnr_pairing = _pnr_pairing(synergy_players, player_composites)
    anchor = _collective_anchor(player_composites)
    rebounding = _collective_rebounding(player_composites)
    transition = _average(player_composites, "transition")
    collective_passing = _collective_passing(synergy_players)

    raw_defensive_coverage, gap_penalty, _gap_positions = compute_lineup_defense(synergy_players)
    defensive_coverage = _defensive_coverage_subscore(raw_defensive_coverage)
    if rebounding < DEFENSIVE_REBOUNDING_MINIMUM:
        defensive_coverage -= (DEFENSIVE_REBOUNDING_MINIMUM - rebounding) * DEFENSIVE_REBOUNDING_PENALTY_SCALE
    defensive_gaps = 10.0 + gap_penalty
    transition += _defensive_transition_boost(synergy_players)

    accentuation_details = compute_accentuation_details(player_composites)
    accentuation_strength = accentuation_details["strength"]["score"]
    accentuation_weakness = accentuation_details["weakness"]["score"]

    subscores = {
        "spacing_creation_ratio": spacing_creation_ratio(spacing, shot_creation),
        "creation_offball_ratio": creation_offball_ratio(shot_creation, off_ball_impact),
        "spacing_paint_touch_ratio": spacing_paint_touch_ratio(spacing, paint_touch),
        "paint_touch_total": _clamp_subscore(paint_touch),
        "post_game_total": _clamp_subscore(post_game),
        "pnr_pairing": _clamp_subscore(pnr_pairing),
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
        accentuation_details=accentuation_details,
    )
