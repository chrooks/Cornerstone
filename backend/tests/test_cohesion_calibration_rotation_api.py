"""
Integration tests for POST /api/cohesion/rotation/evaluate.
"""

from __future__ import annotations

import json
from math import comb

import pytest

from app import create_app
from api import auth, cohesion_calibration


class _FakeQuery:
    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        return type("Result", (), {"data": {"role": "admin"}})()


class _FakeSupabase:
    def table(self, _name: str):
        return _FakeQuery()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(auth, "_verify_jwt", lambda _token: {"sub": "admin-user"})
    monkeypatch.setattr(auth, "get_supabase", lambda: _FakeSupabase())
    monkeypatch.setattr(cohesion_calibration, "ensure_distributions", lambda _season: None)

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def make_player(name: str, slot: int, skills: dict[str, str] | None = None, height: str = "6-7") -> dict:
    return {
        "id": name.lower().replace(" ", "-"),
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
    ]
    heights = ["6-3", "6-5", "6-7", "7-0", "6-8", "6-11"]
    index = slot - 1
    return make_player(name, slot, skill_sets[index], heights[index])


def post_rotation(client, players: list[dict]) -> tuple:
    resp = client.post(
        "/api/cohesion/rotation/evaluate",
        data=json.dumps({"players": players}),
        content_type="application/json",
        headers={"Authorization": "Bearer test-token"},
    )
    return resp, resp.get_json()


def post_lineup(client, players: list[dict]) -> tuple:
    resp = client.post(
        "/api/cohesion/lineup/evaluate",
        data=json.dumps({"players": players}),
        content_type="application/json",
        headers={"Authorization": "Bearer test-token"},
    )
    return resp, resp.get_json()


def test_lineup_endpoint_still_requires_exactly_five_players(client):
    resp, data = post_lineup(client, [balanced_player(f"P{i}", i) for i in range(1, 7)])

    assert resp.status_code == 400
    assert data["success"] is False
    assert "Exactly 5 players required" in data["error"]


def test_lineup_endpoint_returns_archetype_explanation(client):
    resp, data = post_lineup(client, [balanced_player(f"P{i}", i) for i in range(1, 6)])

    assert resp.status_code == 200
    payload = data["data"]
    assert payload["archetype_labels"]
    assert payload["archetype_details"]
    assert payload["archetype_details"][0]["archetype"] in payload["archetype_labels"]
    assert payload["archetype_details"][0]["subscore_key"] in payload["subscores"]


def test_rotation_endpoint_rejects_fewer_than_five_players(client):
    resp, data = post_rotation(client, [balanced_player(f"P{i}", i) for i in range(1, 5)])

    assert resp.status_code == 400
    assert data["success"] is False
    assert "At least 5 players" in data["error"]


def test_rotation_endpoint_rejects_duplicate_players(client):
    players = [balanced_player(f"P{i}", i) for i in range(1, 6)]
    players[4]["id"] = players[0]["id"]

    resp, data = post_rotation(client, players)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "Duplicate" in data["error"]


def test_rotation_endpoint_rejects_over_configured_max(client):
    max_slots = cohesion_calibration.MAX_ROTATION_SLOTS
    players = [balanced_player(f"P{i}", (i % 6) + 1) for i in range(1, max_slots + 2)]

    resp, data = post_rotation(client, players)

    assert resp.status_code == 400
    assert data["success"] is False
    assert f"at most {max_slots}" in data["error"]


def test_rotation_endpoint_with_five_players_returns_one_combination(client):
    players = [balanced_player(f"P{i}", i) for i in range(1, 6)]

    resp, data = post_rotation(client, players)

    assert resp.status_code == 200
    payload = data["data"]
    assert payload["lineup_summary"]["total_lineups"] == 1
    assert payload["theoretical_best_starting_rating"] == payload["star_rating"]
    assert payload["theoretical_best_starting_breakdown"] == payload["star_rating_breakdown"]
    assert len(payload["lineup_combinations"]) == 1
    assert payload["lineup_combinations"][0]["rank"] == 1
    assert payload["lineup_combinations"][0]["is_starting_lineup"] is True
    assert payload["lineup_combinations"][0]["archetype_labels"]
    assert payload["lineup_combinations"][0]["archetype_details"]
    assert payload["starting_lineup"]["cohesion_score"] == payload["lineup_combinations"][0]["cohesion_score"]
    assert len(payload["player_composites"]) == 5
    assert payload["team_description"] is None


def test_rotation_endpoint_with_six_players_returns_ranked_combinations(client):
    players = [balanced_player(f"P{i}", i) for i in range(1, 7)]

    resp, data = post_rotation(client, players)

    assert resp.status_code == 200
    payload = data["data"]
    combinations = payload["lineup_combinations"]
    scores = [lineup["cohesion_score"] for lineup in combinations]

    assert payload["lineup_summary"]["total_lineups"] == comb(6, 5)
    assert len(combinations) == comb(6, 5)
    assert scores == sorted(scores, reverse=True)
    assert payload["theoretical_best_starting_rating"] >= payload["star_rating"]
    assert payload["theoretical_best_starting_breakdown"]["starting_5"] >= payload["star_rating_breakdown"]["starting_5"]
    assert payload["theoretical_best_starting_breakdown"]["depth"] == payload["star_rating_breakdown"]["depth"]
    assert [lineup["rank"] for lineup in combinations] == list(range(1, len(combinations) + 1))
    assert sum(1 for lineup in combinations if lineup["is_starting_lineup"]) == 1
    assert set(payload["star_rating_breakdown"]) == {
        "starting_5",
        "depth",
        "archetype_diversity",
        "floor",
    }
