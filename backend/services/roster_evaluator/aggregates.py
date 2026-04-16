"""
roster_evaluator/aggregates.py — Cross-roster aggregate functions (Phase 2).

Takes a unified roster (list of player dicts) and computes team-level metrics
that Phase 3 rules consume to generate GM notes.

Player dict shape (same as player_scores.py):
  {"name": str, "height": str | None, "skills": dict[str, str]}

All scored aggregates return ScoreTrace. Boolean checks return plain bool.
compute_aggregates() is the single entry point for Phase 3+.

Public API — utilities:
  skill_score(roster, skill)               → float
  team_best(roster, skill)                 → str
  count_at_or_above(roster, skill, tier)   → int

Public API — scored aggregates:
  spacing_score(roster)                    → ScoreTrace
  passer_compound_score(roster)            → ScoreTrace
  perimeter_compound_score(roster)         → ScoreTrace
  defense_score(roster)                    → ScoreTrace
  cutter_score(roster)                     → ScoreTrace
  paint_touch_score(roster)                → ScoreTrace
  rebounding_covered(roster)               → ScoreTrace

Public API — boolean checks:
  lob_threat_active(roster)                → bool
  pnr_synergy(roster)                      → bool
  transition_active(roster)                → bool
  movement_orphaned(roster)                → bool

Public API — orchestration:
  compute_aggregates(roster)               → dict[str, ScoreTrace | bool]
"""

from __future__ import annotations
from .types import ScoreTrace
from .weights import (
    TIER_WEIGHTS,
    SPACING_WEIGHTS,
    PAINT_TOUCH_WEIGHTS,
    CROSS_ROSTER_MULTIPLIERS,
    COMPOUNDING_EXPONENTS,
)
from .player_scores import tier_weight, size_modifier, gravity


# ---------------------------------------------------------------------------
# Internal helper — mirrors player_scores._scale, kept local to avoid coupling
# ---------------------------------------------------------------------------

def _scale(value: float, min_out: float, max_out: float, max_input: float) -> float:
    """Linear map from [0, max_input] → [min_out, max_out], clamped."""
    if max_input <= 0:
        return min_out
    ratio = max(0.0, min(1.0, value / max_input))
    return min_out + ratio * (max_out - min_out)


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def skill_score(roster: list[dict], skill: str) -> float:
    """Sum of tier weights for a skill across all filled roster slots."""
    return round(sum(tier_weight(p, skill) for p in roster), 3)


def team_best(roster: list[dict], skill: str) -> str:
    """
    Highest tier any player has for a given skill.
    Returns 'None' for an empty roster or if no player has the skill.
    """
    if not roster:
        return "None"
    # Sort tiers by weight descending, return first match
    sorted_tiers = sorted(TIER_WEIGHTS, key=lambda t: TIER_WEIGHTS[t], reverse=True)
    for tier in sorted_tiers:
        if any(tier_weight(p, skill) == TIER_WEIGHTS[tier] for p in roster):
            return tier
    return "None"


def count_at_or_above(roster: list[dict], skill: str, min_tier: str) -> int:
    """Number of players with a tier at or above min_tier for a given skill."""
    min_weight = TIER_WEIGHTS.get(min_tier, 0)
    # None tier (weight 0) should never count even when min_tier is "None"
    if min_weight == 0:
        return 0
    return sum(1 for p in roster if tier_weight(p, skill) >= min_weight)


# ---------------------------------------------------------------------------
# Scored aggregates
# ---------------------------------------------------------------------------

