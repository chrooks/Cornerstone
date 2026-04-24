"""
roster_evaluator/hard_checks.py — All 5 Layer 4 hard floor check functions.

Each function: check_HARD_NN(players, agg, cornerstone) -> Note | None
  - Returns a critical-severity Note with presence_type="absence" if the condition is met
  - Returns None if the condition is not met

Hard checks run after all Layer 3 modifiers have been applied.
They represent floor conditions so fundamental that any roster failing them
gets a critical flag, regardless of other strengths.
"""

from __future__ import annotations

from .types import Note
from .weights import TIER_VALUES


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _has_skill(player: dict, skill: str, min_tier: str = "Capable") -> bool:
    """Return True if the player has at least min_tier in the given skill."""
    tier_str = player.get("skills", {}).get(skill, "None")
    return TIER_VALUES.get(tier_str, 0) >= TIER_VALUES.get(min_tier, 1)


# ---------------------------------------------------------------------------
# HARD-01: No paint touch anywhere in the full rotation (including cornerstone)
# ---------------------------------------------------------------------------

def check_HARD_01(
    players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> Note | None:
    """
    ABSENCE — No Capable+ in Driving, Vertical Spacer, Low Post, or Mid Post
    across the full rotation including the cornerstone.

    Without any paint touch, the offense has no way to attack the rim, forces
    mid-range jumpers or long 2s, and collapses under any drop coverage.
    """
    paint_skills = ("driver", "vertical_spacer", "low_post_player", "mid_post_player")
    all_players = [cornerstone] + players
    has_paint = any(
        _has_skill(p, s)
        for p in all_players
        for s in paint_skills
    )
    if has_paint:
        return None
    return Note(
        severity="critical",
        category="offense",
        text="No paint threat anywhere — driving, vertical spacing, low post, or mid post "
             "are all absent. The offense cannot attack the rim or generate high-percentage shots.",
        trace_key="HARD_01",
        presence_type="absence",
        dimension="paint",
    )


# ---------------------------------------------------------------------------
# HARD-02: No creation in the supporting cast (cornerstone excluded)
# ---------------------------------------------------------------------------

def check_HARD_02(
    players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> Note | None:
    """
    ABSENCE — No Capable+ in PnR Ball Handling, Driving, Iso, Low Post, or Mid Post
    among supporting cast only (cornerstone not counted).

    A supporting cast with zero creation forces the cornerstone to do everything —
    predictable, double-teamed, and unsustainable over a full game.
    """
    creation_skills = ("pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player")
    has_creation = any(
        _has_skill(p, s)
        for p in players
        for s in creation_skills
    )
    if has_creation:
        return None
    return Note(
        severity="critical",
        category="offense",
        text="Supporting cast has no creators — no PnR ball handling, driving, iso, or post "
             "skills outside the cornerstone. Everything runs through one player.",
        trace_key="HARD_02",
        presence_type="absence",
        dimension="creation",
    )


# ---------------------------------------------------------------------------
# HARD-03: Fewer than 2 shooters in the supporting cast
# ---------------------------------------------------------------------------

def check_HARD_03(
    players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> Note | None:
    """
    ABSENCE — Fewer than 2 players with Capable+ in any shooting skill
    (Spot-Up, Movement, Off-Dribble) in the supporting cast.

    One shooter (or none) means the floor can be collapsed on almost every possession.
    Two is the minimum to force even basic defender attention.
    """
    shooting_skills = ("spot_up_shooter", "movement_shooter", "off_dribble_shooter")
    shooters = [
        p for p in players
        if any(_has_skill(p, s) for s in shooting_skills)
    ]
    if len(shooters) >= 2:
        return None
    count = len(shooters)
    text = (
        "No floor spacers in the supporting cast — defenders freely collapse on every drive or post-up."
        if count == 0 else
        f"Only {count} shooter in the supporting cast — the floor is barely stretched. "
        "Any coverage scheme will pack the paint."
    )
    return Note(
        severity="critical",
        category="offense",
        text=text,
        trace_key="HARD_03",
        presence_type="absence",
        dimension="spacing",
    )


# ---------------------------------------------------------------------------
# HARD-04: Every player has None in all three defensive skills
# ---------------------------------------------------------------------------

def check_HARD_04(
    players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> Note | None:
    """
    ABSENCE — Every player in the full rotation (including cornerstone) has None
    in Versatile Defender, Rim Protector, AND Perimeter Disruptor.

    A roster with zero defensive skills has no mechanism to generate stops.
    This is a structural deficiency that no amount of offense can overcome
    against competent playoff-caliber teams.
    """
    defensive_skills = ("versatile_defender", "rim_protector", "perimeter_disruptor")
    all_players = [cornerstone] + players
    has_any_defense = any(
        _has_skill(p, s)
        for p in all_players
        for s in defensive_skills
    )
    if has_any_defense:
        return None
    return Note(
        severity="critical",
        category="defense",
        text="Zero defensive skills across the entire roster — no versatile defenders, "
             "rim protectors, or perimeter disruptors. This team cannot generate stops.",
        trace_key="HARD_04",
        presence_type="absence",
        dimension="defense",
    )


# ---------------------------------------------------------------------------
# HARD-05: No Elite+ rebounder AND fewer than 2 Capable+ rebounders
# ---------------------------------------------------------------------------

def check_HARD_05(
    players: list[dict],
    agg: dict,
    cornerstone: dict,
) -> Note | None:
    """
    ABSENCE — No Elite+ rebounder AND fewer than 2 Capable+ rebounders
    across the full rotation (including cornerstone).

    Persistent rebounding deficits enable easy put-backs for opponents and
    slow transition offense by not securing the ball after missed shots.
    """
    all_players = [cornerstone] + players
    elite_rebounders = [
        p for p in all_players
        if _has_skill(p, "rebounder", "Elite")
    ]
    capable_rebounders = [
        p for p in all_players
        if _has_skill(p, "rebounder", "Capable")
    ]
    if elite_rebounders or len(capable_rebounders) >= 2:
        return None
    count = len(capable_rebounders)
    text = (
        "No reliable rebounders — opponents will dominate the glass. "
        "Second-chance points and fast break prevention are both significant liabilities."
        if count == 0 else
        f"Only {count} rebounder in the rotation — insufficient to contest the glass "
        "consistently. Opponents will generate easy second-chance opportunities."
    )
    return Note(
        severity="critical",
        category="defense",
        text=text,
        trace_key="HARD_05",
        presence_type="absence",
        dimension="defense",
    )


# ---------------------------------------------------------------------------
# Public registry
# ---------------------------------------------------------------------------

ALL_HARD_CHECKS: list = [
    check_HARD_01,
    check_HARD_02,
    check_HARD_03,
    check_HARD_04,
    check_HARD_05,
]
