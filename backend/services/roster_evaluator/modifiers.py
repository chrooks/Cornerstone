"""
roster_evaluator/modifiers.py — All 33 Layer 3 interaction modifier functions.

Each modifier: check_XYZ(players, agg, cornerstone, weights) -> tuple[float, str, str] | None
  Returns (delta, narrative, dimension) if the modifier fires, None if it does not.
  - delta     : additive point change to apply to the dimension score (from weights.MODIFIER_DELTAS)
  - narrative : user-facing GM note text (never hardcoded outside the function)
  - dimension : which dimension score to apply the delta to

Modifier types (stored as function attributes):
  presence_type = "presence"  — fires based on what IS on the roster
  presence_type = "absence"   — fires based on what is MISSING

Synergy rule: any modifier that implies a two-player interaction must confirm that
qualifying skills exist on DISTINCT players (not both on the same player).

All delta magnitudes come from weights.MODIFIER_DELTAS — no magic numbers here.
"""

from __future__ import annotations

from .weights import TIER_VALUES


# ---------------------------------------------------------------------------
# Skill category sets — used across multiple modifiers
# ---------------------------------------------------------------------------

# Skills that create on-ball threat (force the defense to guard the ball handler)
_ON_BALL_SKILLS: frozenset[str] = frozenset({
    "pnr_ball_handler", "driver", "isolation_scorer", "mid_post_player", "low_post_player",
})

# Skills that provide off-ball value (help without the ball)
_OFF_BALL_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter", "movement_shooter", "cutter", "pnr_finisher",
    "vertical_spacer", "screen_setter", "offensive_rebounder", "transition_threat",
})

# Skills that produce defensive value
_DEFENSIVE_SKILLS: frozenset[str] = frozenset({
    "versatile_defender", "rim_protector", "perimeter_disruptor", "rebounder",
})

# Skills that count as a shooting skill (for spacing checks)
_SHOOTING_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter", "movement_shooter", "off_dribble_shooter",
})

# Skills that act as "gravity" in the paint/cutting lane
_GRAVITY_SKILLS: frozenset[str] = frozenset({
    "driver", "low_post_player", "mid_post_player", "isolation_scorer",
})

# Creation skills checked in HARD-02 / OFF-09
_CREATION_SKILLS: frozenset[str] = frozenset({
    "pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player",
})

# Low spacing threshold (points) for paint-touch spacing penalties
_LOW_SPACING_THRESHOLD = 35.0

# High spacing threshold for imbalance check (OFF-05)
_IMBALANCE_GAP = 30.0


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _tier_value(player: dict, skill: str) -> int:
    """Return the numeric tier value for a skill on a player (0 if absent)."""
    tier_str = player.get("skills", {}).get(skill, "None")
    return TIER_VALUES.get(tier_str, 0)


def _has_skill(player: dict, skill: str, min_tier: str = "Capable") -> bool:
    """Return True if the player has at least min_tier in the given skill."""
    return _tier_value(player, skill) >= TIER_VALUES.get(min_tier, 1)


def _players_with_skill(
    players: list[dict], skill: str, min_tier: str = "Capable"
) -> list[dict]:
    """Return all players with at least min_tier in the given skill."""
    return [p for p in players if _has_skill(p, skill, min_tier)]


def _any_has_skill(
    players: list[dict], skill: str, min_tier: str = "Capable", include: list[dict] | None = None
) -> bool:
    """Return True if any player in `players` (or optionally `include`) has the skill."""
    all_players = players + (include or [])
    return any(_has_skill(p, skill, min_tier) for p in all_players)


def _is_exclusively_onball(player: dict) -> bool:
    """Return True if player has ANY on-ball skill but ZERO off-ball skills."""
    has_onball = any(_has_skill(player, s) for s in _ON_BALL_SKILLS)
    has_offball = any(_has_skill(player, s) for s in _OFF_BALL_SKILLS)
    return has_onball and not has_offball


def _is_twoway(player: dict) -> bool:
    """Return True if player has at least one offensive AND one defensive skill (Capable+)."""
    has_offense = any(
        _has_skill(player, s)
        for s in (_ON_BALL_SKILLS | _OFF_BALL_SKILLS | _SHOOTING_SKILLS)
    )
    has_defense = any(_has_skill(player, s) for s in _DEFENSIVE_SKILLS)
    return has_offense and has_defense


def _is_offensive_blackhole(player: dict) -> bool:
    """
    Return True if the player has None in all offensive skills.
    An offensive black hole stretches the floor against the team (penalties to spacing).
    """
    all_offensive = _ON_BALL_SKILLS | _OFF_BALL_SKILLS | _SHOOTING_SKILLS
    return not any(_has_skill(player, s) for s in all_offensive)


def _parse_height_inches(height: str | None) -> int | None:
    """
    Parse a height string like "6-7" or "6'7" to total inches.
    Returns None if height is missing or unparseable.
    """
    if not height:
        return None
    height = height.strip().replace("'", "-").replace('"', "")
    if "-" in height:
        parts = height.split("-")
        if len(parts) == 2:
            try:
                return int(parts[0]) * 12 + int(parts[1])
            except ValueError:
                return None
    return None


# Average height per positional group (inferred from height ranges)
_ROLE_HEIGHT_AVERAGES: dict[str, int] = {
    "PG": 74,   # 6-2
    "SG": 76,   # 6-4
    "SF": 78,   # 6-6
    "PF": 80,   # 6-8
    "C":  83,   # 6-11
}


def _infer_role_average_height(height_inches: int) -> int:
    """
    Infer the positional average height from the player's actual height.
    Uses simple height bands to approximate the defensive role expectation.
    """
    if height_inches <= 75:
        return _ROLE_HEIGHT_AVERAGES["PG"]
    elif height_inches <= 77:
        return _ROLE_HEIGHT_AVERAGES["SG"]
    elif height_inches <= 79:
        return _ROLE_HEIGHT_AVERAGES["SF"]
    elif height_inches <= 82:
        return _ROLE_HEIGHT_AVERAGES["PF"]
    else:
        return _ROLE_HEIGHT_AVERAGES["C"]


