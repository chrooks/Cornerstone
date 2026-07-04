"""
Tests for GET /api/players/<player_id>/skill-trace (issue #82).

Public, no-auth endpoint that serves the frozen skill_trace_snapshot for a
non-legend player in the active Snapshot Release. All tests use the Flask
test client with patched DB dependencies — no live DB.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app import create_app

ACTIVE_RELEASE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
LEGEND_ID = "bbbbbbbb-0000-0000-0000-000000000002"

TRACE = {
    "computed": True,
    "skills": {
        "spot_up_shooter": {
            "condition_results": [
                {"section": "elite", "stat": "fg3a", "operator": ">=", "threshold": 4.0,
                 "actual_value": 5.2, "passed": True, "per": None, "stabilized": False,
                 "group_id": 0, "group_logic": "AND", "depth": 0},
            ],
            "override": None,
        },
    },
}


@pytest.fixture()
def app():
    flask_app = create_app()
    flask_app.config["TESTING"] = True
    return flask_app


def test_returns_trace_for_known_player_no_auth_header(app):
    with (
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        patch("api.players.fetch_skill_trace_by_source_player_id", return_value=TRACE),
    ):
        with app.test_client() as client:
            resp = client.get(f"/api/players/{PLAYER_ID}/skill-trace")

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"] == TRACE


def test_404_when_no_trace_for_player_or_legend(app):
    with (
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        patch("api.players.fetch_skill_trace_by_source_player_id", return_value=None),
    ):
        with app.test_client() as client:
            resp = client.get(f"/api/players/{LEGEND_ID}/skill-trace")

    assert resp.status_code == 404
    assert resp.get_json()["success"] is False


def test_invalid_uuid_returns_400(app):
    with app.test_client() as client:
        resp = client.get("/api/players/not-a-uuid/skill-trace")

    assert resp.status_code == 400
