"""
cohesion_engine/weights.py — HISTORICAL REFERENCE / BOOTSTRAP ONLY.

Runtime values come from the active Evaluation Version row in the database.
This file is read at bootstrap (see services/evaluation_versions/bootstrap.py
and backend/scripts/dump_v1_blob.py) to seed the initial cohesion-v1 Version,
and NOT at runtime once the Evaluation Version system is active.

These constants remain intact for the bootstrap path and for test fixtures
that need known default values.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Tier numeric values
# ---------------------------------------------------------------------------

# Maps skill tier labels to numeric scores for composite formulas.
# The gaps are non-linear by design: Elite is 2x Proficient and ATG is
# ~1.67x Elite, so higher tiers carry disproportionate weight in sums.
TIER_VALUES: dict[str, float] = {
    "None": 0.0,
    "Capable": 1.0,
    "Proficient": 4.0,
    "Elite": 8.0,
    "All-Time Great": 16.0,
}


# ---------------------------------------------------------------------------
# Composite formula coefficients
# ---------------------------------------------------------------------------

# Scaling weights used inside individual composite formulas.
# Each key names the composite + the skill being scaled. For example,
# "spacing_off_dribble" = 0.5 means off-dribble shooting contributes
# at half weight to the spacing composite (spot-up is primary).
# "paint_touch_finishing_scale" = 0.08 converts raw finishing tier
# into a small additive bonus for paint touch (secondary signal).
COMPOSITE_COEFFICIENTS: dict[str, float] = {
    "spacing_off_dribble": 0.5,              # off-dribble's fraction of spacing (spot-up is 1.0)
    "paint_touch_finishing_scale": 0.08,      # finishing bonus added to paint touch raw score
    "paint_touch_vertical_spacer": 0.6,       # vertical spacer's contribution to paint touch
    "paint_touch_mid_post": 0.7,              # mid-post scorer's contribution to paint touch
    "post_game_mid_post": 0.7,                # mid-post scorer drives most of post game value
    "pnr_screener_secondary_scale": 0.15,     # secondary screener skills as fraction of PnR screener
    "off_ball_finishing_scale": 0.08,          # finishing bonus for off-ball impact
    "off_ball_passer": 0.3,                   # passing adds secondary off-ball value
    "shot_creation_pnr_orchestration": 0.6,    # pnr orchestration Impact Trait drives creation
    "shot_creation_passer": 0.5,              # passing adds secondary creation value
    "shot_creation_off_dribble": 0.7,         # off-dribble shooting as creation signal
    "shot_creation_spacing": 0.3,             # spacing bonus layered into shot creation
    "shot_creation_paint_touch": 0.5,         # rim pressure scaled down — finishing ≠ creation
    "pnr_ball_handler_passer": 0.3,           # passing amplifies PnR handling (reading the defense)
    "pnr_ball_handler_driver": 0.3,           # driving ability to turn the corner off screens
    "pnr_ball_handler_off_dribble": 0.2,      # pull-up shooting off PnR creates dual threat
    "transition_high_flyer": 0.7,             # athleticism dominates transition scoring
    "transition_driver": 0.3,                 # driving adds secondary transition value
    "transition_spot_up": 0.2,                # catch-and-shoot in transition (trailing shooter)
    "perimeter_defense_versatile_defender": 0.7,  # versatile defender dominates perimeter D composite
    "interior_defense_versatile_defender": 0.25,  # versatile defender's partial interior D credit
    "interior_defense_rebounder": 0.3,        # rebounding contributes to interior D score
    # ── Audit additions (2026-05-25) ─────────────────────────────────────────
    "off_ball_movement_bonus": 0.25,          # movement shooter gravity beyond spacing value
    "off_ball_screen_setter": 0.2,            # off-screen action distinct from PnR screening
    "paint_touch_oreb": 0.4,                  # putback/offensive rebounding as rim pressure
    "finishing_crafty_weight": 1.3,           # crafty finisher draws fouls; higher PPP than high_flyer
    "transition_off_dribble": 0.18,           # pull-up transition value (Lillard/Curry archetype)
    "shot_creation_iso": 1.0,                 # ISO coefficient explicit (was implicit 1.0)
    "ball_security_pnr_handler": 0.45,        # PnR ball-handling pressure → lost-ball avoidance
    "ball_security_driver": 0.35,             # drive turnovers are major live-ball TO source
    "transition_passer": 0.4,                 # flat additive passing bonus (fixes outlet-passer bug)
}

# Canonical list of the 13 composite dimensions a player is scored on.
# Order here determines display order in the UI composite bars.
COMPOSITE_NAMES: tuple[str, ...] = (
    "spacing",               # floor spacing via shooting gravity
    "finishing",              # ability to score at the rim
    "paint_touch",           # combined interior presence (finishing + vertical + post)
    "post_game",             # half-court post scoring repertoire
    "pnr_screener",          # pick-and-roll screening + roll/pop ability
    "off_ball_impact",       # cutting, off-ball movement, and secondary playmaking
    "shot_creation",         # ability to generate shots for self and others
    "pnr_orchestration",     # pick-and-roll initiation and creation
    "ball_security",         # turnover avoidance and ball-handling safety
    "defensive_rebounding",  # securing defensive boards
    "offensive_rebounding",  # crashing the offensive glass
    "transition",            # fast-break value (running, finishing, pushing)
    "perimeter_defense",     # on-ball and help defense on the perimeter
    "interior_defense",      # rim protection, post defense, interior rebounding
)

# Maximum raw score achievable per composite (all contributing skills at ATG).
# Used as the denominator when normalizing raw composites to 0-10 scale.
# Recomputed programmatically after 2026-05-25 audit (compute_raw_composites
# with all skills at All-Time Great, using COMPOSITE_COEFFICIENTS defaults).
THEORETICAL_MAX: dict[str, float] = {
    "spacing": 40.0,
    "finishing": 36.8,
    "paint_touch": 227.56479999999996,
    "post_game": 27.2,
    "pnr_screener": 108.8,
    "off_ball_impact": 115.104,
    "shot_creation": 178.26239999999999,
    "pnr_orchestration": 28.8,
    "ball_security": 16.0,  # possession_protector ATG tier value (proxy only for key-absent legends)
    "defensive_rebounding": 16.0,
    "offensive_rebounding": 16.0,
    "transition": 44.480000000000004,
    "perimeter_defense": 27.2,
    "interior_defense": 24.8,
}

# Bell curve normalization uses a two-segment piecewise-linear mapping:
# segment 1: raw 0→breakpoint percentile maps to 0→breakpoint score
# segment 2: breakpoint percentile→1.0 maps to breakpoint score→10.0
# This compresses the crowded middle and spreads out the top end.
NORMALIZATION_BREAKPOINT_PERCENTILE: float = 0.6  # 60th percentile = inflection point
NORMALIZATION_BREAKPOINT_SCORE: float = 6.0        # maps to score 6 on the 0-10 scale
MIN_DISTRIBUTION_SIZE: int = 20                    # need ≥20 players to build a reliable curve


# ---------------------------------------------------------------------------
# Defensive bell curve constants
# ---------------------------------------------------------------------------

# Peak amplitude of each player's defensive bell curve on the height axis.
# Higher tier = taller curve = more defensive impact at their optimal height.
AMPLITUDE_MAP: dict[str, float] = {
    "None": 0.0,
    "Capable": 1.0,
    "Proficient": 2.0,
    "Elite": 3.0,
    "All-Time Great": 4.0,
}
# Minimum amplitude any rostered player gets — even a non-defender
# occupies space on the court ("warm body" presence).
WARM_BODY: float = 0.5

# Versatile Defender tier → how many inches the bell curve extends
# in BOTH directions from the player's height. Higher VD = wider range.
VD_EXT: dict[str, int] = {
    "None": 0,
    "Capable": 2,
    "Proficient": 3,
    "Elite": 5,
    "All-Time Great": 9,
}
# Perimeter Defender tier → how many inches the curve extends DOWNWARD
# (toward shorter opponents). Guards can cover smaller guards.
PD_DOWN: dict[str, int] = {
    "None": 0,
    "Capable": 2,
    "Proficient": 4,
    "Elite": 6,
    "All-Time Great": 8,
}
# Rim Protector tier → how many inches the curve extends UPWARD
# (toward taller opponents). Bigs can contest larger players.
RP_UP: dict[str, int] = {
    "None": 0,
    "Capable": 2,
    "Proficient": 3,
    "Elite": 5,
    "All-Time Great": 6,
}

# When a player has PD but no RP, shift their bell curve peak downward
# (they defend smaller players). Vice versa for RP-only players.
PEAK_SHIFT_PD_ONLY: int = -1   # PD-only → peak shifts 2" shorter
PEAK_SHIFT_RP_ONLY: int = 1    # RP-only → peak shifts 2" taller
# Height axis bounds for the defensive bell curve (6'0" to 7'4")
HEIGHT_MIN_INCHES: int = 72
HEIGHT_MAX_INCHES: int = 88
# Height-dependent taper steepness.
# Curve uses (1-t)^exponent — drops fast from peak, tapers gently near zero.
# Players at the midpoint height get the base exponent (linear at 1.0).
# Taller players taper steeper going DOWN (toward shorter opponents).
# Shorter players taper steeper going UP (toward taller opponents).
# Formula: exponent = base + max(0, distance_from_midpoint) * scale
BELL_STEEPNESS_MIDPOINT: int = 80          # height where both exponents = base (6'7")
BELL_DOWN_STEEPNESS_BASE: float = 0.8      # downward taper exponent at midpoint (linear)
BELL_DOWN_STEEPNESS_SCALE: float = 0.05    # exponent increase per inch above midpoint
BELL_UP_STEEPNESS_BASE: float = 1.0        # upward taper exponent at midpoint (linear)
BELL_UP_STEEPNESS_SCALE: float = 0.10      # exponent increase per inch below midpoint

# Base width of the bell curve before VD/PD/RP extensions
BELL_BASE_RANGE: int = 1
# Flat-top width = total range / this divisor (creates plateau at peak)
BELL_FLAT_TOP_DIVISOR: int = 3
# Rim protectors ≥80" get a cross-height bonus covering shorter heights
# at reduced (0.7x) amplitude within a 6" window below them.
RP_CROSS_HEIGHT_MIN: int = 80
RP_CROSS_SCALE: float = 0.7
RP_CROSS_HEIGHT_WINDOW: int = 6
# Perimeter defenders ≤75" get a cross-height bonus covering taller heights
# at reduced (0.5x) amplitude within a 4" window above them.
PD_CROSS_HEIGHT_MAX: int = 75
PD_CROSS_SCALE: float = 0.5
PD_CROSS_HEIGHT_WINDOW: int = 4

# Lineup-level defensive scoring parameters
DEFENSIVE_GAP_THRESHOLD: float = 1.5        # coverage below this at any height = gap
DEFENSIVE_GAP_PENALTY_SCALE: float = -1.5   # penalty multiplier per gap inch
DEFENSIVE_COVERAGE_SATURATION_RAW: float = 2.7  # coverage above this yields diminishing returns
DEFENSIVE_REBOUNDING_MINIMUM: float = 3.0    # minimum rebounding composite to avoid penalty
DEFENSIVE_REBOUNDING_PENALTY_SCALE: float = 2.0  # how harshly missing rebounding is penalized
DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE: tuple[int, int] = (72, 79)  # guard zone for density checks
DEFENSIVE_TRANSITION_BOOST_DIVISOR: float = 15.0  # transition composite / this = bonus
DEFENSIVE_TRANSITION_BOOST_CAP: float = 2.0       # max transition defense bonus
# Diminishing returns for stacking multiple players with same composite strength.
# 1st player = full value, 2nd = 50%, 3rd = 25%, 4th+ = 10%.
STACKING_RETURNS: tuple[float, ...] = (1.0, 0.5, 0.25, 0.1)
# Switchability: minimum coverage value to count a player as "covering" a height.
SWITCHABILITY_COVERAGE_THRESHOLD: float = 0.5
# Switchability blend: 60% overlap density, 40% floor compression.
SWITCHABILITY_OVERLAP_WEIGHT: float = 0.6
# Collective passing subscore: best creator carries 60%, rest is depth average.
PASSING_PRIMARY_CREATOR_WEIGHT: float = 0.6
PASSING_DEPTH_WEIGHT: float = 0.4
# Defensive rebounding subscore: best rebounder 45%, 2nd-best 35%, depth 20%.
DEFENSIVE_REBOUNDING_PRIMARY_WEIGHT: float = 0.45
DEFENSIVE_REBOUNDING_SECONDARY_WEIGHT: float = 0.35
DEFENSIVE_REBOUNDING_DEPTH_WEIGHT: float = 0.20
# Offensive rebounding subscore: best offensive rebounder 45%, 2nd-best 35%, depth 20%.
OFFENSIVE_REBOUNDING_PRIMARY_WEIGHT: float = 0.45
OFFENSIVE_REBOUNDING_SECONDARY_WEIGHT: float = 0.35
OFFENSIVE_REBOUNDING_DEPTH_WEIGHT: float = 0.20
# Perimeter defense subscore: primary perimeter defender dominant (60/30/10).
PERIMETER_DEFENSE_PRIMARY_WEIGHT: float = 0.6
PERIMETER_DEFENSE_SECONDARY_WEIGHT: float = 0.3
PERIMETER_DEFENSE_DEPTH_WEIGHT: float = 0.1
# Interior defense subscore: primary rim protector dominant (60/30/10).
INTERIOR_DEFENSE_PRIMARY_WEIGHT: float = 0.6
INTERIOR_DEFENSE_SECONDARY_WEIGHT: float = 0.3
INTERIOR_DEFENSE_DEPTH_WEIGHT: float = 0.1

# Post game subscore: more distributed than anchor because post scoring
# benefits from having multiple post threats (high-low action, etc).
POST_GAME_PRIMARY_WEIGHT: float = 0.5
POST_GAME_SECONDARY_WEIGHT: float = 0.35
POST_GAME_DEPTH_WEIGHT: float = 0.15

# PnR handler subscore: handler support (secondary ball-handlers) scaled
# at 35% of their raw value. Primary handler dominates at 65%.
PNR_HANDLER_SUPPORT_SCALE: float = 0.35
PNR_HANDLER_PRIMARY_WEIGHT: float = 0.65
PNR_HANDLER_SECONDARY_WEIGHT: float = 0.25
PNR_HANDLER_DEPTH_WEIGHT: float = 0.10
# PnR screener subscore: more distributed — multiple screeners useful.
PNR_SCREENER_PRIMARY_WEIGHT: float = 0.55
PNR_SCREENER_SECONDARY_WEIGHT: float = 0.30
PNR_SCREENER_DEPTH_WEIGHT: float = 0.15
# PnR pairing quality gate: best handler×screener pair must exceed this
# floor (0.70) before the remaining 30% is scaled by pairing quality.
PNR_PAIRING_QUALITY_GATE_FLOOR: float = 0.70
PNR_PAIRING_QUALITY_GATE_SCALE: float = 0.30

# Bonus to bell curve amplitude when a player has BOTH rim protection AND
# perimeter defense at Elite+. Rewards true two-way bigs.
RP_PD_BOOST: dict[str, float] = {
    "None": 0.0,
    "Capable": 0.0,
    "Proficient": 0.0,
    "Elite": 0.5,
    "All-Time Great": 1.0,
}


# ---------------------------------------------------------------------------
# Synergy scale factors
# ---------------------------------------------------------------------------

# Pairwise synergy bonuses between two players. Each OFF-XX code represents
# a specific offensive interaction (e.g., OFF-02 = handler draws help, shooter
# relocates). The scale factor determines how much that synergy adds to the
# lineup's cohesion score.
SYNERGY_SCALE_FACTORS: dict[str, float] = {
    "OFF-02": 0.05,  # drive-and-kick to movement shooter
    "OFF-03": 0.03,  # off-screen action to movement shooter
    "OFF-04": 0.04,  # post entry creating backdoor cut
    "OFF-12": 0.05,  # PnR handler to cutting roll man
    "OFF-13": 0.03,  # PnR handler to cutter (short roll pass)
    "OFF-14": 0.04,  # high-low post feed to cutter
    "OFF-15": 0.05,  # drive + lob to vertical spacer
    "OFF-16": 0.05,  # PnR pop to vertical spacer
    "OFF-31": 0.04,  # outlet pass igniting transition threat
    "OFF-32": 0.03,  # fast break lob to high flyer
}

# Which skills get amplified when a synergy fires. If a player has one
# of these skills at a high tier, the synergy bonus is multiplied.
SYNERGY_BOOSTED_SKILLS: dict[str, tuple[str, ...]] = {
    "OFF-02": ("movement_shooter",),
    "OFF-03": ("movement_shooter",),
    "OFF-04": ("cutter",),
    "OFF-12": ("cutter",),
    "OFF-13": ("cutter",),
    "OFF-14": ("cutter",),
    "OFF-15": ("vertical_spacer",),
    "OFF-16": ("vertical_spacer",),
    "OFF-31": ("transition_threat",),
    "OFF-32": ("high_flyer",),
}

# Penalty multiplier when a synergy requires a skill the lineup lacks entirely
SYNERGY_PENALTY_SEVERITY: float = 5.0
# OFF-13 (short roll pass to cutter) requires this much raw spacing
# or the synergy is penalized — cutters need room to operate
OFF_13_RAW_SPACING_THRESHOLD: float = 15.0
# Minimum shot creation composite to qualify as a "creator" for synergy pairing
SYNERGY_CREATOR_THRESHOLD: float = 6.0


# ---------------------------------------------------------------------------
# Cohesion rollup weights
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Two-level cohesion rollup weights
# ---------------------------------------------------------------------------

# Category weights (sum to 1.0). Research-backed proportions from
# lineup-score-model-research-report.md.
CATEGORY_WEIGHTS: dict[str, float] = {
    "offense": 0.40,
    "defense": 0.37,
    "rebounding_transition": 0.23,
}

# Within offense, quality Subscores get 70% and balance Subscores get 30%.
OFFENSE_QUALITY_RATIO: float = 0.70

# Offense quality weights (sum to 1.0).
OFFENSE_QUALITY_WEIGHTS: dict[str, float] = {
    "spacing": 0.18,
    "shot_creation": 0.18,
    "paint_touch": 0.18,
    "collective_passing": 0.14,
    "off_ball_impact": 0.12,
    "ball_security": 0.10,
    "pnr_pairing": 0.06,
    "post_game": 0.04,
}

# Offense balance weights (sum to 1.0).
OFFENSE_BALANCE_WEIGHTS: dict[str, float] = {
    "spacing_creation_ratio": 0.34,
    "creation_offball_ratio": 0.33,
    "spacing_paint_touch_ratio": 0.33,
}

# Defense weights (sum to 1.0).
DEFENSE_SUBSCORE_WEIGHTS: dict[str, float] = {
    "interior_defense": 0.30,
    "defensive_coverage": 0.25,
    "defensive_gaps": 0.25,
    "perimeter_defense": 0.12,
    "switchability": 0.08,
}

# Rebounding/transition weights (sum to 1.0).
REBOUND_TRANSITION_SUBSCORE_WEIGHTS: dict[str, float] = {
    "defensive_rebounding": 0.40,
    "offensive_rebounding": 0.20,
    "transition": 0.25,
    "rebound_transition_ratio": 0.15,
}

# Asymmetric accentuation caps (stars, applied additively post-rollup).
# Weakness penalty ~2x strength bonus per research recommendation.
ACCENTUATION_STRENGTH_CAP: float = 0.25
ACCENTUATION_WEAKNESS_CAP: float = 0.50


# ---------------------------------------------------------------------------
# Ratio mechanics
# ---------------------------------------------------------------------------

# Ratio subscores measure balance between two composites (e.g., spacing vs paint touch).
# Dead zone: ratios within ±0.2 of ideal score full marks (no penalty for small imbalance).
RATIO_DEAD_ZONE: float = 0.2
# When one side is completely absent, apply full (1.0) or partial (0.5) penalty.
RATIO_ASYMMETRIC_FULL_PENALTY: float = 1.0   # penalty when dominant side has zero complement
RATIO_DEFAULT_PENALTY: float = 0.5            # default penalty slope outside dead zone
RATIO_MIN_DENOMINATOR: float = 0.1            # floor to avoid division by zero in ratio calc


# ---------------------------------------------------------------------------
# Accentuation thresholds and complementary pairs
# ---------------------------------------------------------------------------

# Accentuation rewards lineups that lean into clear strengths and
# penalizes lineups with unaddressed weaknesses.
ACCENTUATION_STRENGTH_THRESHOLD: float = 7.5    # composite ≥ this = lineup strength
ACCENTUATION_WEAKNESS_THRESHOLD: float = 2.5    # composite ≤ this = lineup weakness
# Fallback thresholds if no composites meet the primary thresholds
# (relaxed so every lineup gets at least some accentuation signal)
ACCENTUATION_FALLBACK_STRENGTH_THRESHOLD: float = 6.0
ACCENTUATION_FALLBACK_WEAKNESS_THRESHOLD: float = 2.0
ACCENTUATION_TOP_N: int = 3          # consider top 3 strengths / bottom 3 weaknesses
ACCENTUATION_MIN_STRENGTHS: int = 1  # need at least 1 clear strength to score well

# Complementary pairs: if one is a strength and its complement is too,
# the accentuation bonus is amplified (the lineup has a coherent identity).
ACCENTUATION_COMPLEMENTARY_PAIRS: tuple[tuple[str, str], ...] = (
    ("spacing", "paint_touch"),             # inside-out offense
    ("spacing", "post_game"),               # stretch-the-floor + post-up
    ("shot_creation", "off_ball_impact"),    # creators feed cutters/movers
    ("shot_creation", "pnr_screener"),       # PnR-centric offense
    ("perimeter_defense", "interior_defense"),  # complete defensive identity
    ("perimeter_defense", "transition"),     # defense fueling fast breaks
)


# ---------------------------------------------------------------------------
# Note thresholds
# ---------------------------------------------------------------------------

# Controls for the GM-style notes generated alongside cohesion scores.
NOTE_LIMIT_PER_TYPE: int = 3                      # max notes per category (strength/warning/suggestion)
NOTE_ELITE_COMPOSITE_THRESHOLD: float = 8.0       # composite ≥ this triggers a "strength" note
NOTE_STACKED_COMPOSITE_THRESHOLD: float = 6.0     # if N players exceed this in same composite → "stacked" note
NOTE_STACKED_PLAYER_COUNT: int = 2                 # how many players needed to trigger stacked note
NOTE_MISSING_COMPOSITE_THRESHOLD: float = 2.0     # composite total ≤ this triggers a "missing" (catastrophic) warning
NOTE_WEAK_COMPOSITE_AVG_THRESHOLD: float = 4.0   # per-player composite avg below this triggers a "weak" warning
NOTE_COVERED_COMPOSITE_THRESHOLD: float = 6.0    # if any player exceeds this, the category is "covered" for opportunity ranking
NOTE_MIN_ROSTER_SIZE: int = 5                     # fewer players than this triggers a depth warning
NOTE_CAPABLE_PASSER_THRESHOLD: float = 3.0        # passing composite below this → playmaking warning
NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD: float = 3.5  # bell curve peak ≥ this → elite defender callout
NOTE_SEVERITY_MIN: float = 0.0                    # severity range floor (0 = informational)
NOTE_SEVERITY_MAX: float = 1.0                    # severity range ceiling (1 = critical)


# ---------------------------------------------------------------------------
# Layer 2 roster normalization constants
# ---------------------------------------------------------------------------

# Layer 2 evaluates the full 9-man rotation, not just one lineup.
# The roster score is a weighted blend of these four dimensions.
ROSTER_ROLLUP_WEIGHTS: dict[str, float] = {
    "starting_5": 0.45,            # best 5-man lineup cohesion (dominant factor)
    "depth": 0.25,                 # how many viable lineup combos exist in the rotation
    "archetype_diversity": 0.20,   # can the rotation play different styles?
    "floor": 0.10,                 # worst viable lineup's score (how bad is the floor?)
}

# A 5-player Team is a Lineup, so depth and floor are not meaningful factors.
LINEUP_ONLY_ROLLUP_WEIGHTS: dict[str, float] = {
    "starting_5": 0.90,
    "depth": 0.0,
    "archetype_diversity": 0.10,
    "floor": 0.0,
}

LINEUP_ARCHETYPE_MAX: int = 3
STAR_RATING_MAX: float = 5.0             # final roster score mapped to 0-5 stars
VIABLE_LINEUP_THRESHOLD: float = 2.75    # lineup cohesion ≥ this = "viable" (playable)
DEPTH_VIABLE_RATIO_WEIGHT: float = 0.60  # depth subscore: 60% = % of lineups that are viable
DEPTH_QUALITY_WEIGHT: float = 0.40       # depth subscore: 40% = average quality of viable lineups
# C(9,5) = 126 possible 5-man combos from a 9-man rotation
TOTAL_LINEUPS_FULL_ROSTER: int = 126
# Archetype labels for diversity scoring — a rotation that can credibly
# play multiple styles (offensive, defensive, transition, etc.) scores higher.
ARCHETYPE_LABELS: tuple[str, ...] = (
    "offensive",
    "defensive",
    "transition",
    "balanced",
    "paint",
    "shooting",
)