def _synergy_check(players: list[dict], skill_a: str, skill_b: str) -> bool:
    """
    Return True if skill_a and skill_b are present on at least two DISTINCT players.
    A single player with both skills does NOT satisfy the synergy condition.
    """
    players_with_a = {id(p) for p in _players_with_skill(players, skill_a)}
    players_with_b = {id(p) for p in _players_with_skill(players, skill_b)}
    # Synergy fires only if at least one player with A is distinct from at least one with B
    return bool(players_with_a - players_with_b) and bool(players_with_b - players_with_a)


def _delta_to_severity(delta: float) -> str:
    """Derive note severity from the absolute magnitude of the delta."""
    abs_delta = abs(delta)
    if abs_delta > 20:
        return "critical"
    elif abs_delta >= 10:
        return "warning"
    elif delta > 8:
        return "strength"
    else:
        return "tip"


# ---------------------------------------------------------------------------
# DEF modifiers
# ---------------------------------------------------------------------------

def check_DEF_01(players, agg, cornerstone, weights):
    """
    PRESENCE — Rim Protector present → bonus to Defense Score.
    The anchor amplifies the value of every perimeter defender on the roster.
    """
    if not agg.get("has_rim_protector", False):
        return None
    # Only fires if there's also a perimeter or versatile defender to amplify
    if agg.get("perimeter_disruptor_count", 0) == 0 and agg.get("versatile_defender_count", 0) == 0:
        return None
    delta = weights["DEF_01_rim_amplifies_perimeter"]
    return (delta, "Rim anchor amplifies perimeter defenders — defensive switching scheme is viable.", "defense")


check_DEF_01.presence_type = "presence"


def check_DEF_02(players, agg, cornerstone, weights):
    """
    PRESENCE — 2+ Perimeter Disruptors → compounding defensive bonus per additional disruptor.
    The Thunder effect: layering disruptors creates switching nightmares for offenses.
    """
    count = agg.get("perimeter_disruptor_count", 0)
    if count < 2:
        return None
    delta = weights["DEF_02_perimeter_compound_per_player"] * (count - 1)
    return (delta, f"Perimeter disruptors compound ({count} total) — switching pressure multiplies.", "defense")


check_DEF_02.presence_type = "presence"


def check_DEF_03(players, agg, cornerstone, weights):
    """
    PRESENCE — Versatile Defender AND Perimeter Disruptor both present → compound bonus.
    Different defender archetypes covering different threat profiles.
    """
    if agg.get("versatile_defender_count", 0) == 0 or agg.get("perimeter_disruptor_count", 0) == 0:
        return None
    delta = weights["DEF_03_versatile_perimeter_compound"]
    return (delta, "Versatile defenders and perimeter disruptors complement each other.", "defense")


check_DEF_03.presence_type = "presence"


def check_DEF_04(players, agg, cornerstone, weights):
    """
    ABSENCE — No Rim Protector AND 3+ Versatile Defenders → partial mitigation of rim penalty.
    Three versatile defenders can compensate for a missing rim anchor through help rotations.
    """
    if agg.get("has_rim_protector", False):
        return None
    versatile_count = agg.get("versatile_defender_count", 0)
    if versatile_count < 3:
        return None
    delta = weights["DEF_04_no_rim_versatile_mitigation"]
    return (delta, f"No rim anchor, but {versatile_count} versatile defenders partially compensate through rotations.", "defense")


check_DEF_04.presence_type = "absence"


def check_DEF_05(players, agg, cornerstone, weights):
    """
    PRESENCE — Any player below average height for their positional role → defensive penalty.
    Undersized players create defensive mismatches against bigger opponents.
    """
    penalties = []
    for p in players:
        height_in = _parse_height_inches(p.get("height"))
        if height_in is None:
            continue
        role_avg = _infer_role_average_height(height_in)
        if height_in < role_avg - 2:  # more than 2 inches below role average
            penalties.append(p["name"])
    if not penalties:
        return None
    delta = weights["DEF_05_size_penalty"] * len(penalties)
    names = ", ".join(penalties)
    return (delta, f"{names} {'is' if len(penalties) == 1 else 'are'} undersized for their defensive role(s).", "defense")


check_DEF_05.presence_type = "presence"


def check_DEF_06(players, agg, cornerstone, weights):
    """
    PRESENCE — Player has Versatile Defender Proficient+ AND is undersized → reduced size penalty.
    Skill compensates for size disadvantage at the defensive end.
    """
    bonuses = []
    for p in players:
        if not _has_skill(p, "versatile_defender", "Proficient"):
            continue
        height_in = _parse_height_inches(p.get("height"))
        if height_in is None:
            continue
        role_avg = _infer_role_average_height(height_in)
        if height_in < role_avg - 2:
            bonuses.append(p["name"])
    if not bonuses:
        return None
    delta = weights["DEF_06_versatile_widens_range"]
    names = ", ".join(bonuses)
    return (delta, f"{names} offsets size disadvantage with Versatile Defender skill.", "defense")


check_DEF_06.presence_type = "presence"


def check_DEF_07(players, agg, cornerstone, weights):
    """
    PRESENCE — Any player with None across all offensive skills → Spacing Score penalty.
    Offensive black holes shrink the floor and force teammates to carry more offensive burden.
    """
    blackholes = [p for p in players if _is_offensive_blackhole(p)]
    if not blackholes:
        return None
    delta = weights["DEF_07_black_hole_spacing_penalty"] * len(blackholes)
    names = ", ".join(p["name"] for p in blackholes)
    return (delta, f"{names} {'has' if len(blackholes) == 1 else 'have'} no offensive skills — floor spacing shrinks.", "spacing")


check_DEF_07.presence_type = "presence"


def check_DEF_08(players, agg, cornerstone, weights):
    """
    PRESENCE — Any player with both an offensive skill AND a defensive skill → cohesion bonus.
    Two-way players create asymmetric matchup problems for the opponent.
    """
    twoway_players = [p for p in players if _is_twoway(p)]
    if not twoway_players:
        return None
    delta = weights["DEF_08_two_way_bonus"] * len(twoway_players)
    names = ", ".join(p["name"] for p in twoway_players)
    return (delta, f"{names} {'is' if len(twoway_players) == 1 else 'are'} two-way — offensive and defensive value.", "defense")


