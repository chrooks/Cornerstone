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


def _pnr_pairing_details(
    lineup: list[dict[str, Any]], composites: list[PlayerComposites], values: dict[str, Any]
) -> dict[str, float]:
    """Score whether PnR handlers and screeners are both good and balanced.

    Returns the captured intermediates alongside the score so the Attribution
    Ledger (#93) can render them without re-deriving the math.
    """
    handler_quality = _top_two_plus_depth(
        composites, "pnr_orchestration",
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

    # "Is there anybody here who screens at all?" must be asked of the RAW
    # composite, not the normalized one. Since #114 a normalized 0.0 no longer
    # means absent — a lineup of five non-screeners still scores ~3.3 on
    # pnr_screener, because two thirds of the league never screens either.
    # Raw is where absent is still literally 0.0. No screener, no pick-and-roll.
    has_handler = any(pc.raw.get("pnr_orchestration", 0.0) > 0 for pc in composites)
    has_screener = any(pc.raw.get("pnr_screener", 0.0) > 0 for pc in composites)

    details = {
        "handler_quality": handler_quality,
        "screener_quality": screener_quality,
        "has_handler": has_handler,
        "has_screener": has_screener,
        "balance": 0.0,
        "quality_gate": 0.0,
        "score": 0.0,
    }
    if not has_handler or not has_screener:
        return details

    balance = ratio_score(handler_quality, screener_quality, values)
    raw_quality_gate = sqrt(handler_quality * screener_quality) / 10.0
    quality_gate = min(
        1.0,
        values["pnr_pairing_quality_gate_floor"]
        + values["pnr_pairing_quality_gate_scale"] * raw_quality_gate,
    )
    return {
        **details,
        "balance": balance,
        "quality_gate": quality_gate,
        "score": min(10.0, balance * quality_gate),
    }


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
    # Imported at call time: snapshot_versions.distribution_cache imports this
    # package's composites module at load, so a module-level import here would
    # be circular. Grab the immutable state ONCE for the whole lineup — a
    # concurrent publish flip cannot tear this batch.
    from services.snapshot_versions import distribution_cache

    state = distribution_cache.get_state()
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
                distributions=state.distributions,
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


def _weighted_category_score(
    subscores: dict[str, float], weights: dict[str, float]
) -> float:
    """Compute a single category score from Subscores and their weights."""
    return sum(
        weights.get(key, 0.0) * subscores.get(key, 0.0) / 10.0
        for key in weights
    )


def _rollup_score(
    subscores: dict[str, float],
    accentuation_strength: float,
    accentuation_weakness: float,
    values: dict[str, Any],
) -> tuple[float, dict[str, float]]:
    """Two-level rollup: intra-category → category → final star score.

    1. Compute offense score (quality 70% + balance 30%).
    2. Compute defense and rebounding/transition scores.
    3. Weighted category sum → base star score.
    4. Asymmetric accentuation applied additively post-rollup.

    Returns (final_score, category_scores) where category_scores maps each
    category name to its 0.0-1.0 weighted contribution before star scaling.
    """
    category_weights: dict[str, float] = values["category_weights"]
    star_rating_max: float = values["star_rating_max"]

    # Offense: quality + balance blend
    quality_ratio: float = values["offense_quality_ratio"]
    offense_quality = _weighted_category_score(subscores, values["offense_quality_weights"])
    offense_balance = _weighted_category_score(subscores, values["offense_balance_weights"])
    offense_score = offense_quality * quality_ratio + offense_balance * (1.0 - quality_ratio)

    # Defense and rebounding/transition
    defense_score = _weighted_category_score(subscores, values["defense_subscore_weights"])
    reb_trans_score = _weighted_category_score(subscores, values["rebound_transition_subscore_weights"])

    category_scores = {
        "offense": round(offense_score, 4),
        "defense": round(defense_score, 4),
        "rebounding_transition": round(reb_trans_score, 4),
    }

    # Category-weighted base
    base = (
        category_weights["offense"] * offense_score
        + category_weights["defense"] * defense_score
        + category_weights["rebounding_transition"] * reb_trans_score
    )

    # Asymmetric accentuation: additive post-rollup
    strength_cap: float = values.get("accentuation_strength_cap", 0.25)
    weakness_cap: float = values.get("accentuation_weakness_cap", 0.50)
    strength_bonus = (accentuation_strength / 10.0) * strength_cap
    weakness_penalty = ((10.0 - accentuation_weakness) / 10.0) * weakness_cap

    final = round(
        max(0.0, min(star_rating_max, star_rating_max * base + strength_bonus - weakness_penalty)),
        2,
    )
    return final, category_scores


def evaluate_lineup(
    players: list[dict[str, Any]], engine: CohesionEngine, with_attribution: bool = False
) -> LineupCohesion:
    """Evaluate one lineup and return its cohesion score plus explanations.

    Two-level rollup: Subscores → category scores → final star rating.
    Categories: offense (quality + balance), defense, rebounding/transition.
    Accentuation applied additively post-rollup with asymmetric caps.
    """
    values = engine.version.values
    formula_refs = engine.version.formula_refs

    rp_boosted = apply_rp_pd_boost(players, values)
    synergy_players, synergies_applied = apply_synergies(rp_boosted, values)
    player_composites = _compute_player_composites(synergy_players, values)

    ctx = LineupContext(composites=player_composites, lineup=synergy_players)

    # --- Offense quality Subscores (dispatched via Formula Handlers) ---
    spacing = engine.dispatch(formula_refs["spacing"], ctx)
    shot_creation = engine.dispatch(formula_refs["shot_creation"], ctx)
    paint_touch = engine.dispatch(formula_refs["paint_touch"], ctx)
    off_ball_impact = engine.dispatch(formula_refs["off_ball_impact"], ctx)
    ball_security = engine.dispatch(formula_refs["ball_security"], ctx)
    post_game = engine.dispatch(formula_refs["post_game"], ctx)

    # Offense quality Subscores (complex logic, not dispatched)
    pnr_details = _pnr_pairing_details(synergy_players, player_composites, values)
    pnr_pairing = pnr_details["score"]
    collective_passing = _collective_passing(synergy_players, values)

    # --- Defense Subscores ---
    perimeter_defense = engine.dispatch(formula_refs["perimeter_defense"], ctx)
    interior_defense = engine.dispatch(formula_refs["interior_defense"], ctx)
    switchability = engine.dispatch(formula_refs["switchability"], ctx)

    raw_defensive_coverage, gap_penalty, _gap_positions = compute_lineup_defense(
        synergy_players, values
    )
    defensive_coverage = _defensive_coverage_subscore(raw_defensive_coverage, values)
    defensive_gaps = 10.0 + gap_penalty

    # --- Rebounding/Transition Subscores ---
    defensive_rebounding = engine.dispatch(formula_refs["defensive_rebounding"], ctx)
    offensive_rebounding = engine.dispatch(formula_refs["offensive_rebounding"], ctx)
    transition = engine.dispatch(formula_refs["transition"], ctx)
    transition_boost = _defensive_transition_boost(synergy_players, perimeter_defense, values)
    transition += transition_boost

    # --- Accentuation ---
    accentuation_details = compute_accentuation_details(player_composites, values)
    accentuation_strength = accentuation_details["strength"]["score"]
    accentuation_weakness = accentuation_details["weakness"]["score"]

    subscores = {
        # Offense quality
        "spacing": _clamp_subscore(spacing),
        "shot_creation": _clamp_subscore(shot_creation),
        "paint_touch": _clamp_subscore(paint_touch),
        "collective_passing": _clamp_subscore(collective_passing),
        "off_ball_impact": _clamp_subscore(off_ball_impact),
        "ball_security": _clamp_subscore(ball_security),
        "pnr_pairing": _clamp_subscore(pnr_pairing),
        "post_game": _clamp_subscore(post_game),
        # Offense balance
        "spacing_creation_ratio": spacing_creation_ratio(spacing, shot_creation, values),
        "creation_offball_ratio": creation_offball_ratio(shot_creation, off_ball_impact, values),
        "spacing_paint_touch_ratio": spacing_paint_touch_ratio(spacing, paint_touch, values),
        # Defense
        "interior_defense": _clamp_subscore(interior_defense),
        "defensive_coverage": _clamp_subscore(defensive_coverage),
        "defensive_gaps": _clamp_subscore(defensive_gaps),
        "perimeter_defense": _clamp_subscore(perimeter_defense),
        "switchability": _clamp_subscore(switchability),
        # Rebounding/transition
        "defensive_rebounding": _clamp_subscore(defensive_rebounding),
        "offensive_rebounding": _clamp_subscore(offensive_rebounding),
        "transition": _clamp_subscore(transition),
        "rebound_transition_ratio": rebound_transition_ratio(
            defensive_rebounding, transition, values
        ),
    }

    final_score, category_scores = _rollup_score(
        subscores, accentuation_strength, accentuation_weakness, values
    )

    subscore_breakdowns = None
    if with_attribution:
        from .attribution import build_subscore_ledgers

        subscore_breakdowns = build_subscore_ledgers(
            subscores=subscores,
            composites=player_composites,
            lineup=synergy_players,
            values=values,
            formula_refs=formula_refs,
            transition_boost=transition_boost,
            pnr_details=pnr_details,
        )

    return LineupCohesion(
        score=final_score,
        subscores=subscores,
        category_scores=category_scores,
        synergies_applied=synergies_applied,
        accentuation_strength=accentuation_strength,
        accentuation_weakness=accentuation_weakness,
        accentuation_details=accentuation_details,
        subscore_breakdowns=subscore_breakdowns,
    )