def spacing_score(roster: list[dict]) -> ScoreTrace:
    """
    Effective off-ball shooting space created by this roster.

    Movement shooters are weighted 2× spot-up shooters (per heuristics).
    Screen setters amplify movement shooters — without screens, movement
    shooters can't get open looks off actions and operate at reduced value.
    Spot-up shooters are independent of screens (catch-and-shoot from sets).

    Formula:
        screen_mult  = scale(screen_setter_score, 0.5, 1.2)
        effective    = (movement_raw × screen_mult) + spot_up_raw
    """
    movement_raw = skill_score(roster, "movement_shooter") * SPACING_WEIGHTS["movement_shooter"]
    spot_up_raw  = skill_score(roster, "spot_up_shooter")  * SPACING_WEIGHTS["spot_up_shooter"]
    screen_raw   = skill_score(roster, "screen_setter")

    cfg = CROSS_ROSTER_MULTIPLIERS["screen_to_movement"]
    screen_mult = round(_scale(screen_raw, cfg["min"], cfg["max"], cfg["max_input"]), 4)

    effective = round((movement_raw * screen_mult) + spot_up_raw, 3)

    label = (
        f"Spacing {effective:.1f} "
        f"(movement={movement_raw:.1f}×{screen_mult:.2f}, spot-up={spot_up_raw:.1f})"
    )

    return ScoreTrace(
        score=effective,
        components={
            "movement_shooter_raw": round(movement_raw, 3),
            "spot_up_shooter_raw":  round(spot_up_raw, 3),
            "screen_setter_raw":    round(screen_raw, 3),
        },
        multipliers={"screen_to_movement": screen_mult},
        label=label,
    )


def passer_compound_score(roster: list[dict]) -> ScoreTrace:
    """
    Non-linear value of passing talent on this roster.

    Two good passers create more value than 2× one good passer because
    they enable each other's off-ball players simultaneously and prevent
    defenses from keying on a single playmaker.

    Formula: compounded = raw ^ 1.2
    """
    raw = skill_score(roster, "passer")
    if raw == 0:
        return ScoreTrace(
            score=0.0,
            components={"raw_passer_score": 0.0},
            multipliers={"exponent": COMPOUNDING_EXPONENTS["passers"]},
            label="Passer compound 0.0 — no passers",
        )

    exp = COMPOUNDING_EXPONENTS["passers"]
    compounded = round(raw ** exp, 3)

    return ScoreTrace(
        score=compounded,
        components={"raw_passer_score": round(raw, 3)},
        multipliers={"exponent": exp},
        label=f"Passer compound {compounded:.2f} (raw={raw:.1f}, exponent={exp})",
    )


def perimeter_compound_score(roster: list[dict]) -> ScoreTrace:
    """
    Non-linear value of perimeter defensive talent on this roster.

    Perimeter disruptors compound each other more strongly than any other
    skill (the Thunder effect). Versatile defenders also contribute but
    at 0.7× the rate of pure perimeter disruptors.

    Formula:
        raw        = perimeter_disruptor_score + versatile_defender_score × 0.7
        compounded = raw ^ 1.3
    """
    perimeter_raw = skill_score(roster, "perimeter_disruptor")
    versatile_raw = skill_score(roster, "versatile_defender")
    combined_raw  = round(perimeter_raw + versatile_raw * 0.7, 3)

    if combined_raw == 0:
        return ScoreTrace(
            score=0.0,
            components={"perimeter_raw": 0.0, "versatile_contribution": 0.0},
            multipliers={"exponent": COMPOUNDING_EXPONENTS["perimeter_disruptors"]},
            label="Perimeter compound 0.0 — no perimeter defense",
        )

    exp = COMPOUNDING_EXPONENTS["perimeter_disruptors"]
    compounded = round(combined_raw ** exp, 3)

    return ScoreTrace(
        score=compounded,
        components={
            "perimeter_raw":        round(perimeter_raw, 3),
            "versatile_contribution": round(versatile_raw * 0.7, 3),
            "combined_raw":         combined_raw,
        },
        multipliers={"exponent": exp},
        label=f"Perimeter compound {compounded:.2f} (raw={combined_raw:.1f}, exponent={exp})",
    )


