"""
Integration tests for Phase 4 roster-level scoring.
"""

from __future__ import annotations

from backend.services.cohesion_engine import evaluate_roster as package_evaluate_roster
from backend.services.cohesion_engine.roster import evaluate_roster
from backend.services.cohesion_engine.types import RosterEvaluation


def make_player(name: str, slot: int, height: str = "6-7", skills: dict[str, str] | None = None) -> dict:
    return {
        "id": name,
        "name": name,
        "slot": slot,
        "height": height,
        "skills": skills or {},
    }


def balanced_player(name: str, slot: int) -> dict:
    skill_sets = [
        {"pnr_ball_handler": "Elite", "passer": "Elite", "perimeter_disruptor": "Elite"},
        {"movement_shooter": "Elite", "spot_up_shooter": "Elite", "off_dribble_shooter": "Proficient"},
        {"cutter": "Elite", "driver": "Elite", "high_flyer": "Proficient"},
        {"rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite"},
        {"versatile_defender": "Elite", "transition_threat": "Elite", "high_flyer": "Elite"},
        {"low_post_player": "Elite", "mid_post_player": "Proficient", "rebounder": "Proficient"},
        {"spot_up_shooter": "Proficient", "passer": "Proficient", "transition_threat": "Proficient"},
        {"offensive_rebounder": "Elite", "vertical_spacer": "Elite", "screen_setter": "Proficient"},
        {"isolation_scorer": "Elite", "off_dribble_shooter": "Elite", "driver": "Proficient"},
    ]
    heights = ["6-3", "6-5", "6-7", "7-0", "6-8", "6-11", "6-4", "6-10", "6-6"]
    index = slot - 1
    return make_player(name, slot, heights[index], skill_sets[index])


def test_package_reexports_real_evaluate_roster():
    assert package_evaluate_roster is evaluate_roster


def test_evaluate_roster_partial_roster_returns_base_composites_without_lineups():
    players = [
        make_player("A", 1, skills={"spot_up_shooter": "Elite"}),
        make_player("B", 2, skills={"rim_protector": "Elite"}),
        make_player("C", 3, skills={"passer": "Elite"}),
    ]

    result = evaluate_roster(players)

    assert isinstance(result, RosterEvaluation)
    assert result.star_rating == 0.0
    assert result.starting_lineup.score == 0.0
    assert len(result.player_composites) == 3
    assert result.lineup_summary == {
        "total_lineups": 0,
        "viable_lineups": 0,
        "median_score": 0.0,
        "archetype_labels": [],
    }
    assert result.notes == []
    assert result.team_description is None


def test_evaluate_roster_with_five_players_scores_one_lineup():
    players = [balanced_player(f"P{i}", i) for i in range(1, 6)]

    result = evaluate_roster(players)

    assert 0.0 <= result.star_rating <= 5.0
    assert result.starting_lineup.score > 0.0
    assert result.lineup_summary["total_lineups"] == 1
    assert result.lineup_summary["median_score"] == result.starting_lineup.score
    assert set(result.star_breakdown) == {
        "starting_5",
        "depth",
        "archetype_diversity",
        "floor",
    }
    assert all(0.0 <= value <= 1.0 for value in result.star_breakdown.values())


def test_evaluate_roster_with_nine_players_evaluates_all_126_lineups():
    players = [balanced_player(f"P{i}", i) for i in range(1, 10)]

    result = evaluate_roster(players)

    assert result.lineup_summary["total_lineups"] == 126
    assert 0 <= result.lineup_summary["viable_lineups"] <= 126
    assert 0.0 <= result.lineup_summary["median_score"] <= 5.0
    assert all(label in {"offensive", "defensive", "transition", "balanced", "paint", "shooting"} for label in result.lineup_summary["archetype_labels"])


def test_evaluate_roster_uses_slot_order_for_starting_lineup():
    players = [
        balanced_player("Bench", 6),
        balanced_player("Starter 4", 4),
        balanced_player("Starter 2", 2),
        balanced_player("Starter 5", 5),
        balanced_player("Starter 1", 1),
        balanced_player("Starter 3", 3),
    ]

    result = evaluate_roster(players)
    expected = evaluate_roster(sorted(players, key=lambda player: player["slot"])[:5])

    assert result.starting_lineup.score == expected.starting_lineup.score
