"""
Unit tests for the player-level ``passing`` composite (#100).

``passing = passer`` tier value — the player-side mirror of the team-level
``_collective_passing`` subscore. Covers both compute paths (hardcoded and
declarative formula), percentile normalization, and the honest-gap behavior
when an Evaluation Version predates the passing formula.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.cohesion_engine import composites
from backend.services.cohesion_engine.weights import MIN_DISTRIBUTION_SIZE


def _bootstrap_values() -> dict:
    seed_path = (
        Path(__file__).resolve().parents[3]
        / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    )
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


# Seed carries no composite_formulas, so this exercises the hardcoded path.
VALUES = _bootstrap_values()

# The declarative formula for passing that M3 will publish into a new version.
PASSING_FORMULA = {
    "passing": {"factors": [{"type": "skill", "key": "passer", "coefficient": 1.0}]}
}


def test_elite_passer_beats_none_passer_raw():
    elite = composites.compute_raw_composites({"passer": "Elite"}, VALUES)["passing"]
    non_passer = composites.compute_raw_composites({"passer": "None"}, VALUES)["passing"]

    assert elite > non_passer
    assert non_passer == 0.0
    # passer alone, no secondary term — Elite tier value flows straight through.
    assert elite == pytest.approx(VALUES["tier_values"]["Elite"])


def test_hardcoded_and_formula_paths_agree():
    skills = {"passer": "Proficient"}

    hardcoded = composites.compute_raw_composites(skills, VALUES)["passing"]
    formula_values = {**VALUES, "composite_formulas": PASSING_FORMULA}
    from_formula = composites.compute_raw_composites(skills, formula_values)["passing"]

    assert from_formula == pytest.approx(hardcoded)


def test_passing_normalizes_to_zero_ten_percentile():
    # 20 raw values (== MIN_DISTRIBUTION_SIZE) so the percentile path engages.
    distribution = {
        "passing": sorted([0.0] * 10 + [4.0] * 5 + [8.0] * 3 + [16.0] * 2),
    }
    assert len(distribution["passing"]) >= MIN_DISTRIBUTION_SIZE

    low = composites.normalize_composites({"passing": 0.0}, VALUES, distribution)["passing"]
    high = composites.normalize_composites({"passing": 16.0}, VALUES, distribution)["passing"]

    assert 0.0 <= low <= 10.0
    assert 0.0 <= high <= 10.0
    assert high > low


def test_missing_passing_formula_yields_gap_not_crash():
    # A pre-#100 declarative-formula version: composite_formulas present but with
    # no passing entry. The player spoke must render as a gap (None), never a 0,
    # and the evaluation must not raise (old published versions must not crash).
    values_missing = {
        **VALUES,
        "composite_formulas": {
            "spacing": {
                "factors": [{"type": "skill", "key": "spot_up_shooter", "coefficient": 1.0}]
            }
        },
    }

    pc = composites.compute_player_composites(
        {"passer": "Elite", "spot_up_shooter": "Elite"},
        "p1",
        "Test Player",
        values_missing,
    )

    assert pc.passing is None
    assert pc.spacing is not None
