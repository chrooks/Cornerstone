"""
test_players_release_integrity.py — Issue #64.

A Player present in `players` but missing from the active released_players must
NOT fail silently: the 200 + skills: null Contract is kept, but the response
carries release_integrity.missing_from_release and a WARN log containing
"missing_from_release" is emitted.

All tests use the Flask test client with patched DB dependencies — no live DB.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from app import create_app
from services.cohesion_engine import roster as roster_mod

ACTIVE_RELEASE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
RELEASED_PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
MISSING_PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000002"
SEASON = "2025-26"

RELEASED_PROFILE = {
    "Scorer": {"final_tier": "Elite", "stat_tier": "Elite", "claude_tier": "Elite"},
}


class _FakeResult:
    def __init__(self, data):
        self.data = data


def _player_row(player_id: str, name: str) -> dict:
    return {
        "id": player_id,
        "name": name,
        "team": "LAL",
        "position": "SF",
        "age": 28,
        "games_played": 70,
        "minutes_per_game": 34.0,
        "salary": 10_000_000,
        "height": 79,
        "weight": 220,
        "season": SEASON,
        "nba_api_id": 1234567,
        "manually_included": False,
        "draft_round": 2,
        "season_exp": 5,
    }


def _make_supabase(players_rows: list[dict], released_rows: list[dict]) -> MagicMock:
    """Mock Supabase: `players` returns players_rows, `released_players`
    returns released_rows; everything else is empty."""
    supabase = MagicMock()

    def table_side_effect(name: str):
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.in_.return_value = q
        q.or_.return_value = q
        q.order.return_value = q
        q.limit.return_value = q
        q.single.return_value = q

        if name == "players":
            q.execute.return_value = _FakeResult(players_rows)
        elif name == "released_players":
            q.execute.return_value = _FakeResult(released_rows)
        else:
            q.execute.return_value = _FakeResult([])

        return q

    supabase.table.side_effect = table_side_effect
    return supabase


@pytest.fixture()
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


# ---------------------------------------------------------------------------
# GET /api/players/<id>/profile
# ---------------------------------------------------------------------------


def test_profile_missing_from_release_flags_and_warns(app, caplog):
    """Player exists but has no released_players row: 200 with skills: null,
    release_integrity.missing_from_release: true, and a WARN log."""
    supabase = _make_supabase(
        players_rows=[_player_row(MISSING_PLAYER_ID, "Missing Player")],
        released_rows=[],
    )

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        caplog.at_level(logging.WARNING, logger="api.players"),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{MISSING_PLAYER_ID}/profile",
                query_string={"season": SEASON},
            )

    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["skills"] is None
    assert body["data"]["release_integrity"] == {"missing_from_release": True}
    assert any("missing_from_release" in record.getMessage() for record in caplog.records)


def test_profile_present_in_release_has_no_integrity_flag(app, caplog):
    """Player with a released row: skills populated, no release_integrity key,
    no missing_from_release warning."""
    supabase = _make_supabase(
        players_rows=[_player_row(RELEASED_PLAYER_ID, "Released Player")],
        released_rows=[{
            "source_player_id": RELEASED_PLAYER_ID,
            "skill_profile_snapshot": RELEASED_PROFILE,
        }],
    )

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        caplog.at_level(logging.WARNING, logger="api.players"),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{RELEASED_PLAYER_ID}/profile",
                query_string={"season": SEASON},
            )

    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["data"]["skills"] is not None
    assert "release_integrity" not in body["data"]
    assert not any("missing_from_release" in record.getMessage() for record in caplog.records)


# ---------------------------------------------------------------------------
# GET /api/players/bulk
# ---------------------------------------------------------------------------


def test_bulk_flags_only_players_missing_from_release(app, caplog):
    """Bulk list: the player without a released row carries the integrity flag;
    the released player does not. One WARN log mentions missing_from_release."""
    supabase = _make_supabase(
        players_rows=[
            _player_row(RELEASED_PLAYER_ID, "Released Player"),
            _player_row(MISSING_PLAYER_ID, "Missing Player"),
        ],
        released_rows=[{
            "source_player_id": RELEASED_PLAYER_ID,
            "skill_profile_snapshot": RELEASED_PROFILE,
        }],
    )

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        caplog.at_level(logging.WARNING, logger="api.players"),
    ):
        with app.test_client() as client:
            resp = client.get("/api/players/bulk", query_string={"season": SEASON})

    assert resp.status_code == 200, resp.get_json()
    players = resp.get_json()["data"]
    by_id = {p["id"]: p for p in players}

    released = by_id[RELEASED_PLAYER_ID]
    assert released["skills"] == {"Scorer": "Elite"}
    assert "release_integrity" not in released

    missing = by_id[MISSING_PLAYER_ID]
    assert missing["skills"] is None
    assert missing["release_integrity"] == {"missing_from_release": True}

    warn_messages = [r.getMessage() for r in caplog.records if "missing_from_release" in r.getMessage()]
    assert warn_messages, "expected a missing_from_release WARN log"


# ---------------------------------------------------------------------------
# Cohesion roster Boundary — skills: null must warn, not crash
# ---------------------------------------------------------------------------


def test_normalize_player_skills_warns_and_coerces_none(caplog):
    """A roster payload player with skills: null is coerced to {} on a COPY
    (original dict untouched) and produces a missing_from_release WARN."""
    payload_player = {"name": "Missing Player", "skills": None, "slot": 0}

    with caplog.at_level(logging.WARNING, logger="services.cohesion_engine.roster"):
        normalized = roster_mod._normalize_player_skills([payload_player])

    assert normalized[0]["skills"] == {}
    assert payload_player["skills"] is None  # immutability: original not mutated
    assert any(
        "missing_from_release" in record.getMessage() and "Missing Player" in record.getMessage()
        for record in caplog.records
    )


def test_normalize_player_skills_passes_rated_players_through(caplog):
    """Players with real skills are passed through unchanged and unflagged."""
    payload_player = {"name": "Rated Player", "skills": {"Scorer": "Elite"}, "slot": 0}

    with caplog.at_level(logging.WARNING, logger="services.cohesion_engine.roster"):
        normalized = roster_mod._normalize_player_skills([payload_player])

    assert normalized[0] is payload_player
    assert not any("missing_from_release" in record.getMessage() for record in caplog.records)
