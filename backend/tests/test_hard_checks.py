"""
tests/test_hard_checks.py — Unit tests for the 5 Layer 4 hard floor check functions.

Each hard check has:
  - one test that verifies the check FIRES (returns a Note)
  - one test that verifies the check does NOT fire (returns None)
"""

import pytest
from services.roster_evaluator.hard_checks import (
    check_HARD_01,
    check_HARD_02,
    check_HARD_03,
    check_HARD_04,
    check_HARD_05,
)
from services.roster_evaluator.types import Note


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_player(name="P", slot=1, skills=None, is_cornerstone=False):
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": is_cornerstone,
        "height": None,
        "skills": skills or {},
    }


def make_cornerstone(skills=None):
    return make_player(name="CS", slot=0, is_cornerstone=True, skills=skills or {})


def make_agg(**kwargs):
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
# HARD-01: No paint touch anywhere in full rotation (including cornerstone)
# ---------------------------------------------------------------------------

class TestHARD01:
    def test_fires_when_no_paint_touch_skills(self):
        """No driving, vertical spacer, low post, or mid post anywhere → critical note."""
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"perimeter_disruptor": "Capable"}),
        ]
        cs = make_cornerstone(skills={"passer": "Elite"})
        result = check_HARD_01(players, make_agg(), cs)
        assert result is not None
        assert isinstance(result, Note)
        assert result.severity == "critical"
        assert result.presence_type == "absence"

    def test_does_not_fire_when_driver_present(self):
        players = [make_player("P1", 1, {"driver": "Capable"})]
        cs = make_cornerstone(skills={})
        result = check_HARD_01(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_when_cornerstone_has_low_post(self):
        """Cornerstone with low_post_player prevents HARD-01 from firing."""
        players = [make_player("P1", 1, {"spot_up_shooter": "Capable"})]
        cs = make_cornerstone(skills={"low_post_player": "Capable"})
        result = check_HARD_01(players, make_agg(), cs)
        assert result is None


# ---------------------------------------------------------------------------
# HARD-02: No creation in supporting cast only
# ---------------------------------------------------------------------------

class TestHARD02:
    def test_fires_when_no_creation_in_supporting_cast(self):
        """No PnR ball handler, driver, iso, low post, or mid post in supporting cast."""
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"versatile_defender": "Capable"}),
        ]
        # Even if cornerstone has creation, HARD-02 checks supporting cast only
        cs = make_cornerstone(skills={"pnr_ball_handler": "Elite"})
        result = check_HARD_02(players, make_agg(), cs)
        assert result is not None
        assert isinstance(result, Note)
        assert result.severity == "critical"

    def test_does_not_fire_when_supporting_has_driver(self):
        players = [make_player("P1", 1, {"driver": "Capable"})]
        cs = make_cornerstone(skills={})
        result = check_HARD_02(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_when_supporting_has_pnr_handler(self):
        players = [make_player("P1", 1, {"pnr_ball_handler": "Capable"})]
        cs = make_cornerstone(skills={})
        result = check_HARD_02(players, make_agg(), cs)
        assert result is None


# ---------------------------------------------------------------------------
# HARD-03: Fewer than 2 shooters in supporting cast
# ---------------------------------------------------------------------------

class TestHARD03:
    def test_fires_when_fewer_than_two_shooters(self):
        """Only one shooter (or zero) in supporting cast → critical note."""
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"versatile_defender": "Capable"}),
        ]
        cs = make_cornerstone(skills={})
        result = check_HARD_03(players, make_agg(), cs)
        assert result is not None
        assert isinstance(result, Note)
        assert result.severity == "critical"

    def test_does_not_fire_with_two_or_more_shooters(self):
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"movement_shooter": "Capable"}),
        ]
        cs = make_cornerstone(skills={})
        result = check_HARD_03(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_with_two_spot_up_shooters(self):
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"spot_up_shooter": "Capable"}),
        ]
        cs = make_cornerstone(skills={})
        result = check_HARD_03(players, make_agg(), cs)
        assert result is None


# ---------------------------------------------------------------------------
# HARD-04: Every player has None in all defensive skills
# ---------------------------------------------------------------------------

class TestHARD04:
    def test_fires_when_no_defensive_skills(self):
        """All players have zero defensive skills → critical note."""
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Elite"}),
            make_player("P2", 2, {"pnr_ball_handler": "Elite"}),
        ]
        cs = make_cornerstone(skills={"passer": "Elite"})
        result = check_HARD_04(players, make_agg(), cs)
        assert result is not None
        assert isinstance(result, Note)
        assert result.severity == "critical"

    def test_does_not_fire_when_one_defender_present(self):
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Elite"}),
            make_player("P2", 2, {"versatile_defender": "Capable"}),
        ]
        cs = make_cornerstone(skills={})
        result = check_HARD_04(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_when_cornerstone_is_defender(self):
        """Cornerstone counts for HARD-04's full rotation check."""
        players = [make_player("P1", 1, {"spot_up_shooter": "Elite"})]
        cs = make_cornerstone(skills={"rim_protector": "Capable"})
        result = check_HARD_04(players, make_agg(), cs)
        assert result is None


# ---------------------------------------------------------------------------
# HARD-05: No Elite rebounder AND fewer than 2 Capable+ rebounders
# ---------------------------------------------------------------------------

class TestHARD05:
    def test_fires_when_rebounding_deficit(self):
        """No Elite+ rebounder and fewer than 2 Capable+ rebounders → cap note."""
        players = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
        ]
        cs = make_cornerstone(skills={"passer": "Elite"})
        result = check_HARD_05(players, make_agg(), cs)
        assert result is not None
        assert isinstance(result, Note)
        assert result.severity == "critical"

    def test_does_not_fire_with_elite_rebounder(self):
        players = [make_player("P1", 1, {"rebounder": "Elite"})]
        cs = make_cornerstone(skills={})
        result = check_HARD_05(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_with_two_capable_rebounders(self):
        players = [
            make_player("P1", 1, {"rebounder": "Capable"}),
            make_player("P2", 2, {"rebounder": "Capable"}),
        ]
        cs = make_cornerstone(skills={})
        result = check_HARD_05(players, make_agg(), cs)
        assert result is None

    def test_does_not_fire_with_atg_rebounder(self):
        players = [make_player("P1", 1, {"rebounder": "All-Time Great"})]
        cs = make_cornerstone(skills={})
        result = check_HARD_05(players, make_agg(), cs)
        assert result is None
