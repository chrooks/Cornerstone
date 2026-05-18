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
from .engine import CohesionEngine, LineupContext
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


def _player_id(player: dict[str, Any], index: int) -> str:
    """Pick a stable ID from common API shapes, falling back to lineup index."""
    return str(player.get("id") or player.get("player_id") or f"lineup-player-{index}")


def _collective_passing(lineup: list[dict[str, Any]], values: dict[str, Any]) -> float:
    """Blend primary creator quality with lineup-wide passing depth."""
    if not lineup:
        return 0.0
    tv = values["tier_values"]
    passer_values = [tier_value(player.get("skills", {}), "passer", tv) for player in lineup]
    primary_creator = max(passer_values)
    depth = sum(passer_values) / len(passer_values)
    return (
        primary_creator * values["passing_primary_creator_weight"]
        + depth * values["passing_depth_weight"]
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
    sorted_values = sorted((float(getattr(player, field)) for player in composites), reverse=True)
    primary = sorted_values[0] if sorted_values else 0.0
    secondary = sorted_values[1] if len(sorted_values) > 1 else 0.0
    depth = sum(sorted_values) / len(sorted_values)
    return primary * primary_weight + secondary * secondary_weight + depth * depth_weight


def _top_two_plus_depth_values(
    raw_values: list[float],
    primary_weight: float,
    secondary_weight: float,
    depth_weight: float,
) -> float:
    """Score numeric lineup roles by top option, helper, and depth."""
    if not raw_values:
        return 0.0
    sorted_values = sorted(raw_values, reverse=True)
    primary = sorted_values[0]
    secondary = sorted_values[1] if len(sorted_values) > 1 else 0.0
    depth = sum(sorted_values) / len(sorted_values)
    return primary * primary_weight + secondary * secondary_weight + depth * depth_weight


def _pnr_handler_value(player: dict[str, Any], values: dict[str, Any]) -> float:
    """
    Score how complete a player's PnR handling package is without replacing
    broad shot creation. The PnR handler skill is the gate; passing, driving,
    and off-dribble shooting add a modest multiplier.
    """
    tv = values["tier_values"]
    skills = player.get("skills", {})
    base = tier_value(skills, "pnr_ball_handler", tv)
    if base <= 0:
        return 0.0

    support = (
        tier_value(skills, "passer", tv)
        + tier_value(skills, "driver", tv)
        + tier_value(skills, "off_dribble_shooter", tv)
    ) / 3.0
    return min(10.0, base * (1.0 + values["pnr_handler_support_scale"] * support / 10.0))


def _pnr_pairing(
    lineup: list[dict[str, Any]], composites: list[PlayerComposites], values: dict[str, Any]
) -> float:
    """Score whether PnR handlers and screeners are both good and balanced."""
    handler_quality = _top_two_plus_depth_values(
        [_pnr_handler_value(player, values) for player in lineup],
        values["pnr_handler_primary_weight"],
        values["pnr_handler_secondary_weight"],
        values["pnr_handler_depth_weight"],
    )
    screener_quality = _top_two_plus_depth(
        composites,
        "pnr_screener",
        values["pnr_screener_primary_weight"],
        values["pnr_screener_secondary_weight"],
        values["pnr_screener_depth_weight"],
    )

    if handler_quality <= 0 or screener_quality <= 0:
        return 0.0

    balance = ratio_score(handler_quality, screener_quality, values)
    raw_quality_gate = sqrt(handler_quality * screener_quality) / 10.0
    quality_gate = min(
        1.0,
        values["pnr_pairing_quality_gate_floor"]
        + values["pnr_pairing_quality_gate_scale"] * raw_quality_gate,
    )
    return min(10.0, balance * quality_gate)


def _defensive_transition_boost(
    lineup: list[dict[str, Any]], perimeter_defense: float, values: dict[str, Any]
) -> float:
    """Compute DEF-10: perimeter pressure or guard-height density creates transition chances."""
    coverage = compute_lineup_coverage_by_height(lineup, values)
    start, stop = values["defensive_guard_density_height_range"]
    divisor: float = values["defensive_transition_boost_divisor"]
    cap: float = values["defensive_transition_boost_cap"]
    guard_density = sum(coverage.get(height, 0.0) for height in range(start, stop))
    guard_density_boost = guard_density / divisor
    perimeter_pressure_boost = perimeter_defense / divisor
    return min(cap, max(guard_density_boost, perimeter_pressure_boost))


def _compute_player_composites(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> list[PlayerComposites]:
    """Compute effective composites for every player in a lineup."""
    computed: list[PlayerComposites] = []
    for index, player in enumerate(lineup):
        height_inches = parse_height_inches(player.get("height"))
        computed.append(
            compute_player_composites(
                player.get("skills", {}),
                player_id=_player_id(player, index),
                name=str(player.get("name") or _player_id(player, index)),
                values=values,
                height_inches=height_inches,
            )
        )
    return computed


def _clamp_subscore(value: float) -> float:
    """Keep cohesion subscores in the 0-10 range used by the rollup."""
    return round(max(0.0, min(10.0, value)), 1)


def _defensive_coverage_subscore(raw_coverage: float, values: dict[str, Any]) -> float:
    """
    Normalize raw stacked bell-curve coverage onto the 0-10 subscore scale.

    A saturating curve gives strong defensive lineups real lift without making
    every good overlapping coverage profile immediately max out at 10.
    """
    if raw_coverage <= 0:
        return 0.0
    saturation = max(0.1, values["defensive_coverage_saturation_raw"])
    return 10.0 * (1.0 - exp(-raw_coverage / saturation))


def _rollup_score(
    subscores: dict[str, float],
    accentuation_strength: float,
    accentuation_weakness: float,
    values: dict[str, Any],
) -> float:
    """Convert normalized subscores into a 0-5 lineup score."""
    rollup_weights: dict[str, float] = values["cohesion_rollup_weights"]
    star_rating_max: float = values["star_rating_max"]
    weighted_sum = 0.0
    for key, weight in rollup_weights.items():
        if key == "accentuation_strength":
            value = accentuation_strength
        elif key == "accentuation_weakness":
            value = accentuation_weakness
        else:
            value = subscores.get(key, 0.0)
        weighted_sum += weight * (value / 10.0)
    return round(star_rating_max * weighted_sum, 2)


def evaluate_lineup(players: list[dict[str, Any]], engine: CohesionEngine) -> LineupCohesion:
    """Evaluate one lineup and return its cohesion score plus explanations."""
    values = engine.version.values
    formula_refs = engine.version.formula_refs

    rp_boosted = apply_rp_pd_boost(players, values)
    synergy_players, synergies_applied = apply_synergies(rp_boosted, values)
    player_composites = _compute_player_composites(synergy_players, values)

    ctx = LineupContext(composites=player_composites, lineup=synergy_players)

    # Dispatch Impact Trait subscores through registered Formula Handlers
    spacing = engine.dispatch(formula_refs["spacing"], ctx)
    shot_creation = engine.dispatch(formula_refs["shot_creation"], ctx)
    off_ball_impact = engine.dispatch(formula_refs["off_ball_impact"], ctx)
    paint_touch = engine.dispatch(formula_refs["paint_touch"], ctx)
    post_game = engine.dispatch(formula_refs["post_game"], ctx)
    anchor = engine.dispatch(formula_refs["anchor"], ctx)
    perimeter_defense = engine.dispatch(formula_refs["perimeter_defense"], ctx)
    interior_defense = engine.dispatch(formula_refs["interior_defense"], ctx)
    rebounding = engine.dispatch(formula_refs["rebounding"], ctx)
    transition = engine.dispatch(formula_refs["transition"], ctx)

    # Non-dispatched subscores (complex logic, raw skill access, or no handler)
    pnr_pairing = _pnr_pairing(synergy_players, player_composites, values)
    collective_passing = _collective_passing(synergy_players, values)

    raw_defensive_coverage, gap_penalty, _gap_positions = compute_lineup_defense(
        synergy_players, values
    )
    defensive_coverage = _defensive_coverage_subscore(raw_defensive_coverage, values)
    reb_min: float = values["defensive_rebounding_minimum"]
    reb_penalty_scale: float = values["defensive_rebounding_penalty_scale"]
    if rebounding < reb_min:
        defensive_coverage -= (reb_min - rebounding) * reb_penalty_scale
    defensive_gaps = 10.0 + gap_penalty
    transition += _defensive_transition_boost(synergy_players, perimeter_defense, values)

    accentuation_details = compute_accentuation_details(player_composites, values)
    accentuation_strength = accentuation_details["strength"]["score"]
    accentuation_weakness = accentuation_details["weakness"]["score"]

    subscores = {
        "spacing_creation_ratio": spacing_creation_ratio(spacing, shot_creation, values),
        "creation_offball_ratio": creation_offball_ratio(shot_creation, off_ball_impact, values),
        "spacing_paint_touch_ratio": spacing_paint_touch_ratio(spacing, paint_touch, values),
        "paint_touch_total": _clamp_subscore(paint_touch),
        "post_game_total": _clamp_subscore(post_game),
        "pnr_pairing": _clamp_subscore(pnr_pairing),
        "anchor_total": _clamp_subscore(anchor),
        "perimeter_defense_total": _clamp_subscore(perimeter_defense),
        "interior_defense_total": _clamp_subscore(interior_defense),
        "collective_passing": _clamp_subscore(collective_passing),
        "rebounding": _clamp_subscore(rebounding),
        "transition": _clamp_subscore(transition),
        "rebound_transition_ratio": rebound_transition_ratio(rebounding, transition, values),
        "rebounding_spacing_deficit": rebounding_spacing_deficit_ratio(rebounding, spacing, values),
        "defensive_coverage": _clamp_subscore(defensive_coverage),
        "defensive_gaps": _clamp_subscore(defensive_gaps),
    }

    return LineupCohesion(
        score=_rollup_score(subscores, accentuation_strength, accentuation_weakness, values),
        subscores=subscores,
        synergies_applied=synergies_applied,
        accentuation_strength=accentuation_strength,
        accentuation_weakness=accentuation_weakness,
        accentuation_details=accentuation_details,
    )
