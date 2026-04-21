"""
roster_evaluator/optionality.py — Optionality and Robustness scoring.

compute_optionality: measures lineup flexibility (3 components, weighted composite)
compute_robustness:  measures depth and consistency (2 components, weighted composite)

Both return scores in [0, 100]. Inputs are normalized supporting player lists
(slot=1–9, is_cornerstone=False) and the cornerstone player dict.
"""

from __future__ import annotations

from .weights import TIER_VALUES, REDUNDANCY_RANGES


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _has_skill(player: dict, skill: str, min_tier: str = "Capable") -> bool:
    """Return True if the player has at least min_tier in the given skill."""
    tier_str = player.get("skills", {}).get(skill, "None")
    return TIER_VALUES.get(tier_str, 0) >= TIER_VALUES.get(min_tier, 1)


def _tier_value(player: dict, skill: str) -> int:
    """Return the numeric TIER_VALUES for a skill on a player (0 if absent)."""
    tier_str = player.get("skills", {}).get(skill, "None")
    return TIER_VALUES.get(tier_str, 0)


# Off-ball skills — used for flexibility scoring
_OFF_BALL_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter", "movement_shooter", "cutter", "pnr_finisher",
    "vertical_spacer", "screen_setter", "offensive_rebounder", "transition_threat",
})

# Defensive skills — used for versatility scoring
_DEFENSIVE_SKILLS: frozenset[str] = frozenset({
    "versatile_defender", "rim_protector", "perimeter_disruptor",
})

# Creation skills — used for weakness consistency assessment
_CREATION_SKILLS: frozenset[str] = frozenset({
    "pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player",
})

# Spacing skills
_SPACING_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter", "movement_shooter",
})


# ---------------------------------------------------------------------------
# compute_optionality
# ---------------------------------------------------------------------------

def compute_optionality(
    supporting_players: list[dict],
    cornerstone: dict,
    slot_weights: dict[int, float],
) -> float:
    """
    Compute optionality score (0–100) from three components:
      - Component 1: Skill Redundancy (weight 0.40) — healthy coverage across critical skills
      - Component 2: On/Off-Ball Flexibility (weight 0.35) — proportion with off-ball skills
      - Component 3: Defensive Versatility (weight 0.25) — matchup coverage breadth
    """
    if not supporting_players:
        return 0.0

    comp1 = _skill_redundancy(supporting_players)
    comp2 = _offball_flexibility(supporting_players, cornerstone)
    comp3 = _defensive_versatility(supporting_players, cornerstone)

    score = 0.40 * comp1 + 0.35 * comp2 + 0.25 * comp3
    return max(0.0, min(100.0, score))


def _skill_redundancy(supporting_players: list[dict]) -> float:
    """
    Component 1: Score based on how well critical skills are covered by healthy redundancy.
    For each skill: 100 if count in [min, ceiling], scaled down otherwise.
    """
    if not supporting_players:
        return 0.0

    scores: list[float] = []
    for skill, (min_count, ceiling) in REDUNDANCY_RANGES.items():
        count = sum(1 for p in supporting_players if _has_skill(p, skill))
        if count == 0:
            # Complete gap — 0 for this skill
            scores.append(0.0)
        elif count < min_count:
            # Below minimum — partial score
            scores.append(50.0 * (count / min_count))
        elif count <= ceiling:
            # In healthy range — full score
            scores.append(100.0)
        else:
            # Over-stacked — diminishing returns penalty
            excess = count - ceiling
            penalty = min(40.0, excess * 15.0)
            scores.append(max(40.0, 100.0 - penalty))

    return sum(scores) / len(scores) if scores else 0.0


def _offball_flexibility(
    supporting_players: list[dict],
    cornerstone: dict,
) -> float:
    """
    Component 2: Proportion of supporting players with at least one viable off-ball skill.
    Adjusted downward based on cornerstone's on-ball dominance.
    """
    if not supporting_players:
        return 0.0

    with_offball = sum(
        1 for p in supporting_players
        if any(_has_skill(p, s) for s in _OFF_BALL_SKILLS)
    )
    base_score = (with_offball / len(supporting_players)) * 100.0

    # Adjust for cornerstone's on-ball dominance
    # Elite+ on-ball cornerstone raises the minimum off-ball support requirement
    cs_on_ball_tier = max(
        _tier_value(cornerstone, s)
        for s in ("pnr_ball_handler", "driver", "isolation_scorer")
    )
    if cs_on_ball_tier >= TIER_VALUES["Elite"]:
        # Need more off-ball support — penalty if score is low
        base_score = max(0.0, base_score - 10.0) if base_score < 60.0 else base_score

    return max(0.0, min(100.0, base_score))