def defense_score(roster: list[dict]) -> ScoreTrace:
    """
    Overall defensive quality of the roster.

    Each player's defensive skill contributions are weighted by their
    size_modifier — taller players have more presence at the same skill tier.
    A rim anchor (Elite+ rim protector) amplifies perimeter defenders
    by forcing opponents into contested shots in recovery.

    Formula:
        rim_score    = Σ tier_weight(rim_protector) × size_modifier  per player
        rim_mult     = scale(rim_score, 1.0, 1.4)  (amplification)
        perim_comp   = perimeter_compound_score (size-independent compound)
        versatile    = Σ tier_weight(versatile_defender) × size_modifier
        score        = (rim_score × rim_mult) + perim_comp + (versatile × 0.9)
    """
    # Size-weighted rim and versatile contributions
    rim_score = round(
        sum(tier_weight(p, "rim_protector") * size_modifier(p).score for p in roster), 3
    )
    versatile_size_score = round(
        sum(tier_weight(p, "versatile_defender") * size_modifier(p).score for p in roster), 3
    )

    # Rim anchor amplifies perimeter
    cfg = CROSS_ROSTER_MULTIPLIERS["rim_to_perimeter"]
    rim_mult = round(_scale(rim_score, cfg["min"], cfg["max"], cfg["max_input"]), 4)

    # Perimeter compound (uses unweighted scores — the compounding effect is
    # about the number of disruptors, not their size)
    perim_comp = perimeter_compound_score(roster).score

    score = round((rim_score * rim_mult) + perim_comp + (versatile_size_score * 0.9), 3)

    return ScoreTrace(
        score=score,
        components={
            "rim_score (size-weighted)":       rim_score,
            "perimeter_compound":              perim_comp,
            "versatile_score (size-weighted)": versatile_size_score,
        },
        multipliers={"rim_anchor_amplification": rim_mult},
        label=(
            f"Defense {score:.2f} "
            f"(rim={rim_score:.1f}×{rim_mult:.2f}, perim={perim_comp:.1f}, "
            f"versatile={versatile_size_score:.1f})"
        ),
    )


def cutter_score(roster: list[dict]) -> ScoreTrace:
    """
    Effective cutting threat on this roster.

    Cutters require four conditions to generate value:
      1. Passers — to find them in the cut (passer_compound gates this)
      2. Spacing  — to have room to cut into
      3. Screen setters — to create back-cuts and pin-downs
      4. On-ball gravity — an occupied defense leaves more cutting lanes

    All four gates multiply the raw cutter talent. A great cutter with no
    passer and no spacing is nearly useless; the same cutter in the right
    system approaches their full value.
    """
    cutter_raw = skill_score(roster, "cutter")
    if cutter_raw == 0:
        return ScoreTrace(
            score=0.0,
            components={"cutter_raw": 0.0},
            multipliers={},
            label="Cutter score 0.0 — no cutters",
        )

    # Gate 1: passer compound
    passer_comp = passer_compound_score(roster).score
    cfg_passer = CROSS_ROSTER_MULTIPLIERS["passer_to_cutter"]
    passer_mult = round(_scale(passer_comp, cfg_passer["min"], cfg_passer["max"], cfg_passer["max_input"]), 4)

    # Gate 2: spacing
    space = spacing_score(roster).score
    cfg_spacing = CROSS_ROSTER_MULTIPLIERS["spacing_to_cutter"]
    spacing_mult = round(_scale(space, cfg_spacing["min"], cfg_spacing["max"], cfg_spacing["max_input"]), 4)

    # Gate 3: screen setters (create back-cut opportunities)
    screen_raw = skill_score(roster, "screen_setter")
    cfg_screen = CROSS_ROSTER_MULTIPLIERS["screen_to_cutter"]
    screen_mult = round(_scale(screen_raw, cfg_screen["min"], cfg_screen["max"], cfg_screen["max_input"]), 4)

    # Gate 4: on-ball gravity of roster (occupied defense = more cutting lanes)
    total_onball_gravity = round(sum(gravity(p) for p in roster), 3)
    cfg_grav = CROSS_ROSTER_MULTIPLIERS["onball_gravity_to_cutter"]
    gravity_mult = round(_scale(total_onball_gravity, cfg_grav["min"], cfg_grav["max"], cfg_grav["max_input"]), 4)

    effective = round(cutter_raw * passer_mult * spacing_mult * screen_mult * gravity_mult, 3)

    return ScoreTrace(
        score=effective,
        components={
            "cutter_raw":          round(cutter_raw, 3),
            "total_onball_gravity": total_onball_gravity,
        },
        multipliers={
            "passer_mult":   passer_mult,
            "spacing_mult":  spacing_mult,
            "screen_mult":   screen_mult,
            "gravity_mult":  gravity_mult,
        },
        label=(
            f"Cutter {effective:.2f} "
            f"(raw={cutter_raw:.1f}, passer={passer_mult:.2f}, "
            f"spacing={spacing_mult:.2f}, screen={screen_mult:.2f}, "
            f"gravity={gravity_mult:.2f})"
        ),
    )


