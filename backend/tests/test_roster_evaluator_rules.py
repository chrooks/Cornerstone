"""
tests/test_roster_evaluator_rules.py — Phase 3 rule function tests.

Each test covers one rule's trigger and non-trigger conditions.
Player-naming tests verify the named player appears in note text.

Helper: p(name, skills, height=None) → player dict
Helper: agg(roster) → compute_aggregates result
"""

import pytest
from services.roster_evaluator.rules import (
    check_rim_anchor,
    check_perimeter_compounding,
    check_defense_blackhole,
    check_offensive_blackhole,
    check_rebounding,
    check_spacing_critical,
    check_spacing_warning,
    check_movement_orphaned,
    check_screen_cutter_gap,
    check_cutter_activation,
    check_lob_threat_activation,
    check_creator_floor,
    check_exclusively_onball_quality,
    check_pnr_synergy_gap,
    check_transition_gap,
    check_paint_source,
    check_elite_spacing,
    check_defensive_depth,
    check_twoway_premium,
    check_passer_abundance,
    check_pnr_excellence,
    ALL_RULES,
    STRENGTH_RULES,
)
from services.roster_evaluator.aggregates import compute_aggregates


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def p(name: str, skills: dict, height: str | None = None) -> dict:
    """Create a minimal player dict."""
    return {"name": name, "height": height, "skills": skills}


def agg(roster):
    """Compute aggregates for a roster."""
    return compute_aggregates(roster)


# ---------------------------------------------------------------------------
# check_rim_anchor
# ---------------------------------------------------------------------------

