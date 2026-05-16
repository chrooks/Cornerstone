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
    "perimeter_disruptor",
    "high_flyer",
})

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
    "perimeter_disruptor": "Disrupts ball handlers through active hands, pressure, and contest at the point of attack.",
    "high_flyer":          "Possesses elite explosive athleticism for above-the-rim plays, highlight dunks, and transition finishes.",
}
