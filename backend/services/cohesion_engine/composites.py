"""
Player composite computation for the cohesion engine.

This module extracts the validated prototype formulas into production code.
Raw composites use tier values directly, dependent formulas reference raw
sub-composites, and normalization happens once at the end.
"""

from __future__ import annotations

import logging
from typing import Any

from services.skills import ALL_SKILLS

from .bell_curve import compute_bell_params
from .types import PlayerComposites
from .weights import (
    COMPOSITE_NAMES,
    MIN_DISTRIBUTION_SIZE,
)

COMPOSITE_DISTRIBUTIONS: dict[str, list[float]] = {}
_DISTRIBUTION_SEASON: str | None = None

logger = logging.getLogger(__name__)


def _get_supabase_client():
    """Load the Supabase client only when distribution building needs the DB."""
    from services.supabase_client import get_supabase

    return get_supabase()


def _run_query(query):
    """Thin wrapper so tests can replace DB execution without real network IO."""
    from services.supabase_client import run_query

    return run_query(query)


def tier_value(skills: dict[str, str | float], skill: str, tier_values: dict[str, float]) -> float:
    """
    Return a skill's numeric value.

    Phase 3 synergies may pass already-boosted numeric skill values, while base
    player profiles use tier strings. Supporting both keeps this module context
    free.
    """
    value = skills.get(skill, "None")
    if isinstance(value, int | float):
        return float(value)
    return tier_values.get(value, 0.0)


def _with_default_skills(skills: dict[str, str | float]) -> dict[str, str | float]:
    """Copy the skill map and fill missing taxonomy entries as 'None'."""
    normalized = dict(skills)
    for skill in ALL_SKILLS:
        normalized.setdefault(skill, "None")
    return normalized


def compute_raw_composites(skills: dict[str, str | float], values: dict[str, Any]) -> dict[str, float]:
    """Compute all raw player composites in dependency order.

    Args:
        skills: Player skill map (tier strings or pre-boosted floats).
        values: The ``engine.version.values`` dict from the active Evaluation Version.
    """
    skills = _with_default_skills(skills)
    tv = values["tier_values"]
    c = values["composite_coefficients"]

    def _tv(skill: str) -> float:
        return tier_value(skills, skill, tv)

    # Step 1: independent composites that do not depend on other composites.
    raw_spacing = (
        _tv("movement_shooter")
        + _tv("spot_up_shooter")
        + c["spacing_off_dribble"] * _tv("off_dribble_shooter")
    )
    raw_finishing = _tv("high_flyer") + _tv("crafty_finisher")
    raw_defensive_rebounding = _tv("rebounder")
    raw_offensive_rebounding = _tv("offensive_rebounder")
    raw_perimeter_defense = (
        _tv("perimeter_disruptor")
        + c["perimeter_defense_versatile_defender"] * _tv("versatile_defender")
    )
    raw_interior_defense = (
        _tv("rim_protector")
        + c["interior_defense_versatile_defender"] * _tv("versatile_defender")
        + c["interior_defense_rebounder"] * _tv("rebounder")
    )

    # Step 2: rim pressure uses raw finishing as an amplifier.
    finishing_mult = max(1.0, 1.0 + c["paint_touch_finishing_scale"] * raw_finishing)
    raw_paint_touch = finishing_mult * (
        _tv("driver")
        + c["paint_touch_vertical_spacer"] * _tv("vertical_spacer")
        + _tv("low_post_player")
        + c["paint_touch_mid_post"] * _tv("mid_post_player")
    )

    # Step 3: independent composites (post game, PnR screener, transition, ball security).
    raw_ball_security = _tv("passer")
    raw_post_game = (
        _tv("low_post_player")
        + c["post_game_mid_post"] * _tv("mid_post_player")
    )
    pnr_secondary_mult = max(
        1.0,
        1.0
        + c["pnr_screener_secondary_scale"]
        * (_tv("vertical_spacer") + _tv("spot_up_shooter")),
    )
    raw_pnr_screener = _tv("pnr_finisher") * pnr_secondary_mult + _tv("screen_setter")
    passer_transition_mult = max(
        1.0,
        1.0 + c["transition_passer_scale"] * _tv("passer"),
    )
    raw_transition = (
        _tv("transition_threat") * passer_transition_mult
        + c["transition_high_flyer"] * _tv("high_flyer")
        + c["transition_driver"] * _tv("driver")
        + c["transition_spot_up"] * _tv("spot_up_shooter")
    )

    # Step 4: off-ball impact references raw spacing and raw finishing.
    cutting_finishing_mult = max(1.0, 1.0 + c["off_ball_finishing_scale"] * raw_finishing)
    raw_off_ball_impact = (
        raw_spacing
        + _tv("cutter") * cutting_finishing_mult
        + _tv("passer") * c["off_ball_passer"]
    )

    # Step 5: PnR orchestration — focused PnR initiation distinct from broad shot creation.
    raw_pnr_orchestration = (
        _tv("pnr_ball_handler")
        + c["pnr_ball_handler_passer"] * _tv("passer")
        + c["pnr_ball_handler_driver"] * _tv("driver")
        + c["pnr_ball_handler_off_dribble"] * _tv("off_dribble_shooter")
    )

    # Step 6: shot creation references raw spacing, raw paint touch, and raw pnr orchestration.
    raw_shot_creation = (
        c["shot_creation_pnr_orchestration"] * raw_pnr_orchestration
        + c["shot_creation_passer"] * _tv("passer")
        + c["shot_creation_off_dribble"] * _tv("off_dribble_shooter")
        + _tv("isolation_scorer")
        + c["shot_creation_spacing"] * raw_spacing
        + c["shot_creation_paint_touch"] * raw_paint_touch
    )

    return {
        "spacing": raw_spacing,
        "finishing": raw_finishing,
        "paint_touch": raw_paint_touch,
        "post_game": raw_post_game,
        "pnr_screener": raw_pnr_screener,
        "off_ball_impact": raw_off_ball_impact,
        "shot_creation": raw_shot_creation,
        "pnr_orchestration": raw_pnr_orchestration,
        "ball_security": raw_ball_security,
        "defensive_rebounding": raw_defensive_rebounding,
        "offensive_rebounding": raw_offensive_rebounding,
        "transition": raw_transition,
        "perimeter_defense": raw_perimeter_defense,
        "interior_defense": raw_interior_defense,
    }


