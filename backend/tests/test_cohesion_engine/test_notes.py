"""
Tests for Phase 5 cohesion-engine notes.
"""

from __future__ import annotations

import json
from pathlib import Path

from backend.services.cohesion_engine.notes import generate_notes
from backend.services.cohesion_engine.types import LineupCohesion, Note, PlayerComposites


def _bootstrap_values() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


VALUES = _bootstrap_values()


def make_composite(
    name: str,
    *,
    spacing: float = 0.0,
    shot_creation: float = 0.0,
    paint_touch: float = 0.0,
    anchor: float = 0.0,
    post_game: float = 0.0,
    pnr_screener: float = 0.0,
    off_ball_impact: float = 0.0,
    rebounding: float = 0.0,
    transition: float = 0.0,
    perimeter_defense: float = 0.0,
    interior_defense: float = 0.0,
    bell_amplitude: float = 0.5,
) -> PlayerComposites:
    return PlayerComposites(
        player_id=name,
        name=name,
        spacing=spacing,
        finishing=0.0,
        paint_touch=paint_touch,
        anchor=anchor,
        post_game=post_game,
        pnr_screener=pnr_screener,
        off_ball_impact=off_ball_impact,
        shot_creation=shot_creation,
        rebounding=rebounding,
        transition=transition,
        perimeter_defense=perimeter_defense,
        interior_defense=interior_defense,
        bell_amplitude=bell_amplitude,
        bell_peak=78,
        bell_range_down=1,
        bell_range_up=1,
        bell_flat_down=0,
        bell_flat_up=0,
    )


def notes_of_type(notes: list[Note], note_type: str) -> list[Note]:
    return [note for note in notes if note.type == note_type]


def test_mode_a_generates_strengths_weaknesses_and_suggestions():
    players = [
        {
            "id": "shooter",
            "name": "Shooter",
            "height": "6-5",
            "skills": {"spot_up_shooter": "Elite", "passer": "None"},
        }
    ]
    composites = [make_composite("Shooter", spacing=8.5)]

    notes = generate_notes(players, composites, VALUES)

    assert any(note.type == "strength" and note.category == "spacing" for note in notes)
    assert any(note.type == "weakness" and note.category == "anchor" for note in notes)
    assert any(note.type == "suggestion" and note.category == "anchor" for note in notes)
    assert all(isinstance(note, Note) for note in notes)


def test_mode_a_detects_stacked_spacing_and_playmaking():
    players = [
        {"id": "a", "name": "A", "height": "6-3", "skills": {"passer": "Elite"}},
        {"id": "b", "name": "B", "height": "6-4", "skills": {"passer": "Elite"}},
    ]
    composites = [
        make_composite("A", spacing=6.1, shot_creation=3.0, paint_touch=2.5),
        make_composite("B", spacing=6.5, shot_creation=3.0, paint_touch=2.5),
    ]

    notes = generate_notes(players, composites, VALUES)
    strengths = notes_of_type(notes, "strength")

    assert any(note.category == "spacing" and "Multiple shooters" in note.text for note in strengths)
    assert any(note.category == "passing" and "Multiple playmakers" in note.text for note in strengths)


def test_mode_b_uses_lineup_level_observations():
    players = [{"id": str(index), "name": f"P{index}", "skills": {}} for index in range(5)]
    composites = [make_composite(f"P{index}") for index in range(5)]
    lineup = LineupCohesion(
        score=3.8,
        subscores={
            "spacing_creation_ratio": 8.4,
            "paint_touch_total": 7.8,
            "anchor_total": 2.2,
            "collective_passing": 3.1,
            "defensive_gaps": 4.5,
        },
        synergies_applied=["OFF-02", "OFF-28"],
        accentuation_strength=5.5,
        accentuation_weakness=2.0,
    )

    notes = generate_notes(players, composites, VALUES, {"starting_lineup": lineup})

    assert any(note.type == "strength" and note.category == "spacing_creation_ratio" for note in notes)
    assert any(note.type == "strength" and note.category == "synergy" for note in notes)
    assert any(note.type == "weakness" and note.category == "anchor_total" for note in notes)
    assert any(note.type == "suggestion" and note.category == "paint_touch" for note in notes)
    assert any(note.type == "suggestion" and note.category == "rebounding" for note in notes)
    assert any(note.type == "suggestion" and note.category == "shot_creation" for note in notes)


def test_notes_are_deduplicated_limited_and_sorted_by_severity_within_type():
    players = [{"id": str(index), "name": f"P{index}", "skills": {}} for index in range(5)]
    composites = [make_composite(f"P{index}") for index in range(5)]
    lineup = LineupCohesion(
        score=2.0,
        subscores={
            "spacing_creation_ratio": 9.0,
            "spacing_paint_touch_ratio": 8.5,
            "paint_touch_total": 8.0,
            "anchor_total": 0.5,
            "collective_passing": 1.0,
            "defensive_coverage": 1.5,
            "defensive_gaps": 1.0,
            "rebounding": 0.2,
        },
        synergies_applied=[],
        accentuation_strength=0.0,
        accentuation_weakness=0.5,
    )

    notes = generate_notes(players, composites, VALUES, {"starting_lineup": lineup})

    for note_type in ("strength", "weakness", "suggestion"):
        typed_notes = notes_of_type(notes, note_type)
        assert 1 <= len(typed_notes) <= 3
        assert len({note.category for note in typed_notes}) == len(typed_notes)
        assert [note.severity for note in typed_notes] == sorted(
            [note.severity for note in typed_notes],
            reverse=True,
        )

    suggestion_categories = {note.category for note in notes_of_type(notes, "suggestion")}
    assert len(suggestion_categories) == len(notes_of_type(notes, "suggestion"))