def paint_touch_score(roster: list[dict]) -> ScoreTrace:
    """
    Effectiveness of paint access on this roster.

    Measures how reliably this roster can get the ball in the paint via
    driving, posting, or lob threats. Each paint-touch skill is weighted
    by its tier and its type (drivers weighted highest, post slightly less).

    A player with multiple paint-touch skills is more versatile and both
    contributions count.
    """
    components: dict[str, float] = {}
    total = 0.0

    for i, player in enumerate(roster):
        for skill, weight in PAINT_TOUCH_WEIGHTS.items():
            contribution = tier_weight(player, skill) * weight
            if contribution > 0:
                # Use index prefix to guarantee uniqueness — player names may collide
                key = f"{i}:{player['name']}.{skill}"
                components[key] = round(contribution, 3)
                total += contribution

    score = round(total, 3)
    label = f"Paint touch {score:.2f}" + (
        f" — led by {max(components, key=lambda k: components[k])}"
        if components else " — no paint sources"
    )

    return ScoreTrace(
        score=score,
        components=components,
        multipliers={},
        label=label,
    )


def rebounding_covered(roster: list[dict]) -> ScoreTrace:
    """
    Whether this roster has sufficient rebounding to end defensive possessions.

    Two paths to adequate rebounding:
      - Elite path: at least 1 player with Elite+ rebounding
      - Committee path: at least 3 players with Capable+ rebounding

    Returns score 1.0 if covered, 0.0 if not.
    """
    elite_count   = count_at_or_above(roster, "rebounder", "Elite")
    capable_count = count_at_or_above(roster, "rebounder", "Capable")
    covered = elite_count >= 1 or capable_count >= 3

    return ScoreTrace(
        score=1.0 if covered else 0.0,
        components={
            "elite_rebounder_count":  float(elite_count),
            "capable_rebounder_count": float(capable_count),
        },
        multipliers={},
        label=(
            f"Rebounding {'covered' if covered else 'not covered'} "
            f"(elite={elite_count}, capable={capable_count})"
        ),
    )


# ---------------------------------------------------------------------------
# Boolean checks
# ---------------------------------------------------------------------------

def lob_threat_active(roster: list[dict]) -> bool:
    """
    True if this roster has both a lob target AND a reliable lob thrower.

    A vertical spacer without a passer or driver to throw the lob is reduced
    to a static finisher — they lose most of their lane-opening value.
    Requires: vertical_spacer ≥ Capable AND (passer ≥ Proficient OR driver ≥ Proficient).
    """
    spacer_weight = TIER_WEIGHTS.get(team_best(roster, "vertical_spacer"), 0)
    has_spacer = spacer_weight >= TIER_WEIGHTS["Capable"]
    has_passer = TIER_WEIGHTS.get(team_best(roster, "passer"), 0) >= TIER_WEIGHTS["Proficient"]
    has_driver = TIER_WEIGHTS.get(team_best(roster, "driver"), 0) >= TIER_WEIGHTS["Proficient"]
    return has_spacer and (has_passer or has_driver)


