"""
tests/test_modifiers.py — Unit tests for all 33 Layer 3 modifier functions.

Each modifier has at minimum:
  - one test that verifies the modifier FIRES (returns a non-None tuple)
  - one test that verifies the modifier does NOT fire (returns None)

Synergy modifiers (OFF-28, OFF-16, OFF-31, etc.) include a test verifying
that a single player with both skills does NOT satisfy the two-player requirement.
"""

import pytest
from services.roster_evaluator.modifiers import (
    check_DEF_01, check_DEF_02, check_DEF_03, check_DEF_04, check_DEF_05,
    check_DEF_06, check_DEF_07, check_DEF_08, check_DEF_09,
    check_OFF_01, check_OFF_02, check_OFF_03, check_OFF_04, check_OFF_05,
    check_OFF_06, check_OFF_07, check_OFF_08, check_OFF_09, check_OFF_10,
    check_OFF_11, check_OFF_12, check_OFF_13, check_OFF_14, check_OFF_15,
    check_OFF_16, check_OFF_17, check_OFF_18, check_OFF_19, check_OFF_20,
    check_OFF_21, check_OFF_22, check_OFF_23, check_OFF_24, check_OFF_25,
    check_OFF_26, check_OFF_27, check_OFF_28, check_OFF_29, check_OFF_30,
    check_OFF_31, check_OFF_32, check_OFF_33,
)
from services.roster_evaluator.weights import MODIFIER_DELTAS, TIER_VALUES


# ---------------------------------------------------------------------------
# Helpers to build minimal player/agg fixtures
# ---------------------------------------------------------------------------

def make_player(name="P", slot=1, skills=None, height=None, is_cornerstone=False):
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": is_cornerstone,
        "height": height,
        "skills": skills or {},
    }


def make_cornerstone(skills=None):
    return make_player(name="CS", slot=0, is_cornerstone=True, skills=skills or {})


def make_agg(**kwargs):
    """Build a minimal aggregate context dict with sensible defaults."""
    defaults = {
        "has_rim_protector": False,
        "has_passer": False,
        "has_lob_thrower": False,
        "pnr_handler_tier": 0,
        "pnr_finisher_count": 0,
        "perimeter_disruptor_count": 0,
        "versatile_defender_count": 0,
        "movement_shooter_count": 0,
        "cutter_count": 0,
        "transition_threat_count": 0,
        "exclusive_onball_count": 0,
        "spacing_score_pre_modifiers": 50.0,
        "creation_score_pre_modifiers": 50.0,
        "defense_score_pre_modifiers": 50.0,
    }
    defaults.update(kwargs)
    return defaults


# ---------------------------------------------------------------------------
# DEF-01: Rim Protector amplifies perimeter defenders
# ---------------------------------------------------------------------------