def _percentile_normalize(
    raw: float,
    distribution: list[float],
    breakpoint_percentile: float,
    breakpoint_score: float,
) -> float:
    """Hybrid percentile normalization from the implementation spec."""
    if not distribution or raw <= 0:
        return 0.0

    sorted_distribution = sorted(distribution)
    n = len(sorted_distribution)
    below = sum(1 for value in sorted_distribution if value < raw)
    equal = sum(1 for value in sorted_distribution if value == raw)
    percentile = (below + equal / 2) / n

    p_break_index = int(n * breakpoint_percentile)
    p_break_value = sorted_distribution[min(p_break_index, n - 1)]
    empirical_max = sorted_distribution[-1]

    if percentile <= breakpoint_percentile:
        result = percentile / breakpoint_percentile * breakpoint_score
    elif empirical_max <= p_break_value:
        result = 10.0
    else:
        t = (raw - p_break_value) / (empirical_max - p_break_value)
        t = max(0.0, min(1.0, t))
        result = breakpoint_score + t * (10.0 - breakpoint_score)

    return round(min(10.0, result), 1)


def set_distributions(distributions: dict[str, list[float]] | None) -> None:
    """Replace cached distributions; tests and cache invalidation use this hook."""
    COMPOSITE_DISTRIBUTIONS.clear()
    if distributions:
        COMPOSITE_DISTRIBUTIONS.update(
            {name: sorted(vals) for name, vals in distributions.items()}
        )


def clear_distributions() -> None:
    """Clear cached distributions so normalization falls back to theoretical max."""
    global _DISTRIBUTION_SEASON
    _DISTRIBUTION_SEASON = None
    set_distributions(None)


def distributions_ready() -> bool:
    """Return True when every composite has enough distribution values."""
    return all(
        len(COMPOSITE_DISTRIBUTIONS.get(name, [])) >= MIN_DISTRIBUTION_SIZE
        for name in COMPOSITE_NAMES
    )


