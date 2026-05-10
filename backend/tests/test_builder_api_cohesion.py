"""
Integration tests for POST /api/builder/evaluate.
"""

from __future__ import annotations

import json
from math import comb

import pytest

from app import create_app
from api import builder


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(builder, "ensure_distributions", lambda _season: None)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def make_player(name: str, slot: int, skills: dict[str, str], height: str = "6-7") -> dict:
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": slot == 0,
        "height": height,
        "skills": skills,
    }


def post_evaluate(client, body: dict) -> tuple:
    resp = client.post(
        "/api/builder/evaluate",
        data=json.dumps(body),
        content_type="application/json",
    )
    return resp, resp.get_json()


def cohesion_roster() -> list[dict]:
    return [
        make_player("Cornerstone", 0, {"passer": "Elite", "pnr_ball_handler": "Elite"}, "6-8"),
        make_player("Shooter", 1, {"movement_shooter": "Elite", "spot_up_shooter": "Elite"}, "6-5"),
        make_player("Cutter", 2, {"cutter": "Elite", "driver": "Proficient"}, "6-7"),
        make_player("Big", 3, {"rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite"}, "7-0"),
        make_player("Wing", 4, {"versatile_defender": "Elite", "transition_threat": "Elite", "high_flyer": "Elite"}, "6-8"),
    ]


def test_evaluate_returns_cohesion_response_shape(client):

    resp, data = post_evaluate(
        client,
        {"players": cohesion_roster(), "mode": "live", "debug": False},
    )

    assert resp.status_code == 200
    assert data["success"] is True
    payload = data["data"]
    assert "scores" not in payload
    assert 0.0 <= payload["star_rating"] <= 5.0
    assert set(payload["star_rating_breakdown"]) == {
        "starting_5",
        "depth",
        "archetype_diversity",
        "floor",
    }
    assert payload["starting_lineup"]["cohesion_score"] >= 0.0
    assert "subscores" in payload["starting_lineup"]
    assert "strength_amplification" in payload["starting_lineup"]["accentuation"]
    assert len(payload["player_composites"]) == 5
    assert "spacing" in payload["player_composites"][0]["base"]
    assert "amplitude" in payload["player_composites"][0]["bell_curve"]
    assert payload["lineup_summary"]["total_lineups"] == 1
    assert isinstance(payload["notes"], list)


def test_partial_roster_returns_mode_a_notes(client):
    players = [
        make_player("Cornerstone", 0, {"spot_up_shooter": "Elite"}, "6-6"),
        make_player("Support", 1, {}, "6-5"),
    ]

    resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})

    assert resp.status_code == 200
    payload = data["data"]
    assert payload["lineup_summary"]["total_lineups"] == 0
    assert payload["starting_lineup"]["cohesion_score"] == 0.0
    assert len(payload["notes"]) > 0


def test_evaluate_returns_ranked_lineup_combinations_for_current_selection(client):
    players = [
        *cohesion_roster(),
        make_player("Bench", 5, {"rebounder": "Elite", "spot_up_shooter": "Proficient"}, "6-9"),
    ]

    resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})

    assert resp.status_code == 200
    payload = data["data"]
    combinations = payload["lineup_combinations"]
    scores = [lineup["cohesion_score"] for lineup in combinations]

    assert payload["lineup_summary"]["total_lineups"] == comb(6, 5)
    assert len(combinations) == comb(6, 5)
    assert scores == sorted(scores, reverse=True)
    assert [lineup["rank"] for lineup in combinations] == list(range(1, len(combinations) + 1))
    assert sum(1 for lineup in combinations if lineup["is_starting_lineup"]) == 1
    assert {"rank", "player_names", "player_ids", "subscores"}.issubset(combinations[0])
