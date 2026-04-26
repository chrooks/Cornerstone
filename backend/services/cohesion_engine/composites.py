"""
Player composite computation for the cohesion engine.

This module extracts the validated prototype formulas into production code.
Raw composites use tier values directly, dependent formulas reference raw
sub-composites, and normalization happens once at the end.
"""

from __future__ import annotations

from typing import Any

from backend.services.skills import ALL_SKILLS

from .bell_curve import compute_bell_params
from .types import PlayerComposites
from .weights import (
    COMPOSITE_COEFFICIENTS,
    COMPOSITE_NAMES,
    MIN_DISTRIBUTION_SIZE,
    NORMALIZATION_BREAKPOINT_PERCENTILE,
    NORMALIZATION_BREAKPOINT_SCORE,
    THEORETICAL_MAX,
    TIER_VALUES,
)

COMPOSITE_DISTRIBUTIONS: dict[str, list[float]] = {}


def _get_supabase_client():
    """Load the Supabase client only when distribution building needs the DB."""
    from backend.services.supabase_client import get_supabase

    return get_supabase()


def _run_query(query):
    """Thin wrapper so tests can replace DB execution without real network IO."""
    from backend.services.supabase_client import run_query

    return run_query(query)


def tier_value(skills: dict[str, str | float], skill: str) -> float:
    """
    Return a skill's numeric value.

    Phase 3 synergies may pass already-boosted numeric skill values, while base
    player profiles use tier strings. Supporting both keeps this module context
    free.
    """
    value = skills.get(skill, "None")
    if isinstance(value, int | float):
        return float(value)
    return TIER_VALUES.get(value, 0.0)


def _with_default_skills(skills: dict[str, str | float]) -> dict[str, str | float]:
    """Copy the skill map and fill missing taxonomy entries as 'None'."""
    normalized = dict(skills)
    for skill in ALL_SKILLS:
        normalized.setdefault(skill, "None")
    return normalized


def compute_raw_composites(skills: dict[str, str | float]) -> dict[str, float]:
    """Compute all raw player composites in dependency order."""
    skills = _with_default_skills(skills)
    c = COMPOSITE_COEFFICIENTS

    # Step 1: independent composites that do not depend on other composites.
    raw_spacing = (
        tier_value(skills, "movement_shooter")
        + tier_value(skills, "spot_up_shooter")
        + c["spacing_off_dribble"] * tier_value(skills, "off_dribble_shooter")
    )
    raw_finishing = tier_value(skills, "high_flyer") + tier_value(skills, "crafty_finisher")
    raw_rebounding = tier_value(skills, "rebounder") + tier_value(skills, "offensive_rebounder")

    # Step 2: paint touch uses raw finishing as an amplifier.
    finishing_mult = max(1.0, 1.0 + c["paint_touch_finishing_scale"] * raw_finishing)
    raw_paint_touch = finishing_mult * (
        tier_value(skills, "driver")
        + c["paint_touch_vertical_spacer"] * tier_value(skills, "vertical_spacer")
        + tier_value(skills, "low_post_player")
        + c["paint_touch_mid_post"] * tier_value(skills, "mid_post_player")
    )

    # Step 3: independent big-man and transition composites.
    raw_anchor = (
        tier_value(skills, "rebounder")
        + tier_value(skills, "rim_protector")
        + tier_value(skills, "vertical_spacer")
        + c["anchor_screen_setter"] * tier_value(skills, "screen_setter")
    )
    raw_post_game = (
        tier_value(skills, "low_post_player")
        + c["post_game_mid_post"] * tier_value(skills, "mid_post_player")
    )
    pnr_secondary_mult = max(
        1.0,
        1.0
        + c["pnr_screener_secondary_scale"]
        * (tier_value(skills, "spot_up_shooter") + tier_value(skills, "passer")),
    )
    raw_pnr_screener = tier_value(skills, "pnr_finisher") * pnr_secondary_mult + tier_value(
        skills,
        "screen_setter",
    )
    passer_transition_mult = max(
        1.0,
        1.0 + c["transition_passer_scale"] * tier_value(skills, "passer"),
    )
    raw_transition = (
        tier_value(skills, "transition_threat") * passer_transition_mult
        + c["transition_high_flyer"] * tier_value(skills, "high_flyer")
        + c["transition_driver"] * tier_value(skills, "driver")
        + c["transition_spot_up"] * tier_value(skills, "spot_up_shooter")
    )

    # Step 4: off-ball impact references raw spacing and raw finishing.
    cutting_finishing_mult = max(1.0, 1.0 + c["off_ball_finishing_scale"] * raw_finishing)
    raw_off_ball_impact = (
        raw_spacing
        + tier_value(skills, "cutter") * cutting_finishing_mult
        + tier_value(skills, "passer")
    )

    # Step 5: shot creation references raw spacing and raw paint touch.
    raw_shot_creation = (
        tier_value(skills, "pnr_ball_handler")
        + tier_value(skills, "passer")
        + tier_value(skills, "off_dribble_shooter")
        + tier_value(skills, "isolation_scorer")
        + c["shot_creation_spacing"] * raw_spacing
        + raw_paint_touch
    )

    return {
        "spacing": raw_spacing,
        "finishing": raw_finishing,
        "paint_touch": raw_paint_touch,
        "anchor": raw_anchor,
        "post_game": raw_post_game,
        "pnr_screener": raw_pnr_screener,
        "off_ball_impact": raw_off_ball_impact,
        "shot_creation": raw_shot_creation,
        "rebounding": raw_rebounding,
        "transition": raw_transition,
    }


