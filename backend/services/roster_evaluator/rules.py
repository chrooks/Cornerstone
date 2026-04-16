"""
roster_evaluator/rules.py — Phase 3 rule functions.

Each rule: check_X(roster, agg) → Note | None
  roster: list of unified player dicts
  agg:    result of compute_aggregates(roster)

Two rule groups consumed by evaluator.py:
  ALL_RULES      — always evaluated (critical, warning, tip)
  STRENGTH_RULES — final mode only (strength)

Public API:
  ALL_RULES: list[Callable]
  STRENGTH_RULES: list[Callable]
  (plus all check_* functions for direct testing)
"""

from __future__ import annotations
from .types import Note
from .weights import (
    TIER_WEIGHTS,
    SPACING_THRESHOLDS,
    DEFENSE_THRESHOLDS,
    PERIMETER_THRESHOLDS,
    PERIMETER_DISRUPTOR_THRESHOLDS,
    STRENGTH_THRESHOLDS,
    CUTTER_ACTIVATION_RATIO,
    SHOOTER_DEPTH_THRESHOLDS,
)
from .player_scores import (
    tier_weight,
    is_exclusively_onball,
    is_twoway,
    is_offensive_blackhole,
    CREATION_SKILLS,
    DEFENSIVE_SKILLS,
)
from .aggregates import count_at_or_above, skill_score, team_best


# ---------------------------------------------------------------------------
# Module-local skill-set constants
# ---------------------------------------------------------------------------

# All offensive skills — used to check whether a player can justify
# having no defensive floor ("Elite at something else")
_OFFENSIVE_SKILLS: frozenset[str] = frozenset({
    "off_dribble_shooter",
    "isolation_scorer",
    "mid_post_player",
    "driver",
    "low_post_player",
    "crafty_finisher",
    "transition_threat",
    "spot_up_shooter",
    "movement_shooter",
    "cutter",
    "vertical_spacer",
    "pnr_ball_handler",
    "pnr_finisher",
    "screen_setter",
    "passer",
    "offensive_rebounder",
    "high_flyer",
})


# ---------------------------------------------------------------------------
# Defense rules
# ---------------------------------------------------------------------------

def check_rim_anchor(roster: list[dict], agg: dict) -> Note | None:
    """
    Critical if no rim protector ≥ Proficient AND versatile defender depth < 3.

    A deep versatile defender rotation can compensate for the absence of a rim
    anchor, but requires breadth (≥3 capable+). One rim protector at Proficient
    satisfies the anchor requirement alone.
    """
    rim_best = TIER_WEIGHTS.get(team_best(roster, "rim_protector"), 0)
    if rim_best >= TIER_WEIGHTS["Proficient"]:
        return None
    versatile_count = count_at_or_above(roster, "versatile_defender", "Capable")
    if versatile_count >= int(DEFENSE_THRESHOLDS["versatile_depth_min"]):
        return None
    return Note(
        severity="critical",
        category="defense",
        text=(
            "No rim anchor and insufficient versatile defender depth — "
            "this defense will struggle protecting the paint."
        ),
        trace_key="defense_score",
    )


