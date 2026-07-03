"""
Player composite mechanics for the cohesion engine.

This module extracts the validated prototype formulas into production code.
Raw composites use tier values directly, dependent formulas reference raw
sub-composites, and normalization happens once at the end.

Boundary: this module is pure mechanics — raw composite math, building
distributions from an explicitly supplied Snapshot Release id, and percentile
normalization against an explicitly supplied distributions mapping. The cache
flip policy (the (season, release_id) key, staleness checks, the draft-pin
guard, and the clear/ensure entry points) lives in
services.snapshot_versions.distribution_cache, which imports this module —
never the reverse.
"""

from __future__ import annotations

import logging
from typing import Any, Mapping

from services.skills import ALL_SKILLS

from .bell_curve import compute_bell_params
from .types import PlayerComposites
from .weights import (
    COMPOSITE_NAMES,
    MIN_DISTRIBUTION_SIZE,
)

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
    player profiles use tier strings; both inputs are supported.
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

    When ``values["composite_formulas"]`` exists, delegates to the declarative
    formula engine. Otherwise falls back to the hardcoded logic below.

    Args:
        skills: Player skill map (tier strings or pre-boosted floats).
        values: The ``engine.version.values`` dict from the active Evaluation Version.
    """
    # Capture key-presence BEFORE default-fill: a skill rated "None" is present
    # (rated careless — no proxy), a key-absent skill (unbackfilled Legend) is
    # not. _with_default_skills erases this distinction, so it must be taken here.
    present_keys = set(skills.keys())

    composite_formulas = values.get("composite_formulas")
    if composite_formulas:
        from .formula_engine import compute_raw_from_formulas

        return compute_raw_from_formulas(
            skills, composite_formulas, values["tier_values"],
            present_keys=present_keys,
        )

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
    raw_finishing = c.get("finishing_crafty_weight", 1.0) * _tv("crafty_finisher") + _tv("high_flyer")
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
    # Floor changed 1.0 → 0.9: non-finishers who generate paint touches they
    # can't convert are penalized (research-backed). Formula matches the declarative
    # engine convention: max(floor, floor + scale * source), so floor=0.9 means
    # a zero-finishing player multiplies paint touch by 0.9 (10% penalty).
    finishing_mult = max(0.9, 0.9 + c["paint_touch_finishing_scale"] * raw_finishing)
    raw_paint_touch = finishing_mult * (
        _tv("driver")
        + c["paint_touch_vertical_spacer"] * _tv("vertical_spacer")
        + _tv("low_post_player")
        + c["paint_touch_mid_post"] * _tv("mid_post_player")
        + c.get("paint_touch_oreb", 0.0) * _tv("offensive_rebounder")
    )

    # Step 3: independent composites (post game, PnR screener, transition, ball security).
    # ball_security reads the possession_protector skill when the raw profile carries
    # the key (even at tier "None" — rated careless is NOT proxied); the legacy
    # 3-skill proxy (passer / pnr_handler / driver) fires only for key-absent
    # profiles (unbackfilled Legends). Mirrors the formula engine's fallback.
    if "possession_protector" in present_keys:
        raw_ball_security = _tv("possession_protector")
    else:
        raw_ball_security = (
            _tv("passer")
            + c.get("ball_security_pnr_handler", 0.0) * _tv("pnr_ball_handler")
            + c.get("ball_security_driver", 0.0) * _tv("driver")
        )
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
    # transition: drop multiplicative passer amplifier (was double-counting vs synergies).
    # Replaces passer_mult with flat additive term. Fixes latent bug where a great
    # outlet-passer with no transition_threat contributed zero transition value.
    raw_transition = (
        _tv("transition_threat")
        + c["transition_high_flyer"] * _tv("high_flyer")
        + c["transition_driver"] * _tv("driver")
        + c["transition_spot_up"] * _tv("spot_up_shooter")
        + c.get("transition_off_dribble", 0.0) * _tv("off_dribble_shooter")
        + c.get("transition_passer", 0.0) * _tv("passer")
    )

    # Step 4: off-ball impact references raw spacing and raw finishing.
    # Two new additive terms added: movement_shooter gravity and screen_setter off-screen actions.
    cutting_finishing_mult = max(1.0, 1.0 + c["off_ball_finishing_scale"] * raw_finishing)
    raw_off_ball_impact = (
        raw_spacing
        + c.get("off_ball_movement_bonus", 0.0) * _tv("movement_shooter")
        + c.get("off_ball_screen_setter", 0.0) * _tv("screen_setter")
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
    # isolation_scorer now uses an explicit coefficient (was implicit 1.0) for API tunability.
    raw_shot_creation = (
        c["shot_creation_pnr_orchestration"] * raw_pnr_orchestration
        + c["shot_creation_passer"] * _tv("passer")
        + c["shot_creation_off_dribble"] * _tv("off_dribble_shooter")
        + c.get("shot_creation_iso", 1.0) * _tv("isolation_scorer")
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


def distributions_ready(distributions: Mapping[str, list[float]] | None) -> bool:
    """Return True when every composite has enough distribution values."""
    if not distributions:
        return False
    return all(
        len(distributions.get(name, [])) >= MIN_DISTRIBUTION_SIZE
        for name in COMPOSITE_NAMES
    )


def normalize_composites(
    raw: dict[str, float],
    values: dict[str, Any],
    distributions: Mapping[str, list[float]] | None = None,
) -> dict[str, float]:
    """Normalize raw composites to 0.0-10.0.

    Uses percentile normalization against the supplied distributions when they
    are ready, theoretical-max fallback otherwise. Callers normalizing against
    the production cache grab one immutable state via
    services.snapshot_versions.distribution_cache.get_state() and pass its
    distributions here — one read per evaluation, so a concurrent release flip
    cannot tear the computation.
    """
    theoretical_max = values["theoretical_max"]
    breakpoint_percentile = values["normalization_breakpoint_percentile"]
    breakpoint_score = values["normalization_breakpoint_score"]

    if distributions_ready(distributions):
        assert distributions is not None
        return {
            name: _percentile_normalize(
                value, distributions.get(name, []),
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


def build_distributions(
    season: str, values: dict[str, Any], release_id: str
) -> dict[str, list[float]]:
    """
    Build raw composite distributions for a Snapshot Release's players + legends.

    Pure mechanics: the release id is supplied by the caller (the cache policy
    in services.snapshot_versions.distribution_cache resolves the active
    release and owns the swap into the cache) and no module state is mutated
    here.

    After M3 (#50): reads from released_players (the table formerly named
    snapshot_players) for the given Snapshot Release instead of live
    skill_profiles, so production normalization is stable against a known,
    immutable snapshot. Both regular-player and legend profiles are sourced
    from the skill_profile_snapshot column — the publish RPC freezes legends
    into released_players, superseding the original plan to keep reading
    legends from live skill_profiles.

    If fewer than MIN_DISTRIBUTION_SIZE player profiles exist, callers will still
    receive the small distribution, but normalization falls back to theoretical
    maxima until the cache has enough population data.
    """
    logger.info(
        "Building composite distributions for season %s, release %s", season, release_id
    )

    client = _get_supabase_client()
    all_raw: dict[str, list[float]] = {name: [] for name in COMPOSITE_NAMES}

    # Regular players — source_player_id is non-null, is_legend=false
    profiles = _run_query(
        lambda: client.table("released_players")
        .select("skill_profile_snapshot")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", False)
        .execute()
    )
    for row in profiles.data:
        # No default-fill here: compute_raw_composites fills defaults itself and
        # must see raw key-absence to route ball_security's legend proxy fallback.
        skills = _extract_skills(row["skill_profile_snapshot"] or {})
        raw = compute_raw_composites(skills, values)
        for name, value in raw.items():
            all_raw[name].append(value)

    # Legends — is_legend=true; composite already frozen at publish
    legend_profiles = _run_query(
        lambda: client.table("released_players")
        .select("skill_profile_snapshot")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", True)
        .execute()
    )
    for row in legend_profiles.data:
        skills = _extract_skills(row["skill_profile_snapshot"] or {})
        raw = compute_raw_composites(skills, values)
        for name, value in raw.items():
            all_raw[name].append(value)

    return {name: sorted(vals) for name, vals in all_raw.items()}


def compute_player_composites(
    skills: dict[str, str | float],
    player_id: str,
    name: str,
    values: dict[str, Any],
    height_inches: int | None = None,
    distributions: Mapping[str, list[float]] | None = None,
) -> PlayerComposites:
    """Compute normalized composites and bell parameters for one player.

    distributions: percentile-normalization population, usually one atomic
    read of distribution_cache.get_state().distributions taken by the caller
    for the whole evaluation. None falls back to theoretical maxima.
    """
    raw = compute_raw_composites(skills, values)
    normalized = normalize_composites(raw, values, distributions)

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
