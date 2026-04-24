"""
roster_evaluator/weights.py — All tunable constants for the 4-layer scoring pipeline.

This is the single source of truth for tier values, slot weights, skill weights,
dimension rollup weights, modifier deltas, redundancy ranges, and meta constants.
Adjust values here to retune the engine — no logic code changes needed.

Sections:
  TIER_VALUES               — numeric value per skill tier (0, 1, 2, 4, 8)
  SLOT_WEIGHTS              — importance decay per roster slot (0 = cornerstone)
  SKILL_WEIGHTS             — intra-dimension contribution per skill
  DIMENSION_WEIGHTS         — rollup to overall score
  OFFENSE_SUBWEIGHTS        — Spacing/Creation/Paint/Transition → Offense composite
  MODIFIER_DELTAS           — all modifier delta magnitudes (named constants)
  REDUNDANCY_RANGES         — (min, ceiling) per critical skill for optionality scoring
  SEVERITY_ORDER            — sort key for note prioritisation
  LIVE_NOTE_LIMIT           — max notes in live mode
  ABSENCE_NOTE_MIN_PLAYERS  — supporting players needed before ABSENCE notes appear in live mode
"""

# ---------------------------------------------------------------------------
# Tier numeric values
# Elite=4, ATG=8 (distinct from old engine's 0-1-2-3-4 scale)
# ---------------------------------------------------------------------------
TIER_VALUES: dict[str, int] = {
    "None": 0,
    "Capable": 1.5,
    "Proficient": 3,
    "Elite": 6,
    "All-Time Great": 10,
}

# ---------------------------------------------------------------------------
# Slot weights — Slot 0 is the cornerstone (never scored; context only).
# Slot 1 = co-star (highest weight). Weights decay toward bench.
# ---------------------------------------------------------------------------
SLOT_WEIGHTS: dict[int, float] = {
    0: 0.0,   # cornerstone — context only, not aggregated
    1: 1.0,   # co-star
    2: 0.9,   # third best starter
    3: 0.75,  # fourth best starter
    4: 0.7,   # fifth starter
    5: 0.6,
    6: 0.5,
    7: 0.4,
    8: 0.2,
    9: 0.1,  # 9th supporting slot if present
}

# Spacing skills (spot_up_shooter, movement_shooter, screen_setter) use this floor
# instead of raw slot weight. A shooter in slot 7 still occupies a defender — their
# gravity doesn't decay as sharply as a creator's influence on play-calling does.
# Slots 1–5 are already at or above this floor and are unaffected.
SPACING_SLOT_WEIGHT_FLOOR: float = 0.6

# ---------------------------------------------------------------------------
# Intra-dimension skill weights — how much each skill contributes per dimension.
# Skills with empty dicts are multipliers/enablers, not raw additive contributors.
# ---------------------------------------------------------------------------
SKILL_WEIGHTS: dict[str, dict[str, float]] = {
    # Spacing
    "movement_shooter":     {"spacing": 2},
    "spot_up_shooter":      {"spacing": 1.2},
    "screen_setter":        {"spacing": 0.4},   # enabler, not a spacer itself

    # Creation
    "pnr_ball_handler":     {"creation": 1.0},
    "driver":               {"creation": 1.0, "paint": 1.0},
    "isolation_scorer":     {"creation": 0.7},
    "mid_post_player":      {"creation": 0.6, "paint": 0.8},
    "low_post_player":      {"creation": 0.6, "paint": 1.0},

    # Defense
    "versatile_defender":   {"defense": 1.0},
    "rim_protector":        {"defense": 1.0},
    "perimeter_disruptor":  {"defense": 0.6},   # scales with count via DEF-02
    "rebounder":            {"defense": 0.5},

    # Paint (additional entries beyond driver/low_post/mid_post above)
    "vertical_spacer":      {"paint": 1.0},

    # Transition
    "transition_threat":    {"transition": 2.5},

    # Supporting/multiplier skills (not raw dimension contributors)
    "passer":               {},  # multiplier only
    "cutter":               {},  # enabled by passers + spacing
    "pnr_finisher":         {},  # enabled by pnr_ball_handler
    "offensive_rebounder":  {},  # standalone value
    "high_flyer":           {},  # multiplier only
}

# ---------------------------------------------------------------------------
# Dimension rollup weights to overall score
# ---------------------------------------------------------------------------
DIMENSION_WEIGHTS: dict[str, float] = {
    "offense":      0.30,   # composite of spacing + creation + paint + transition
    "defense":      0.30,
    "optionality":  0.20,
    "robustness":   0.20,
}

