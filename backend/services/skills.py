"""
skills.py — HISTORICAL REFERENCE / BOOTSTRAP ONLY for the skill taxonomy.

Runtime taxonomy now comes from the active Evaluation Version row in the
database (payload.taxonomy.skills). This file seeds the initial cohesion-v1
Version via backend/scripts/dump_v1_blob.py.

The pipeline (stat evaluation, Claude assessment, compositing) still reads
these constants for Skill Profile creation. The Evaluation Version controls
only cohesion scoring math, not the pipeline.

Confidence tiers determine how skills are rated:
  HIGH      — stat pipeline is reliable; Claude is NOT called
  MODERATE  — Claude runs blind (sees stats but NOT the stat tier)
  LOW       — Claude runs informed (sees stats AND stat tier + confidence)
"""

# ---------------------------------------------------------------------------
# Confidence classification
# ---------------------------------------------------------------------------

# Skills where stat pipeline is reliable — Claude is NOT called
HIGH_CONFIDENCE_SKILLS: frozenset[str] = frozenset({
    "rim_protector",
    "spot_up_shooter",
    "off_dribble_shooter",
    "rebounder",
    "offensive_rebounder",
    "isolation_scorer",
    "steady_hand",
})

# Skills where Claude runs blind (sees stats but NOT the stat tier)
MODERATE_CONFIDENCE_SKILLS: frozenset[str] = frozenset({
    "cutter",
    "movement_shooter",
    "passer",
    "crafty_finisher",
    "driver",
    "mid_post_player",
    "low_post_player",
    "screen_setter",
    "vertical_spacer",
    "transition_threat",
    "pnr_ball_handler",
    "pnr_finisher",
})

# Skills where Claude runs informed (sees stats AND stat tier + confidence)
LOW_CONFIDENCE_SKILLS: frozenset[str] = frozenset({
    "versatile_defender",
    "point_of_attack_defender",
    "off_ball_disruptor",
    "high_flyer",
})

# Skills a bulk "Trust Stats" must never resolve across many players at once.
# Their tier drives an archetype label, and the stats engine is weakest exactly
# there, so a human decides each one.
# #152 split perimeter_disruptor into point_of_attack_defender + off_ball_disruptor; D19 labels read these tiers
NO_BULK_TRUST_STATS_SKILLS: frozenset[str] = frozenset({
    "versatile_defender",
    "point_of_attack_defender",
    "off_ball_disruptor",
})

# Composite entries whose `source` records a human review decision (issue #120).
# A recompute must never silently overwrite these — resolved (a flag adjudicated
# in /admin/review) and manual_override (an admin's direct tier) are people's
# calls, not stat output. One definition, because the recompute path and the
# whole-profile guard must agree on what a person's call looks like.
HUMAN_DECISION_SOURCES: frozenset[str] = frozenset({"resolved", "manual_override"})

# ---------------------------------------------------------------------------
# Derived collections
# ---------------------------------------------------------------------------

# Flat sorted list of every skill key — derived, never hardcoded
ALL_SKILLS: list[str] = sorted(
    HIGH_CONFIDENCE_SKILLS | MODERATE_CONFIDENCE_SKILLS | LOW_CONFIDENCE_SKILLS
)

# ---------------------------------------------------------------------------
# Human-readable definitions (used in Claude prompts)
# ---------------------------------------------------------------------------