def check_perimeter_compounding(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if perimeter defensive compound score is below the warning threshold.

    Perimeter defense compounds non-linearly — a single disruptor has limited
    impact, but multiple disruptors trap and rotate together. Below the threshold,
    the roster lacks the depth to benefit from that compounding effect.
    """
    score = agg["perimeter_compound_score"].score
    if score >= PERIMETER_THRESHOLDS["warning"]:
        return None
    return Note(
        severity="warning",
        category="defense",
        text=(
            "Thin perimeter defense — the compounding value of multiple "
            "quality disruptors is missing."
        ),
        trace_key="perimeter_compound_score",
    )


def check_perimeter_disruptor_depth(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if fewer than 2 perimeter disruptors; Tip if fewer than 3.

    perimeter_compound_score gets inflated by versatile defenders, masking
    the absence of dedicated on-ball disruptors. This rule checks raw headcount
    of players who can actually lock up on the perimeter — the skill that
    compounds most aggressively (Thunder effect). Without at least two,
    the roster can't trap, switch, or generate pressure across possessions.
    """
    n = len(roster)
    if n < PERIMETER_DISRUPTOR_THRESHOLDS["min_roster_size"]:
        return None

    count = agg["perimeter_disruptor_count"]

    versatile_count = count_at_or_above(roster, "versatile_defender", "Capable")

    if count < PERIMETER_DISRUPTOR_THRESHOLDS["warning_capable"]:
        coverage = (
            f" {versatile_count} versatile defenders provide some switching coverage,"
            " but" if versatile_count >= 2 else " —"
        )
        return Note(
            severity="warning",
            category="defense",
            text=(
                f"Only {count} dedicated perimeter disruptor{'s' if count != 1 else ''} on "
                f"a {n}-player roster.{coverage} "
                "this defense can't generate consistent on-ball pressure or traps."
            ),
            trace_key="perimeter_compound_score",
        )

    if count < PERIMETER_DISRUPTOR_THRESHOLDS["tip_capable"]:
        return Note(
            severity="tip",
            category="defense",
            text=(
                f"Thin perimeter disruption depth — only {count} dedicated "
                "on-ball disruptors. Foul trouble or matchup problems leave "
                "the perimeter exposed."
            ),
            trace_key="perimeter_compound_score",
        )

    return None


def check_defense_blackhole(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if any player has no defensive floor and no Elite+ offense.

    Per heuristics: "If you aren't at least a capable defender, you better be
    Elite at something else." Players who can't defend AND aren't elite enough
    offensively to justify the liability are flagged by name.
    """
    flagged: list[str] = []
    for player in roster:
        has_defense = any(
            tier_weight(player, s) >= TIER_WEIGHTS["Capable"]
            for s in DEFENSIVE_SKILLS
        )
        if has_defense:
            continue
        has_elite_offense = any(
            tier_weight(player, s) >= TIER_WEIGHTS["Elite"]
            for s in _OFFENSIVE_SKILLS
        )
        if not has_elite_offense:
            flagged.append(player["name"])

    if not flagged:
        return None

    names = ", ".join(flagged)
    verb = "has" if len(flagged) == 1 else "have"
    return Note(
        severity="warning",
        category="defense",
        text=(
            f"{names} {verb} no defensive floor and aren't elite enough offensively "
            "to justify the liability."
        ),
        trace_key="defense_score",
    )


def check_offensive_blackhole(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if more than one player has no offensive threat (no shooting or creation).

    Offensive blackholes get sagged on by defenses — they enable hard doubles
    on your on-ball players and eliminate floor space. One blackhole is tolerable
    (great defense can offset it); multiple blackholes compound the damage.
    """
    blackholes = [p["name"] for p in roster if is_offensive_blackhole(p)]
    if len(blackholes) <= int(DEFENSE_THRESHOLDS["blackhole_max"]):
        return None
    names = ", ".join(blackholes)
    return Note(
        severity="warning",
        category="two_way",
        text=(
            f"{names} create spacing penalties — no shooting or creation forces "
            "defenses to sag and double your on-ball players."
        ),
        trace_key="paint_touch_score",
    )


def check_rebounding(roster: list[dict], agg: dict) -> Note | None:
    """Warning if neither the elite nor committee rebounding threshold is met."""
    if agg["rebounding_covered"].score >= 1.0:
        return None
    return Note(
        severity="warning",
        category="defense",
        text=(
            "No clear rebounding presence — this roster needs either an elite "
            "rebounder or a committee of capable ones."
        ),
        trace_key="rebounding_covered",
    )


# ---------------------------------------------------------------------------
# Offense rules
# ---------------------------------------------------------------------------

def check_spacing_critical(roster: list[dict], agg: dict) -> Note | None:
    """Critical if spacing score is below the critical threshold."""
    if agg["spacing_score"].score >= SPACING_THRESHOLDS["critical"]:
        return None
    return Note(
        severity="critical",
        category="offense",
        text=(
            "Critically low spacing — on-ball skills are nearly neutralized "
            "without floor shooters."
        ),
        trace_key="spacing_score",
    )


def check_spacing_warning(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if spacing score is in the warning band (above critical, below warning).

    check_spacing_critical handles the band below critical — this rule only
    fires in the middle band so both notes never fire simultaneously.
    """
    score = agg["spacing_score"].score
    if score < SPACING_THRESHOLDS["critical"] or score >= SPACING_THRESHOLDS["warning"]:
        return None
    return Note(
        severity="warning",
        category="offense",
        text=(
            "Tight spacing — limited off-ball shooting constrains what "
            "on-ball players can do."
        ),
        trace_key="spacing_score",
    )


def check_shooter_depth(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if fewer than 3 Proficient+ shooters; Tip if fewer than 4 Capable+.

    spacing_score measures shooting quality but not distribution — two Elite
    shooters surrounded by five non-shooters still scores well, but defenses
    sag off every non-shooter and collapse the paint. This rule catches that
    concentration problem independently of the composite spacing score.

    Skipped if roster is too small to draw a meaningful conclusion.
    """
    n = len(roster)
    if n < SHOOTER_DEPTH_THRESHOLDS["min_roster_size"]:
        return None

    prof_count = agg["shooter_count_proficient"]
    cap_count  = agg["shooter_count_capable"]

    if prof_count < SHOOTER_DEPTH_THRESHOLDS["warning_proficient"]:
        return Note(
            severity="warning",
            category="offense",
            text=(
                f"Only {prof_count} reliable floor spacer{'s' if prof_count != 1 else ''} "
                f"(Proficient+ shooter) on a {n}-player roster — "
                "defenses will sag off every non-shooter and pack the paint."
            ),
            trace_key="spacing_score",
        )

    if cap_count < SHOOTER_DEPTH_THRESHOLDS["tip_capable"]:
        return Note(
            severity="tip",
            category="offense",
            text=(
                f"Thin shooting distribution — only {cap_count} players "
                "can credibly threaten from range. On-ball players will face "
                "crowded paint against disciplined defenses."
            ),
            trace_key="spacing_score",
        )

    return None


def check_movement_orphaned(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if movement shooters are present but no capable screen setters exist.

    Movement shooters generate value from off-screen and handoff actions. Without
    screen setters running those actions, they revert to spot-up value at best.
    """
    if not agg["movement_orphaned"]:
        return None
    shooters = [
        p["name"] for p in roster
        if tier_weight(p, "movement_shooter") >= TIER_WEIGHTS["Capable"]
    ]
    names = ", ".join(shooters)
    noun = "movement shooter" if len(shooters) == 1 else "movement shooters"
    return Note(
        severity="warning",
        category="offense",
        text=(
            f"{names} {'is a' if len(shooters) == 1 else 'are'} {noun} "
            "with no screen setters to free them — off-screen actions can't be run."
        ),
        trace_key="spacing_score",
    )


def check_screen_cutter_gap(roster: list[dict], agg: dict) -> Note | None:
    """
    Tip if screen setters are present but no cutters exist to exploit back-cuts.

    Screen setters create back-cuts and pin-downs in addition to movement shooting
    opportunities. Without cutters, that secondary action goes to waste.
    """
    has_screens = count_at_or_above(roster, "screen_setter", "Capable") > 0
    has_cutters = count_at_or_above(roster, "cutter", "Capable") > 0
    if not has_screens or has_cutters:
        return None
    return Note(
        severity="tip",
        category="offense",
        text=(
            "Screen setters are present but no cutters to exploit back-cuts and "
            "pin-downs — a cutter would unlock more from your screens."
        ),
        trace_key="cutter_score",
    )


def check_cutter_activation(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if cutter talent is present but heavily suppressed by missing enablers.

    Cutters need passers, spacing, screens, and on-ball gravity to generate value.
    When the product of those multipliers drops below CUTTER_ACTIVATION_RATIO,
    the cutter talent is going mostly to waste.
    """
    cutter_raw = agg["cutter_score"].components.get("cutter_raw", 0.0)
    if cutter_raw == 0:
        return None
    effective = agg["cutter_score"].score
    if effective >= cutter_raw * CUTTER_ACTIVATION_RATIO:
        return None
    cutters = [
        p["name"] for p in roster
        if tier_weight(p, "cutter") >= TIER_WEIGHTS["Capable"]
    ]
    names = ", ".join(cutters)
    return Note(
        severity="warning",
        category="offense",
        text=(
            f"{names}'s cutting ability is underactivated — "
            "they need better passers, spacing, or screens to be effective."
        ),
        trace_key="cutter_score",
    )


def check_lob_threat_activation(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if a vertical spacer is present but the lob isn't activated.

    Vertical spacers need a proficient passer or driver to throw the lob. Without
    one, they're reduced to static rim-running — losing most of their lane-opening
    and cutting-lane impact.
    """
    has_spacer = count_at_or_above(roster, "vertical_spacer", "Capable") > 0
    if not has_spacer or agg["lob_threat_active"]:
        return None
    spacers = [
        p["name"] for p in roster
        if tier_weight(p, "vertical_spacer") >= TIER_WEIGHTS["Capable"]
    ]
    names = ", ".join(spacers)
    return Note(
        severity="warning",
        category="offense",
        text=(
            f"{names}'s vertical spacing is underutilized — "
            "no proficient passer or driver to throw the lob."
        ),
        trace_key="lob_threat_active",
    )


def check_creator_floor(roster: list[dict], agg: dict) -> Note | None:
    """
    Critical if no on-ball creators; Warning if only one.

    Creators (drivers, iso scorers, post players, PnR handlers) are the engine
    of any half-court offense. Zero creators means the offense can't generate
    quality looks; one creator is a single point of failure.
    """
    creator_count = sum(
        1 for p in roster
        if any(tier_weight(p, s) >= TIER_WEIGHTS["Capable"] for s in CREATION_SKILLS)
    )
    if creator_count == 0:
        return Note(
            severity="critical",
            category="offense",
            text=(
                "No on-ball creators — this roster can't generate quality looks "
                "without someone who can attack off the dribble or post up."
            ),
            trace_key="paint_touch_score",
        )
    if creator_count == 1:
        return Note(
            severity="warning",
            category="offense",
            text=(
                "Only one on-ball creator — if they're contained or unavailable, "
                "this offense has no secondary creator to fall back on."
            ),
            trace_key="paint_touch_score",
        )
    return None


def check_exclusively_onball_quality(roster: list[dict], agg: dict) -> Note | None:
    """
    Warning if any exclusively on-ball player is below Elite level.

    Exclusively on-ball players provide zero value when someone else has the
    ball. To justify that liability, they need to be Elite+ at what they do.
    """
    subpar = [
        p["name"] for p in roster
        if is_exclusively_onball(p)
        and not any(
            tier_weight(p, s) >= TIER_WEIGHTS["Elite"]
            for s in _OFFENSIVE_SKILLS
        )
    ]
    if not subpar:
        return None
    names = ", ".join(subpar)
    verb = "is" if len(subpar) == 1 else "are"
    return Note(
        severity="warning",
        category="offense",
        text=(
            f"{names} {verb} exclusively on-ball without the elite-level output "
            "to justify it — can't coexist productively when someone else has the ball."
        ),
        trace_key="paint_touch_score",
    )


def check_pnr_synergy_gap(roster: list[dict], agg: dict) -> Note | None:
    """
    Tip if one side of the PnR is strong but the other is missing.

    A great PnR ball handler without a finisher leaves the roll man ignorable.
    A great finisher without a handler can't run the action. Both sides need
    to be Proficient+ for the action to be effective.
    """
    handler_best = TIER_WEIGHTS.get(team_best(roster, "pnr_ball_handler"), 0)
    finisher_best = TIER_WEIGHTS.get(team_best(roster, "pnr_finisher"), 0)
    prof = TIER_WEIGHTS["Proficient"]
    has_handler = handler_best >= prof
    has_finisher = finisher_best >= prof
    if has_handler == has_finisher:
        return None   # both present or both absent — no gap
    if has_handler:
        return Note(
            severity="tip",
            category="offense",
            text=(
                "Strong PnR ball handler but no proficient finisher — "
                "the pick-and-roll action is one-sided."
            ),
            trace_key="pnr_synergy",
        )
    return Note(
        severity="tip",
        category="offense",
        text=(
            "Capable PnR finisher but no proficient ball handler to run the action — "
            "the roll man can't be fully exploited."
        ),
        trace_key="pnr_synergy",
    )


def check_transition_gap(roster: list[dict], agg: dict) -> Note | None:
    """
    Tip if transition threats are present but no passer to advance the ball.

    Transition threats create tempo but need a playmaker passer to turn
    pushes into coherent fast-break attacks. Without one, tempo advantages
    are routinely wasted.
    """
    has_threats = count_at_or_above(roster, "transition_threat", "Capable") > 0
    if not has_threats or agg["transition_active"]:
        return None
    return Note(
        severity="tip",
        category="offense",
        text=(
            "Transition threats on the roster but no proficient passer to push pace — "
            "tempo advantages are left on the table."
        ),
        trace_key="transition_active",
    )


def check_paint_source(roster: list[dict], agg: dict) -> Note | None:
    """Critical if no paint touch sources exist on the roster."""
    if agg["paint_touch_score"].score > 0:
        return None
    return Note(
        severity="critical",
        category="offense",
        text=(
            "No way to get paint touches — this offense can't attack the rim "
            "or force the defense to pack the paint."
        ),
        trace_key="paint_touch_score",
    )


# ---------------------------------------------------------------------------
# Strength rules (final mode only)
# ---------------------------------------------------------------------------

def check_elite_spacing(roster: list[dict], agg: dict) -> Note | None:
    """Strength if spacing score meets or exceeds the 'good' threshold."""
    if agg["spacing_score"].score < SPACING_THRESHOLDS["good"]:
        return None
    return Note(
        severity="strength",
        category="offense",
        text=(
            "Elite spacing — floor shooters open the paint and give "
            "on-ball players room to operate."
        ),
        trace_key="spacing_score",
    )


def check_defensive_depth(roster: list[dict], agg: dict) -> Note | None:
    """Strength if overall defense score exceeds the strength threshold."""
    if agg["defense_score"].score < STRENGTH_THRESHOLDS["defense"]:
        return None
    return Note(
        severity="strength",
        category="defense",
        text=(
            "Deep defensive roster — compounding perimeter pressure and rim "
            "protection create a cohesive defensive unit."
        ),
        trace_key="defense_score",
    )


def check_twoway_premium(roster: list[dict], agg: dict) -> Note | None:
    """Strength if two or more players contribute meaningfully on both ends."""
    twoway_count = sum(1 for p in roster if is_twoway(p))
    if twoway_count < 2:
        return None
    return Note(
        severity="strength",
        category="two_way",
        text=(
            f"{twoway_count} two-way contributors — getting both ends "
            "without sacrificing roster spots."
        ),
        trace_key="defense_score",
    )


def check_passer_abundance(roster: list[dict], agg: dict) -> Note | None:
    """Strength if passer compound score exceeds the strength threshold."""
    if agg["passer_compound_score"].score < STRENGTH_THRESHOLDS["passer_compound"]:
        return None
    return Note(
        severity="strength",
        category="offense",
        text=(
            "Exceptional passing — multiple playmakers amplify every "
            "off-ball skill on the roster."
        ),
        trace_key="passer_compound_score",
    )


def check_pnr_excellence(roster: list[dict], agg: dict) -> Note | None:
    """Strength if full PnR synergy (both handler and finisher Proficient+) is present."""
    if not agg["pnr_synergy"]:
        return None
    return Note(
        severity="strength",
        category="offense",
        text=(
            "PnR synergy — proficient handler and finisher create a repeatable "
            "action the defense must account for."
        ),
        trace_key="pnr_synergy",
    )


# ---------------------------------------------------------------------------
# Rule lists consumed by evaluator.py
# ---------------------------------------------------------------------------

ALL_RULES = [
    # Defense
    check_rim_anchor,
    check_perimeter_compounding,
    check_perimeter_disruptor_depth,
    check_defense_blackhole,
    check_offensive_blackhole,
    check_rebounding,
    # Offense
    check_spacing_critical,
    check_spacing_warning,
    check_shooter_depth,
    check_movement_orphaned,
    check_screen_cutter_gap,
    check_cutter_activation,
    check_lob_threat_activation,
    check_creator_floor,
    check_exclusively_onball_quality,
    check_pnr_synergy_gap,
    check_transition_gap,
    check_paint_source,
]

STRENGTH_RULES = [
    check_elite_spacing,
    check_defensive_depth,
    check_twoway_premium,
    check_passer_abundance,
    check_pnr_excellence,
]
