"""
Tests for the cohesion engine's immutable value objects.
"""

from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest

from backend.services.cohesion_engine.types import (
    LineupCohesion,
    Note,
    PlayerComposites,
    RosterEvaluation,
)


def make_player_composites() -> PlayerComposites:
    """Build a representative player composite object for type tests."""
    return PlayerComposites(
        player_id="player-1",
        name="Example Player",
        spacing=8.5,
        finishing=6.0,
        paint_touch=7.2,
        post_game=1.0,
        pnr_screener=4.5,
        off_ball_impact=8.0,
        shot_creation=7.8,
        pnr_ball_handler=0.0,
        ball_security=4.0,
        defensive_rebounding=5.5,
        offensive_rebounding=3.0,
        transition=6.7,
        perimeter_defense=7.1,
        interior_defense=8.2,
        bell_amplitude=3.5,
        bell_peak=80,
        bell_range_down=6,
        bell_range_up=4,
        bell_flat_down=2,
        bell_flat_up=1,
    )


def test_player_composites_constructs_all_phase_1_fields():
    player = make_player_composites()

    assert player.player_id == "player-1"
    assert player.name == "Example Player"
    assert player.spacing == 8.5
    assert player.transition == 6.7
    assert player.perimeter_defense == 7.1
    assert player.interior_defense == 8.2
    assert player.bell_amplitude == 3.5
    assert player.bell_peak == 80
    assert player.bell_flat_up == 1


def test_player_composites_is_frozen():
    player = make_player_composites()

    with pytest.raises(FrozenInstanceError):
        player.spacing = 9.0


def test_lineup_note_and_roster_evaluation_construct_cleanly():
    lineup = LineupCohesion(
        score=4.1,
        subscores={"spacing_creation_ratio": 7.8},
        synergies_applied=["OFF-02"],
        accentuation_strength=3.2,
        accentuation_weakness=2.1,
    )
    note = Note(
        type="strength",
        category="spacing",
        severity=0.9,
        raw_value=8.5,
        text="Example Player's shooting creates elite floor spacing.",
    )
    evaluation = RosterEvaluation(
        star_rating=4.2,
        star_breakdown={
            "starting_5": 0.85,
            "depth": 0.72,
            "archetype_diversity": 0.60,
            "floor": 0.78,
        },
        starting_lineup=lineup,
        player_composites=[make_player_composites()],
        lineup_summary={
            "total_lineups": 126,
            "viable_lineups": 28,
            "median_score": 3.8,
            "archetype_labels": ["offensive", "defensive"],
        },
        notes=[note],
        team_description=None,
    )

    assert evaluation.star_rating == 4.2
    assert evaluation.starting_lineup.score == 4.1
    assert evaluation.notes[0].type == "strength"
    assert evaluation.player_composites[0].name == "Example Player"


def test_lineup_note_and_roster_evaluation_are_frozen():
    lineup = LineupCohesion(4.1, {}, [], 0.0, 0.0)
    note = Note("weakness", "interior_defense", 0.7, 1.0, "No rim protection.")
    evaluation = RosterEvaluation(0.0, {}, lineup, [], {}, [note], None)

    with pytest.raises(FrozenInstanceError):
        lineup.score = 5.0
    with pytest.raises(FrozenInstanceError):
        note.severity = 0.1
    with pytest.raises(FrozenInstanceError):
        evaluation.star_rating = 1.0
