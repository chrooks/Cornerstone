"""
roster_evaluator/weights.py — All tunable numbers for the rule engine.

This is the single source of truth for weights, multipliers, and thresholds.
Adjust values here and re-run to retune the engine — no logic code changes needed.

Sections:
  TIER_WEIGHTS              — numeric value per skill tier (0–4)
  ON_BALL_SCORING_WEIGHTS   — per-skill contribution to on-ball scoring threat
  OFF_BALL_GRAVITY_WEIGHTS  — per-skill contribution to off-ball defensive attention
  SIZE_MODIFIER             — height → defensive impact scale config
  GRAVITY_SCALE             — max_input for normalising gravity to [0, 1]
  OFF_BALL_GRAVITY_SCALE    — max_input for normalising off-ball gravity to [0, 1]
  CROSS_ROSTER_MULTIPLIERS  — amplification ranges for inter-skill relationships
  SPACING_THRESHOLDS        — score cutoffs for critical/warning notes
  SEVERITY_ORDER            — sort key for note prioritisation
  HIGH_FLEX_SKILLS          — skills whose gaps warrant louder warnings
"""

# ---------------------------------------------------------------------------
# Tier numeric values — used everywhere a tier string needs arithmetic
# ---------------------------------------------------------------------------
TIER_WEIGHTS: dict[str, int] = {
    "None": 0,
    "Capable": 1,
    "Proficient": 2,
    "Elite": 3,
    "All-Time Great": 4,
}

# ---------------------------------------------------------------------------
# On-ball scoring threat — what forces defenses to respect you with the ball
# ---------------------------------------------------------------------------
ON_BALL_SCORING_WEIGHTS: dict[str, float] = {
    "off_dribble_shooter": 1.0,
    "isolation_scorer":    1.0,
    "mid_post_player":     0.8,
    "driver":              0.8,
    "low_post_player":     0.7,
    "crafty_finisher":     0.5,
    "transition_threat":   0.4,   # dual on/off-ball skill
}

# ---------------------------------------------------------------------------
# Off-ball gravity — defensive attention commanded without the ball
# ---------------------------------------------------------------------------
OFF_BALL_GRAVITY_WEIGHTS: dict[str, float] = {
    "spot_up_shooter":  1.0,
    "movement_shooter": 1.2,   # harder to track; movement > spot-up
    "cutter":           0.9,
    "vertical_spacer":  0.8,
    "high_flyer":       0.5,   # lob threat amplifies cutting/spacing
    "transition_threat": 0.4,  # dual on/off-ball skill
}

# ---------------------------------------------------------------------------
# Size modifier — scales defensive contributions by player height
# ---------------------------------------------------------------------------
SIZE_MODIFIER: dict[str, float] = {
    "min_height_inches":         72.0,   # 6-0 → modifier floor
    "max_height_inches":         84.0,   # 7-0 → modifier ceiling
    "min_modifier":              0.6,
    "max_modifier":              1.0,
    "high_flyer_bonus_per_tier": 0.05,   # each tier of high_flyer adds this
    "default_modifier":          0.8,    # used when height is unavailable
}

# ---------------------------------------------------------------------------
# Gravity normalisation — maps raw scoring threat score to [0, 1]
#
# Calibrated ceiling: scores above max_input clamp to gravity 1.0.
# True mathematical ceiling (all 7 skills at ATG) is 20.8, but no real player
# achieves that. 12.0 is set so that a complete multi-dimensional scorer
# (ATG iso + ATG off-dribble + Elite post + Elite driver) reaches ~1.0,
# while a one-dimensional scorer (ATG iso only) gets ~0.33. Adjust if real
# player profiles show consistent mis-calibration.
# ---------------------------------------------------------------------------
GRAVITY_SCALE: dict[str, float] = {
    "max_input": 12.0,
}

# ---------------------------------------------------------------------------
# Off-ball gravity normalisation — maps raw off-ball score to [0, 1]
#
# Calibrated ceiling: true ceiling (all 6 skills at ATG) is 19.2.
# 10.0 is set so ATG spot-up + ATG movement (raw=8.8) reaches gravity ~0.88,
# reflecting Steph Curry-level off-ball threat. Adjust if mis-calibrated.
# ---------------------------------------------------------------------------
OFF_BALL_GRAVITY_SCALE: dict[str, float] = {
    "max_input": 10.0,
}

# ---------------------------------------------------------------------------
# Cross-roster multipliers — one skill amplifying another at roster level
# Each is a (min_multiplier, max_multiplier) range; interpolated by score.
# ---------------------------------------------------------------------------
CROSS_ROSTER_MULTIPLIERS: dict[str, dict[str, float]] = {
    # Screen setters amplify movement shooters (primary) and cutters (secondary)
    "screen_to_movement": {"min": 0.5, "max": 1.2, "max_input": 16.0},
    "screen_to_cutter":   {"min": 0.6, "max": 1.0, "max_input": 16.0},

    # Passers amplify cutters, vertical spacers, transition threats
    "passer_to_cutter":   {"min": 0.2, "max": 1.0, "max_input": 16.0},
    "passer_to_spacer":   {"min": 0.1, "max": 1.0, "max_input": 16.0},

    # On-ball gravity of teammates opens cutting lanes
    "onball_gravity_to_cutter": {"min": 0.5, "max": 1.0, "max_input": 6.0},

    # Rim anchor amplifies perimeter defenders
    "rim_to_perimeter":   {"min": 1.0, "max": 1.4, "max_input": 16.0},
}

# ---------------------------------------------------------------------------
# Compounding exponents — non-linear stacking for defenders / passers
# ---------------------------------------------------------------------------
COMPOUNDING_EXPONENTS: dict[str, float] = {
    "perimeter_disruptors": 1.3,   # Thunder effect — stacking is superlinear
    "versatile_defenders":  1.15,  # compounds with perimeter, less than rim
    "passers":              1.2,   # two elite passers > 2× one
}

# ---------------------------------------------------------------------------
# Spacing thresholds — raw effective spacing score cutoffs for notes
# ---------------------------------------------------------------------------
SPACING_THRESHOLDS: dict[str, float] = {
    "critical": 3.0,
    "warning":  5.0,
    "good":     8.0,
}

# ---------------------------------------------------------------------------
# Defense thresholds
# ---------------------------------------------------------------------------
DEFENSE_THRESHOLDS: dict[str, float] = {
    "rim_anchor_min":       2.0,   # rim_score below this = no anchor
    "versatile_depth_min":  3,     # count of capable+ versatile defenders to compensate no rim
    "blackhole_max":        1,     # more than this many blackholes = flag
}

# ---------------------------------------------------------------------------
# Note priority — lower number = shown first
# ---------------------------------------------------------------------------
SEVERITY_ORDER: dict[str, int] = {
    "critical": 0,
    "warning":  1,
    "tip":      2,
    "strength": 3,
}

# ---------------------------------------------------------------------------
# High-flexibility skills — gaps here warrant louder notes
# (per heuristics doc: Passers, VD, Rim Protectors, OffReb, Spot-Up, Movement)
# ---------------------------------------------------------------------------
HIGH_FLEX_SKILLS: frozenset[str] = frozenset({
    "passer",
    "versatile_defender",
    "rim_protector",
    "offensive_rebounder",
    "spot_up_shooter",
    "movement_shooter",
})

# ---------------------------------------------------------------------------
# Live mode — max notes returned
# ---------------------------------------------------------------------------
LIVE_NOTE_LIMIT: int = 7
