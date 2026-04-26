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
from .weights import (
    OFF_13_RAW_SPACING_THRESHOLD,
    SYNERGY_CREATOR_THRESHOLD,
    SYNERGY_PENALTY_SEVERITY,
    SYNERGY_SCALE_FACTORS,
)


def _skill(player: dict[str, Any], skill: str) -> float:
    """Read a player's skill as a numeric tier value."""
    return tier_value(player.get("skills", {}), skill)


def _copy_lineup_with_numeric_skills(lineup: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Copy players so effective skill changes never mutate caller data."""
    return deepcopy(lineup)


def _boost(player: dict[str, Any], skill: str, scale: float, provider_value: float) -> None:
    """Apply a bounded tier-scaled boost to one effective skill value."""
    skills = player.setdefault("skills", {})
    base = tier_value(skills, skill)
    skills[skill] = base * (1 + scale * provider_value)


def _penalize(player: dict[str, Any], skill: str, scale: float) -> None:
    """Apply a bounded penalty to one effective skill value."""
    skills = player.setdefault("skills", {})
    base = tier_value(skills, skill)
    skills[skill] = base / (1 + scale * SYNERGY_PENALTY_SEVERITY)


def _raw_lineup_spacing(lineup: list[dict[str, Any]]) -> float:
    """Quick pre-composite spacing estimate used by OFF-13."""
    return sum(_skill(player, "movement_shooter") + _skill(player, "spot_up_shooter") for player in lineup)


def apply_synergies(lineup: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Apply all Phase 3 lineup synergies.

    Returns copied players with effective numeric skills plus a de-duplicated
    list of synergy IDs that fired.
    """
    boosted = _copy_lineup_with_numeric_skills(lineup)
    fired: list[str] = []

    def fire(synergy_id: str) -> None:
        if synergy_id not in fired:
            fired.append(synergy_id)

    screeners = [i for i, player in enumerate(lineup) if _skill(player, "screen_setter") > 0]
    movement_shooters = [i for i, player in enumerate(lineup) if _skill(player, "movement_shooter") > 0]
    cutters = [i for i, player in enumerate(lineup) if _skill(player, "cutter") > 0]
    passers = [i for i, player in enumerate(lineup) if _skill(player, "passer") > 0]
    drivers = [i for i, player in enumerate(lineup) if _skill(player, "driver") > 0]
    vertical_spacers = [i for i, player in enumerate(lineup) if _skill(player, "vertical_spacer") > 0]
    handlers = [i for i, player in enumerate(lineup) if _skill(player, "pnr_ball_handler") > 0]
    finishers = [i for i, player in enumerate(lineup) if _skill(player, "pnr_finisher") > 0]
    transition_threats = [i for i, player in enumerate(lineup) if _skill(player, "transition_threat") > 0]
    high_flyers = [i for i, player in enumerate(lineup) if _skill(player, "high_flyer") > 0]
    creators = [
        i
        for i, player in enumerate(lineup)
        if _skill(player, "pnr_ball_handler")
        + _skill(player, "driver")
        + _skill(player, "isolation_scorer")
        + _skill(player, "passer")
        >= SYNERGY_CREATOR_THRESHOLD
    ]

    if screeners and movement_shooters:
        for shooter in movement_shooters:
            providers = [i for i in screeners if i != shooter]
            if providers:
                provider_value = max(_skill(lineup[i], "screen_setter") for i in providers)
                _boost(boosted[shooter], "movement_shooter", SYNERGY_SCALE_FACTORS["OFF-02"], provider_value)
                fire("OFF-02")
    elif movement_shooters:
        for shooter in movement_shooters:
            _penalize(boosted[shooter], "movement_shooter", SYNERGY_SCALE_FACTORS["OFF-03"])
        fire("OFF-03")

    if screeners and cutters:
        for cutter in cutters:
            providers = [i for i in screeners if i != cutter]
            if providers:
                provider_value = max(_skill(lineup[i], "screen_setter") for i in providers)
                _boost(boosted[cutter], "cutter", SYNERGY_SCALE_FACTORS["OFF-04"], provider_value)
                fire("OFF-04")

    if cutters and not passers:
        for cutter in cutters:
            _penalize(boosted[cutter], "cutter", SYNERGY_SCALE_FACTORS["OFF-12"])
        fire("OFF-12")

    if cutters and _raw_lineup_spacing(lineup) < OFF_13_RAW_SPACING_THRESHOLD:
        for cutter in cutters:
            _penalize(boosted[cutter], "cutter", SYNERGY_SCALE_FACTORS["OFF-13"])
        fire("OFF-13")

    if cutters and creators:
        for cutter in cutters:
            providers = [i for i in creators if i != cutter]
            if providers:
                provider_value = max(
                    _skill(lineup[i], "pnr_ball_handler")
                    + _skill(lineup[i], "driver")
                    + _skill(lineup[i], "isolation_scorer")
                    + _skill(lineup[i], "passer")
                    for i in providers
                )
                _boost(boosted[cutter], "cutter", SYNERGY_SCALE_FACTORS["OFF-14"], provider_value)
                fire("OFF-14")

    if vertical_spacers and not (passers or drivers):
        for spacer in vertical_spacers:
            _penalize(boosted[spacer], "vertical_spacer", SYNERGY_SCALE_FACTORS["OFF-15"])
        fire("OFF-15")

    if vertical_spacers and (passers or drivers):
        provider_pool = passers + drivers
        for spacer in vertical_spacers:
            providers = [i for i in provider_pool if i != spacer]
            if providers:
                provider_value = max(_skill(lineup[i], "passer") + _skill(lineup[i], "driver") for i in providers)
                _boost(boosted[spacer], "vertical_spacer", SYNERGY_SCALE_FACTORS["OFF-16"], provider_value)
                fire("OFF-16")

    if handlers and finishers:
        for handler in handlers:
            providers = [i for i in finishers if i != handler]
            if providers:
                provider_value = max(_skill(lineup[i], "pnr_finisher") for i in providers)
                _boost(boosted[handler], "pnr_ball_handler", SYNERGY_SCALE_FACTORS["OFF-28"], provider_value)
                fire("OFF-28")
        for finisher in finishers:
            providers = [i for i in handlers if i != finisher]
            if providers:
                provider_value = max(_skill(lineup[i], "pnr_ball_handler") for i in providers)
                _boost(boosted[finisher], "pnr_finisher", SYNERGY_SCALE_FACTORS["OFF-28"], provider_value)
                fire("OFF-28")

    if transition_threats and passers:
        for threat in transition_threats:
            providers = [i for i in passers if i != threat]
            if providers:
                provider_value = max(_skill(lineup[i], "passer") for i in providers)
                _boost(boosted[threat], "transition_threat", SYNERGY_SCALE_FACTORS["OFF-31"], provider_value)
                fire("OFF-31")

    if high_flyers and transition_threats and passers:
        provider_pool = transition_threats + passers
        for flyer in high_flyers:
            providers = [i for i in provider_pool if i != flyer]
            if providers:
                provider_value = max(_skill(lineup[i], "transition_threat") + _skill(lineup[i], "passer") for i in providers)
                _boost(boosted[flyer], "high_flyer", SYNERGY_SCALE_FACTORS["OFF-32"], provider_value)
                fire("OFF-32")

    if len(passers) == 1:
        fire("OFF-37")

    return boosted, fired