check_DEF_08.presence_type = "presence"


def check_DEF_09(players, agg, cornerstone, weights):
    """
    ABSENCE — No Elite+ rebounder AND fewer than 3 Capable+ rebounders → hard cap on Defense Score.
    Rebounding deficit limits second-chance prevention and transition defense.
    """
    all_players = [cornerstone] + players
    elite_rebounders = _players_with_skill(all_players, "rebounder", "Elite")
    capable_rebounders = _players_with_skill(all_players, "rebounder", "Capable")
    if elite_rebounders or len(capable_rebounders) >= 3:
        return None
    # delta=-10 signals a warning-level rebounding weakness to the note severity resolver.
    # The actual defense cap (MODIFIER_DELTAS["DEF_09_rebounding_deficit_cap"]) is
    # applied by the evaluator after all modifiers run, by checking for "DEF_09" in
    # modifier trace_keys — parallel to how HARD_05 is applied for hard checks.
    # Do NOT return the cap value (60) as delta — that would incorrectly ADD 60 to defense.
    delta = weights["DEF_09_rebounding_deficit_penalty"]
    return (delta, "Rebounding is a significant weakness — opponents will dominate the glass.", "defense")


check_DEF_09.presence_type = "absence"


# ---------------------------------------------------------------------------
# Spacing / On-Ball Balance modifiers (OFF-01 through OFF-10)
# ---------------------------------------------------------------------------

def check_OFF_01(players, agg, cornerstone, weights):
    """
    ABSENCE — Spacing Score below threshold → penalty to Creation Score.
    Creation is severely impaired when there's no floor spacing — defenders collapse on every drive.
    Threshold is raised by OFF-10 if cornerstone is a dominant on-ball creator.
    """
    threshold = _LOW_SPACING_THRESHOLD
    # Check if cornerstone is dominant on-ball (OFF-10 context)
    cs_is_dominant = any(
        _has_skill(cornerstone, s, "Elite")
        for s in ("pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player")
    )
    if cs_is_dominant:
        threshold += weights["OFF_10_cornerstone_raises_spacing_threshold"]

    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= threshold:
        return None
    deficit = threshold - spacing
    # Scale penalty with deficit depth
    scale = min(2.0, deficit / threshold)
    delta = weights["OFF_01_low_spacing_caps_creation"] * scale
    return (delta, f"Low floor spacing ({spacing:.0f}) limits creation options — defenders collapse on every pick.", "creation")


check_OFF_01.presence_type = "absence"


def check_OFF_02(players, agg, cornerstone, weights):
    """
    PRESENCE — Movement Shooter AND Screen Setter on DISTINCT players → Spacing bonus.
    Screen actions create separation for movement shooters — requires a screen setter to execute.
    """
    if not _synergy_check(players, "movement_shooter", "screen_setter"):
        return None
    movement_count = agg.get("movement_shooter_count", 0)
    delta = weights["OFF_02_screen_enables_movement"] * max(1, movement_count)
    return (delta, "Screen setter enables movement shooters — off-ball actions create sustained spacing.", "spacing")


check_OFF_02.presence_type = "presence"


def check_OFF_03(players, agg, cornerstone, weights):
    """
    ABSENCE — 2+ Movement Shooters but no Screen Setter → penalty to movement shooter value.
    Movement shooters need screens to create separation; without them, the action stalls.
    """
    movement_count = agg.get("movement_shooter_count", 0)
    if movement_count < 2:
        return None
    has_screen = any(_has_skill(p, "screen_setter") for p in players)
    if has_screen:
        return None
    delta = weights["OFF_03_movement_without_screen"]
    return (delta, f"{movement_count} movement shooters without a screen setter — off-ball runs lack trigger points.", "spacing")


check_OFF_03.presence_type = "absence"


def check_OFF_04(players, agg, cornerstone, weights):
    """
    PRESENCE — Cutter AND Screen Setter on DISTINCT players → bonus to cutting contributions.
    Screens free cutters from defenders; two distinct players required for the action.
    """
    if not _synergy_check(players, "cutter", "screen_setter"):
        return None
    delta = weights["OFF_04_screen_enables_cutting"]
    return (delta, "Screen setter frees cutters — backdoor and elevator cuts become viable.", "creation")


check_OFF_04.presence_type = "presence"


def check_OFF_05(players, agg, cornerstone, weights):
    """
    ABSENCE — Creation Score and Spacing Score differ by more than 30 points → penalty to the stronger.
    Extreme imbalance between creation and spacing makes both less effective.
    """
    creation = agg.get("creation_score_pre_modifiers", 50.0)
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    gap = abs(creation - spacing)
    if gap <= _IMBALANCE_GAP:
        return None
    delta = weights["OFF_05_creation_spacing_imbalance"]
    stronger = "creation" if creation > spacing else "spacing"
    weaker = "spacing" if stronger == "creation" else "creation"
    return (delta, f"Extreme imbalance: {stronger} ({max(creation, spacing):.0f}) far outpaces {weaker} ({min(creation, spacing):.0f}).", stronger)


check_OFF_05.presence_type = "absence"


def check_OFF_06(players, agg, cornerstone, weights):
    """
    PRESENCE — 2+ exclusively on-ball players → scaling penalty per additional one.
    Multiple ball-dominant players without off-ball skills create possessions that stall.
    """
    exclusive_count = agg.get("exclusive_onball_count", 0)
    if exclusive_count < 2:
        return None
    delta = weights["OFF_06_exclusive_onball_penalty"] * (exclusive_count - 1)
    return (delta, f"{exclusive_count} exclusively on-ball players — possessions become contested and predictable.", "creation")


check_OFF_06.presence_type = "presence"


