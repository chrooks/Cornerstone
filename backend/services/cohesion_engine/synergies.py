"""
Lineup-context skill boosts and penalties.

Synergies operate before composite computation. They change effective skill
values for this lineup only, then `composites.py` turns those adjusted skills
into player composites.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .composites import tier_value


def _skill(player: dict[str, Any], skill: str, tier_values: dict[str, float]) -> float:
    """Read a player's skill as a numeric tier value."""
    return tier_value(player.get("skills", {}), skill, tier_values)


def _copy_lineup_with_numeric_skills(lineup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy players so effective skill changes never mutate caller data."""
    return deepcopy(lineup)


def _boost(
    player: dict[str, Any], skill: str, scale: float, provider_value: float,
    tier_values: dict[str, float],
) -> None:
    """Apply a bounded tier-scaled boost to one effective skill value."""
    skills = player.setdefault("skills", {})
    base = tier_value(skills, skill, tier_values)
    skills[skill] = base * (1 + scale * provider_value)


def _penalize(
    player: dict[str, Any], skill: str, scale: float,
    tier_values: dict[str, float], synergy_penalty_severity: float,
) -> None:
    """Apply a bounded penalty to one effective skill value."""
    skills = player.setdefault("skills", {})
    base = tier_value(skills, skill, tier_values)
    skills[skill] = base / (1 + scale * synergy_penalty_severity)


def _raw_lineup_spacing(lineup: list[dict[str, Any]], tier_values: dict[str, float]) -> float:
    """Quick pre-composite spacing estimate used by OFF-13."""
    return sum(
        _skill(player, "movement_shooter", tier_values)
        + _skill(player, "spot_up_shooter", tier_values)
        for player in lineup
    )


def apply_synergies(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Apply all Phase 3 lineup synergies.

    Returns copied players with effective numeric skills plus a de-duplicated
    list of synergy IDs that fired.
    """
    tv: dict[str, float] = values["tier_values"]
    scale_factors: dict[str, float] = values["synergy_scale_factors"]
    penalty_severity: float = values["synergy_penalty_severity"]
    creator_threshold: float = values["synergy_creator_threshold"]
    off_13_spacing_threshold: float = values["off_13_raw_spacing_threshold"]

    boosted = _copy_lineup_with_numeric_skills(lineup)
    fired: list[str] = []

    def fire(synergy_id: str) -> None:
        if synergy_id not in fired:
            fired.append(synergy_id)

    screeners = [i for i, player in enumerate(lineup) if _skill(player, "screen_setter", tv) > 0]
    movement_shooters = [i for i, player in enumerate(lineup) if _skill(player, "movement_shooter", tv) > 0]
    cutters = [i for i, player in enumerate(lineup) if _skill(player, "cutter", tv) > 0]
    passers = [i for i, player in enumerate(lineup) if _skill(player, "passer", tv) > 0]
    drivers = [i for i, player in enumerate(lineup) if _skill(player, "driver", tv) > 0]
    vertical_spacers = [i for i, player in enumerate(lineup) if _skill(player, "vertical_spacer", tv) > 0]
    transition_threats = [i for i, player in enumerate(lineup) if _skill(player, "transition_threat", tv) > 0]
    high_flyers = [i for i, player in enumerate(lineup) if _skill(player, "high_flyer", tv) > 0]
    creators = [
        i
        for i, player in enumerate(lineup)
        if _skill(player, "pnr_ball_handler", tv)
        + _skill(player, "driver", tv)
        + _skill(player, "isolation_scorer", tv)
        + _skill(player, "passer", tv)
        >= creator_threshold
    ]

    if screeners and movement_shooters:
        for shooter in movement_shooters:
            providers = [i for i in screeners if i != shooter]
            if providers:
                provider_value = max(_skill(lineup[i], "screen_setter", tv) for i in providers)
                _boost(boosted[shooter], "movement_shooter", scale_factors["OFF-02"], provider_value, tv)
                fire("OFF-02")
    elif movement_shooters:
        for shooter in movement_shooters:
            _penalize(boosted[shooter], "movement_shooter", scale_factors["OFF-03"], tv, penalty_severity)
        fire("OFF-03")

    if screeners and cutters:
        for cutter in cutters:
            providers = [i for i in screeners if i != cutter]
            if providers:
                provider_value = max(_skill(lineup[i], "screen_setter", tv) for i in providers)
                _boost(boosted[cutter], "cutter", scale_factors["OFF-04"], provider_value, tv)
                fire("OFF-04")

    if cutters and not passers:
        for cutter in cutters:
            _penalize(boosted[cutter], "cutter", scale_factors["OFF-12"], tv, penalty_severity)
        fire("OFF-12")

    if cutters and _raw_lineup_spacing(lineup, tv) < off_13_spacing_threshold:
        for cutter in cutters:
            _penalize(boosted[cutter], "cutter", scale_factors["OFF-13"], tv, penalty_severity)
        fire("OFF-13")

    if cutters and creators:
        for cutter in cutters:
            providers = [i for i in creators if i != cutter]
            if providers:
                provider_value = max(
                    _skill(lineup[i], "pnr_ball_handler", tv)
                    + _skill(lineup[i], "driver", tv)
                    + _skill(lineup[i], "isolation_scorer", tv)
                    + _skill(lineup[i], "passer", tv)
                    for i in providers
                )
                _boost(boosted[cutter], "cutter", scale_factors["OFF-14"], provider_value, tv)
                fire("OFF-14")

    if vertical_spacers and not (passers or drivers):
        for spacer in vertical_spacers:
            _penalize(boosted[spacer], "vertical_spacer", scale_factors["OFF-15"], tv, penalty_severity)
        fire("OFF-15")

    if vertical_spacers and (passers or drivers):
        provider_pool = passers + drivers
        for spacer in vertical_spacers:
            providers = [i for i in provider_pool if i != spacer]
            if providers:
                provider_value = max(
                    _skill(lineup[i], "passer", tv) + _skill(lineup[i], "driver", tv)
                    for i in providers
                )
                _boost(boosted[spacer], "vertical_spacer", scale_factors["OFF-16"], provider_value, tv)
                fire("OFF-16")

    if transition_threats and passers:
        for threat in transition_threats:
            providers = [i for i in passers if i != threat]
            if providers:
                provider_value = max(_skill(lineup[i], "passer", tv) for i in providers)
                _boost(boosted[threat], "transition_threat", scale_factors["OFF-31"], provider_value, tv)
                fire("OFF-31")

    if high_flyers and transition_threats and passers:
        provider_pool = transition_threats + passers
        for flyer in high_flyers:
            providers = [i for i in provider_pool if i != flyer]
            if providers:
                provider_value = max(
                    _skill(lineup[i], "transition_threat", tv) + _skill(lineup[i], "passer", tv)
                    for i in providers
                )
                _boost(boosted[flyer], "high_flyer", scale_factors["OFF-32"], provider_value, tv)
                fire("OFF-32")

    if len(passers) == 1:
        fire("OFF-37")

    return boosted, fired
