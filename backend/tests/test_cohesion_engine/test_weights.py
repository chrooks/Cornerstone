"""
Tests that pin Phase 1 cohesion-engine constants to the implementation spec.
"""

from __future__ import annotations

import pytest

from backend.services.cohesion_engine import weights


def test_tier_values_match_design_mapping():
    assert weights.TIER_VALUES == {
        "None": 0.0,
        "Capable": 1.0,
        "Proficient": 4.0,
        "Elite": 8.0,
        "All-Time Great": 16.0,
    }


def test_composite_coefficients_match_resolved_formulas():
    assert weights.COMPOSITE_COEFFICIENTS["spacing_off_dribble"] == 0.5
    assert weights.COMPOSITE_COEFFICIENTS["paint_touch_finishing_scale"] == 0.08
    assert weights.COMPOSITE_COEFFICIENTS["paint_touch_vertical_spacer"] == 0.6
    assert weights.COMPOSITE_COEFFICIENTS["post_game_mid_post"] == 0.7
    assert weights.COMPOSITE_COEFFICIENTS["pnr_screener_secondary_scale"] == 0.15
    assert weights.COMPOSITE_COEFFICIENTS["shot_creation_spacing"] == 0.3
    assert weights.COMPOSITE_COEFFICIENTS["transition_passer_scale"] == 0.2
    assert weights.COMPOSITE_COEFFICIENTS["perimeter_defense_versatile_defender"] == 0.7
    assert weights.COMPOSITE_COEFFICIENTS["interior_defense_versatile_defender"] == 0.25
    assert weights.COMPOSITE_COEFFICIENTS["interior_defense_rebounder"] == 0.3


def test_theoretical_maxima_match_impl_spec_fallback_table():
    assert weights.THEORETICAL_MAX == {
        "spacing": 40.0,
        "finishing": 32.0,
        "paint_touch": 187.968,
        "post_game": 27.2,
        "pnr_screener": 108.8,
        "off_ball_impact": 101.76,
        "shot_creation": 158.464,
        "pnr_orchestration": 28.8,
        "ball_security": 16.0,
        "defensive_rebounding": 16.0,
        "offensive_rebounding": 16.0,
        "transition": 86.4,
        "perimeter_defense": 27.2,
        "interior_defense": 24.8,
    }


def test_bell_curve_tables_and_peak_shifts_match_impl_spec():
    assert weights.AMPLITUDE_MAP["Elite"] == 3.0
    assert weights.AMPLITUDE_MAP["All-Time Great"] == 4.0
    assert weights.WARM_BODY == 0.5
    assert weights.VD_EXT == {
        "None": 0,
        "Capable": 2,
        "Proficient": 3,
        "Elite": 5,
        "All-Time Great": 9,
    }
    assert weights.PD_DOWN == {
        "None": 0,
        "Capable": 2,
        "Proficient": 4,
        "Elite": 6,
        "All-Time Great": 8,
    }
    assert weights.RP_UP == {
        "None": 0,
        "Capable": 2,
        "Proficient": 3,
        "Elite": 5,
        "All-Time Great": 6,
    }
    assert weights.PEAK_SHIFT_PD_ONLY == -1
    assert weights.PEAK_SHIFT_RP_ONLY == 1


def test_synergy_scale_factors_match_impl_spec_table():
    assert weights.SYNERGY_SCALE_FACTORS == {
        "OFF-02": 0.05,
        "OFF-03": 0.03,
        "OFF-04": 0.04,
        "OFF-12": 0.05,
        "OFF-13": 0.03,
        "OFF-14": 0.04,
        "OFF-15": 0.05,
        "OFF-16": 0.05,
        "OFF-31": 0.04,
        "OFF-32": 0.03,
    }
    assert weights.SYNERGY_PENALTY_SEVERITY == 5.0
    assert weights.OFF_13_RAW_SPACING_THRESHOLD == 15.0
    assert weights.SYNERGY_CREATOR_THRESHOLD == 6.0
    assert weights.PNR_HANDLER_SUPPORT_SCALE == 0.35