def check_OFF_07(players, agg, cornerstone, weights):
    """
    PRESENCE — Any exclusively on-ball player below Elite in their primary skill → penalty.
    A ball-dominant player who isn't elite creates possessions with low probability of success.
    """
    bad_onball = []
    for p in players:
        if not _is_exclusively_onball(p):
            continue
        # Check if primary on-ball skill is below Elite
        primary_tier = max(
            (_tier_value(p, s) for s in _ON_BALL_SKILLS),
            default=0,
        )
        if primary_tier < TIER_VALUES["Elite"]:
            bad_onball.append(p["name"])
    if not bad_onball:
        return None
    delta = weights["OFF_07_exclusive_onball_below_elite"]
    names = ", ".join(bad_onball)
    return (delta, f"{names} {'is' if len(bad_onball) == 1 else 'are'} exclusively on-ball but below Elite — limiting ROI on possessions.", "creation")


check_OFF_07.presence_type = "presence"


def check_OFF_08(players, agg, cornerstone, weights):
    """
    PRESENCE — Any player with both an on-ball AND off-ball skill → bonus.
    Versatile offensive players force defenders to account for multiple threats simultaneously.
    """
    versatile = []
    for p in players:
        has_onball = any(_has_skill(p, s) for s in _ON_BALL_SKILLS)
        has_offball = any(_has_skill(p, s) for s in _OFF_BALL_SKILLS | _SHOOTING_SKILLS)
        if has_onball and has_offball:
            versatile.append(p["name"])
    if not versatile:
        return None
    delta = weights["OFF_08_onball_with_offball_bonus"] * len(versatile)
    names = ", ".join(versatile)
    return (delta, f"{names} {'is' if len(versatile) == 1 else 'are'} two-dimensional offensively — hard to scheme against.", "creation")


check_OFF_08.presence_type = "presence"


def check_OFF_09(players, agg, cornerstone, weights):
    """
    ABSENCE — Only one supporting player with a creation skill → upweight that player's contributions.
    A single creator is a single point of failure, but becomes even more valuable.
    """
    creators = [p for p in players if any(_has_skill(p, s) for s in _CREATION_SKILLS)]
    if len(creators) != 1:
        return None
    delta = weights["OFF_09_single_creator_upweight"]
    return (delta, f"{creators[0]['name']} is the lone creator — elite usage required from the single ball-handler.", "creation")


check_OFF_09.presence_type = "absence"


def check_OFF_10(players, agg, cornerstone, weights):
    """
    PRESENCE — Cornerstone is Elite+ in an on-ball skill → raises OFF-01 spacing threshold.
    A dominant on-ball cornerstone puts even more pressure on supporting cast to space the floor.
    This modifier returns a context delta (applied to the threshold, not a dimension score).
    We encode it as a positive creation delta to reflect that the system is more demanding.
    """
    cs_is_dominant = any(
        _has_skill(cornerstone, s, "Elite")
        for s in ("pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player")
    )
    if not cs_is_dominant:
        return None
    delta = weights["OFF_10_cornerstone_raises_spacing_threshold"]
    return (delta, f"Cornerstone's dominant on-ball game raises the floor-spacing requirement for the supporting cast.", "creation")


check_OFF_10.presence_type = "presence"


def check_OFF_11(players, agg, cornerstone, weights):
    """
    PRESENCE — Passer Capable+ present (including cornerstone) → multiplier on off-ball contributions.
    Elite passing unlocks off-ball skills that would otherwise be underutilized.
    """
    if not agg.get("has_passer", False):
        return None
    # Count total off-ball skills that benefit from passing
    offball_count = sum(
        1 for p in players
        for s in _OFF_BALL_SKILLS
        if s != "offensive_rebounder" and _has_skill(p, s)
    )
    if offball_count == 0:
        return None
    delta = weights["OFF_11_passer_offball_multiplier"] * offball_count
    return (delta, f"Passer unlocks {offball_count} off-ball skills — cutting, spacing, and transition amplified.", "creation")


check_OFF_11.presence_type = "presence"


def check_OFF_12(players, agg, cornerstone, weights):
    """
    ABSENCE — Cutter Capable+ present but NO Passer Capable+ in full rotation (including cornerstone).
    Cutters without a passer to find them are wasted movement — the action rarely converts.
    """
    cutter_count = agg.get("cutter_count", 0)
    if cutter_count == 0:
        return None
    # Check full rotation including cornerstone
    has_passer = agg.get("has_passer", False)
    if has_passer:
        return None
    delta = weights["OFF_12_cutter_without_passer"]
    return (delta, f"{cutter_count} cutter(s) without a passer — cuts go unrewarded without a lob/kickout threat.", "creation")


check_OFF_12.presence_type = "absence"


def check_OFF_13(players, agg, cornerstone, weights):
    """
    ABSENCE — Cutter Capable+ present but Spacing Score below threshold.
    Cutters need space to cut into; low spacing collapses those lanes.
    """
    cutter_count = agg.get("cutter_count", 0)
    if cutter_count == 0:
        return None
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= _LOW_SPACING_THRESHOLD:
        return None
    delta = weights["OFF_13_cutter_without_spacing"]
    return (delta, f"Cutting lanes are clogged — low floor spacing ({spacing:.0f}) limits cutter effectiveness.", "creation")


check_OFF_13.presence_type = "absence"


def check_OFF_14(players, agg, cornerstone, weights):
    """
    PRESENCE — Cutter Capable+ AND at least one Proficient+ gravity player (Driver/Post/Iso) on DISTINCT players.
    Gravity players freeze defenders, creating the lanes that cutters exploit.
    """
    cutter_count = agg.get("cutter_count", 0)
    if cutter_count == 0:
        return None
    gravity_players = [p for p in players if any(_has_skill(p, s, "Proficient") for s in _GRAVITY_SKILLS)]
    cutter_players = [p for p in players if _has_skill(p, "cutter")]
    # Require distinct players
    gravity_ids = {id(p) for p in gravity_players}
    cutter_ids = {id(p) for p in cutter_players}
    if not (gravity_ids - cutter_ids) or not (cutter_ids - gravity_ids):
        return None
    delta = weights["OFF_14_cutter_gravity_bonus"] * len(gravity_players)
    return (delta, f"Gravity players freeze help defenders — cutting lanes open for {cutter_count} cutter(s).", "creation")


check_OFF_14.presence_type = "presence"


