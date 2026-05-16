"""
Integration tests for Phase 3 lineup cohesion orchestration.
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.services.cohesion_engine.cohesion import evaluate_lineup
from backend.services.cohesion_engine.types import LineupCohesion


def _bootstrap_values() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


VALUES = _bootstrap_values()


def make_player(name: str, height: str, skills: dict[str, str]) -> dict:
    return {"id": name, "name": name, "height": height, "skills": skills}


def test_evaluate_lineup_returns_all_subscores_in_range():
    lineup = [
        make_player("Handler", "6-3", {"pnr_ball_handler": "Elite", "passer": "Elite", "perimeter_disruptor": "Elite"}),
        make_player("Shooter", "6-5", {"movement_shooter": "Elite", "spot_up_shooter": "Elite"}),
        make_player("Cutter", "6-7", {"cutter": "Elite", "driver": "Proficient"}),
        make_player("Big", "7-0", {"rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite"}),
        make_player("Wing", "6-8", {"versatile_defender": "Elite", "transition_threat": "Elite", "high_flyer": "Elite"}),
    ]

    result = evaluate_lineup(lineup, VALUES)

    assert isinstance(result, LineupCohesion)
    assert 0.0 <= result.score <= 5.0
    assert set(result.subscores) == {
        "spacing_creation_ratio",
        "creation_offball_ratio",
        "spacing_paint_touch_ratio",
        "paint_touch_total",
        "post_game_total",
        "pnr_pairing",
        "anchor_total",
        "perimeter_defense_total",
        "interior_defense_total",
        "collective_passing",
        "rebounding",
        "transition",
        "rebound_transition_ratio",
        "rebounding_spacing_deficit",
        "defensive_coverage",
        "defensive_gaps",
    }
    assert all(0.0 <= value <= 10.0 for value in result.subscores.values())
    assert "OFF-28" not in result.synergies_applied
    assert "OFF-02" in result.synergies_applied
    assert result.subscores["pnr_pairing"] > 0.0
    assert result.subscores["perimeter_defense_total"] > 0.0
    assert result.subscores["interior_defense_total"] > 0.0
    assert result.accentuation_strength >= 0.0
    assert result.accentuation_weakness >= 0.0


def test_evaluate_lineup_does_not_mutate_input_players():
    lineup = [
        make_player("Handler", "6-3", {"pnr_ball_handler": "Elite"}),
        make_player("Finisher", "6-11", {"pnr_finisher": "Elite", "rim_protector": "Elite"}),
    ]

    evaluate_lineup(lineup, VALUES)

    assert lineup[0]["skills"]["pnr_ball_handler"] == "Elite"
    assert lineup[1]["skills"]["pnr_finisher"] == "Elite"


def test_perimeter_defense_can_boost_transition_subscore():
    pressure_lineup = [
        make_player(f"Defender {index}", "6-8", {"perimeter_disruptor": "All-Time Great"})
        for index in range(5)
    ]
    neutral_lineup = [
        make_player(f"Neutral {index}", "6-8", {})
        for index in range(5)
    ]

    pressure_result = evaluate_lineup(pressure_lineup, VALUES)
    neutral_result = evaluate_lineup(neutral_lineup, VALUES)

    assert pressure_result.subscores["perimeter_defense_total"] > neutral_result.subscores["perimeter_defense_total"]
    assert pressure_result.subscores["transition"] > neutral_result.subscores["transition"]
