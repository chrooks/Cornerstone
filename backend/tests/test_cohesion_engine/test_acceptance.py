"""
Acceptance tests for the completed cohesion engine.

These tests lock the phase-level contracts from the ExecPlan: named formula
regressions, defensive bell archetypes, key synergy behavior, and full-roster
runtime.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from services.cohesion_engine.bell_curve import compute_bell_params
from services.cohesion_engine.composites import compute_raw_composites
from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion
from services.cohesion_engine.roster import evaluate_roster
from services.cohesion_engine.synergies import apply_synergies

# Ensure handlers are registered before tests run
import services.cohesion_engine.handlers.composites_v1  # noqa: F401


def _bootstrap_engine() -> CohesionEngine:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    version = EvaluationVersion(
        id="test", slug="test", status="published", payload=data["payload"],
    )
    return CohesionEngine(version)


ENGINE = _bootstrap_engine()
VALUES = ENGINE.version.values


REFERENCE_PROFILES = {
    "Stephen Curry": {
        "movement_shooter": "All-Time Great",
        "spot_up_shooter": "Elite",
        "off_dribble_shooter": "All-Time Great",
        "crafty_finisher": "Elite",
        "passer": "Elite",
        "pnr_ball_handler": "Elite",
        "isolation_scorer": "Elite",
        "transition_threat": "Proficient",
        "driver": "Proficient",
    },
    "LeBron James": {
        "passer": "All-Time Great",
        "driver": "Elite",
        "transition_threat": "All-Time Great",
        "high_flyer": "Elite",
        "crafty_finisher": "Elite",
        "rim_protector": "Proficient",
        "versatile_defender": "Elite",
        "low_post_player": "Proficient",
        "mid_post_player": "Proficient",
        "rebounder": "Elite",
        "pnr_ball_handler": "Elite",
        "isolation_scorer": "Elite",
        "spot_up_shooter": "Proficient",
    },
    "Rudy Gobert": {
        "rim_protector": "Elite",
        "rebounder": "Elite",
        "screen_setter": "Elite",
        "pnr_finisher": "Proficient",
        "vertical_spacer": "Elite",
    },
    "Nikola Jokic": {
        "passer": "All-Time Great",
        "low_post_player": "Elite",
        "mid_post_player": "Elite",
        "rebounder": "Elite",
        "screen_setter": "Proficient",
        "pnr_finisher": "Elite",
        "spot_up_shooter": "Proficient",
        "movement_shooter": "Proficient",
        "crafty_finisher": "Elite",
        "driver": "Proficient",
        "transition_threat": "Proficient",
    },
    "Victor Wembanyama": {
        "rim_protector": "All-Time Great",
        "vertical_spacer": "Elite",
        "high_flyer": "Elite",
        "crafty_finisher": "Proficient",
        "low_post_player": "Proficient",
        "mid_post_player": "Proficient",
        "rebounder": "Elite",
        "spot_up_shooter": "Proficient",
        "pnr_finisher": "Proficient",
        "screen_setter": "Proficient",
        "transition_threat": "Proficient",
    },
    "Devin Vassell": {
        "spot_up_shooter": "Elite",
        "movement_shooter": "Proficient",
        "off_dribble_shooter": "Proficient",
        "perimeter_disruptor": "Proficient",
        "versatile_defender": "Capable",
        "transition_threat": "Proficient",
        "cutter": "Proficient",
        "driver": "Capable",
        "passer": "Capable",
    },
}

EXPECTED_RAW_COMPOSITES = {
    "Stephen Curry": {
        "spacing": 32.0,
        "finishing": 8.0,
        "paint_touch": 6.56,
        "post_game": 0.0,
        "pnr_screener": 0.0,
        "off_ball_impact": 34.4,
        "shot_creation": 44.96,
        "pnr_orchestration": 14.8,
        "ball_security": 8.0,
        "defensive_rebounding": 0.0,
        "offensive_rebounding": 0.0,
        "transition": 13.2,
        "perimeter_defense": 0.0,
        "interior_defense": 0.0,
    },
    "LeBron James": {
        "spacing": 4.0,
        "finishing": 16.0,
        "paint_touch": 33.744,
        "post_game": 6.8,
        "pnr_screener": 0.0,
        "off_ball_impact": 8.8,
        "shot_creation": 43.192,
        "pnr_orchestration": 15.2,
        "ball_security": 16.0,
        "defensive_rebounding": 8.0,
        "offensive_rebounding": 0.0,
        "transition": 76.0,
        "perimeter_defense": 5.6,
        "interior_defense": 8.4,
    },
    "Rudy Gobert": {
        "spacing": 0.0,
        "finishing": 0.0,
        "paint_touch": 4.8,
        "post_game": 0.0,
        "pnr_screener": 16.8,
        "off_ball_impact": 0.0,
        "shot_creation": 2.4,
        "pnr_orchestration": 0.0,
        "ball_security": 0.0,
        "defensive_rebounding": 8.0,
        "offensive_rebounding": 0.0,
        "transition": 0.0,
        "perimeter_defense": 0.0,
        "interior_defense": 10.4,
    },
    "Nikola Jokic": {
        "spacing": 8.0,
        "finishing": 8.0,
        "paint_touch": 28.864,
        "post_game": 13.6,
        "pnr_screener": 16.8,
        "off_ball_impact": 12.8,
        "shot_creation": 28.432,
        "pnr_orchestration": 6.0,
        "ball_security": 16.0,
        "defensive_rebounding": 8.0,
        "offensive_rebounding": 0.0,
        "transition": 18.8,
        "perimeter_defense": 0.0,
        "interior_defense": 2.4,
    },
    "Victor Wembanyama": {
        "spacing": 4.0,
        "finishing": 12.0,
        "paint_touch": 22.736,
        "post_game": 6.8,
        "pnr_screener": 15.2,
        "off_ball_impact": 4.0,
        "shot_creation": 12.568,
        "pnr_orchestration": 0.0,
        "ball_security": 0.0,
        "defensive_rebounding": 8.0,
        "offensive_rebounding": 0.0,
        "transition": 10.4,
        "perimeter_defense": 0.0,
        "interior_defense": 18.4,
    },
    "Devin Vassell": {
        "spacing": 14.0,
        "finishing": 0.0,
        "paint_touch": 1.0,
        "post_game": 0.0,
        "pnr_screener": 0.0,
        "off_ball_impact": 18.3,
        "shot_creation": 8.84,
        "pnr_orchestration": 1.4,
        "ball_security": 1.0,
        "defensive_rebounding": 0.0,
        "offensive_rebounding": 0.0,
        "transition": 6.7,
        "perimeter_defense": 4.7,
        "interior_defense": 0.25,
    },
}


def player(name: str, slot: int, height: str, skills: dict[str, str]) -> dict:
    return {"id": name, "name": name, "slot": slot, "height": height, "skills": skills}


@pytest.mark.parametrize("name", sorted(REFERENCE_PROFILES))
def test_reference_player_raw_composites_match_locked_formula_outputs(name):
    raw = compute_raw_composites(REFERENCE_PROFILES[name], VALUES)

    assert raw == pytest.approx(EXPECTED_RAW_COMPOSITES[name])


def test_named_defensive_bell_archetypes_match_expected_shapes():
    assert compute_bell_params({"perimeter_disruptor": "None"}, 73, VALUES) == {
        "amplitude": 0.5,
        "peak_center": 73,
        "range_down": 1,
        "range_up": 1,
        "flat_top_down": 0,
        "flat_top_up": 0,
        "player_height": 73,
    }
    assert compute_bell_params({"versatile_defender": "Elite"}, 80, VALUES) == {
        "amplitude": 3.5,
        "peak_center": 80,
        "range_down": 6,
        "range_up": 6,
        "flat_top_down": 2,
        "flat_top_up": 2,
        "player_height": 80,
    }
    assert compute_bell_params({"rim_protector": "Elite"}, 85, VALUES) == {
        "amplitude": 3.5,
        "peak_center": 86,
        "range_down": 4,
        "range_up": 6,
        "flat_top_down": 1,
        "flat_top_up": 2,
        "player_height": 85,
    }
    assert compute_bell_params({"rim_protector": "All-Time Great"}, 89, VALUES) == {
        "amplitude": 4.0,
        "peak_center": 88,
        "range_down": 5,
        "range_up": 7,
        "flat_top_down": 1,
        "flat_top_up": 2,
        "player_height": 88,
    }


def test_synergy_contracts_cover_threshold_and_flag_only_cases():
    low_spacing, low_spacing_ids = apply_synergies(
        [
            player("Cutter", 1, "6-7", {"cutter": "Elite"}),
            player("NonShooter", 2, "6-6", {}),
        ],
        VALUES,
    )
    high_spacing, high_spacing_ids = apply_synergies(
        [
            player("Cutter", 1, "6-7", {"cutter": "Elite"}),
            player("Shooter", 2, "6-5", {"movement_shooter": "All-Time Great", "spot_up_shooter": "Elite"}),
        ],
        VALUES,
    )

    assert "OFF-13" in low_spacing_ids
    assert "OFF-13" not in high_spacing_ids
    assert low_spacing[0]["skills"]["cutter"] < high_spacing[0]["skills"]["cutter"]

    boosted, fired = apply_synergies(
        [
            player("Only Passer", 1, "6-6", {"passer": "Elite"}),
            player("Target", 2, "6-7", {}),
        ],
        VALUES,
    )

    assert "OFF-37" in fired
    assert boosted == [
        player("Only Passer", 1, "6-6", {"passer": "Elite"}),
        player("Target", 2, "6-7", {}),
    ]


def test_full_nine_player_roster_evaluates_126_lineups_under_100ms():
    roster = [
        player("LeBron James", 1, "6-8", REFERENCE_PROFILES["LeBron James"]),
        player("Stephen Curry", 2, "6-3", REFERENCE_PROFILES["Stephen Curry"]),
        player("Devin Vassell", 3, "6-5", REFERENCE_PROFILES["Devin Vassell"]),
        player("Victor Wembanyama", 4, "7-4", REFERENCE_PROFILES["Victor Wembanyama"]),
        player("Nikola Jokic", 5, "6-11", REFERENCE_PROFILES["Nikola Jokic"]),
        player("Rudy Gobert", 6, "7-1", REFERENCE_PROFILES["Rudy Gobert"]),
        player("Connector", 7, "6-7", {"passer": "Proficient", "cutter": "Elite", "versatile_defender": "Proficient"}),
        player("Rebound Wing", 8, "6-8", {"rebounder": "Elite", "transition_threat": "Elite", "spot_up_shooter": "Proficient"}),
        player("Screen Guard", 9, "6-4", {"screen_setter": "Proficient", "movement_shooter": "Elite", "perimeter_disruptor": "Elite"}),
    ]

    start = time.perf_counter()
    result = evaluate_roster(roster, ENGINE)
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert result.lineup_summary["total_lineups"] == 126
    assert 0.0 <= result.star_rating <= 5.0
    assert elapsed_ms < 100