class TestCheckRimAnchor:
    def test_no_rim_no_versatile_depth_returns_critical(self):
        roster = [p("Alice", {}), p("Bob", {})]
        note = check_rim_anchor(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"
        assert note.category == "defense"

    def test_no_rim_two_versatile_defenders_returns_critical(self):
        roster = [
            p("Alice", {"versatile_defender": "Capable"}),
            p("Bob", {"versatile_defender": "Proficient"}),
            p("Carol", {}),
        ]
        note = check_rim_anchor(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_no_rim_three_versatile_defenders_returns_none(self):
        roster = [
            p("Alice", {"versatile_defender": "Capable"}),
            p("Bob", {"versatile_defender": "Capable"}),
            p("Carol", {"versatile_defender": "Capable"}),
        ]
        note = check_rim_anchor(roster, agg(roster))
        assert note is None

    def test_proficient_rim_protector_returns_none(self):
        roster = [p("Wemby", {"rim_protector": "Proficient"})]
        note = check_rim_anchor(roster, agg(roster))
        assert note is None

    def test_capable_rim_protector_below_proficient_threshold_returns_critical(self):
        # "Capable" is below Proficient, so still flags without versatile depth
        roster = [p("Alice", {"rim_protector": "Capable"})]
        note = check_rim_anchor(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_elite_rim_protector_returns_none(self):
        roster = [p("Gobert", {"rim_protector": "Elite"})]
        note = check_rim_anchor(roster, agg(roster))
        assert note is None

    def test_empty_roster_returns_critical(self):
        roster = []
        note = check_rim_anchor(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_trace_key_is_defense_score(self):
        roster = []
        note = check_rim_anchor(roster, agg(roster))
        assert note.trace_key == "defense_score"


# ---------------------------------------------------------------------------
# check_perimeter_compounding
# ---------------------------------------------------------------------------

class TestCheckPerimeterCompounding:
    def test_no_perimeter_defense_returns_warning(self):
        roster = [p("Alice", {})]
        note = check_perimeter_compounding(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_single_capable_perimeter_returns_warning(self):
        roster = [p("Alice", {"perimeter_disruptor": "Capable"})]
        note = check_perimeter_compounding(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_multiple_proficient_perimeter_clears_warning(self):
        roster = [
            p("Alice", {"perimeter_disruptor": "Proficient"}),
            p("Bob", {"perimeter_disruptor": "Proficient"}),
            p("Carol", {"perimeter_disruptor": "Capable"}),
        ]
        note = check_perimeter_compounding(roster, agg(roster))
        assert note is None

    def test_elite_versatile_defenders_compensate(self):
        roster = [
            p("Alice", {"versatile_defender": "Elite"}),
            p("Bob", {"versatile_defender": "Elite"}),
        ]
        note = check_perimeter_compounding(roster, agg(roster))
        assert note is None

    def test_trace_key_is_perimeter_compound_score(self):
        roster = [p("Alice", {})]
        note = check_perimeter_compounding(roster, agg(roster))
        assert note.trace_key == "perimeter_compound_score"


# ---------------------------------------------------------------------------
# check_defense_blackhole
# ---------------------------------------------------------------------------

class TestCheckDefenseBlackhole:
    def test_no_defense_no_elite_offense_returns_warning(self):
        roster = [p("Alice", {"spot_up_shooter": "Proficient"})]  # no defense, offense not Elite
        note = check_defense_blackhole(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "Alice" in note.text

    def test_no_defense_elite_offense_returns_none(self):
        roster = [p("Luka", {"isolation_scorer": "Elite"})]
        note = check_defense_blackhole(roster, agg(roster))
        assert note is None

    def test_has_capable_defense_returns_none(self):
        roster = [p("Alice", {"perimeter_disruptor": "Capable"})]
        note = check_defense_blackhole(roster, agg(roster))
        assert note is None

    def test_multiple_flagged_players_named(self):
        roster = [
            p("Alice", {}),          # no defense, no offense
            p("Bob", {}),            # same
            p("Carol", {"rim_protector": "Capable"}),  # has defense
        ]
        note = check_defense_blackhole(roster, agg(roster))
        assert note is not None
        assert "Alice" in note.text
        assert "Bob" in note.text
        assert "Carol" not in note.text

    def test_all_have_defense_returns_none(self):
        roster = [
            p("Alice", {"versatile_defender": "Capable"}),
            p("Bob", {"rim_protector": "Capable"}),
        ]
        note = check_defense_blackhole(roster, agg(roster))
        assert note is None

    def test_all_time_great_offense_counts_as_elite(self):
        roster = [p("Curry", {"spot_up_shooter": "All-Time Great"})]
        note = check_defense_blackhole(roster, agg(roster))
        assert note is None

    def test_trace_key_is_defense_score(self):
        roster = [p("Alice", {})]
        note = check_defense_blackhole(roster, agg(roster))
        assert note.trace_key == "defense_score"


# ---------------------------------------------------------------------------
# check_offensive_blackhole
# ---------------------------------------------------------------------------

class TestCheckOffensiveBlackhole:
    def test_single_blackhole_below_threshold_returns_none(self):
        # blackhole_max=1, so exactly 1 is not flagged
        roster = [
            p("Alice", {"rim_protector": "Elite"}),  # blackhole
            p("Bob", {"spot_up_shooter": "Capable"}),  # not blackhole
        ]
        note = check_offensive_blackhole(roster, agg(roster))
        assert note is None

    def test_two_blackholes_above_threshold_returns_warning(self):
        roster = [
            p("Alice", {"rim_protector": "Elite"}),    # blackhole
            p("Bob", {"versatile_defender": "Elite"}),  # blackhole
            p("Carol", {"spot_up_shooter": "Capable"}),
        ]
        note = check_offensive_blackhole(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "Alice" in note.text
        assert "Bob" in note.text

    def test_no_blackholes_returns_none(self):
        roster = [
            p("Alice", {"spot_up_shooter": "Capable", "versatile_defender": "Elite"}),
        ]
        note = check_offensive_blackhole(roster, agg(roster))
        assert note is None

    def test_trace_key_is_correct(self):
        roster = [
            p("A", {"rim_protector": "Elite"}),
            p("B", {"versatile_defender": "Elite"}),
        ]
        note = check_offensive_blackhole(roster, agg(roster))
        assert note is not None
        assert note.trace_key == "paint_touch_score"


# ---------------------------------------------------------------------------
# check_rebounding
# ---------------------------------------------------------------------------

class TestCheckRebounding:
    def test_no_rebounders_returns_warning(self):
        roster = [p("Alice", {}), p("Bob", {})]
        note = check_rebounding(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_elite_rebounder_returns_none(self):
        roster = [p("Giannis", {"rebounder": "Elite"})]
        note = check_rebounding(roster, agg(roster))
        assert note is None

    def test_three_capable_rebounders_returns_none(self):
        roster = [
            p("A", {"rebounder": "Capable"}),
            p("B", {"rebounder": "Capable"}),
            p("C", {"rebounder": "Capable"}),
        ]
        note = check_rebounding(roster, agg(roster))
        assert note is None

    def test_two_capable_rebounders_returns_warning(self):
        roster = [
            p("A", {"rebounder": "Capable"}),
            p("B", {"rebounder": "Capable"}),
        ]
        note = check_rebounding(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_trace_key_is_rebounding_covered(self):
        roster = []
        note = check_rebounding(roster, agg(roster))
        assert note.trace_key == "rebounding_covered"


# ---------------------------------------------------------------------------
# check_spacing_critical
# ---------------------------------------------------------------------------

class TestCheckSpacingCritical:
    def test_no_shooters_returns_critical(self):
        roster = [p("A", {}), p("B", {})]
        note = check_spacing_critical(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_adequate_shooters_returns_none(self):
        roster = [
            p("A", {"spot_up_shooter": "Proficient"}),
            p("B", {"spot_up_shooter": "Capable"}),
            p("C", {"spot_up_shooter": "Capable"}),
        ]
        note = check_spacing_critical(roster, agg(roster))
        assert note is None

    def test_trace_key_is_spacing_score(self):
        roster = []
        note = check_spacing_critical(roster, agg(roster))
        assert note.trace_key == "spacing_score"


# ---------------------------------------------------------------------------
# check_spacing_warning
# ---------------------------------------------------------------------------

class TestCheckSpacingWarning:
    def test_score_below_critical_threshold_does_not_trigger_warning(self):
        # critical fires instead, not warning
        roster = [p("A", {})]
        note = check_spacing_warning(roster, agg(roster))
        assert note is None  # spacing_critical handles this band

    def test_score_in_warning_band_returns_warning(self):
        # Spacing score between 3.0 and 5.0
        # One spot-up shooter at Proficient = raw 2.0, no movement, no screens
        # spacing = 0 (movement) * 0.5 (min screen_mult) + 2.0 (spot-up) = 2.0 → critical
        # Need to reach 3.0–5.0 range: 3 capable spot-ups (3 * 1.0 = 3.0 → exactly critical)
        # Use 4 capable spot-up = 4.0 (in warning band)
        roster = [
            p("A", {"spot_up_shooter": "Capable"}),
            p("B", {"spot_up_shooter": "Capable"}),
            p("C", {"spot_up_shooter": "Capable"}),
            p("D", {"spot_up_shooter": "Capable"}),
        ]
        note = check_spacing_warning(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_strong_spacing_returns_none(self):
        roster = [
            p("A", {"movement_shooter": "Elite", "spot_up_shooter": "Elite"}),
            p("B", {"movement_shooter": "Proficient"}),
            p("C", {"screen_setter": "Elite"}),
        ]
        note = check_spacing_warning(roster, agg(roster))
        assert note is None


# ---------------------------------------------------------------------------
# check_movement_orphaned
# ---------------------------------------------------------------------------

class TestCheckMovementOrphaned:
    def test_movement_shooter_no_screens_returns_warning(self):
        roster = [
            p("Klay", {"movement_shooter": "Elite"}),
            p("Bob", {"spot_up_shooter": "Capable"}),
        ]
        note = check_movement_orphaned(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "Klay" in note.text

    def test_movement_shooter_with_screens_returns_none(self):
        roster = [
            p("Klay", {"movement_shooter": "Elite"}),
            p("Draymond", {"screen_setter": "Capable"}),
        ]
        note = check_movement_orphaned(roster, agg(roster))
        assert note is None

    def test_no_movement_shooters_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_movement_orphaned(roster, agg(roster))
        assert note is None

    def test_multiple_orphaned_shooters_all_named(self):
        roster = [
            p("Klay", {"movement_shooter": "Elite"}),
            p("Ray", {"movement_shooter": "Proficient"}),
        ]
        note = check_movement_orphaned(roster, agg(roster))
        assert note is not None
        assert "Klay" in note.text
        assert "Ray" in note.text

    def test_trace_key_is_spacing_score(self):
        roster = [p("Klay", {"movement_shooter": "Elite"})]
        note = check_movement_orphaned(roster, agg(roster))
        assert note.trace_key == "spacing_score"


# ---------------------------------------------------------------------------
# check_screen_cutter_gap
# ---------------------------------------------------------------------------

class TestCheckScreenCutterGap:
    def test_screens_but_no_cutters_returns_tip(self):
        roster = [
            p("A", {"screen_setter": "Proficient"}),
            p("B", {"spot_up_shooter": "Capable"}),
        ]
        note = check_screen_cutter_gap(roster, agg(roster))
        assert note is not None
        assert note.severity == "tip"

    def test_screens_and_cutters_returns_none(self):
        roster = [
            p("A", {"screen_setter": "Proficient"}),
            p("B", {"cutter": "Capable"}),
        ]
        note = check_screen_cutter_gap(roster, agg(roster))
        assert note is None

    def test_no_screens_at_all_returns_none(self):
        # No screens = no screen-cutter gap, a different problem
        roster = [p("A", {"spot_up_shooter": "Capable"})]
        note = check_screen_cutter_gap(roster, agg(roster))
        assert note is None

    def test_trace_key_is_cutter_score(self):
        roster = [p("A", {"screen_setter": "Proficient"})]
        note = check_screen_cutter_gap(roster, agg(roster))
        assert note.trace_key == "cutter_score"


# ---------------------------------------------------------------------------
# check_cutter_activation
# ---------------------------------------------------------------------------

class TestCheckCutterActivation:
    def test_cutters_with_no_enablers_returns_warning(self):
        # Cutter with no passer, no spacing, no screens → suppressed
        roster = [
            p("Gafford", {"cutter": "Elite"}),
            p("Bob", {}),
        ]
        note = check_cutter_activation(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "Gafford" in note.text

    def test_cutters_with_full_enablers_returns_none(self):
        roster = [
            p("Gafford", {"cutter": "Elite"}),
            p("CP3", {"passer": "Elite"}),
            p("Klay", {"movement_shooter": "Elite"}),
            p("Draymond", {"screen_setter": "Elite"}),
            p("Harden", {"isolation_scorer": "Elite"}),  # on-ball gravity
        ]
        note = check_cutter_activation(roster, agg(roster))
        assert note is None

    def test_no_cutters_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_cutter_activation(roster, agg(roster))
        assert note is None

    def test_trace_key_is_cutter_score(self):
        roster = [p("A", {"cutter": "Elite"})]
        note = check_cutter_activation(roster, agg(roster))
        assert note.trace_key == "cutter_score"


# ---------------------------------------------------------------------------
# check_lob_threat_activation
# ---------------------------------------------------------------------------

class TestCheckLobThreatActivation:
    def test_vertical_spacer_no_passer_no_driver_returns_warning(self):
        roster = [
            p("DeAndre", {"vertical_spacer": "Elite"}),
            p("Bob", {"spot_up_shooter": "Capable"}),
        ]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "DeAndre" in note.text

    def test_vertical_spacer_with_proficient_passer_returns_none(self):
        roster = [
            p("DeAndre", {"vertical_spacer": "Elite"}),
            p("CP3", {"passer": "Proficient"}),
        ]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note is None

    def test_vertical_spacer_with_proficient_driver_returns_none(self):
        roster = [
            p("DeAndre", {"vertical_spacer": "Elite"}),
            p("LeBron", {"driver": "Proficient"}),
        ]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note is None

    def test_no_vertical_spacer_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Capable"})]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note is None

    def test_capable_passer_not_enough_returns_warning(self):
        # Passer must be Proficient+ to activate lob
        roster = [
            p("DeAndre", {"vertical_spacer": "Elite"}),
            p("Bob", {"passer": "Capable"}),
        ]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note is not None

    def test_trace_key_is_lob_threat_active(self):
        roster = [p("A", {"vertical_spacer": "Elite"})]
        note = check_lob_threat_activation(roster, agg(roster))
        assert note.trace_key == "lob_threat_active"


# ---------------------------------------------------------------------------
# check_creator_floor
# ---------------------------------------------------------------------------

class TestCheckCreatorFloor:
    def test_no_creators_returns_critical(self):
        roster = [
            p("A", {"spot_up_shooter": "Elite"}),
            p("B", {"rim_protector": "Elite"}),
        ]
        note = check_creator_floor(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_one_creator_returns_warning(self):
        roster = [
            p("A", {"driver": "Capable"}),
            p("B", {"spot_up_shooter": "Elite"}),
            p("C", {}),
        ]
        note = check_creator_floor(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"

    def test_two_creators_returns_none(self):
        roster = [
            p("A", {"driver": "Capable"}),
            p("B", {"isolation_scorer": "Capable"}),
        ]
        note = check_creator_floor(roster, agg(roster))
        assert note is None

    def test_pnr_ball_handler_counts_as_creator(self):
        roster = [
            p("A", {"pnr_ball_handler": "Capable"}),
            p("B", {"mid_post_player": "Capable"}),
        ]
        note = check_creator_floor(roster, agg(roster))
        assert note is None

    def test_trace_key_is_paint_touch_score(self):
        roster = []
        note = check_creator_floor(roster, agg(roster))
        assert note.trace_key == "paint_touch_score"


# ---------------------------------------------------------------------------
# check_exclusively_onball_quality
# ---------------------------------------------------------------------------

class TestCheckExclusivelyOnballQuality:
    def test_exclusively_onball_below_elite_returns_warning(self):
        # On-ball only, Proficient level — not Elite enough to justify
        roster = [p("Alice", {"isolation_scorer": "Proficient"})]
        note = check_exclusively_onball_quality(roster, agg(roster))
        assert note is not None
        assert note.severity == "warning"
        assert "Alice" in note.text

    def test_exclusively_onball_elite_returns_none(self):
        roster = [p("Cam Thomas", {"isolation_scorer": "Elite"})]
        note = check_exclusively_onball_quality(roster, agg(roster))
        assert note is None

    def test_player_with_offball_skill_not_flagged(self):
        # Has a spot-up shooter skill → not exclusively on-ball
        roster = [p("Alice", {"isolation_scorer": "Proficient", "spot_up_shooter": "Capable"})]
        note = check_exclusively_onball_quality(roster, agg(roster))
        assert note is None

    def test_all_time_great_onball_returns_none(self):
        roster = [p("Kobe", {"isolation_scorer": "All-Time Great"})]
        note = check_exclusively_onball_quality(roster, agg(roster))
        assert note is None

    def test_multiple_subpar_exclusively_onball_all_named(self):
        roster = [
            p("Alice", {"driver": "Proficient"}),
            p("Bob", {"isolation_scorer": "Proficient"}),
        ]
        note = check_exclusively_onball_quality(roster, agg(roster))
        assert note is not None
        assert "Alice" in note.text
        assert "Bob" in note.text


# ---------------------------------------------------------------------------
# check_pnr_synergy_gap
# ---------------------------------------------------------------------------

class TestCheckPnrSynergyGap:
    def test_strong_handler_no_finisher_returns_tip(self):
        roster = [
            p("Tyrese", {"pnr_ball_handler": "Elite"}),
            p("Bob", {"spot_up_shooter": "Capable"}),
        ]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note is not None
        assert note.severity == "tip"

    def test_strong_finisher_no_handler_returns_tip(self):
        roster = [
            p("Gafford", {"pnr_finisher": "Elite"}),
            p("Bob", {"spot_up_shooter": "Capable"}),
        ]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note is not None
        assert note.severity == "tip"

    def test_both_sides_proficient_returns_none(self):
        roster = [
            p("A", {"pnr_ball_handler": "Proficient"}),
            p("B", {"pnr_finisher": "Proficient"}),
        ]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note is None

    def test_neither_side_proficient_returns_none(self):
        # No PnR action at all → no gap to note
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note is None

    def test_capable_handler_not_enough_for_synergy(self):
        # Capable handler + Proficient finisher → handler side below threshold
        roster = [
            p("A", {"pnr_ball_handler": "Capable"}),
            p("B", {"pnr_finisher": "Proficient"}),
        ]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note is not None  # finisher has it, handler doesn't

    def test_trace_key_is_pnr_synergy(self):
        roster = [p("A", {"pnr_ball_handler": "Elite"})]
        note = check_pnr_synergy_gap(roster, agg(roster))
        assert note.trace_key == "pnr_synergy"


# ---------------------------------------------------------------------------
# check_transition_gap
# ---------------------------------------------------------------------------

class TestCheckTransitionGap:
    def test_transition_threats_no_passer_returns_tip(self):
        roster = [
            p("A", {"transition_threat": "Elite"}),
            p("B", {"transition_threat": "Capable"}),
        ]
        note = check_transition_gap(roster, agg(roster))
        assert note is not None
        assert note.severity == "tip"

    def test_transition_threats_with_passer_returns_none(self):
        roster = [
            p("A", {"transition_threat": "Elite"}),
            p("B", {"passer": "Proficient"}),
        ]
        note = check_transition_gap(roster, agg(roster))
        assert note is None

    def test_no_transition_threats_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_transition_gap(roster, agg(roster))
        assert note is None

    def test_transition_threats_capable_passer_not_enough(self):
        # Passer must be Proficient+ for transition_active
        roster = [
            p("A", {"transition_threat": "Elite"}),
            p("B", {"passer": "Capable"}),
        ]
        note = check_transition_gap(roster, agg(roster))
        assert note is not None

    def test_trace_key_is_transition_active(self):
        roster = [p("A", {"transition_threat": "Elite"})]
        note = check_transition_gap(roster, agg(roster))
        assert note.trace_key == "transition_active"


# ---------------------------------------------------------------------------
# check_paint_source
# ---------------------------------------------------------------------------

class TestCheckPaintSource:
    def test_no_paint_sources_returns_critical(self):
        roster = [
            p("A", {"spot_up_shooter": "Elite"}),
            p("B", {"movement_shooter": "Elite"}),
        ]
        note = check_paint_source(roster, agg(roster))
        assert note is not None
        assert note.severity == "critical"

    def test_driver_provides_paint_source(self):
        roster = [p("A", {"driver": "Capable"})]
        note = check_paint_source(roster, agg(roster))
        assert note is None

    def test_low_post_provides_paint_source(self):
        roster = [p("A", {"low_post_player": "Capable"})]
        note = check_paint_source(roster, agg(roster))
        assert note is None

    def test_vertical_spacer_provides_paint_source(self):
        roster = [p("A", {"vertical_spacer": "Capable"})]
        note = check_paint_source(roster, agg(roster))
        assert note is None

    def test_trace_key_is_paint_touch_score(self):
        roster = []
        note = check_paint_source(roster, agg(roster))
        assert note.trace_key == "paint_touch_score"


# ---------------------------------------------------------------------------
# Strength rules
# ---------------------------------------------------------------------------

class TestCheckEliteSpacing:
    def test_elite_spacing_roster_returns_strength(self):
        # Many movement shooters + screens → high spacing score
        roster = [
            p("A", {"movement_shooter": "Elite", "screen_setter": "Elite"}),
            p("B", {"movement_shooter": "Elite"}),
            p("C", {"spot_up_shooter": "Elite"}),
        ]
        note = check_elite_spacing(roster, agg(roster))
        assert note is not None
        assert note.severity == "strength"

    def test_mediocre_spacing_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Capable"})]
        note = check_elite_spacing(roster, agg(roster))
        assert note is None

    def test_trace_key_is_spacing_score(self):
        roster = [
            p("A", {"movement_shooter": "Elite", "screen_setter": "Elite"}),
            p("B", {"movement_shooter": "Elite"}),
            p("C", {"spot_up_shooter": "Elite"}),
        ]
        note = check_elite_spacing(roster, agg(roster))
        assert note.trace_key == "spacing_score"


class TestCheckDefensiveDepth:
    def test_deep_defensive_roster_returns_strength(self):
        roster = [
            p("A", {"rim_protector": "Elite"}, height="7-0"),
            p("B", {"perimeter_disruptor": "Elite"}),
            p("C", {"perimeter_disruptor": "Elite"}),
            p("D", {"versatile_defender": "Elite"}),
        ]
        note = check_defensive_depth(roster, agg(roster))
        assert note is not None
        assert note.severity == "strength"

    def test_weak_defense_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_defensive_depth(roster, agg(roster))
        assert note is None


class TestCheckTwowayPremium:
    def test_two_twoway_players_returns_strength(self):
        roster = [
            p("A", {"spot_up_shooter": "Capable", "perimeter_disruptor": "Capable"}),
            p("B", {"driver": "Capable", "versatile_defender": "Capable"}),
        ]
        note = check_twoway_premium(roster, agg(roster))
        assert note is not None
        assert note.severity == "strength"
        assert "2" in note.text

    def test_one_twoway_player_returns_none(self):
        roster = [
            p("A", {"spot_up_shooter": "Capable", "perimeter_disruptor": "Capable"}),
            p("B", {"spot_up_shooter": "Elite"}),
        ]
        note = check_twoway_premium(roster, agg(roster))
        assert note is None

    def test_zero_twoway_players_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_twoway_premium(roster, agg(roster))
        assert note is None


class TestCheckPasserAbundance:
    def test_elite_passer_roster_returns_strength(self):
        roster = [
            p("A", {"passer": "Elite"}),
            p("B", {"passer": "Proficient"}),
            p("C", {"passer": "Capable"}),
        ]
        note = check_passer_abundance(roster, agg(roster))
        assert note is not None
        assert note.severity == "strength"

    def test_single_proficient_passer_returns_none(self):
        roster = [p("A", {"passer": "Proficient"})]
        note = check_passer_abundance(roster, agg(roster))
        assert note is None


class TestCheckPnrExcellence:
    def test_pnr_synergy_returns_strength(self):
        roster = [
            p("A", {"pnr_ball_handler": "Elite"}),
            p("B", {"pnr_finisher": "Proficient"}),
        ]
        note = check_pnr_excellence(roster, agg(roster))
        assert note is not None
        assert note.severity == "strength"

    def test_no_pnr_synergy_returns_none(self):
        roster = [p("A", {"spot_up_shooter": "Elite"})]
        note = check_pnr_excellence(roster, agg(roster))
        assert note is None

    def test_trace_key_is_pnr_synergy(self):
        roster = [
            p("A", {"pnr_ball_handler": "Elite"}),
            p("B", {"pnr_finisher": "Elite"}),
        ]
        note = check_pnr_excellence(roster, agg(roster))
        assert note.trace_key == "pnr_synergy"


# ---------------------------------------------------------------------------
# Rule list completeness
# ---------------------------------------------------------------------------

class TestRuleLists:
    def test_all_rules_list_is_nonempty(self):
        assert len(ALL_RULES) >= 10

    def test_strength_rules_list_is_nonempty(self):
        assert len(STRENGTH_RULES) >= 4

    def test_all_rules_are_callable(self):
        for rule in ALL_RULES:
            assert callable(rule)

    def test_strength_rules_are_callable(self):
        for rule in STRENGTH_RULES:
            assert callable(rule)

    def test_all_rules_return_note_or_none(self):
        from services.roster_evaluator.types import Note
        roster = [
            p("LeBron", {
                "driver": "Elite",
                "passer": "Elite",
                "spot_up_shooter": "Proficient",
                "versatile_defender": "Elite",
                "rim_protector": "Capable",
                "rebounder": "Elite",
                "transition_threat": "Elite",
            }, height="6-9"),
        ]
        a = agg(roster)
        for rule in ALL_RULES:
            result = rule(roster, a)
            assert result is None or isinstance(result, Note), (
                f"{rule.__name__} returned {type(result)}"
            )

    def test_strength_rules_return_note_or_none(self):
        from services.roster_evaluator.types import Note
        roster = [
            p("Steph", {
                "movement_shooter": "All-Time Great",
                "spot_up_shooter": "All-Time Great",
                "passer": "Elite",
                "off_dribble_shooter": "Elite",
            }),
            p("Draymond", {
                "screen_setter": "Elite",
                "passer": "Elite",
                "versatile_defender": "Elite",
            }),
        ]
        a = agg(roster)
        for rule in STRENGTH_RULES:
            result = rule(roster, a)
            assert result is None or isinstance(result, Note), (
                f"{rule.__name__} returned {type(result)}"
            )