def check_OFF_15(players, agg, cornerstone, weights):
    """
    ABSENCE — Vertical Spacer Capable+ present but no Passer or Driver in DISTINCT player(s).
    Vertical spacers (lob threats) are worthless without someone to lob to them.
    Requires distinct players: lob threat and lob passer must be different people.
    """
    vertical_players = [p for p in players if _has_skill(p, "vertical_spacer")]
    if not vertical_players:
        return None
    # Check if any lob thrower exists on a DIFFERENT player
    lob_skills = {"passer", "driver"}
    for vp in vertical_players:
        has_distinct_lob = any(
            any(_has_skill(p, s) for s in lob_skills)
            for p in players + [cornerstone]
            if id(p) != id(vp)
        )
        if not has_distinct_lob:
            delta = weights["OFF_15_vertical_without_lob"]
            return (delta, f"{vp['name']}'s vertical spacing goes unrewarded without a lob passer.", "paint")
    return None


check_OFF_15.presence_type = "absence"


def check_OFF_16(players, agg, cornerstone, weights):
    """
    PRESENCE — Vertical Spacer AND Passer/Driver on DISTINCT players → bonus.
    A vertical spacer with a capable lob thrower creates a live alley-oop threat every possession.
    """
    vertical_players = [p for p in players if _has_skill(p, "vertical_spacer")]
    if not vertical_players:
        return None
    lob_skills = {"passer", "driver"}
    for vp in vertical_players:
        # Need a distinct lob-capable player
        distinct_lob_players = [
            p for p in players + [cornerstone]
            if id(p) != id(vp) and any(_has_skill(p, s) for s in lob_skills)
        ]
        if distinct_lob_players:
            best_lob_tier = max(
                max(_tier_value(p, s) for s in lob_skills)
                for p in distinct_lob_players
            )
            scale = best_lob_tier / TIER_VALUES["Elite"]
            delta = weights["OFF_16_vertical_with_lob"] * max(0.5, min(1.5, scale))
            return (delta, f"Vertical spacer plus lob passer — live alley-oop threat stretches the defense vertically.", "paint")
    return None


check_OFF_16.presence_type = "presence"


def check_OFF_17(players, agg, cornerstone, weights):
    """
    PRESENCE — Driver AND (Crafty Finisher OR High Flyer) on the SAME player.
    Finishing ability turns a driver into a reliable scorer rather than a layup artist.
    Single-player modifier — both skills on same player.
    """
    for p in players:
        if not _has_skill(p, "driver"):
            continue
        has_finishing = _has_skill(p, "high_flyer") or _has_skill(p, "crafty_finisher")
        if has_finishing:
            delta = weights["OFF_17_driver_finishing_bonus"]
            return (delta, f"{p['name']}'s finishing ability maximizes the value of drives to the rim.", "paint")
    return None


check_OFF_17.presence_type = "presence"


def check_OFF_18(players, agg, cornerstone, weights):
    """
    PRESENCE — Driver AND Passer on the SAME player.
    A driving passer is a nightmare for rim protectors who can't commit fully without giving up kicks.
    Single-player modifier.
    """
    for p in players:
        if _has_skill(p, "driver") and _has_skill(p, "passer"):
            delta = weights["OFF_18_driver_passing_bonus"]
            return (delta, f"{p['name']}'s drive-and-kick ability keeps the defense honest.", "paint")
    return None


check_OFF_18.presence_type = "presence"


def check_OFF_19(players, agg, cornerstone, weights):
    """
    ABSENCE — Low Post Capable+ present AND Spacing Score below threshold.
    Low post players need spacing to operate; without it, the paint is packed and helpless.
    """
    has_low_post = any(_has_skill(p, "low_post_player") for p in players)
    if not has_low_post:
        return None
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= _LOW_SPACING_THRESHOLD:
        return None
    delta = weights["OFF_19_low_post_spacing_penalty"]
    return (delta, f"Low post game throttled by poor spacing ({spacing:.0f}) — defenders double without consequence.", "paint")


check_OFF_19.presence_type = "absence"


def check_OFF_20(players, agg, cornerstone, weights):
    """
    PRESENCE — Low Post player with secondary skills (Crafty Finisher / Passer / Offensive Rebounder).
    Secondary skills on the same player multiply the value of low post possessions.
    Single-player modifier.
    """
    total_delta = 0.0
    fired = False
    best_name = None
    for p in players:
        if not _has_skill(p, "low_post_player"):
            continue
        secondaries = sum(1 for s in ("crafty_finisher", "passer", "offensive_rebounder") if _has_skill(p, s))
        if secondaries > 0:
            total_delta += weights["OFF_20_low_post_secondary_bonus"] * secondaries
            fired = True
            best_name = p["name"]
    if not fired:
        return None
    return (total_delta, f"{best_name}'s secondary skills (passing/finishing/rebounding) multiply low post value.", "paint")


check_OFF_20.presence_type = "presence"


def check_OFF_21(players, agg, cornerstone, weights):
    """
    ABSENCE — Mid Post Capable+ AND Spacing Score below threshold.
    Mid post players (like low post) need spacing — dense paint negates mid-range angle plays.
    """
    has_mid_post = any(_has_skill(p, "mid_post_player") for p in players)
    if not has_mid_post:
        return None
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= _LOW_SPACING_THRESHOLD:
        return None
    delta = weights["OFF_21_mid_post_spacing_penalty"]
    return (delta, f"Mid post game suffers without spacing ({spacing:.0f}) — no clear angles to work from.", "paint")


check_OFF_21.presence_type = "absence"


def check_OFF_22(players, agg, cornerstone, weights):
    """
    PRESENCE — Mid Post player with secondary skills (Passer / Crafty Finisher / High Flyer / Off-Dribble Shooter).
    Secondary skills on same player create 2-for-1 scoring threats.
    Single-player modifier.
    """
    total_delta = 0.0
    fired = False
    best_name = None
    for p in players:
        if not _has_skill(p, "mid_post_player"):
            continue
        secondaries = sum(
            1 for s in ("passer", "crafty_finisher", "high_flyer", "off_dribble_shooter")
            if _has_skill(p, s)
        )
        if secondaries > 0:
            total_delta += weights["OFF_22_mid_post_secondary_bonus"] * secondaries
            fired = True
            best_name = p["name"]
    if not fired:
        return None
    return (total_delta, f"{best_name}'s secondary skills unlock multi-level scoring from mid-post.", "paint")