SKILL_DEFINITIONS: dict[str, str] = {
    "spot_up_shooter":     "Hits catch-and-shoot three-pointers and mid-range shots from set positions.",
    "off_dribble_shooter": "Creates and converts shots off the dribble, including pull-ups and step-backs.",
    "isolation_scorer":    "Beats defenders one-on-one in isolation situations through dribble moves and athleticism.",
    "movement_shooter":    "Hits shots while relocating off screens and handoffs (not just standing still).",
    "cutter":              "Scores effectively by cutting to the basket off-ball.",
    "transition_threat":   "Scores effectively in the open court on fast breaks.",
    "pnr_ball_handler":    "Initiates and scores/creates effectively as the ball handler in pick-and-roll actions.",
    "pnr_finisher":        "Scores effectively as the screener in pick-and-roll actions, whether rolling, popping, or slipping.",
    "crafty_finisher":     "Scores at the rim using touch, body control, and foul-drawing ability rather than pure athleticism.",
    "driver":              "Consistently attacks the paint from the perimeter off the dribble, generating driving lane pressure and paint touches.",
    "passer":              "Creates quality shot opportunities for teammates through vision and passing skill.",
    "offensive_rebounder": "Consistently crashes offensive boards and converts second-chance opportunities.",
    "vertical_spacer":     "Threatens vertically as a lob target and above-the-rim finisher, creating driving lanes for teammates.",
    "rebounder":           "Consistently secures defensive boards through positioning, boxing out, and effort.",
    "rim_protector":       "Deters and blocks shots at the rim, altering opponent finishing attempts.",
    "screen_setter":       "Sets quality screens that free teammates for open shots.",
    "mid_post_player":     "Scores effectively from the mid-post/elbow area using face-up moves and mid-range shooting.",
    "low_post_player":     "Scores effectively with back-to-basket moves in the low post.",
    "versatile_defender":  "Can guard multiple positional groups effectively when switched.",
    "point_of_attack_defender": "Contains the ball handler, fights over screens, and takes the toughest perimeter assignment when asked.",
    "off_ball_disruptor":  "Disrupts the offense away from his own man: holds the right help position, rotates and recovers on the perimeter, digs at drivers and jumps passing lanes, creating deflections, steals and charges.",
    "high_flyer":          "Possesses elite explosive athleticism for above-the-rim plays, highlight dunks, and transition finishes.",
    "steady_hand":      "Protects possessions with a low turnover rate relative to ball responsibility — secure handling, safe decisions, and strong hands under pressure.",
}

# Display names for every Skill. Mirrors SKILL_LABELS in frontend/lib/skills.ts —
# keep the two in step. The archetype why-lines read this (never
# claude_assessment._SKILL_DISPLAY_NAMES, which covers only the Claude-rated
# Skills and pulls in the anthropic and supabase imports).
SKILL_LABELS: dict[str, str] = {
    "spot_up_shooter":          "Spot Up Shooter",
    "off_dribble_shooter":      "Off-Dribble Shooter",
    "offensive_rebounder":      "Offensive Rebounder",
    "rebounder":                "Defensive Rebounding",
    "rim_protector":            "Rim Protector",
    "isolation_scorer":         "Isolation Scorer",
    "steady_hand":              "Steady Hand",
    "movement_shooter":         "Movement Shooter",
    "cutter":                   "Cutter",
    "transition_threat":        "Transition Threat",
    "pnr_ball_handler":         "PnR Ball Handler",
    "pnr_finisher":             "PnR Finisher",
    "crafty_finisher":          "Below the Rim Finishing",
    "driver":                   "Driver",
    "vertical_spacer":          "Vertical Spacer",
    "screen_setter":            "Screen Setter",
    "passer":                   "Passer",
    "mid_post_player":          "Mid-Post Player",
    "low_post_player":          "Low-Post Player",
    "versatile_defender":       "Versatile Defender",
    "point_of_attack_defender": "Point of Attack Defender",
    "off_ball_disruptor":       "Off-Ball Disruptor",
    "high_flyer":               "Above the Rim Finishing",
}


# ---------------------------------------------------------------------------
# Legacy key alias (#152)
# ---------------------------------------------------------------------------

# The one Skill the #152 split renamed. Old rows — a pre-split Snapshot Release,
# a saved team, an Evaluation Version blob whose formulas still name the old key
# — carry `perimeter_disruptor`; the code now reads `point_of_attack_defender`.
# The alias runs both ways so either side can be the one that is current.
_LEGACY_SKILL_ALIASES: tuple[tuple[str, str], ...] = (
    ("perimeter_disruptor", "point_of_attack_defender"),
)


def with_legacy_skill_keys(skills: dict) -> dict:
    """Return a copy of ``skills`` where each renamed Skill answers to both keys.

    A present ``perimeter_disruptor`` fills an absent ``point_of_attack_defender``
    and the reverse. A key already present is never overwritten, so a post-split
    profile holding both keeps its own on-ball tier.

    Key presence is what the engine reads (``present_keys`` in
    ``composites.compute_raw_composites`` separates "rated None" from "never
    rated"), so the alias copies the value as it is — an entry dict, a bare tier
    string, or None for an unrated Skill.

    # ponytail: delete after prod runs EV v10 and a post-split release
    """
    aliased = dict(skills or {})
    for old, new in _LEGACY_SKILL_ALIASES:
        if old in aliased and new not in aliased:
            aliased[new] = aliased[old]
        elif new in aliased and old not in aliased:
            aliased[old] = aliased[new]
    return aliased