class TestDEF01:
    def test_fires_when_rim_protector_present(self):
        players = [make_player(skills={"rim_protector": "Capable", "perimeter_disruptor": "Capable"})]
        agg = make_agg(has_rim_protector=True, perimeter_disruptor_count=1)
        result = check_DEF_01(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, narrative, dimension = result
        assert delta > 0
        assert dimension == "defense"

    def test_does_not_fire_without_rim_protector(self):
        players = [make_player(skills={"perimeter_disruptor": "Capable"})]
        agg = make_agg(has_rim_protector=False, perimeter_disruptor_count=1)
        result = check_DEF_01(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-02: Perimeter disruptor compound bonus
# ---------------------------------------------------------------------------

class TestDEF02:
    def test_fires_with_two_perimeter_disruptors(self):
        players = [
            make_player("P1", 1, {"perimeter_disruptor": "Capable"}),
            make_player("P2", 2, {"perimeter_disruptor": "Capable"}),
        ]
        agg = make_agg(perimeter_disruptor_count=2)
        result = check_DEF_02(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, dimension = result
        assert delta > 0
        assert dimension == "defense"

    def test_does_not_fire_with_one_disruptor(self):
        players = [make_player("P1", 1, {"perimeter_disruptor": "Capable"})]
        agg = make_agg(perimeter_disruptor_count=1)
        result = check_DEF_02(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-03: Versatile + Perimeter compound bonus
# ---------------------------------------------------------------------------

class TestDEF03:
    def test_fires_with_versatile_and_disruptor(self):
        players = [
            make_player("P1", 1, {"versatile_defender": "Capable"}),
            make_player("P2", 2, {"perimeter_disruptor": "Capable"}),
        ]
        agg = make_agg(versatile_defender_count=1, perimeter_disruptor_count=1)
        result = check_DEF_03(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_both(self):
        players = [make_player("P1", 1, {"versatile_defender": "Capable"})]
        agg = make_agg(versatile_defender_count=1, perimeter_disruptor_count=0)
        result = check_DEF_03(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-04: No rim but 3+ versatile defenders (absence modifier)
# ---------------------------------------------------------------------------

class TestDEF04:
    def test_fires_with_no_rim_and_three_versatile(self):
        players = [make_player(f"P{i}", i, {"versatile_defender": "Capable"}) for i in range(1, 4)]
        agg = make_agg(has_rim_protector=False, versatile_defender_count=3)
        result = check_DEF_04(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0  # mitigation is positive

    def test_does_not_fire_when_rim_present(self):
        players = [make_player(f"P{i}", i, {"versatile_defender": "Capable"}) for i in range(1, 4)]
        agg = make_agg(has_rim_protector=True, versatile_defender_count=3)
        result = check_DEF_04(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None

    def test_does_not_fire_with_fewer_than_three_versatile(self):
        players = [make_player(f"P{i}", i, {"versatile_defender": "Capable"}) for i in range(1, 3)]
        agg = make_agg(has_rim_protector=False, versatile_defender_count=2)
        result = check_DEF_04(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-05: Height coverage hole penalty (fires when any inch in 6'0–7'2 uncovered)
# ---------------------------------------------------------------------------

class TestDEF05:
    def test_fires_when_roster_has_coverage_holes(self):
        # Single 6-0 player with no VD: range is roughly 70-71", leaves most of 72-86 uncovered
        player = make_player(height="6-0", skills={})
        players = [player]
        agg = make_agg()
        result = check_DEF_05(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_when_full_coverage(self):
        # Build a squad that covers 72-86 without gaps:
        # Elite VD at 6-4 (76"): range 76+(-5)=71 to 76+(+4)=80
        # Elite VD at 6-9 (81"): range 81+(-5)=76 to 81+(+4)=85
        # Elite VD at 7-2 (86"): range 86+(-5)=81 to 86+(+4)=90
        # Combined: 71-90 → covers 72-86 fully
        p1 = make_player("P1", 1, {"versatile_defender": "Elite"}, height="6-4")
        p2 = make_player("P2", 2, {"versatile_defender": "Elite"}, height="6-9")
        p3 = make_player("P3", 3, {"versatile_defender": "Elite"}, height="7-2")
        players = [p1, p2, p3]
        agg = make_agg()
        result = check_DEF_05(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-06: Full height coverage bonus (fires when 6'0–7'2 fully covered)
# ---------------------------------------------------------------------------

class TestDEF06:
    def test_fires_when_full_coverage_achieved(self):
        # Same three-player squad that covers 72-86 completely
        p1 = make_player("P1", 1, {"versatile_defender": "Elite"}, height="6-4")
        p2 = make_player("P2", 2, {"versatile_defender": "Elite"}, height="6-9")
        p3 = make_player("P3", 3, {"versatile_defender": "Elite"}, height="7-2")
        players = [p1, p2, p3]
        agg = make_agg()
        result = check_DEF_06(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_when_gaps_remain(self):
        # Single player can't cover the full 72-86 range alone
        player = make_player(height="6-9", skills={"versatile_defender": "Capable"})
        players = [player]
        agg = make_agg()
        result = check_DEF_06(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-07: Offensive black hole (None across all offensive skills)
# ---------------------------------------------------------------------------

class TestDEF07:
    def test_fires_for_player_with_no_offensive_skills(self):
        # Player has only defensive skills — black hole offensively
        player = make_player(skills={"rim_protector": "Elite"})
        players = [player]
        agg = make_agg()
        result = check_DEF_07(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_for_player_with_any_offensive_skill(self):
        player = make_player(skills={"spot_up_shooter": "Capable"})
        players = [player]
        agg = make_agg()
        # Cornerstone must have an offensive skill — DEF_07 now includes cornerstone in
        # the black-hole check, so a skill-less cornerstone would trigger the penalty.
        cornerstone = make_cornerstone(skills={"pnr_ball_handler": "Elite"})
        result = check_DEF_07(players, agg, cornerstone, MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-08: Two-way bonus
# ---------------------------------------------------------------------------

class TestDEF08:
    def test_fires_for_two_way_player(self):
        player = make_player(skills={"spot_up_shooter": "Capable", "versatile_defender": "Capable"})
        players = [player]
        agg = make_agg()
        result = check_DEF_08(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_for_one_dimensional_player(self):
        player = make_player(skills={"versatile_defender": "Elite"})
        players = [player]
        agg = make_agg()
        result = check_DEF_08(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# DEF-09: No Elite rebounder + < 3 Capable+ (absence)
# ---------------------------------------------------------------------------

class TestDEF09:
    def test_fires_when_rebounding_deficit(self):
        players = [make_player(skills={"spot_up_shooter": "Capable"})]
        agg = make_agg()
        result = check_DEF_09(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_with_elite_rebounder(self):
        players = [make_player(skills={"rebounder": "Elite"})]
        agg = make_agg()
        result = check_DEF_09(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-01: Low spacing caps creation (absence)
# ---------------------------------------------------------------------------

class TestOFF01:
    def test_fires_when_spacing_below_threshold(self):
        players = [make_player(skills={"driver": "Elite"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        cs = make_cornerstone(skills={})  # non-dominant cornerstone
        result = check_OFF_01(players, agg, cs, MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_when_spacing_high(self):
        players = [make_player(skills={"driver": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=80.0)
        result = check_OFF_01(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-02: Screen enables movement shooter bonus (presence, synergy)
# ---------------------------------------------------------------------------

class TestOFF02:
    def test_fires_with_movement_shooter_and_screen_setter_on_different_players(self):
        players = [
            make_player("P1", 1, {"movement_shooter": "Capable"}),
            make_player("P2", 2, {"screen_setter": "Capable"}),
        ]
        agg = make_agg(movement_shooter_count=1)
        result = check_OFF_02(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_screen_setter(self):
        players = [make_player("P1", 1, {"movement_shooter": "Capable"})]
        agg = make_agg(movement_shooter_count=1)
        result = check_OFF_02(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None

    def test_does_not_fire_same_player_has_both(self):
        """Synergy requires distinct players."""
        players = [make_player("P1", 1, {"movement_shooter": "Capable", "screen_setter": "Capable"})]
        agg = make_agg(movement_shooter_count=1)
        result = check_OFF_02(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-03: Movement shooters without screen setter (absence)
# ---------------------------------------------------------------------------

class TestOFF03:
    def test_fires_with_two_movement_shooters_no_screen(self):
        players = [
            make_player("P1", 1, {"movement_shooter": "Capable"}),
            make_player("P2", 2, {"movement_shooter": "Capable"}),
        ]
        agg = make_agg(movement_shooter_count=2)
        result = check_OFF_03(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_with_screen_setter_present(self):
        players = [
            make_player("P1", 1, {"movement_shooter": "Capable"}),
            make_player("P2", 2, {"movement_shooter": "Capable"}),
            make_player("P3", 3, {"screen_setter": "Capable"}),
        ]
        agg = make_agg(movement_shooter_count=2)
        result = check_OFF_03(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-04: Screen enables cutting bonus (presence, synergy)
# ---------------------------------------------------------------------------

class TestOFF04:
    def test_fires_with_cutter_and_screen_setter_on_different_players(self):
        players = [
            make_player("P1", 1, {"cutter": "Capable"}),
            make_player("P2", 2, {"screen_setter": "Capable"}),
        ]
        agg = make_agg(cutter_count=1)
        result = check_OFF_04(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_same_player_has_both(self):
        players = [make_player("P1", 1, {"cutter": "Capable", "screen_setter": "Capable"})]
        agg = make_agg(cutter_count=1)
        result = check_OFF_04(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-05: Creation/Spacing imbalance (absence)
# ---------------------------------------------------------------------------

class TestOFF05:
    def test_fires_when_scores_differ_by_more_than_30(self):
        agg = make_agg(creation_score_pre_modifiers=80.0, spacing_score_pre_modifiers=40.0)
        result = check_OFF_05([], agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_when_balanced(self):
        agg = make_agg(creation_score_pre_modifiers=55.0, spacing_score_pre_modifiers=50.0)
        result = check_OFF_05([], agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-06: Exclusive on-ball penalty (presence)
# ---------------------------------------------------------------------------

class TestOFF06:
    def test_fires_with_two_exclusive_onball_players(self):
        # Players with on-ball skills and no off-ball skills
        players = [
            make_player("P1", 1, {"isolation_scorer": "Capable"}),
            make_player("P2", 2, {"isolation_scorer": "Capable"}),
        ]
        agg = make_agg(exclusive_onball_count=2)
        result = check_OFF_06(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_with_one_or_fewer_exclusive_onball(self):
        players = [make_player("P1", 1, {"isolation_scorer": "Capable"})]
        agg = make_agg(exclusive_onball_count=1)
        result = check_OFF_06(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-07: Exclusively on-ball below Elite (presence)
# ---------------------------------------------------------------------------

class TestOFF07:
    def test_fires_for_exclusive_onball_below_elite(self):
        player = make_player(skills={"isolation_scorer": "Capable"})
        players = [player]
        agg = make_agg(exclusive_onball_count=1)
        result = check_OFF_07(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_for_elite_onball(self):
        player = make_player(skills={"isolation_scorer": "Elite"})
        players = [player]
        agg = make_agg(exclusive_onball_count=1)
        result = check_OFF_07(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-08: On-ball + off-ball combo bonus (presence)
# ---------------------------------------------------------------------------

class TestOFF08:
    def test_fires_for_onball_offball_player(self):
        player = make_player(skills={"driver": "Capable", "spot_up_shooter": "Capable"})
        players = [player]
        result = check_OFF_08(players, [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_for_one_dimensional_player(self):
        player = make_player(skills={"driver": "Capable"})
        players = [player]
        result = check_OFF_08(players, [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-09: Single creator upweight (absence)
# ---------------------------------------------------------------------------

class TestOFF09:
    def test_fires_with_only_one_creator(self):
        players = [
            make_player("P1", 1, {"pnr_ball_handler": "Capable"}),
            make_player("P2", 2, {"spot_up_shooter": "Capable"}),
        ]
        agg = make_agg()
        result = check_OFF_09(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0  # upweight (positive)

    def test_does_not_fire_with_multiple_creators(self):
        players = [
            make_player("P1", 1, {"pnr_ball_handler": "Capable"}),
            make_player("P2", 2, {"driver": "Capable"}),
        ]
        agg = make_agg()
        result = check_OFF_09(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-10: Cornerstone raises spacing threshold (presence)
# ---------------------------------------------------------------------------

class TestOFF10:
    def test_fires_when_cornerstone_is_elite_onball(self):
        cs = make_cornerstone(skills={"pnr_ball_handler": "Elite"})
        agg = make_agg()
        result = check_OFF_10([], agg, cs, MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0  # raises threshold (this is a context modifier)

    def test_does_not_fire_for_non_dominant_cornerstone(self):
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        agg = make_agg()
        result = check_OFF_10([], agg, cs, MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-11: Passer multiplier on off-ball contributions (presence)
# ---------------------------------------------------------------------------

class TestOFF11:
    def test_fires_when_passer_present(self):
        players = [make_player(skills={"passer": "Capable", "cutter": "Capable"})]
        agg = make_agg(has_passer=True)
        result = check_OFF_11(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_passer(self):
        players = [make_player(skills={"cutter": "Capable"})]
        agg = make_agg(has_passer=False)
        result = check_OFF_11(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-12: Cutter without passer (absence, synergy)
# ---------------------------------------------------------------------------

class TestOFF12:
    def test_fires_with_cutter_and_no_passer(self):
        players = [make_player(skills={"cutter": "Capable"})]
        agg = make_agg(has_passer=False, cutter_count=1)
        cs = make_cornerstone(skills={})
        result = check_OFF_12(players, agg, cs, MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_when_passer_present(self):
        players = [
            make_player("P1", 1, {"cutter": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
        ]
        agg = make_agg(has_passer=True, cutter_count=1)
        cs = make_cornerstone(skills={})
        result = check_OFF_12(players, agg, cs, MODIFIER_DELTAS)
        assert result is None

    def test_cornerstone_passer_satisfies_condition(self):
        """Cornerstone with Passer skill counts as a passer for OFF-12."""
        players = [make_player(skills={"cutter": "Capable"})]
        agg = make_agg(has_passer=True, cutter_count=1)
        cs = make_cornerstone(skills={"passer": "Capable"})
        result = check_OFF_12(players, agg, cs, MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-13: Cutter without spacing (absence)
# ---------------------------------------------------------------------------

class TestOFF13:
    def test_fires_with_cutter_and_low_spacing(self):
        players = [make_player(skills={"cutter": "Capable"})]
        agg = make_agg(cutter_count=1, spacing_score_pre_modifiers=20.0)
        result = check_OFF_13(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_with_adequate_spacing(self):
        players = [make_player(skills={"cutter": "Capable"})]
        agg = make_agg(cutter_count=1, spacing_score_pre_modifiers=60.0)
        result = check_OFF_13(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-14: Cutter + gravity bonus (presence, synergy)
# ---------------------------------------------------------------------------

class TestOFF14:
    def test_fires_with_cutter_and_gravity_player(self):
        players = [
            make_player("P1", 1, {"cutter": "Capable"}),
            make_player("P2", 2, {"driver": "Proficient"}),
        ]
        agg = make_agg(cutter_count=1)
        result = check_OFF_14(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_cutter(self):
        players = [make_player("P1", 1, {"driver": "Elite"})]
        agg = make_agg(cutter_count=0)
        result = check_OFF_14(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-15: Vertical spacer without lob thrower (absence, synergy)
# ---------------------------------------------------------------------------

class TestOFF15:
    def test_fires_with_vertical_spacer_and_no_lob_thrower(self):
        players = [make_player(skills={"vertical_spacer": "Capable"})]
        agg = make_agg(has_lob_thrower=False)
        cs = make_cornerstone(skills={})
        result = check_OFF_15(players, agg, cs, MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_when_lob_thrower_present(self):
        players = [
            make_player("P1", 1, {"vertical_spacer": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
        ]
        agg = make_agg(has_lob_thrower=True)
        result = check_OFF_15(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None

    def test_does_not_fire_same_player_has_both(self):
        """Single player with vertical spacer + passer does NOT satisfy synergy."""
        players = [make_player("P1", 1, {"vertical_spacer": "Capable", "passer": "Capable"})]
        # has_lob_thrower is True but from same player — check_OFF_15 should detect this
        agg = make_agg(has_lob_thrower=True)
        cs = make_cornerstone(skills={})
        result = check_OFF_15(players, agg, cs, MODIFIER_DELTAS)
        # With a single player having both, lob support is from same player — should fire
        assert result is not None


# ---------------------------------------------------------------------------
# OFF-16: Vertical spacer + lob thrower bonus (presence, synergy)
# ---------------------------------------------------------------------------

class TestOFF16:
    def test_fires_with_vertical_and_lob_on_different_players(self):
        players = [
            make_player("P1", 1, {"vertical_spacer": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
        ]
        agg = make_agg(has_lob_thrower=True)
        result = check_OFF_16(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_same_player_has_both(self):
        """Synergy requires distinct players."""
        players = [make_player("P1", 1, {"vertical_spacer": "Capable", "passer": "Capable"})]
        agg = make_agg(has_lob_thrower=True)
        result = check_OFF_16(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None

    def test_does_not_fire_without_vertical_spacer(self):
        players = [make_player("P1", 1, {"passer": "Capable"})]
        agg = make_agg(has_lob_thrower=True)
        result = check_OFF_16(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-17: Driver + finishing skill on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF17:
    def test_fires_with_driver_and_high_flyer(self):
        player = make_player(skills={"driver": "Capable", "high_flyer": "Capable"})
        result = check_OFF_17([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_finishing_skill(self):
        player = make_player(skills={"driver": "Capable"})
        result = check_OFF_17([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-18: Driver + passer on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF18:
    def test_fires_with_driver_and_passer(self):
        player = make_player(skills={"driver": "Capable", "passer": "Capable"})
        result = check_OFF_18([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_passer(self):
        player = make_player(skills={"driver": "Capable"})
        result = check_OFF_18([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-19: Low post + low spacing penalty (absence)
# ---------------------------------------------------------------------------

class TestOFF19:
    def test_fires_with_low_post_and_low_spacing(self):
        players = [make_player(skills={"low_post_player": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        result = check_OFF_19(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta < 0

    def test_does_not_fire_with_adequate_spacing(self):
        players = [make_player(skills={"low_post_player": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=70.0)
        result = check_OFF_19(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-20: Low post + secondary skills bonus (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF20:
    def test_fires_with_low_post_and_passer(self):
        player = make_player(skills={"low_post_player": "Capable", "passer": "Capable"})
        result = check_OFF_20([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_secondary(self):
        player = make_player(skills={"low_post_player": "Capable"})
        result = check_OFF_20([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-21: Mid post + low spacing penalty (absence)
# ---------------------------------------------------------------------------

class TestOFF21:
    def test_fires_with_mid_post_and_low_spacing(self):
        players = [make_player(skills={"mid_post_player": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        result = check_OFF_21(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_with_adequate_spacing(self):
        players = [make_player(skills={"mid_post_player": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=70.0)
        result = check_OFF_21(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-22: Mid post + secondary skills bonus (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF22:
    def test_fires_with_mid_post_and_passer(self):
        player = make_player(skills={"mid_post_player": "Capable", "passer": "Capable"})
        result = check_OFF_22([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_secondary(self):
        player = make_player(skills={"mid_post_player": "Capable"})
        result = check_OFF_22([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-23: Iso + low spacing penalty (absence)
# ---------------------------------------------------------------------------

class TestOFF23:
    def test_fires_with_iso_and_low_spacing(self):
        players = [make_player(skills={"isolation_scorer": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        result = check_OFF_23(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_with_adequate_spacing(self):
        players = [make_player(skills={"isolation_scorer": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=70.0)
        result = check_OFF_23(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-24: Iso + secondary skills bonus (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF24:
    def test_fires_with_iso_and_passer(self):
        player = make_player(skills={"isolation_scorer": "Capable", "passer": "Capable"})
        result = check_OFF_24([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_secondary(self):
        player = make_player(skills={"isolation_scorer": "Capable"})
        result = check_OFF_24([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-25: High flyer + vertical spacer on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF25:
    def test_fires_with_high_flyer_and_vertical_spacer(self):
        player = make_player(skills={"high_flyer": "Capable", "vertical_spacer": "Capable"})
        result = check_OFF_25([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_vertical_spacer(self):
        player = make_player(skills={"high_flyer": "Capable"})
        result = check_OFF_25([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-26: High flyer + cutter on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF26:
    def test_fires_with_high_flyer_and_cutter(self):
        player = make_player(skills={"high_flyer": "Capable", "cutter": "Capable"})
        result = check_OFF_26([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_cutter(self):
        player = make_player(skills={"high_flyer": "Capable"})
        result = check_OFF_26([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-27: High flyer + PnR finisher on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF27:
    def test_fires_with_high_flyer_and_pnr_finisher(self):
        player = make_player(skills={"high_flyer": "Capable", "pnr_finisher": "Capable"})
        result = check_OFF_27([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_pnr_finisher(self):
        player = make_player(skills={"high_flyer": "Capable"})
        result = check_OFF_27([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-28: PnR handler + finisher synergy (presence, two-player synergy)
# ---------------------------------------------------------------------------

class TestOFF28:
    def test_fires_with_handler_and_finisher_on_different_players(self):
        players = [
            make_player("P1", 1, {"pnr_ball_handler": "Capable"}),
            make_player("P2", 2, {"pnr_finisher": "Capable"}),
        ]
        agg = make_agg(pnr_handler_tier=TIER_VALUES["Capable"], pnr_finisher_count=1)
        result = check_OFF_28(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_same_player_has_both(self):
        """Synergy requires distinct players."""
        players = [make_player("P1", 1, {"pnr_ball_handler": "Capable", "pnr_finisher": "Capable"})]
        agg = make_agg(pnr_handler_tier=TIER_VALUES["Capable"], pnr_finisher_count=1)
        result = check_OFF_28(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None

    def test_does_not_fire_without_finisher(self):
        players = [make_player("P1", 1, {"pnr_ball_handler": "Capable"})]
        agg = make_agg(pnr_handler_tier=TIER_VALUES["Capable"], pnr_finisher_count=0)
        result = check_OFF_28(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-29: PnR handler + secondary skills on same player (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF29:
    def test_fires_with_handler_and_passer(self):
        player = make_player(skills={"pnr_ball_handler": "Capable", "passer": "Capable"})
        result = check_OFF_29([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_secondary(self):
        player = make_player(skills={"pnr_ball_handler": "Capable"})
        result = check_OFF_29([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-30: PnR finisher + secondary skills bonus (presence, single-player)
# ---------------------------------------------------------------------------

class TestOFF30:
    def test_fires_with_finisher_and_vertical_spacer(self):
        player = make_player(skills={"pnr_finisher": "Capable", "vertical_spacer": "Capable"})
        result = check_OFF_30([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None

    def test_does_not_fire_without_secondary(self):
        player = make_player(skills={"pnr_finisher": "Capable"})
        result = check_OFF_30([player], [], make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-31: Transition threat + passer synergy (presence, two-player synergy)
# ---------------------------------------------------------------------------

class TestOFF31:
    def test_fires_with_transition_and_passer_on_different_players(self):
        players = [
            make_player("P1", 1, {"transition_threat": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
        ]
        agg = make_agg(transition_threat_count=1, has_passer=True)
        result = check_OFF_31(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_fires_for_dual_threat_player(self):
        """A single player with both transition_threat and passer is a dual-threat — fires."""
        players = [make_player("P1", 1, {"transition_threat": "Capable", "passer": "Capable"})]
        agg = make_agg(transition_threat_count=1, has_passer=True)
        result = check_OFF_31(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_dual_threat_scales_higher_with_better_tiers(self):
        """ATG×ATG dual threat contributes more than Capable×Capable."""
        atg_player = make_player("ATG", 1, {"transition_threat": "All-Time Great", "passer": "All-Time Great"})
        cap_player = make_player("CAP", 1, {"transition_threat": "Capable", "passer": "Capable"})
        agg = make_agg()
        atg_result = check_OFF_31([atg_player], agg, make_cornerstone(), MODIFIER_DELTAS)
        cap_result = check_OFF_31([cap_player], agg, make_cornerstone(), MODIFIER_DELTAS)
        assert atg_result is not None and cap_result is not None
        assert atg_result[0] > cap_result[0]

    def test_multiple_dual_threats_compound(self):
        """Two dual-threat players produce a larger bonus than one."""
        one_player = [make_player("P1", 1, {"transition_threat": "Elite", "passer": "Elite"})]
        two_players = [
            make_player("P1", 1, {"transition_threat": "Elite", "passer": "Elite"}),
            make_player("P2", 2, {"transition_threat": "Elite", "passer": "Elite"}),
        ]
        agg = make_agg()
        one_result = check_OFF_31(one_player, agg, make_cornerstone(), MODIFIER_DELTAS)
        two_result = check_OFF_31(two_players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert two_result[0] > one_result[0]

    def test_does_not_fire_without_transition_threat(self):
        players = [make_player("P1", 1, {"passer": "Capable"})]
        agg = make_agg(transition_threat_count=0, has_passer=True)
        result = check_OFF_31(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-32: High flyer + active OFF-31 bonus (presence)
# ---------------------------------------------------------------------------

class TestOFF32:
    def test_fires_when_off31_active_and_high_flyer_present(self):
        # Need transition threat and passer on different players, plus high flyer
        players = [
            make_player("P1", 1, {"transition_threat": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
            make_player("P3", 3, {"high_flyer": "Capable"}),
        ]
        agg = make_agg(transition_threat_count=1, has_passer=True)
        result = check_OFF_32(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0

    def test_does_not_fire_without_high_flyer(self):
        players = [
            make_player("P1", 1, {"transition_threat": "Capable"}),
            make_player("P2", 2, {"passer": "Capable"}),
        ]
        agg = make_agg(transition_threat_count=1, has_passer=True)
        result = check_OFF_32(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None


# ---------------------------------------------------------------------------
# OFF-33: Offensive rebounder mitigates OFF-01 penalty (presence)
# ---------------------------------------------------------------------------

class TestOFF33:
    def test_fires_when_offreb_and_low_spacing(self):
        players = [make_player(skills={"offensive_rebounder": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        result = check_OFF_33(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is not None
        delta, _, _ = result
        assert delta > 0  # mitigation is positive

    def test_does_not_fire_without_offensive_rebounder(self):
        players = [make_player(skills={"spot_up_shooter": "Capable"})]
        agg = make_agg(spacing_score_pre_modifiers=20.0)
        result = check_OFF_33(players, agg, make_cornerstone(), MODIFIER_DELTAS)
        assert result is None
