"""
tests/test_optionality.py — Unit tests for optionality and robustness scoring.

Tests verify:
  - Non-trivial roster (3+ supporting players with variety) → both scores > 0
  - Empty supporting rotation → scores default gracefully (no crash), return 0.0
  - Over-stacked roster is penalized in redundancy component vs. balanced roster
"""

import pytest
from services.roster_evaluator.optionality import compute_optionality, compute_robustness
from services.roster_evaluator.weights import SLOT_WEIGHTS


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


# ---------------------------------------------------------------------------
# compute_optionality
# ---------------------------------------------------------------------------

class TestComputeOptionality:
    def test_non_trivial_roster_produces_nonzero_optionality(self):
        """A diverse 4-player rotation should produce a non-zero optionality score."""
        supporting = [
            make_player("P1", 1, {"spot_up_shooter": "Elite", "versatile_defender": "Capable"}),
            make_player("P2", 2, {"pnr_ball_handler": "Proficient", "transition_threat": "Capable"}),
            make_player("P3", 3, {"rim_protector": "Proficient", "rebounder": "Capable"}),
            make_player("P4", 4, {"movement_shooter": "Capable", "cutter": "Capable"}),
        ]
        cs = make_cornerstone(skills={"passer": "Elite", "driver": "Proficient"})
        score = compute_optionality(supporting, cs, SLOT_WEIGHTS)
        assert score > 0, f"Expected non-zero optionality, got {score}"
        assert 0 <= score <= 100

    def test_empty_rotation_returns_zero_gracefully(self):
        """Empty supporting rotation should return 0.0 without crashing."""
        score = compute_optionality([], make_cornerstone(), SLOT_WEIGHTS)
        assert score == 0.0

    def test_score_clamped_to_zero_to_100(self):
        """Score must always be in [0, 100] range."""
        supporting = [
            make_player(f"P{i}", i, {
                "spot_up_shooter": "All-Time Great",
                "versatile_defender": "All-Time Great",
                "passer": "All-Time Great",
            }) for i in range(1, 5)
        ]
        cs = make_cornerstone(skills={})
        score = compute_optionality(supporting, cs, SLOT_WEIGHTS)
        assert 0 <= score <= 100


# ---------------------------------------------------------------------------
# compute_robustness
# ---------------------------------------------------------------------------

class TestComputeRobustness:
    def test_non_trivial_roster_produces_nonzero_robustness(self):
        """A balanced rotation with depth should produce a non-zero robustness score."""
        supporting = [
            make_player("P1", 1, {"spot_up_shooter": "Elite"}),
            make_player("P2", 2, {"spot_up_shooter": "Proficient", "versatile_defender": "Capable"}),
            make_player("P3", 3, {"versatile_defender": "Capable", "rebounder": "Capable"}),
            make_player("P4", 4, {"rim_protector": "Capable", "rebounder": "Capable"}),
        ]
        score = compute_robustness(supporting, SLOT_WEIGHTS)
        assert score > 0, f"Expected non-zero robustness, got {score}"
        assert 0 <= score <= 100

    def test_empty_rotation_returns_zero_gracefully(self):
        """Empty rotation should return 0.0 without crashing."""
        score = compute_robustness([], SLOT_WEIGHTS)
        assert score == 0.0

    def test_concentrated_roster_scores_lower_than_distributed(self):
        """
        A roster where one high-slot player provides all coverage of a critical skill
        should score lower in robustness than a roster that distributes that coverage.
        """
        # Concentrated: only slot 1 (top weight) has the skill
        concentrated = [
            make_player("P1", 1, {"spot_up_shooter": "Elite"}),
            make_player("P2", 2, {}),
            make_player("P3", 3, {}),
            make_player("P4", 4, {}),
        ]
        # Distributed: skill spread across multiple slots
        distributed = [
            make_player("P1", 1, {"spot_up_shooter": "Capable"}),
            make_player("P2", 2, {"spot_up_shooter": "Capable"}),
            make_player("P3", 3, {"spot_up_shooter": "Capable"}),
            make_player("P4", 4, {"spot_up_shooter": "Capable"}),
        ]
        score_concentrated = compute_robustness(concentrated, SLOT_WEIGHTS)
        score_distributed = compute_robustness(distributed, SLOT_WEIGHTS)
        assert score_distributed >= score_concentrated, (
            f"Distributed ({score_distributed}) should be >= concentrated ({score_concentrated})"
        )

    def test_score_clamped_to_zero_to_100(self):
        supporting = [
            make_player(f"P{i}", i, {"versatile_defender": "All-Time Great", "rebounder": "All-Time Great"})
            for i in range(1, 6)
        ]
        score = compute_robustness(supporting, SLOT_WEIGHTS)
        assert 0 <= score <= 100
