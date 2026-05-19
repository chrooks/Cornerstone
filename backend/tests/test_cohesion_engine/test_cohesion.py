"""
Integration tests for Phase 3 lineup cohesion orchestration.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.cohesion_engine.cohesion import evaluate_lineup
from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion
from services.cohesion_engine.types import LineupCohesion

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

    result = evaluate_lineup(lineup, ENGINE)

    assert isinstance(result, LineupCohesion)
    assert 0.0 <= result.score <= 5.0
    assert set(result.subscores) == {
        # Offense quality
        "spacing",
        "shot_creation",
        "paint_touch",
        "collective_passing",
        "off_ball_impact",
        "ball_security",
        "pnr_pairing",
        "post_game",
        # Offense balance
        "spacing_creation_ratio",
        "creation_offball_ratio",
        "spacing_paint_touch_ratio",
        # Defense
        "interior_defense",
        "defensive_coverage",
        "defensive_gaps",
        "perimeter_defense",
        "switchability",
        # Rebounding/transition
        "defensive_rebounding",
        "offensive_rebounding",
        "transition",
        "rebound_transition_ratio",
    }
    assert all(0.0 <= value <= 10.0 for value in result.subscores.values())
    assert "OFF-28" not in result.synergies_applied
    assert "OFF-02" in result.synergies_applied
    assert result.subscores["pnr_pairing"] > 0.0
    assert result.subscores["perimeter_defense"] > 0.0
    assert result.subscores["interior_defense"] > 0.0
    assert result.accentuation_strength >= 0.0
    assert result.accentuation_weakness >= 0.0


def test_evaluate_lineup_does_not_mutate_input_players():
    lineup = [
        make_player("Handler", "6-3", {"pnr_ball_handler": "Elite"}),
        make_player("Finisher", "6-11", {"pnr_finisher": "Elite", "rim_protector": "Elite"}),
    ]

    evaluate_lineup(lineup, ENGINE)

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

    pressure_result = evaluate_lineup(pressure_lineup, ENGINE)
    neutral_result = evaluate_lineup(neutral_lineup, ENGINE)

    assert pressure_result.subscores["perimeter_defense"] > neutral_result.subscores["perimeter_defense"]
    assert pressure_result.subscores["transition"] > neutral_result.subscores["transition"]