def _percentile_normalize(raw: float, distribution: list[float]) -> float:
    """Hybrid percentile normalization from the implementation spec."""
    if not distribution or raw <= 0:
        return 0.0

    sorted_distribution = sorted(distribution)
    n = len(sorted_distribution)
    below = sum(1 for value in sorted_distribution if value < raw)
    equal = sum(1 for value in sorted_distribution if value == raw)
    percentile = (below + equal / 2) / n

    breakpoint = NORMALIZATION_BREAKPOINT_PERCENTILE
    breakpoint_score = NORMALIZATION_BREAKPOINT_SCORE
    p_break_index = int(n * breakpoint)
    p_break_value = sorted_distribution[min(p_break_index, n - 1)]
    empirical_max = sorted_distribution[-1]

    if percentile <= breakpoint:
        result = percentile / breakpoint * breakpoint_score
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
            {name: sorted(values) for name, values in distributions.items()}
        )


def clear_distributions() -> None:
    """Clear cached distributions so normalization falls back to theoretical max."""
    set_distributions(None)


def normalize_composites(raw: dict[str, float]) -> dict[str, float]:
    """Normalize raw composites to 0.0-10.0 using cache or theoretical fallback."""
    using_percentiles = all(
        len(COMPOSITE_DISTRIBUTIONS.get(name, [])) >= MIN_DISTRIBUTION_SIZE
        for name in raw
    )
    if using_percentiles:
        return {
            name: _percentile_normalize(value, COMPOSITE_DISTRIBUTIONS.get(name, []))
            for name, value in raw.items()
        }

    return {
        name: round(min(10.0, value / THEORETICAL_MAX[name] * 10.0), 1)
        for name, value in raw.items()
    }


def _extract_skills(profile: dict[str, Any]) -> dict[str, str]:
    """Extract tier strings from a skill profile JSON blob."""
    return {
        skill: data.get("final_tier", "None") if isinstance(data, dict) else data
        for skill, data in profile.items()
    }


def build_distributions(season: str) -> dict[str, list[float]]:
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
        raw = compute_raw_composites(skills)
        for name, value in raw.items():
            all_raw[name].append(value)

    legend_profiles = _run_query(
        lambda: client.table("skill_profiles")
        .select("profile")
        .eq("source", "composite")
        .eq("is_legend", True)
        .execute()
    )
    for row in legend_profiles.data:
        skills = _with_default_skills(_extract_skills(row["profile"]))
        raw = compute_raw_composites(skills)
        for name, value in raw.items():
            all_raw[name].append(value)

    distributions = {name: sorted(values) for name, values in all_raw.items()}
    set_distributions(distributions)
    return distributions


def compute_player_composites(
    skills: dict[str, str | float],
    player_id: str,
    name: str,
    height_inches: int | None = None,
) -> PlayerComposites:
    """Compute normalized composites and bell parameters for one player."""
    raw = compute_raw_composites(skills)
    normalized = normalize_composites(raw)

    # A missing height should not break partial roster previews; the midpoint
    # keeps the dataclass complete until the API provides real player height.
    bell = compute_bell_params(
        {key: str(value) for key, value in skills.items() if not isinstance(value, int | float)},
        height_inches if height_inches is not None else 78,
    )

    return PlayerComposites(
        player_id=player_id,
        name=name,
        spacing=normalized["spacing"],
        finishing=normalized["finishing"],
        paint_touch=normalized["paint_touch"],
        anchor=normalized["anchor"],
        post_game=normalized["post_game"],
        pnr_screener=normalized["pnr_screener"],
        off_ball_impact=normalized["off_ball_impact"],
        shot_creation=normalized["shot_creation"],
        rebounding=normalized["rebounding"],
        transition=normalized["transition"],
        bell_amplitude=float(bell["amplitude"]),
        bell_peak=int(bell["peak_center"]),
        bell_range_down=int(bell["range_down"]),
        bell_range_up=int(bell["range_up"]),
        bell_flat_down=int(bell["flat_top_down"]),
        bell_flat_up=int(bell["flat_top_up"]),
    )
