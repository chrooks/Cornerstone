"""
cohesion_engine/weights.py — Tunable constants for the cohesion engine.

The production modules should import values from here instead of embedding
formula numbers locally. Keeping these constants centralized makes calibration
possible without hunting through the evaluation logic.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Tier numeric values
# ---------------------------------------------------------------------------

TIER_VALUES: dict[str, float] = {
    "None": 0.0,
    "Capable": 1.5,
    "Proficient": 3.0,
    "Elite": 6.0,
    "All-Time Great": 10.0,
}


# ---------------------------------------------------------------------------
# Composite formula coefficients
# ---------------------------------------------------------------------------

COMPOSITE_COEFFICIENTS: dict[str, float] = {
    "spacing_off_dribble": 0.5,
    "paint_touch_finishing_scale": 0.08,
    "paint_touch_vertical_spacer": 0.6,
    "paint_touch_mid_post": 0.7,
    "anchor_screen_setter": 0.3,
    "post_game_mid_post": 0.7,
    "pnr_screener_secondary_scale": 0.15,
    "off_ball_finishing_scale": 0.08,
    "shot_creation_spacing": 0.3,
    "transition_passer_scale": 0.2,
    "transition_high_flyer": 0.7,
    "transition_driver": 0.3,
    "transition_spot_up": 0.2,
}

COMPOSITE_NAMES: tuple[str, ...] = (
    "spacing",
    "finishing",
    "paint_touch",
    "anchor",
    "post_game",
    "pnr_screener",
    "off_ball_impact",
    "shot_creation",
    "rebounding",
    "transition",
)

THEORETICAL_MAX: dict[str, float] = {
    "spacing": 25.0,
    "finishing": 20.0,
    "paint_touch": 85.8,
    "anchor": 33.0,
    "post_game": 17.0,
    "pnr_screener": 50.0,
    "off_ball_impact": 61.0,
    "shot_creation": 60.0,
    "rebounding": 20.0,
    "transition": 42.0,
}

NORMALIZATION_BREAKPOINT_PERCENTILE: float = 0.6
NORMALIZATION_BREAKPOINT_SCORE: float = 6.0
MIN_DISTRIBUTION_SIZE: int = 20


# ---------------------------------------------------------------------------
# Defensive bell curve constants
# ---------------------------------------------------------------------------

AMPLITUDE_MAP: dict[str, float] = {
    "None": 0.0,
    "Capable": 1.0,
    "Proficient": 2.0,
    "Elite": 3.0,
    "All-Time Great": 4.0,
}
WARM_BODY: float = 0.5

VD_EXT: dict[str, int] = {
    "None": 0,
    "Capable": 2,
    "Proficient": 3,
    "Elite": 5,
    "All-Time Great": 7,
}
PD_DOWN: dict[str, int] = {
    "None": 0,
    "Capable": 1,
    "Proficient": 2,
    "Elite": 3,
    "All-Time Great": 5,
}
RP_UP: dict[str, int] = {
    "None": 0,
    "Capable": 1,
    "Proficient": 2,
    "Elite": 3,
    "All-Time Great": 4,
}

PEAK_SHIFT_PD_ONLY: int = -2
PEAK_SHIFT_RP_ONLY: int = 2
HEIGHT_MIN_INCHES: int = 72
HEIGHT_MAX_INCHES: int = 88
BELL_BASE_RANGE: int = 1
BELL_FLAT_TOP_DIVISOR: int = 3
RP_CROSS_HEIGHT_MIN: int = 82
RP_CROSS_SCALE: float = 0.5
RP_CROSS_HEIGHT_WINDOW: int = 6
PD_CROSS_HEIGHT_MAX: int = 75
PD_CROSS_SCALE: float = 0.5
PD_CROSS_HEIGHT_WINDOW: int = 4

DEFENSIVE_GAP_THRESHOLD: float = 1.0
DEFENSIVE_GAP_PENALTY_SCALE: float = -0.5
DEFENSIVE_REBOUNDING_MINIMUM: float = 3.0
DEFENSIVE_REBOUNDING_PENALTY_SCALE: float = 2.0
DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE: tuple[int, int] = (72, 79)
DEFENSIVE_TRANSITION_BOOST_DIVISOR: float = 15.0
DEFENSIVE_TRANSITION_BOOST_CAP: float = 2.0
STACKING_RETURNS: tuple[float, ...] = (1.0, 0.5, 0.25, 0.1)

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

SYNERGY_SCALE_FACTORS: dict[str, float] = {
    "OFF-02": 0.05,
    "OFF-03": 0.03,
    "OFF-04": 0.04,
    "OFF-12": 0.05,
    "OFF-13": 0.03,
    "OFF-14": 0.04,
    "OFF-15": 0.05,
    "OFF-16": 0.05,
    "OFF-28": 0.05,
    "OFF-31": 0.04,
    "OFF-32": 0.03,
}

SYNERGY_BOOSTED_SKILLS: dict[str, tuple[str, ...]] = {
    "OFF-02": ("movement_shooter",),
    "OFF-03": ("movement_shooter",),
    "OFF-04": ("cutter",),
    "OFF-12": ("cutter",),
    "OFF-13": ("cutter",),
    "OFF-14": ("cutter",),
    "OFF-15": ("vertical_spacer",),
    "OFF-16": ("vertical_spacer",),
    "OFF-28": ("pnr_ball_handler", "pnr_finisher"),
    "OFF-31": ("transition_threat",),
    "OFF-32": ("high_flyer",),
}

SYNERGY_PENALTY_SEVERITY: float = 5.0
OFF_13_RAW_SPACING_THRESHOLD: float = 15.0


# ---------------------------------------------------------------------------
# Cohesion rollup weights
# ---------------------------------------------------------------------------

COHESION_ROLLUP_WEIGHTS: dict[str, float] = {
    "spacing_creation_ratio": 0.12,
    "spacing_paint_touch_ratio": 0.06,
    "paint_touch_total": 0.08,
    "post_game_total": 0.03,
    "pnr_screener_total": 0.03,
    "anchor_total": 0.08,
    "collective_passing": 0.06,
    "rebounding": 0.06,
    "transition": 0.06,
    "rebound_transition_ratio": 0.04,
    "rebounding_spacing_deficit": 0.03,
    "defensive_coverage": 0.15,
    "defensive_gaps": 0.10,
    "accentuation_strength": 0.05,
    "accentuation_weakness": 0.05,
}


# ---------------------------------------------------------------------------
# Ratio mechanics
# ---------------------------------------------------------------------------

RATIO_DEAD_ZONE: float = 0.2
RATIO_ASYMMETRIC_FULL_PENALTY: float = 1.0
RATIO_DEFAULT_PENALTY: float = 0.5
RATIO_MIN_DENOMINATOR: float = 0.1
REBOUNDING_SPACING_DEFICIT_THRESHOLD: float = 5.0


# ---------------------------------------------------------------------------
# Accentuation thresholds and complementary pairs
# ---------------------------------------------------------------------------

ACCENTUATION_STRENGTH_THRESHOLD: float = 7.5
ACCENTUATION_WEAKNESS_THRESHOLD: float = 2.5
ACCENTUATION_FALLBACK_STRENGTH_THRESHOLD: float = 6.0
ACCENTUATION_FALLBACK_WEAKNESS_THRESHOLD: float = 2.0
ACCENTUATION_TOP_N: int = 3
ACCENTUATION_MIN_STRENGTHS: int = 1

ACCENTUATION_COMPLEMENTARY_PAIRS: tuple[tuple[str, str], ...] = (
    ("spacing", "paint_touch"),
    ("shot_creation", "off_ball_impact"),
    ("shot_creation", "pnr_screener"),
)


# ---------------------------------------------------------------------------
# Note thresholds
# ---------------------------------------------------------------------------

NOTE_LIMIT_PER_TYPE: int = 3
NOTE_ELITE_COMPOSITE_THRESHOLD: float = 8.0
NOTE_STACKED_COMPOSITE_THRESHOLD: float = 6.0
NOTE_STACKED_PLAYER_COUNT: int = 2
NOTE_MISSING_COMPOSITE_THRESHOLD: float = 2.0
NOTE_CAPABLE_PASSER_THRESHOLD: float = 3.0
NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD: float = 3.5
NOTE_SEVERITY_MIN: float = 0.0
NOTE_SEVERITY_MAX: float = 1.0


# ---------------------------------------------------------------------------
# Layer 2 roster normalization constants
# ---------------------------------------------------------------------------

ROSTER_ROLLUP_WEIGHTS: dict[str, float] = {
    "starting_5": 0.45,
    "depth": 0.25,
    "archetype_diversity": 0.20,
    "floor": 0.10,
}

STAR_RATING_MAX: float = 5.0
VIABLE_LINEUP_THRESHOLD: float = 3.5
DEPTH_LINEUP_CEILING: int = 40
TOTAL_LINEUPS_FULL_ROSTER: int = 126
ARCHETYPE_LABELS: tuple[str, ...] = (
    "offensive",
    "defensive",
    "transition",
    "balanced",
    "paint",
    "shooting",
)
