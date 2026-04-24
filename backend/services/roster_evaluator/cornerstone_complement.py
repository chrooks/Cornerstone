"""
roster_evaluator/cornerstone_complement.py — Proactive archetype suggestions for
early roster stages (0–2 supporting players).

Called by the evaluator when the supporting rotation has fewer than
COMPLEMENT_STAGE_CUTOFF players. Analyzes the cornerstone's skill profile against
what's already been added and returns directional Note suggestions for what archetype
to target next.

Stage framing:
  0 supporting players → "co-star" framing
  1 supporting player  → "third player / core" framing
  2 supporting players → "rotation" framing
  3+ supporting players → this module is not called; main modifiers handle suggestions

Each gap rule checks the full rotation (cornerstone + supporting) to avoid suggesting
something that's already been addressed.

Returns at most MAX_COMPLEMENT_NOTES notes, in priority order.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .types import Note
from .weights import TIER_VALUES

# Maximum complement suggestions returned per evaluation
MAX_COMPLEMENT_NOTES: int = 3

# ---------------------------------------------------------------------------
# Skill category sets — mirrors evaluator.py definitions
# ---------------------------------------------------------------------------

_CREATION_SKILLS: frozenset[str] = frozenset({
    "pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player",
})
_ON_BALL_DOMINANT: frozenset[str] = frozenset({
    "pnr_ball_handler", "driver", "isolation_scorer", "low_post_player", "mid_post_player",
})
_SHOOTING_SKILLS: frozenset[str] = frozenset({"spot_up_shooter", "movement_shooter"})
_DEFENSE_SKILLS: frozenset[str] = frozenset({
    "versatile_defender", "rim_protector", "perimeter_disruptor",
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tier(player: dict, skill: str) -> int:
    """Numeric tier value for a skill on a player."""
    return TIER_VALUES.get(player.get("skills", {}).get(skill, "None"), 0)


def _has(player: dict, skill: str, min_tier: str = "Capable") -> bool:
    return _tier(player, skill) >= TIER_VALUES.get(min_tier, 1)


def _any_has(players: list[dict], skill: str, min_tier: str = "Capable") -> bool:
    return any(_has(p, skill, min_tier) for p in players)


def _any_has_any(players: list[dict], skills: frozenset[str], min_tier: str = "Capable") -> bool:
    return any(_has(p, s, min_tier) for p in players for s in skills)


def _count_with(players: list[dict], skill: str, min_tier: str = "Capable") -> int:
    return sum(1 for p in players if _has(p, skill, min_tier))


def _stage_label(stage: int) -> str:
    """Human-readable label for the role being filled at this stage."""
    if stage == 0:
        return "co-star"
    elif stage == 1:
        return "third player"
    else:
        return "next addition"


def _is_onball_dominant(player: dict) -> bool:
    """True if player has at least one Elite+ on-ball skill — dominant offensive engine."""
    return any(_has(player, s, "Elite") for s in _ON_BALL_DOMINANT)


def _is_offball_cornerstone(cornerstone: dict) -> bool:
    """
    True if the cornerstone is primarily an off-ball player — a scorer/shooter who
    works best without primary ball-handling duties (e.g. Durant, Klay Thompson).
    """
    has_shooting = any(_has(cornerstone, s) for s in _SHOOTING_SKILLS)
    has_creation = any(_has(cornerstone, s) for s in _CREATION_SKILLS)
    # Off-ball profile: has shooting but lacks dominant on-ball skill
    return has_shooting and not _is_onball_dominant(cornerstone)


# ---------------------------------------------------------------------------
# Gap rule descriptor
# ---------------------------------------------------------------------------

@dataclass
class _GapRule:
    """
    A single complement gap to check.

    priority: lower = surfaced first
    condition: (cornerstone, supporting, all_players, stage) -> bool
               Returns True when the gap exists and a note should fire.
    narrative: (cornerstone_name, stage) -> str
    dimension: dimension category for the note
    trace_key: unique identifier (used for what-changed diff in the UI)
    """
    priority: int
    condition: Callable[[dict, list[dict], list[dict], int], bool]
    narrative: Callable[[str, dict, list[dict], int], str]
    dimension: str
    trace_key: str


# ---------------------------------------------------------------------------
# Gap rules — defined in priority order
# ---------------------------------------------------------------------------

def _gap_missing_creator(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    No primary creator in the full rotation. Fire when neither the cornerstone
    nor any current supporting player can generate offense off the dribble.
    """
    return not _any_has_any(all_players, _CREATION_SKILLS)