check_OFF_22.presence_type = "presence"


def check_OFF_23(players, agg, cornerstone, weights):
    """
    ABSENCE — Iso Scorer Capable+ AND Spacing Score below threshold.
    Iso scorers need the corner-3 threat to keep help defenders off them.
    """
    has_iso = any(_has_skill(p, "isolation_scorer") for p in players)
    if not has_iso:
        return None
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= _LOW_SPACING_THRESHOLD:
        return None
    delta = weights["OFF_23_iso_spacing_penalty"]
    return (delta, f"Isolation scorer operating in a crowded floor ({spacing:.0f}) — help defense has no cost.", "creation")


check_OFF_23.presence_type = "absence"


def check_OFF_24(players, agg, cornerstone, weights):
    """
    PRESENCE — Iso Scorer with Passer skill OR 2+ scoring methods on the same player.
    A scoring ISO player who can also pass or score multiple ways is far harder to contain.
    Single-player modifier.
    """
    for p in players:
        if not _has_skill(p, "isolation_scorer"):
            continue
        has_passer = _has_skill(p, "passer")
        scoring_methods = sum(
            1 for s in ("isolation_scorer", "driver", "mid_post_player", "low_post_player", "pnr_ball_handler")
            if _has_skill(p, s)
        )
        if has_passer or scoring_methods >= 2:
            delta = weights["OFF_24_iso_secondary_bonus"]
            return (delta, f"{p['name']}'s versatility in isolation (multiple scoring vectors) is hard to key on.", "creation")
    return None


check_OFF_24.presence_type = "presence"


def check_OFF_25(players, agg, cornerstone, weights):
    """
    PRESENCE — High Flyer AND Vertical Spacer on the SAME player → multiplied vertical contribution.
    Aerial athleticism amplifies lob threat effectiveness significantly.
    Single-player modifier.
    """
    for p in players:
        if _has_skill(p, "high_flyer") and _has_skill(p, "vertical_spacer"):
            hf_tier = _tier_value(p, "high_flyer")
            scale = hf_tier / TIER_VALUES["Capable"]
            mult = weights["OFF_25_high_flyer_vertical_mult"]
            delta = (mult - 1.0) * 10 * scale  # convert multiplier to delta
            return (delta, f"{p['name']}'s high-flying athleticism turns vertical spacing into an elite lob threat.", "paint")
    return None


check_OFF_25.presence_type = "presence"


def check_OFF_26(players, agg, cornerstone, weights):
    """
    PRESENCE — High Flyer AND Cutter on the SAME player → multiplied cutting contribution.
    High-flying athletes convert cuts at a higher rate — rim-level athleticism.
    Single-player modifier.
    """
    for p in players:
        if _has_skill(p, "high_flyer") and _has_skill(p, "cutter"):
            mult = weights["OFF_26_high_flyer_cutting_mult"]
            delta = (mult - 1.0) * 10
            return (delta, f"{p['name']}'s athleticism converts cuts at a high rate — a finishing threat above the rim.", "creation")
    return None


check_OFF_26.presence_type = "presence"


def check_OFF_27(players, agg, cornerstone, weights):
    """
    PRESENCE — High Flyer AND PnR Finisher on the SAME player → multiplied PnR contribution.
    High-flying roll men are among the most efficient scorers per possession in basketball.
    Single-player modifier.
    """
    for p in players:
        if _has_skill(p, "high_flyer") and _has_skill(p, "pnr_finisher"):
            mult = weights["OFF_27_high_flyer_pnr_mult"]
            delta = (mult - 1.0) * 10
            return (delta, f"{p['name']}'s high-flying finish on the PnR roll is nearly unguardable at the rim.", "creation")
    return None


check_OFF_27.presence_type = "presence"


def check_OFF_28(players, agg, cornerstone, weights):
    """
    PRESENCE — PnR Ball Handler AND PnR Finisher on DISTINCT players → bonus.
    Requires two separate players — one handler, one roll man.
    """
    handler_players = _players_with_skill(players + [cornerstone], "pnr_ball_handler")
    finisher_players = _players_with_skill(players, "pnr_finisher")  # finisher must be supporting

    if not handler_players or not finisher_players:
        return None

    # Verify distinct players: find a handler-finisher pair that is NOT the same person
    handler_ids = {id(p) for p in handler_players}
    finisher_ids = {id(p) for p in finisher_players}
    if not (handler_ids - finisher_ids) or not (finisher_ids - handler_ids):
        # All handlers are also finishers OR all finishers are also handlers
        # Check if there's at least one purely handler and one purely finisher
        handlers_only = [p for p in handler_players if id(p) not in finisher_ids]
        finishers_only = [p for p in finisher_players if id(p) not in handler_ids]
        if not (handlers_only or finishers_only):
            return None

    delta = weights["OFF_28_pnr_synergy_bonus"]
    # Apply dual-star multiplier if both are in slots 1–3
    handler_slot = min((p.get("slot", 9) for p in handler_players), default=9)
    finisher_slot = min((p.get("slot", 9) for p in finisher_players), default=9)
    if handler_slot <= 3 and finisher_slot <= 3:
        # Both are co-stars — apply the note but not a stacking multiplier in delta form
        return (delta, "Elite PnR pair — handler and roll man form a two-man game that breaks half-court defenses.", "creation")
    return (delta, "PnR handler and finisher present — pick-and-roll game creates repeatable high-percentage looks.", "creation")


check_OFF_28.presence_type = "presence"


