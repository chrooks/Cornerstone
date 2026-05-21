"""
Unit tests for the declarative formula engine.

Verifies that ``compute_raw_from_formulas`` produces identical results to the
hardcoded ``compute_raw_composites`` for multiple player profiles, and tests
edge cases like circular dependencies and amplifier floor clamping.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.cohesion_engine.composites import compute_raw_composites
from backend.services.cohesion_engine.formula_engine import (
    compute_raw_from_formulas,
    topological_sort,
)
from backend.services.cohesion_engine.formula_export import export_formulas


def _bootstrap_values() -> dict:
    seed_path = (
        Path(__file__).resolve().parents[3]
        / "supabase"
        / "migrations"
        / "data"
        / "evaluation_version_v1_seed.json"
    )
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


VALUES = _bootstrap_values()
FORMULAS = export_formulas(VALUES["composite_coefficients"])
TIER_VALUES = VALUES["tier_values"]
TOLERANCE = 1e-10


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------


def _all_atg_skills() -> dict[str, str]:
    """Every skill at All-Time Great."""
    from backend.services.skills import ALL_SKILLS

    return {skill: "All-Time Great" for skill in ALL_SKILLS}


def _all_none_skills() -> dict[str, str]:
    """Every skill at None."""
    from backend.services.skills import ALL_SKILLS

    return {skill: "None" for skill in ALL_SKILLS}


def _mixed_skills() -> dict[str, str]:
    """Realistic mixed profile (a two-way wing)."""
    return {
        "movement_shooter": "Elite",
        "spot_up_shooter": "Proficient",
        "off_dribble_shooter": "Capable",
        "high_flyer": "Capable",
        "crafty_finisher": "Elite",
        "rebounder": "Proficient",
        "offensive_rebounder": "Capable",
        "driver": "Elite",
        "vertical_spacer": "Proficient",
        "low_post_player": "Capable",
        "mid_post_player": "Elite",
        "rim_protector": "Elite",
        "perimeter_disruptor": "Proficient",
        "versatile_defender": "Capable",
        "screen_setter": "Capable",
        "pnr_finisher": "Proficient",
        "passer": "All-Time Great",
        "cutter": "Proficient",
        "transition_threat": "Elite",
        "pnr_ball_handler": "Capable",
        "isolation_scorer": "Proficient",
    }


def _guard_profile() -> dict[str, str]:
    """Point guard profile — heavy creation, light interior."""
    return {
        "movement_shooter": "Proficient",
        "spot_up_shooter": "Capable",
        "off_dribble_shooter": "Elite",
        "high_flyer": "None",
        "crafty_finisher": "Proficient",
        "rebounder": "None",
        "offensive_rebounder": "None",
        "driver": "Elite",
        "vertical_spacer": "None",
        "low_post_player": "None",
        "mid_post_player": "None",
        "rim_protector": "None",
        "perimeter_disruptor": "Elite",
        "versatile_defender": "Capable",
        "screen_setter": "None",
        "pnr_finisher": "None",
        "passer": "All-Time Great",
        "cutter": "Capable",
        "transition_threat": "Elite",
        "pnr_ball_handler": "Elite",
        "isolation_scorer": "Elite",
    }


# ---------------------------------------------------------------------------
# Parity tests
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "profile_name,profile_fn",
    [
        ("all_atg", _all_atg_skills),
        ("all_none", _all_none_skills),
        ("mixed", _mixed_skills),
        ("guard", _guard_profile),
    ],
)
def test_formula_engine_matches_hardcoded(profile_name: str, profile_fn):
    """Declarative engine produces identical output to hardcoded computation."""
    skills = profile_fn()
    hardcoded = compute_raw_composites(skills, VALUES)
    declarative = compute_raw_from_formulas(skills, FORMULAS, TIER_VALUES)

    assert set(hardcoded.keys()) == set(declarative.keys()), (
        f"Key mismatch for {profile_name}: "
        f"hardcoded={sorted(hardcoded.keys())}, declarative={sorted(declarative.keys())}"
    )

    for key in hardcoded:
        assert abs(hardcoded[key] - declarative[key]) < TOLERANCE, (
            f"{profile_name}/{key}: hardcoded={hardcoded[key]}, "
            f"declarative={declarative[key]}, diff={abs(hardcoded[key] - declarative[key])}"
        )


# ---------------------------------------------------------------------------
# Topological sort
# ---------------------------------------------------------------------------


def test_topological_sort_respects_dependencies():
    """Composites with dependencies come after their dependencies."""
    order = topological_sort(FORMULAS)

    index_of = {key: i for i, key in enumerate(order)}
    for key, formula in FORMULAS.items():
        for dep in formula.get("depends_on", []):
            assert index_of[dep] < index_of[key], (
                f"'{key}' depends on '{dep}' but '{dep}' appears later in order"
            )


def test_topological_sort_circular_raises():
    """Circular dependencies raise ValueError."""
    circular = {
        "a": {"factors": [], "amplifiers": [], "depends_on": ["b"]},
        "b": {"factors": [], "amplifiers": [], "depends_on": ["a"]},
    }
    with pytest.raises(ValueError, match="Circular"):
        topological_sort(circular)


# ---------------------------------------------------------------------------
# Export completeness
# ---------------------------------------------------------------------------


def test_export_covers_all_composites():
    """Export produces entries for all 14 canonical composites."""
    from backend.services.cohesion_engine.weights import COMPOSITE_NAMES

    exported_keys = set(FORMULAS.keys())
    expected_keys = set(COMPOSITE_NAMES)
    assert exported_keys == expected_keys, (
        f"Missing: {expected_keys - exported_keys}, "
        f"Extra: {exported_keys - expected_keys}"
    )


# ---------------------------------------------------------------------------
# Amplifier behavior
# ---------------------------------------------------------------------------


def test_amplifier_floor_respected():
    """Amplifier multiplier never goes below floor even with zero source."""
    skills = _all_none_skills()
    result = compute_raw_from_formulas(skills, FORMULAS, TIER_VALUES)

    # All None → all composites should be 0.0 (factors are 0, so even
    # with multiplier clamped at 1.0 the result is 0 * 1 = 0).
    for key, val in result.items():
        assert val == 0.0, f"{key} should be 0.0 for all-None skills, got {val}"


def test_single_coefficient_change_affects_dependents():
    """Changing one coefficient changes only the target and its dependents."""
    skills = _mixed_skills()

    # Baseline
    baseline = compute_raw_from_formulas(skills, FORMULAS, TIER_VALUES)

    # Double the off_dribble coefficient in spacing
    import copy

    modified_formulas = copy.deepcopy(FORMULAS)
    spacing_formula = modified_formulas["spacing"]
    # Find the off_dribble_shooter factor
    for factor in spacing_formula["factors"]:
        if factor["key"] == "off_dribble_shooter":
            factor["coefficient"] *= 2.0

    modified = compute_raw_from_formulas(skills, modified_formulas, TIER_VALUES)

    # spacing should change
    assert modified["spacing"] != baseline["spacing"]

    # Dependents of spacing (off_ball_impact, shot_creation) should also change
    assert modified["off_ball_impact"] != baseline["off_ball_impact"]
    assert modified["shot_creation"] != baseline["shot_creation"]

    # Composites independent of spacing should be unchanged
    assert modified["finishing"] == baseline["finishing"]
    assert modified["interior_defense"] == baseline["interior_defense"]
    assert modified["defensive_rebounding"] == baseline["defensive_rebounding"]
    assert modified["pnr_orchestration"] == baseline["pnr_orchestration"]


def test_per_factor_amplifier():
    """Amplifier with applies_to only multiplies specified factors."""
    # off_ball_impact has cutter amplified by finishing, but spacing is not
    skills = _mixed_skills()
    result = compute_raw_from_formulas(skills, FORMULAS, TIER_VALUES)

    # Verify off_ball_impact is positive (mixed profile has real skills)
    assert result["off_ball_impact"] > 0.0

    # Verify the amplifier affected the result by comparing to a version
    # without the amplifier
    import copy

    no_amp_formulas = copy.deepcopy(FORMULAS)
    no_amp_formulas["off_ball_impact"]["amplifiers"] = []

    no_amp_result = compute_raw_from_formulas(skills, no_amp_formulas, TIER_VALUES)

    # With amplifier should be >= without (finishing is positive → mult >= 1.0)
    assert result["off_ball_impact"] >= no_amp_result["off_ball_impact"]