OFFENSE_SUBWEIGHTS: dict[str, float] = {
    "spacing":    0.35,
    "creation":   0.35,
    "paint":      0.20,
    "transition": 0.10,
}

# ---------------------------------------------------------------------------
# Modifier delta constants — all additive point deltas on 0–100 dimension scores.
# All modifier logic reads from here; no magic numbers in modifier functions.
# ---------------------------------------------------------------------------
MODIFIER_DELTAS: dict[str, float] = {
    # Defense
    "DEF_01_rim_amplifies_perimeter":       +8,
    "DEF_02_perimeter_compound_per_player": +5,   # per additional disruptor beyond first
    "DEF_03_versatile_perimeter_compound":  +3,
    "DEF_04_no_rim_versatile_mitigation":   +6,   # reduces missing rim protection penalty
    "DEF_05_height_hole_penalty":           -8,   # base penalty when any coverage hole exists
    "DEF_05_height_hole_per_inch":          -2,   # additional per uncovered inch
    "DEF_05_height_hole_cap":              -25,   # floor on total penalty
    "DEF_06_full_coverage_bonus":           +8,   # bonus when 6'0–7'2 fully covered
    "DEF_07_black_hole_spacing_penalty":    -8,
    "DEF_08_two_way_bonus":                 +2.5,
    "DEF_09_rebounding_deficit_penalty":     -10,  # additive penalty when rebounding is deficient
    "DEF_09_rebounding_deficit_cap":        60,   # hard cap value on defense score after penalty
    "DEF_10_perimeter_transition_per_player": +4,  # 0.8 × DEF_02; perimeter pressure → deflections → fast breaks

    # Spacing
    "OFF_01_low_spacing_caps_creation":     -18,  # per threshold breach level
    "OFF_02_screen_enables_movement":       +6,
    "OFF_03_movement_without_screen":       -5,
    "OFF_04_screen_enables_cutting":        +3,
    "OFF_05_creation_spacing_imbalance":    -15,

    # On-Ball Balance
    "OFF_06_exclusive_onball_penalty":      -7,   # per additional exclusively on-ball player
    "OFF_07_exclusive_onball_below_elite":  -5,
    "OFF_08_onball_with_offball_bonus":     +1,
    "OFF_09_single_creator_upweight":       +6,
    "OFF_10_cornerstone_raises_spacing_threshold": 10,  # points added to spacing threshold

    # Passers & Off-Ball
    "OFF_11_passer_offball_multiplier":     +0.4,   # per off-ball skill enabled (reduced from 0.5 — prevents single ATG passer inflating creation unrealistically)
    "OFF_12_cutter_without_passer":         -8,
    "OFF_13_cutter_without_spacing":        -6,
    "OFF_14_cutter_gravity_bonus":          +2,
    "OFF_15_vertical_without_lob":          -10,
    "OFF_16_vertical_with_lob":             +7,

    # Paint
    "OFF_17_driver_finishing_bonus":        +5,
    "OFF_18_driver_passing_bonus":          +4,
    "OFF_19_low_post_spacing_penalty":      -10,
    "OFF_20_low_post_secondary_bonus":      +4,   # per secondary skill
    "OFF_21_mid_post_spacing_penalty":      -7,
    "OFF_22_mid_post_secondary_bonus":      +3,
    "OFF_23_iso_spacing_penalty":           -5,
    "OFF_24_iso_secondary_bonus":           +4,

    # High Flyer multipliers
    "OFF_25_high_flyer_vertical_mult":      1.25,
    "OFF_26_high_flyer_cutting_mult":       1.20,
    "OFF_27_high_flyer_pnr_mult":           1.20,

    # PnR
    "OFF_28_pnr_synergy_bonus":             +8,
    "OFF_29_pnr_handler_secondary_bonus":   +1,   # per secondary skill
    "OFF_30_pnr_finisher_secondary_bonus":  +1,   # per secondary skill

    # Creation concentration
    "OFF_37_single_passer_dependency":      -10,  # penalty when only 1 passer in full rotation

    # Transition
    "OFF_31_transition_passer_synergy":     +8,
    "OFF_31_transition_dual_threat_double": 1.5,  # tier-scale constant: bonus = base × (tt/elite) × (passer/elite) × this; Elite×Elite → ×2 total
    "OFF_32_high_flyer_transition_bonus":   +8,   # base delta per high-flyer (multiplied by tier factors)
    "OFF_32_high_flyer_transition_cap":     +20,  # ceiling on combined bonus across all high-flyers

    # Offensive Rebounding
    "OFF_33_offreb_spacing_mitigation":     +4,

    # Shooter Density — compounding gravity bonus for multiple shooters
    "OFF_34_shooter_density_per_extra":     +5.5,   # +5 spacing per shooter beyond the first (Capable+)
    "OFF_34_shooter_density_cap":           +25,  # ceiling on total density bonus

    # Non-Shooter Penalty — each non-shooter beyond the first collapses floor spacing
    "OFF_35_non_shooter_penalty":           -8,   # per non-shooter beyond the first in supporting rotation
    "OFF_35_non_shooter_penalty_cap":       -24,  # floor on total penalty (max -24 hit)

    # Cornerstone Spacing — cornerstone shooting creates gravity even though slot weight = 0
    "OFF_36_cornerstone_spacing_base":      +6,   # base per spacing skill, scaled by tier and skill weight

    # Hard floors
    "HARD_01_no_paint_penalty":             -25,
    "HARD_02_no_creation_penalty":          -20,
    "HARD_03_insufficient_spacing_penalty": -20,
    "HARD_04_no_defender_penalty":          -25,
    "HARD_05_no_rebounding_cap":            65,   # hard cap on defense score
}