def _narrative_missing_creator(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    # Tailor based on whether cornerstone is defensive or all-around
    has_defense = any(_has(cornerstone, s) for s in _DEFENSE_SKILLS)
    if has_defense and not any(_has(cornerstone, s) for s in _SHOOTING_SKILLS | _CREATION_SKILLS):
        return (
            f"{name} anchors the defense but the roster has no offensive engine — "
            f"target a primary creator as {label} who can generate shots for the entire team."
        )
    return (
        f"No primary creator in the rotation yet — add a PnR ball handler or elite driver as {label} "
        f"to give the offense a reliable way to generate half-court looks."
    )


def _gap_missing_spacing(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    Cornerstone is on-ball dominant but the full rotation is light on shooting.
    A dominant creator needs floor spacing or defenders collapse every possession.
    Counts the cornerstone's own shooting gravity — a Curry-type (elite handler + shooter)
    only needs one more shooter, not two.
    """
    if not _is_onball_dominant(cornerstone):
        return False
    # Count shooters across the full rotation (cornerstone counts too — their gravity is real)
    shooter_count = sum(1 for p in all_players if any(_has(p, s) for s in _SHOOTING_SKILLS))
    # Gap if fewer than 2 shooters total in the rotation
    return shooter_count < 2


def _narrative_missing_spacing(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    existing_shooters = sum(1 for p in supporting if any(_has(p, s) for s in _SHOOTING_SKILLS))
    # Figure out which on-ball skill makes the cornerstone dominant
    if _has(cornerstone, "pnr_ball_handler", "Elite"):
        action = "PnR game"
    elif _has(cornerstone, "low_post_player", "Elite"):
        action = "post game"
    elif _has(cornerstone, "driver", "Elite"):
        action = "drive-and-kick game"
    else:
        action = "on-ball creation"
    if existing_shooters == 0:
        return (
            f"{name}'s {action} needs floor spacing to operate — defenders will collapse without "
            f"shooters to punish them. Prioritize a spot-up or movement shooter as {label}."
        )
    else:
        return (
            f"{name}'s {action} benefits from multiple shooters spacing the floor — "
            f"one shooter isn't enough to keep help defenders honest. Add another {label} who can shoot."
        )


def _gap_missing_rim_protector(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """No rim protector anywhere in the full rotation."""
    return not _any_has(all_players, "rim_protector")


def _narrative_missing_rim_protector(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    # If cornerstone is a perimeter player, emphasize interior deterrence
    has_vd = _has(cornerstone, "versatile_defender")
    if has_vd:
        return (
            f"{name} covers the perimeter defensively but leaves interior deterrence uncovered — "
            f"add a rim protector as {label} to complete the two-level defensive picture."
        )
    return (
        f"No interior anchor in the rotation — a rim protector as {label} would give the defense "
        f"a deterrent that forces opponents to earn every paint touch."
    )


def _gap_missing_passer(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    No passer in the full rotation, and there are (or will be) off-ball players
    who need someone to find them. Only fires when the cornerstone is not already
    the playmaker — don't suggest a passer if the cornerstone IS the passer.
    """
    if _has(cornerstone, "passer"):
        return False  # cornerstone already handles playmaking
    if _any_has(all_players, "passer"):
        return False  # already have one
    # Check if there are off-ball players in the supporting cast who need a passer
    offball_skills = frozenset({"cutter", "pnr_finisher", "vertical_spacer", "movement_shooter"})
    has_offball_players = _any_has_any(supporting, offball_skills)
    # At stage 0, always fire (cornerstone will need a passer on the roster eventually)
    return stage == 0 or has_offball_players


def _narrative_missing_passer(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    # If cornerstone is a scorer/shooter, a playmaking co-star is the classic pairing
    is_scorer = any(_has(cornerstone, s) for s in _SHOOTING_SKILLS | {"driver", "isolation_scorer"})
    if is_scorer and stage == 0:
        return (
            f"{name} scores but doesn't run the offense — a pass-first {label} would unlock "
            f"off-ball actions, find {name} in catch-and-shoot spots, and take creation pressure off the roster."
        )
    return (
        f"No playmaker in the rotation — add a passer as {label} to find cutters, "
        f"trigger off-ball actions, and reduce reliance on one-on-one creation."
    )


def _gap_missing_perimeter_defense(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    Full rotation has neither a versatile defender nor perimeter disruptor.
    Don't fire if cornerstone already handles perimeter defense.
    """
    if _has(cornerstone, "versatile_defender") or _has(cornerstone, "perimeter_disruptor"):
        return False  # cornerstone covers it
    has_vd = _any_has(all_players, "versatile_defender")
    has_pd = _any_has(all_players, "perimeter_disruptor")
    return not has_vd and not has_pd


def _narrative_missing_perimeter_defense(
    name: str, cornerstone: dict, supporting: list[dict], stage: int
) -> str:
    label = _stage_label(stage)
    has_rim = _any_has([cornerstone] + supporting, "rim_protector")
    if has_rim:
        return (
            f"Interior defense is covered but the perimeter is exposed — "
            f"add a versatile defender as {label} who can switch and disrupt on the outside."
        )
    return (
        f"No defensive versatility in the rotation — a two-way {label} with perimeter "
        f"disruption ability would give the defense someone to switch onto guards and wings."
    )


def _gap_missing_rebounder(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    No capable rebounder in the full rotation. Lower priority — surfaces after
    offensive and primary defensive gaps.
    Only fires at stage 0-1 if cornerstone is a perimeter/guard type without rebounding.
    """
    if _any_has(all_players, "rebounder"):
        return False
    # Only suggest this early if the cornerstone clearly won't rebound (a guard/wing type)
    cs_is_perimeter = (
        not _has(cornerstone, "rebounder") and
        not _has(cornerstone, "rim_protector") and
        not _has(cornerstone, "low_post_player")
    )
    return cs_is_perimeter


def _narrative_missing_rebounder(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    return (
        f"No rebounder in the rotation — {name}'s perimeter profile means the glass will be uncontested. "
        f"Add a {label} who can secure defensive boards and limit second-chance opportunities."
    )


def _gap_missing_pnr_finisher(
    cornerstone: dict, supporting: list[dict], all_players: list[dict], stage: int
) -> bool:
    """
    Cornerstone is an elite PnR handler but no PnR finisher in the supporting cast.
    The two-man game is the most efficient half-court action in basketball.
    """
    if not _has(cornerstone, "pnr_ball_handler", "Elite"):
        return False
    return not _any_has(supporting, "pnr_finisher")


def _narrative_missing_pnr_finisher(name: str, cornerstone: dict, supporting: list[dict], stage: int) -> str:
    label = _stage_label(stage)
    return (
        f"{name}'s elite pick-and-roll game needs a finisher to complete the two-man action — "
        f"a high-flying roll man as {label} turns every PnR into a live lob threat the defense can't ignore."
    )


# ---------------------------------------------------------------------------
# Rule registry — ordered by priority (index 0 = highest priority)
# ---------------------------------------------------------------------------

_GAP_RULES: list[_GapRule] = [
    _GapRule(
        priority=0,
        condition=_gap_missing_creator,
        narrative=_narrative_missing_creator,
        dimension="creation",
        trace_key="COMPLEMENT_CREATOR",
    ),
    _GapRule(
        priority=1,
        condition=_gap_missing_pnr_finisher,
        narrative=_narrative_missing_pnr_finisher,
        dimension="creation",
        trace_key="COMPLEMENT_PNR_FINISHER",
    ),
    _GapRule(
        priority=2,
        condition=_gap_missing_spacing,
        narrative=_narrative_missing_spacing,
        dimension="spacing",
        trace_key="COMPLEMENT_SPACING",
    ),
    _GapRule(
        priority=3,
        condition=_gap_missing_rim_protector,
        narrative=_narrative_missing_rim_protector,
        dimension="defense",
        trace_key="COMPLEMENT_RIM",
    ),
    _GapRule(
        priority=4,
        condition=_gap_missing_passer,
        narrative=_narrative_missing_passer,
        dimension="creation",
        trace_key="COMPLEMENT_PASSER",
    ),
    _GapRule(
        priority=5,
        condition=_gap_missing_perimeter_defense,
        narrative=_narrative_missing_perimeter_defense,
        dimension="defense",
        trace_key="COMPLEMENT_PERIMETER_D",
    ),
    _GapRule(
        priority=6,
        condition=_gap_missing_rebounder,
        narrative=_narrative_missing_rebounder,
        dimension="defense",
        trace_key="COMPLEMENT_REBOUNDER",
    ),
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_complement_notes(
    cornerstone: dict,
    supporting_players: list[dict],
) -> list[Note]:
    """
    Analyze the cornerstone's skill profile against the current supporting rotation
    and return directional suggestion notes for what archetype to target next.

    Only call this when len(supporting_players) < COMPLEMENT_STAGE_CUTOFF.
    Returns at most MAX_COMPLEMENT_NOTES notes in priority order.
    """
    stage = len(supporting_players)
    all_players = [cornerstone] + supporting_players
    cs_name = cornerstone.get("name", "Your cornerstone")

    notes: list[Note] = []
    for rule in _GAP_RULES:
        if len(notes) >= MAX_COMPLEMENT_NOTES:
            break
        if rule.condition(cornerstone, supporting_players, all_players, stage):
            text = rule.narrative(cs_name, cornerstone, supporting_players, stage)
            notes.append(Note(
                severity="suggestion",
                category="offense" if rule.dimension in ("spacing", "creation", "paint") else "defense",
                text=text,
                trace_key=rule.trace_key,
                presence_type="absence",
                dimension=rule.dimension,
            ))

    return notes