def ensure_distributions(season: str, values: dict[str, Any], force: bool = False) -> bool:
    """
    Build percentile normalization distributions when missing.

    Returns True when percentile normalization is ready. Failures are logged and
    leave theoretical fallback available, so request handling can continue.
    """
    global _DISTRIBUTION_SEASON
    if not force and _DISTRIBUTION_SEASON == season and distributions_ready():
        return True

    try:
        build_distributions(season, values)
        _DISTRIBUTION_SEASON = season
    except Exception as exc:
        logger.warning(
            "Unable to build cohesion composite distributions; using theoretical fallback (%s)",
            exc,
        )
        return False

    return distributions_ready()


def normalize_composites(raw: dict[str, float], values: dict[str, Any]) -> dict[str, float]:
    """Normalize raw composites to 0.0-10.0 using cache or theoretical fallback."""
    theoretical_max = values["theoretical_max"]
    breakpoint_percentile = values["normalization_breakpoint_percentile"]
    breakpoint_score = values["normalization_breakpoint_score"]

    if distributions_ready():
        return {
            name: _percentile_normalize(
                value, COMPOSITE_DISTRIBUTIONS.get(name, []),
                breakpoint_percentile, breakpoint_score,
            )
            for name, value in raw.items()
        }

    result: dict[str, float] = {}
    for name, value in raw.items():
        denom = theoretical_max.get(name, 0)
        if denom <= 0:
            result[name] = 0.0
        else:
            result[name] = round(min(10.0, value / denom * 10.0), 1)
    return result


def _extract_skills(profile: dict[str, Any]) -> dict[str, str]:
    """Extract tier strings from a skill profile JSON blob."""
    return {
        skill: data.get("final_tier", "None") if isinstance(data, dict) else data
        for skill, data in profile.items()
    }


def build_distributions(season: str, values: dict[str, Any]) -> dict[str, list[float]]:
    """
    Build and cache raw composite distributions for current players + legends.

    If fewer than MIN_DISTRIBUTION_SIZE player profiles exist, callers will still
    receive the small distribution, but normalization falls back to theoretical
    maxima until the cache has enough population data.
    """
    client = _get_supabase_client()
    all_raw: dict[str, list[float]] = {name: [] for name in COMPOSITE_NAMES}

    profiles = _run_query(
        lambda: client.table("skill_profiles")
        .select("profile")
        .eq("season", season)
        .eq("source", "composite")
        .execute()
    )
    for row in profiles.data:
        skills = _with_default_skills(_extract_skills(row["profile"]))
        raw = compute_raw_composites(skills, values)
        for name, value in raw.items():
            all_raw[name].append(value)

    legend_profiles = _run_query(
        lambda: client.table("skill_profiles")
        .select("profile")
        .eq("source", "manual")
        .eq("is_legend", True)
        .execute()
    )
    for row in legend_profiles.data:
        skills = _with_default_skills(_extract_skills(row["profile"]))
        raw = compute_raw_composites(skills, values)
        for name, value in raw.items():
            all_raw[name].append(value)

    distributions = {name: sorted(vals) for name, vals in all_raw.items()}
    set_distributions(distributions)
    return distributions


def compute_player_composites(
    skills: dict[str, str | float],
    player_id: str,
    name: str,
    values: dict[str, Any],
    height_inches: int | None = None,
) -> PlayerComposites:
    """Compute normalized composites and bell parameters for one player."""
    raw = compute_raw_composites(skills, values)
    normalized = normalize_composites(raw, values)

    # A missing height should not break partial roster previews; the midpoint
    # keeps the dataclass complete until the API provides real player height.
    bell = compute_bell_params(
        {key: str(value) for key, value in skills.items() if not isinstance(value, int | float)},
        height_inches if height_inches is not None else 78,
        values,
    )

    return PlayerComposites(
        player_id=player_id,
        name=name,
        **{name: normalized[name] for name in COMPOSITE_NAMES},
        bell_amplitude=float(bell["amplitude"]),
        bell_peak=int(bell["peak_center"]),
        bell_range_down=int(bell["range_down"]),
        bell_range_up=int(bell["range_up"]),
        bell_flat_down=int(bell["flat_top_down"]),
        bell_flat_up=int(bell["flat_top_up"]),
    )