def check_OFF_29(players, agg, cornerstone, weights):
    """
    PRESENCE — PnR Ball Handler with secondary skills (Passer / Off-Dribble Shooter / Driver) on same player.
    A multi-dimensional PnR handler is nearly impossible to guard on every possession.
    Single-player modifier.
    """
    total_delta = 0.0
    fired = False
    best_name = None
    for p in players:
        if not _has_skill(p, "pnr_ball_handler"):
            continue
        secondaries = sum(
            1 for s in ("passer", "off_dribble_shooter", "driver")
            if _has_skill(p, s)
        )
        if secondaries > 0:
            total_delta += weights["OFF_29_pnr_handler_secondary_bonus"] * secondaries
            fired = True
            best_name = p["name"]
    if not fired:
        return None
    return (total_delta, f"{best_name}'s secondary skills (shooting/passing/driving) make the PnR unpredictable.", "creation")


check_OFF_29.presence_type = "presence"


def check_OFF_30(players, agg, cornerstone, weights):
    """
    PRESENCE — PnR Finisher with secondary skills (Vertical Spacer / Screen Setter / Spot-Up / Passer).
    A roll man who can also set pin-downs, space the floor, or pass elevates the two-man game.
    Single-player modifier.
    """
    total_delta = 0.0
    fired = False
    best_name = None
    for p in players:
        if not _has_skill(p, "pnr_finisher"):
            continue
        secondaries = sum(
            1 for s in ("vertical_spacer", "screen_setter", "spot_up_shooter", "passer")
            if _has_skill(p, s)
        )
        if secondaries > 0:
            total_delta += weights["OFF_30_pnr_finisher_secondary_bonus"] * secondaries
            fired = True
            best_name = p["name"]
    if not fired:
        return None
    return (total_delta, f"{best_name}'s secondary skills add wrinkles to the PnR — defenders can't play straight up.", "creation")


check_OFF_30.presence_type = "presence"


def check_OFF_31(players, agg, cornerstone, weights):
    """
    PRESENCE — Transition Threat and/or Passer synergy → Transition Score bonus.

    Two distinct archetypes compound:

    1. DISTINCT SYNERGY: a dedicated passer (who is NOT a transition threat) feeds a
       transition runner (who is NOT also a passer) — base bonus.

    2. DUAL THREAT (per player): any player who is BOTH a transition threat AND a passer
       creates their own fast-break opportunities. Bonus scales with both skill tiers and
       accumulates per dual-threat player:
         contribution = base × scale_k × (tt_tier / elite_ref) × (passer_tier / elite_ref)

    At least one of the two archetypes must be present for the modifier to fire.
    """
    all_players = players + [cornerstone]

    # Partition players into dual-threats (have both skills) vs. skill-only players
    dual_threats  = [p for p in all_players
                     if _has_skill(p, "transition_threat") and _has_skill(p, "passer")]
    dual_ids      = {id(p) for p in dual_threats}
    tt_only       = [p for p in _players_with_skill(all_players, "transition_threat")
                     if id(p) not in dual_ids]
    passer_only   = [p for p in _players_with_skill(all_players, "passer")
                     if id(p) not in dual_ids]

    has_distinct_synergy = bool(tt_only and passer_only)

    if not has_distinct_synergy and not dual_threats:
        return None

    base      = weights["OFF_31_transition_passer_synergy"]
    elite_ref = float(TIER_VALUES.get("Elite", 5))
    scale_k   = weights["OFF_31_transition_dual_threat_double"]

    # Base bonus for distinct TT + passer pair
    delta = base if has_distinct_synergy else 0.0

    # Per dual-threat player: tier-scaled compound bonus
    for p in dual_threats:
        tt_factor     = _tier_value(p, "transition_threat") / elite_ref
        passer_factor = _tier_value(p, "passer") / elite_ref
        delta += base * scale_k * tt_factor * passer_factor

    # Build narrative reflecting what fired
    dual_count = len(dual_threats)
    if has_distinct_synergy and dual_count > 0:
        narrative = (
            f"{dual_count} dual-threat player{'s' if dual_count > 1 else ''} who can both push "
            f"and finish, plus a dedicated transition duo — the break operates at full speed."
        )
    elif dual_count > 0:
        narrative = (
            f"{dual_count} dual-threat player{'s' if dual_count > 1 else ''} who push and finish "
            f"in transition — self-sufficient fast-break creation."
        )
    else:
        narrative = "Transition threats plus a dedicated passer — fast break opportunities convert at high rates."

    return (delta, narrative, "transition")


check_OFF_31.presence_type = "presence"


def check_OFF_32(players, agg, cornerstone, weights):
    """
    PRESENCE — High Flyer(s) present while OFF-31 is active (transition threat + distinct passer).

    Bonus compounds across every (passer, high-flyer) pair and scales with all three tiers:
      - High-flyer tier: how explosively they can finish above the rim
      - Passer tier: how reliably and accurately they deliver the lob
      - Best transition-threat tier: the pace at which opportunities are created

    Formula per (passer, high-flyer) pair:
      contribution = base × (hf_tier / elite_ref) × (passer_tier / elite_ref) × (best_tt_tier / elite_ref)

    A second Elite passer doubles the number of lob windows; an ATG passer generates
    better, more accurate lobs than a Capable one — both compound with each aerial athlete.
    Total bonus is capped at OFF_32_high_flyer_transition_cap.
    """
    # Require OFF-31 to be active: transition threat + passer on distinct players
    transition_players = _players_with_skill(players, "transition_threat")
    if not transition_players:
        return None
    passer_players = _players_with_skill(players + [cornerstone], "passer")
    if not passer_players:
        return None
    transition_ids = {id(p) for p in transition_players}
    distinct_passers = [p for p in passer_players if id(p) not in transition_ids]
    if not distinct_passers:
        return None

    # Require at least one high flyer
    high_flyer_players = _players_with_skill(players, "high_flyer")
    if not high_flyer_players:
        return None

    # Tier normalization: Elite = 1.0 factor; ATG = 2.0; Capable ≈ 0.3
    elite_ref    = float(TIER_VALUES.get("Elite", 5))
    best_tt_tier = max(_tier_value(p, "transition_threat") for p in transition_players)
    tt_factor    = best_tt_tier / elite_ref

    base = weights["OFF_32_high_flyer_transition_bonus"]
    cap  = weights["OFF_32_high_flyer_transition_cap"]

    # Accumulate over each (passer, high-flyer) pair — three tiers all multiplicatively scale
    total = 0.0
    for passer in distinct_passers:
        passer_factor = _tier_value(passer, "passer") / elite_ref
        for hf_player in high_flyer_players:
            hf_factor = _tier_value(hf_player, "high_flyer") / elite_ref
            total += base * hf_factor * passer_factor * tt_factor
    total = min(total, cap)

    passer_count = len(distinct_passers)
    hf_count     = len(high_flyer_players)
    narrative = (
        f"{hf_count} aerial athlete{'s' if hf_count > 1 else ''} paired with "
        f"{passer_count} passer{'s' if passer_count > 1 else ''} in transition — "
        f"lob windows open at every level of the break."
    )
    return (total, narrative, "transition")