# ---------------------------------------------------------------------------
# Redundancy ranges — (min_count, over_stack_ceiling) per critical skill.
# Used by optionality scoring: below min → penalize, above ceiling → diminishing.
# ---------------------------------------------------------------------------
REDUNDANCY_RANGES: dict[str, tuple[int, int]] = {
    "movement_shooter":   (1, 3),
    "rim_protector":      (1, 2),
    "versatile_defender": (1, 5),
    "perimeter_disruptor":(1, 5),
    "pnr_ball_handler":   (1, 2),
    "pnr_finisher":       (1, 2),
    "driver":             (1, 3),
    "rebounder":          (1, 3),
    "low_post_player":    (1, 1),  # hard to over-stack
    "mid_post_player":    (1, 1),
}

# ---------------------------------------------------------------------------
# Note priority — lower number = shown first
# ---------------------------------------------------------------------------
SEVERITY_ORDER: dict[str, int] = {
    "critical": 0,
    "warning":  1,
    "suggestion": 2,
    "strength": 3,
}

# ---------------------------------------------------------------------------
# Live mode — max notes returned; max strength notes returned
# ---------------------------------------------------------------------------
LIVE_NOTE_LIMIT: int = 14
LIVE_STRENGTH_LIMIT: int = 5

# ---------------------------------------------------------------------------
# Absence note minimum players — ABSENCE-tagged notes only surface in live mode
# when the supporting rotation has at least this many players.
# Now that absence notes are directional suggestions (not penalties), 3 players
# is enough context to give meaningful recommendations.
# ---------------------------------------------------------------------------
ABSENCE_NOTE_MIN_PLAYERS: int = 3

# ---------------------------------------------------------------------------
# Cornerstone complement layer — max supporting players before the complement
# suggestion module retires and the main modifier system takes over fully.
# ---------------------------------------------------------------------------
COMPLEMENT_STAGE_CUTOFF: int = 3

# ---------------------------------------------------------------------------
# Directional guidance — score-based archetype suggestions that continue
# after the complement module retires (3+ supporting players).
# Dimensions scoring below this threshold get a "your team needs X" suggestion.
# ---------------------------------------------------------------------------
DIRECTIONAL_GUIDANCE_THRESHOLD: float = 40.0
DIRECTIONAL_NOTE_LIMIT: int = 2

# ---------------------------------------------------------------------------
# Healthy-dimension note suppression — negative modifier notes are dropped when
# the final dimension score exceeds this threshold.
#
# Modifiers run in Layer 3 against pre-modifier scores. When positive modifiers
# later push a dimension well into healthy territory, the negative notes that fired
# against the raw score become misleading (e.g. "floor spacing is too thin (34)"
# when the final spacing is 84). Any negative note whose dimension finishes above
# this threshold is suppressed entirely — the score answers the concern already.
# ---------------------------------------------------------------------------
NOTE_SUPPRESSION_THRESHOLD: float = 65.0
