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
        "spacing": 21.0,
        "finishing": 6.0,
        "paint_touch": 4.44,
        "post_game": 0.0,
        "pnr_screener": 0.0,
        "off_ball_impact": 22.8,
        "shot_creation": 36.52,
        "ball_security": 6.0,
        "defensive_rebounding": 0.0,
        "offensive_rebounding": 0.0,
        "transition": 8.7,
        "perimeter_defense": 0.0,
        "interior_defense": 0.0,
    },
    "LeBron James": {
        "spacing": 3.0,
        "finishing": 12.0,
        "paint_touch": 21.756,
        "post_game": 5.1,
        "pnr_screener": 0.0,
        "off_ball_impact": 6.0,
        "shot_creation": 33.778,
        "ball_security": 10.0,
        "defensive_rebounding": 6.0,
        "offensive_rebounding": 0.0,
        "transition": 36.6,
        "perimeter_defense": 4.2,
        "interior_defense": 6.3,
    },
    "Rudy Gobert": {
        "spacing": 0.0,
        "finishing": 0.0,
        "paint_touch": 3.6,
        "post_game": 0.0,
        "pnr_screener": 11.7,
        "off_ball_impact": 0.0,
        "shot_creation": 1.8,
        "ball_security": 0.0,
        "defensive_rebounding": 6.0,
        "offensive_rebounding": 0.0,
        "transition": 0.0,
        "perimeter_defense": 0.0,
        "interior_defense": 7.8,
    },
    "Nikola Jokic": {
        "spacing": 6.0,
        "finishing": 6.0,
        "paint_touch": 19.536,
        "post_game": 10.2,
        "pnr_screener": 11.7,
        "off_ball_impact": 9.0,
        "shot_creation": 21.568,
        "ball_security": 10.0,
        "defensive_rebounding": 6.0,
        "offensive_rebounding": 0.0,
        "transition": 10.5,
        "perimeter_defense": 0.0,
        "interior_defense": 1.8,
    },
    "Victor Wembanyama": {
        "spacing": 3.0,
        "finishing": 9.0,
        "paint_touch": 14.964,
        "post_game": 5.1,
        "pnr_screener": 10.05,
        "off_ball_impact": 3.0,
        "shot_creation": 8.382,
        "ball_security": 0.0,
        "defensive_rebounding": 6.0,
        "offensive_rebounding": 0.0,
        "transition": 7.8,
        "perimeter_defense": 0.0,
        "interior_defense": 11.8,
    },
    "Devin Vassell": {
        "spacing": 10.5,
        "finishing": 0.0,
        "paint_touch": 1.5,
        "post_game": 0.0,
        "pnr_screener": 0.0,
        "off_ball_impact": 13.95,
        "shot_creation": 8.4,
        "ball_security": 1.5,
        "defensive_rebounding": 0.0,
        "offensive_rebounding": 0.0,
        "transition": 5.55,
        "perimeter_defense": 4.05,
        "interior_defense": 0.375,
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