check_OFF_32.presence_type = "presence"


def check_OFF_33(players, agg, cornerstone, weights):
    """
    PRESENCE — Offensive Rebounder Capable+ AND Spacing Score below threshold.
    Offensive rebounding partially offsets the turnover cost of low-spacing possessions.
    """
    has_offreb = any(_has_skill(p, "offensive_rebounder") for p in players)
    if not has_offreb:
        return None
    spacing = agg.get("spacing_score_pre_modifiers", 50.0)
    if spacing >= _LOW_SPACING_THRESHOLD:
        return None
    delta = weights["OFF_33_offreb_spacing_mitigation"]
    return (delta, "Offensive rebounding salvages second chances despite low spacing — not ideal but functional.", "spacing")


check_OFF_33.presence_type = "presence"


# ---------------------------------------------------------------------------
# OFF-34 — Shooter density bonus
# ---------------------------------------------------------------------------

def check_OFF_34(players: list[dict], agg: dict, cornerstone: dict, weights: dict):
    """
    PRESENCE — Multiple shooters compound floor-spacing gravity.

    A single shooter forces one defender to chase; three shooters force the
    entire defense to account for every corner simultaneously, opening driving
    lanes and post entries that don't exist without that density. The base
    Layer 1 contribution already rewards each shooter linearly; this modifier
    adds the non-linear compounding benefit of sustained density across lineups.

    Counts Capable+ spot_up_shooter and movement_shooter across the full
    rotation including the cornerstone (their shooting gravity counts even
    though their skill scores are context-only).

    Fires when 2+ shooters present. Delta: +OFF_34_shooter_density_per_extra
    per shooter beyond the first, capped at OFF_34_shooter_density_cap.
    """
    all_players = [cornerstone] + players
    shooter_count = sum(
        1 for p in all_players
        if _has_skill(p, "spot_up_shooter") or _has_skill(p, "movement_shooter")
    )
    if shooter_count < 2:
        return None

    per_extra = weights["OFF_34_shooter_density_per_extra"]
    cap       = weights["OFF_34_shooter_density_cap"]
    bonus     = min((shooter_count - 1) * per_extra, cap)

    narrative = (
        f"Shooter density ({shooter_count} shooters): every lineup combination "
        f"maintains floor-wide gravity, compounding driving and post-entry opportunities."
    )
    return (bonus, narrative, "spacing")


check_OFF_34.presence_type = "presence"


# ---------------------------------------------------------------------------
# OFF-35 — Non-shooter stacking penalty
# ---------------------------------------------------------------------------

def check_OFF_35(players: list[dict], agg: dict, cornerstone: dict, weights: dict):
    """
    PRESENCE — More than one non-shooter in the supporting rotation collapses spacing.

    A single non-shooter (a rim protector, a bruiser) is tolerable — the rest of the
    rotation can compensate. Two or more non-shooters means defenders can sag off
    multiple players simultaneously, eliminating driving lanes and post-entry windows.

    "Non-shooter" = no spot_up_shooter AND no movement_shooter at Capable+ tier.
    Counts only supporting players (cornerstone excluded; their spacing is already
    context-only and not aggregated into the spacing dimension score).

    First non-shooter: no penalty.
    Each additional non-shooter beyond the first: OFF_35_non_shooter_penalty (additive).
    Total penalty capped at OFF_35_non_shooter_penalty_cap.
    """
    # Count supporting players with zero shooting at Capable+ tier
    non_shooter_count = sum(
        1 for p in players
        if not _has_skill(p, "spot_up_shooter") and not _has_skill(p, "movement_shooter")
    )
    if non_shooter_count <= 1:
        return None  # One non-shooter is fine

    extra = non_shooter_count - 1  # penalty triggers on 2nd, 3rd, … non-shooter
    per_penalty = weights["OFF_35_non_shooter_penalty"]
    cap         = weights["OFF_35_non_shooter_penalty_cap"]
    delta       = max(extra * per_penalty, cap)  # cap is negative (floor)

    narrative = (
        f"{non_shooter_count} non-shooters in the rotation allow defenders to sag into "
        f"the paint, collapsing driving lanes and post-entry windows. Even one reliable "
        f"floor-spacer would open the offense significantly."
    )
    return (delta, narrative, "spacing")


check_OFF_35.presence_type = "presence"


# ---------------------------------------------------------------------------
# Public registry — all modifier functions in evaluation order
# ---------------------------------------------------------------------------

ALL_MODIFIERS: list = [
    check_DEF_01, check_DEF_02, check_DEF_03, check_DEF_04, check_DEF_05,
    check_DEF_06, check_DEF_07, check_DEF_08, check_DEF_09,
    check_OFF_01, check_OFF_02, check_OFF_03, check_OFF_04, check_OFF_05,
    check_OFF_06, check_OFF_07, check_OFF_08, check_OFF_09, check_OFF_10,
    check_OFF_11, check_OFF_12, check_OFF_13, check_OFF_14, check_OFF_15,
    check_OFF_16, check_OFF_17, check_OFF_18, check_OFF_19, check_OFF_20,
    check_OFF_21, check_OFF_22, check_OFF_23, check_OFF_24, check_OFF_25,
    check_OFF_26, check_OFF_27, check_OFF_28, check_OFF_29, check_OFF_30,
    check_OFF_31, check_OFF_32, check_OFF_33, check_OFF_34, check_OFF_35,
]