def pnr_synergy(roster: list[dict]) -> bool:
    """
    True if the roster has both a capable PnR ball handler AND a capable finisher.

    Both sides must be Proficient+ — a great handler without a finisher
    leaves the roll man ignored, and vice versa.
    """
    handler_best  = TIER_WEIGHTS.get(team_best(roster, "pnr_ball_handler"), 0)
    finisher_best = TIER_WEIGHTS.get(team_best(roster, "pnr_finisher"), 0)
    min_tier = TIER_WEIGHTS["Proficient"]
    return handler_best >= min_tier and finisher_best >= min_tier


def transition_active(roster: list[dict]) -> bool:
    """
    True if the roster has transition threats AND a passer to advance the ball.

    Transition threats alone can push tempo, but without a reliable passer
    they can't generate advantage fast enough to convert. The passer turns
    transition runners into a coherent fast-break attack.
    Requires: transition_threat ≥ Capable (any player) AND passer ≥ Proficient.
    """
    has_threats = count_at_or_above(roster, "transition_threat", "Capable") > 0
    has_passer  = TIER_WEIGHTS.get(team_best(roster, "passer"), 0) >= TIER_WEIGHTS["Proficient"]
    return has_threats and has_passer


def shooter_count(roster: list[dict], min_tier: str = "Capable") -> int:
    """
    Number of players who can credibly stretch the floor.

    Counts players with spot_up_shooter OR movement_shooter at or above min_tier.
    Each player counted once even if they have both skills.
    """
    min_weight = TIER_WEIGHTS.get(min_tier, 0)
    if min_weight == 0:
        return 0
    return sum(
        1 for p in roster
        if tier_weight(p, "spot_up_shooter") >= min_weight
        or tier_weight(p, "movement_shooter") >= min_weight
    )


def movement_orphaned(roster: list[dict]) -> bool:
    """
    True if the roster has movement shooters but no screen setters to free them.

    Movement shooters need off-screen and handoff actions to generate open looks.
    Without capable screen setters, they can't run those actions effectively
    and their movement-shooting ability goes largely unused.
    """
    has_movement = count_at_or_above(roster, "movement_shooter", "Capable") > 0
    has_screens  = count_at_or_above(roster, "screen_setter", "Capable") > 0
    return has_movement and not has_screens


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def compute_aggregates(roster: list[dict]) -> "dict[str, ScoreTrace | bool]":
    """
    Compute all cross-roster aggregates for Phase 3 rule consumption.

    Returns a flat dict mapping aggregate name → ScoreTrace | bool.
    ScoreTrace values: read .score for numeric comparisons.
    bool values: used directly by rule predicates.
    """
    return {
        # Scored aggregates
        "spacing_score":             spacing_score(roster),
        "passer_compound_score":     passer_compound_score(roster),
        "perimeter_compound_score":  perimeter_compound_score(roster),
        "defense_score":             defense_score(roster),
        "cutter_score":              cutter_score(roster),
        "paint_touch_score":         paint_touch_score(roster),
        "rebounding_covered":        rebounding_covered(roster),
        # Boolean checks
        "lob_threat_active":         lob_threat_active(roster),
        "pnr_synergy":               pnr_synergy(roster),
        "transition_active":         transition_active(roster),
        "movement_orphaned":         movement_orphaned(roster),
        # Shooter distribution
        "shooter_count_proficient":  shooter_count(roster, "Proficient"),
        "shooter_count_capable":     shooter_count(roster, "Capable"),
        # Perimeter disruptor headcount (separate from compound score)
        "perimeter_disruptor_count": count_at_or_above(roster, "perimeter_disruptor", "Capable"),
    }