def test_two_level_rollup_weights_sum_correctly():
    assert sum(weights.CATEGORY_WEIGHTS.values()) == pytest.approx(1.0)
    assert sum(weights.OFFENSE_QUALITY_WEIGHTS.values()) == pytest.approx(1.0)
    assert sum(weights.OFFENSE_BALANCE_WEIGHTS.values()) == pytest.approx(1.0)
    assert sum(weights.DEFENSE_SUBSCORE_WEIGHTS.values()) == pytest.approx(1.0)
    assert sum(weights.REBOUND_TRANSITION_SUBSCORE_WEIGHTS.values()) == pytest.approx(1.0)
    assert weights.CATEGORY_WEIGHTS["offense"] == 0.40
    assert weights.CATEGORY_WEIGHTS["defense"] == 0.37
    assert weights.CATEGORY_WEIGHTS["rebounding_transition"] == 0.23
    assert weights.OFFENSE_QUALITY_RATIO == 0.70
    assert weights.ACCENTUATION_STRENGTH_CAP == 0.25
    assert weights.ACCENTUATION_WEAKNESS_CAP == 0.50


def test_ratio_accentuation_note_and_layer_2_constants_exist():
    assert weights.RATIO_DEAD_ZONE == 0.2
    assert weights.ACCENTUATION_STRENGTH_THRESHOLD == 7.5
    assert weights.ACCENTUATION_WEAKNESS_THRESHOLD == 2.5
    assert ("perimeter_defense", "interior_defense") in weights.ACCENTUATION_COMPLEMENTARY_PAIRS
    assert ("perimeter_defense", "transition") in weights.ACCENTUATION_COMPLEMENTARY_PAIRS
    assert weights.ACCENTUATION_FALLBACK_STRENGTH_THRESHOLD == 6.0
    assert weights.ACCENTUATION_FALLBACK_WEAKNESS_THRESHOLD == 2.0
    assert weights.NOTE_ELITE_COMPOSITE_THRESHOLD == 8.0
    assert weights.NOTE_STACKED_COMPOSITE_THRESHOLD == 6.0
    assert weights.NOTE_LIMIT_PER_TYPE == 3
    assert weights.ROSTER_ROLLUP_WEIGHTS == {
        "starting_5": 0.45,
        "depth": 0.25,
        "archetype_diversity": 0.20,
        "floor": 0.10,
    }
    assert weights.LINEUP_ONLY_ROLLUP_WEIGHTS == {
        "starting_5": 0.90,
        "depth": 0.0,
        "archetype_diversity": 0.10,
        "floor": 0.0,
    }
    assert weights.LINEUP_ARCHETYPE_MAX == 3
    assert weights.VIABLE_LINEUP_THRESHOLD == 2.75
    assert weights.DEPTH_VIABLE_RATIO_WEIGHT == 0.60
    assert weights.DEPTH_QUALITY_WEIGHT == 0.40
    assert weights.TOTAL_LINEUPS_FULL_ROSTER == 126


def test_defensive_and_rp_pd_boost_constants_match_impl_spec():
    assert weights.DEFENSIVE_GAP_THRESHOLD == 1.5
    assert weights.DEFENSIVE_GAP_PENALTY_SCALE == -1.5
    assert weights.DEFENSIVE_REBOUNDING_MINIMUM == 3.0
    assert weights.DEFENSIVE_REBOUNDING_PENALTY_SCALE == 2.0
    assert weights.DEFENSIVE_TRANSITION_BOOST_DIVISOR == 15.0
    assert weights.DEFENSIVE_TRANSITION_BOOST_CAP == 2.0
    assert weights.RP_PD_BOOST == {
        "None": 0.0,
        "Capable": 0.0,
        "Proficient": 0.0,
        "Elite": 0.5,
        "All-Time Great": 1.0,
    }
