"""
Unit tests for Phase 3 lineup synergies.
"""

from __future__ import annotations

import pytest

from backend.services.cohesion_engine.synergies import apply_synergies


def make_player(name: str, skills: dict[str, str]) -> dict:
    return {"id": name, "name": name, "height": "6-7", "skills": skills}


def test_off_02_boosts_movement_shooter_from_distinct_screener():
    lineup = [
        make_player("Shooter", {"movement_shooter": "Elite"}),
        make_player("Screener", {"screen_setter": "Elite"}),
    ]

    boosted, fired = apply_synergies(lineup)

    assert "OFF-02" in fired
    assert boosted[0]["skills"]["movement_shooter"] == pytest.approx(7.8)
    assert lineup[0]["skills"]["movement_shooter"] == "Elite"


def test_off_03_penalizes_movement_shooter_without_screen():
    boosted, fired = apply_synergies([make_player("Shooter", {"movement_shooter": "Elite"})])

    assert "OFF-03" in fired
    assert boosted[0]["skills"]["movement_shooter"] == pytest.approx(5.2173913043)


def test_cutter_synergies_can_boost_and_penalize_same_effective_skill():
    lineup = [
        make_player("Cutter", {"cutter": "Proficient"}),
        make_player("Screener", {"screen_setter": "Elite"}),
        make_player("Creator", {"pnr_ball_handler": "Elite"}),
    ]

    boosted, fired = apply_synergies(lineup)

    assert {"OFF-04", "OFF-13", "OFF-14"}.issubset(set(fired))
    assert boosted[0]["skills"]["cutter"] > 3.0


def test_off_12_fires_when_cutter_has_no_passer():
    boosted, fired = apply_synergies([make_player("Cutter", {"cutter": "Elite"})])

    assert "OFF-12" in fired
    assert boosted[0]["skills"]["cutter"] < 6.0


def test_vertical_spacer_penalty_and_boost_conditions():
    penalized, penalty_ids = apply_synergies([make_player("Lob", {"vertical_spacer": "Elite"})])
    boosted, boost_ids = apply_synergies(
        [
            make_player("Lob", {"vertical_spacer": "Elite"}),
            make_player("Passer", {"passer": "Elite"}),
        ]
    )

    assert "OFF-15" in penalty_ids
    assert "OFF-16" in boost_ids
    assert penalized[0]["skills"]["vertical_spacer"] < 6.0
    assert boosted[0]["skills"]["vertical_spacer"] > 6.0


def test_off_28_is_retired_in_favor_of_pnr_pairing_subscore():
    lineup = [
        make_player("Handler", {"pnr_ball_handler": "Elite"}),
        make_player("Finisher", {"pnr_finisher": "Proficient"}),
    ]

    boosted, fired = apply_synergies(lineup)

    assert "OFF-28" not in fired
    assert boosted[0]["skills"]["pnr_ball_handler"] == "Elite"
    assert boosted[1]["skills"]["pnr_finisher"] == "Proficient"


def test_transition_synergies_and_single_passer_flag_fire():
    lineup = [
        make_player("Runner", {"transition_threat": "Elite", "high_flyer": "Elite"}),
        make_player("Passer", {"passer": "Elite"}),
    ]

    boosted, fired = apply_synergies(lineup)

    assert {"OFF-31", "OFF-32", "OFF-37"}.issubset(set(fired))
    assert boosted[0]["skills"]["transition_threat"] > 6.0
    assert boosted[0]["skills"]["high_flyer"] > 6.0
