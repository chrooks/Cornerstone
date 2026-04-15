"""
tests/test_builder_api.py — Integration tests for POST /api/builder/evaluate.

Uses Flask test client. No Supabase — endpoint is pure computation.

Test shapes:
  - Valid body returns 200 + RosterEvaluation JSON
  - Missing/invalid fields return 400
  - live mode caps notes at 7
  - final mode returns strength notes
  - debug=True populates traces in response
  - debug=False omits traces
"""

import json
import pytest
from app import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

def minimal_player(name: str) -> dict:
    return {"name": name, "height": None, "skills": {}}


def elite_player(name: str) -> dict:
    return {
        "name": name,
        "height": "6-7",
        "skills": {
            "off_dribble_shooter": "Elite",
            "spot_up_shooter":     "Elite",
            "movement_shooter":    "Elite",
            "passer":              "Elite",
            "perimeter_disruptor": "Elite",
            "versatile_defender":  "Elite",
            "rim_protector":       "Elite",
            "driver":              "Elite",
            "pnr_ball_handler":    "Elite",
            "pnr_finisher":        "Elite",
            "screen_setter":       "Elite",
            "cutter":              "Elite",
            "vertical_spacer":     "Elite",
            "rebounder":           "Elite",
            "isolation_scorer":    "Elite",
            "transition_threat":   "Elite",
        },
    }


def post_evaluate(client, body: dict) -> tuple:
    resp = client.post(
        "/api/builder/evaluate",
        data=json.dumps(body),
        content_type="application/json",
    )
    return resp, resp.get_json()


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------

class TestEvaluateEndpointSuccess:
    def test_returns_200_with_valid_body(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
            "mode":    "live",
            "debug":   False,
        })
        assert resp.status_code == 200
        assert data["success"] is True

    def test_response_has_notes_list(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
            "mode":    "live",
            "debug":   False,
        })
        assert "notes" in data["data"]
        assert isinstance(data["data"]["notes"], list)

    def test_each_note_has_required_fields(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
            "mode":    "live",
            "debug":   False,
        })
        for note in data["data"]["notes"]:
            assert "severity" in note
            assert "category" in note
            assert "text" in note
            assert "trace_key" in note

    def test_debug_false_omits_traces(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
            "mode":    "live",
            "debug":   False,
        })
        assert data["data"]["player_traces"] is None
        assert data["data"]["aggregate_traces"] is None

    def test_debug_true_populates_traces(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
            "mode":    "live",
            "debug":   True,
        })
        assert data["data"]["player_traces"] is not None
        assert data["data"]["aggregate_traces"] is not None

    def test_empty_players_list_is_valid(self, client):
        resp, data = post_evaluate(client, {
            "players": [],
            "mode":    "live",
            "debug":   False,
        })
        assert resp.status_code == 200

    def test_mode_defaults_to_live_when_omitted(self, client):
        resp, data = post_evaluate(client, {
            "players": [minimal_player("Alice")],
        })
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# live mode behaviour
# ---------------------------------------------------------------------------

class TestLiveModeEndpoint:
    def test_live_mode_caps_notes_at_7(self, client):
        roster = [minimal_player(f"P{i}") for i in range(8)]
        resp, data = post_evaluate(client, {
            "players": roster,
            "mode":    "live",
            "debug":   False,
        })
        assert resp.status_code == 200
        assert len(data["data"]["notes"]) <= 7

    def test_live_mode_no_strength_notes(self, client):
        roster = [elite_player(f"P{i}") for i in range(5)]
        resp, data = post_evaluate(client, {
            "players": roster,
            "mode":    "live",
            "debug":   False,
        })
        for note in data["data"]["notes"]:
            assert note["severity"] != "strength"


# ---------------------------------------------------------------------------
# final mode behaviour
# ---------------------------------------------------------------------------

class TestFinalModeEndpoint:
    def test_final_mode_returns_strength_notes_for_strong_roster(self, client):
        roster = [elite_player(f"P{i}") for i in range(5)]
        resp, data = post_evaluate(client, {
            "players": roster,
            "mode":    "final",
            "debug":   False,
        })
        severities = [n["severity"] for n in data["data"]["notes"]]
        assert "strength" in severities

    def test_final_mode_notes_not_capped_at_7(self, client):
        roster = [minimal_player(f"P{i}") for i in range(8)]
        resp_live, data_live = post_evaluate(client, {
            "players": roster, "mode": "live", "debug": False,
        })
        resp_final, data_final = post_evaluate(client, {
            "players": roster, "mode": "final", "debug": False,
        })
        assert len(data_final["data"]["notes"]) >= len(data_live["data"]["notes"])


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

class TestEvaluateEndpointValidation:
    def test_missing_players_field_returns_400(self, client):
        resp, data = post_evaluate(client, {"mode": "live"})
        assert resp.status_code == 400

    def test_players_not_a_list_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": "not-a-list",
            "mode":    "live",
        })
        assert resp.status_code == 400

    def test_invalid_mode_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [],
            "mode":    "turbo",
        })
        assert resp.status_code == 400

    def test_player_missing_name_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"height": "6-2", "skills": {}}],
            "mode":    "live",
        })
        assert resp.status_code == 400

    def test_player_skills_not_dict_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "skills": "bad"}],
            "mode":    "live",
        })
        assert resp.status_code == 400

    def test_too_many_players_returns_400(self, client):
        roster = [minimal_player(f"P{i}") for i in range(21)]
        resp, data = post_evaluate(client, {"players": roster, "mode": "live"})
        assert resp.status_code == 400

    def test_player_name_too_long_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "A" * 101, "skills": {}}],
            "mode":    "live",
        })
        assert resp.status_code == 400

    def test_too_many_skills_returns_400(self, client):
        skills = {f"skill_{i}": "Capable" for i in range(31)}
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "skills": skills}],
            "mode":    "live",
        })
        assert resp.status_code == 400

    def test_non_boolean_debug_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [],
            "mode":    "live",
            "debug":   1,
        })
        assert resp.status_code == 400