def _defensive_versatility(
    supporting_players: list[dict],
    cornerstone: dict,
) -> float:
    """
    Component 3: Score based on how many distinct defensive matchup types are covered.
    Estimates from: versatile defender count, rim protector presence, height distribution, high flyers.
    """
    if not supporting_players:
        return 0.0

    all_players = [cornerstone] + supporting_players
    versatile_count = sum(1 for p in supporting_players if _has_skill(p, "versatile_defender"))
    has_rim = any(_has_skill(p, "rim_protector") for p in all_players)
    perimeter_count = sum(1 for p in supporting_players if _has_skill(p, "perimeter_disruptor"))
    high_flyer_count = sum(1 for p in supporting_players if _has_skill(p, "high_flyer"))

    # Score each component
    versatile_score = min(100.0, versatile_count * 25.0)  # 4 versatile defenders = 100
    rim_bonus = 25.0 if has_rim else 0.0
    perimeter_bonus = min(25.0, perimeter_count * 12.5)
    athleticism_bonus = min(15.0, high_flyer_count * 7.5)

    raw = versatile_score * 0.4 + rim_bonus + perimeter_bonus + athleticism_bonus
    return max(0.0, min(100.0, raw))


# ---------------------------------------------------------------------------
# compute_robustness
# ---------------------------------------------------------------------------

def compute_robustness(
    supporting_players: list[dict],
    slot_weights: dict[int, float],
) -> float:
    """
    Compute robustness score (0–100) from two components:
      - Component 1: Depth Robustness (weight 0.55) — skill coverage not concentrated in one player
      - Component 2: Weakness Consistency (weight 0.45) — structural vs. situational weaknesses
    """
    if not supporting_players:
        return 0.0

    comp1 = _depth_robustness(supporting_players, slot_weights)
    comp2 = _weakness_consistency(supporting_players)

    score = 0.55 * comp1 + 0.45 * comp2
    return max(0.0, min(100.0, score))


def _depth_robustness(
    supporting_players: list[dict],
    slot_weights: dict[int, float],
) -> float:
    """
    Component 1: Penalize rosters where one high-slot player provides most of a critical skill's coverage.
    High concentration (>70% of coverage from top provider) = fragile.
    Low concentration (<40%) = distributed and resilient.
    """
    if not supporting_players:
        return 0.0

    distribution_scores: list[float] = []

    for skill in REDUNDANCY_RANGES:
        # Get all players with this skill and their slot-weighted contributions
        providers = [
            (p, slot_weights.get(p.get("slot", 9), 0.05))
            for p in supporting_players
            if _has_skill(p, skill)
        ]
        if len(providers) < 2:
            # Only 0 or 1 provider — distribution score depends on whether there's at least one
            distribution_scores.append(30.0 if len(providers) == 1 else 0.0)
            continue

        total_weight = sum(w for _, w in providers)
        if total_weight == 0:
            distribution_scores.append(50.0)
            continue

        top_share = max(w for _, w in providers) / total_weight
        if top_share > 0.70:
            # Fragile — one player provides most of it
            distribution_scores.append(max(0.0, 100.0 - (top_share - 0.70) * 200))
        elif top_share < 0.40:
            # Well-distributed
            distribution_scores.append(100.0)
        else:
            # Middle ground — linear interpolation
            distribution_scores.append(100.0 - (top_share - 0.40) * 200)

    return sum(distribution_scores) / len(distribution_scores) if distribution_scores else 0.0


def _weakness_consistency(supporting_players: list[dict]) -> float:
    """
    Component 2: Measures whether the weakest dimension is structural or situational.
    Checks how many supporting players contribute to each key dimension.
    Low contributor count relative to roster size = structural weakness → lower score.
    """
    if not supporting_players:
        return 0.0

    n = len(supporting_players)

    # Count contributors per dimension
    spacing_contributors = sum(
        1 for p in supporting_players
        if any(_has_skill(p, s) for s in _SPACING_SKILLS)
    )
    creation_contributors = sum(
        1 for p in supporting_players
        if any(_has_skill(p, s) for s in _CREATION_SKILLS)
    )
    defense_contributors = sum(
        1 for p in supporting_players
        if any(_has_skill(p, s) for s in _DEFENSIVE_SKILLS)
    )

    # Each contributor ratio: what fraction of the rotation contributes to this dimension
    ratios = [
        spacing_contributors / n,
        creation_contributors / n,
        defense_contributors / n,
    ]

    # Worst dimension ratio — structural weakness if it's very low
    min_ratio = min(ratios)
    avg_ratio = sum(ratios) / len(ratios)

    # Score based on the floor (avoid catastrophic structural holes)
    floor_score = min_ratio * 100.0
    avg_score = avg_ratio * 100.0

    # Weight the floor heavily — consistent structural weakness is more damaging
    return max(0.0, min(100.0, 0.6 * floor_score + 0.4 * avg_score))
