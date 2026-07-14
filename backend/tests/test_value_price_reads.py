"""Integration test for #109 ac1 — value_price served alongside salary.

Proves the read paths (bulk actives, profile) carry `value_price` next to the
existing `salary`, and that salary is unchanged so existing consumers are
unaffected. Fully mocked — no live Supabase. The ladder is injected via the
value_ladder_cache test hook so the read does not rebuild from the DB.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app
from services.cohesion_engine.value_price import ValueLadder
from services.snapshot_versions import value_ladder_cache

ACTIVE_RELEASE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
SEASON = "2025-26"
REAL_SALARY = 10_000_000
VALUE_PRICE = 42_500_000

RELEASED_PROFILE = {"Scorer": {"final_tier": "Elite"}}


class _FakeResult:
    def __init__(self, data):
        self.data = data


def _player_row() -> dict:
    return {
        "id": PLAYER_ID, "name": "Test Player", "team": "LAL", "position": "SF",
        "age": 28, "games_played": 70, "minutes_per_game": 34.0,
        "salary": REAL_SALARY, "height": 79, "weight": 220, "season": SEASON,
        "nba_api_id": 1234567, "manually_included": False,
        "draft_round": 2, "season_exp": 5,
    }


def _make_supabase() -> MagicMock:
    supabase = MagicMock()

    def table_side_effect(name: str):
        q = MagicMock()
        for m in ("select", "eq", "in_", "or_", "order", "limit", "single", "range"):
            getattr(q, m).return_value = q
        if name == "players":
            q.execute.return_value = _FakeResult([_player_row()])
        elif name == "released_players":
            q.execute.return_value = _FakeResult(
                [{"source_player_id": PLAYER_ID, "skill_profile_snapshot": RELEASED_PROFILE}]
            )
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


@pytest.fixture(autouse=True)
def _inject_ladder(app):
    """Pin a known ladder for the read, then restore the empty state.

    Depends on `app` so it runs AFTER create_app's boot warm — otherwise the
    warm would clobber the injected ladder.
    """
    value_ladder_cache.set_ladder(
        ValueLadder(active_prices={PLAYER_ID: VALUE_PRICE}, legend_prices={}),
        key=(SEASON, ACTIVE_RELEASE_ID),
    )
    yield
    value_ladder_cache.force_clear_ladder()


def test_bulk_serves_value_price_next_to_salary(app):
    supabase = _make_supabase()
    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        # Freeze the ladder to the injected one — no rebuild from the mock DB.
        patch("api.players.ensure_ladder", return_value=True),
    ):
        with app.test_client() as client:
            resp = client.get("/api/players/bulk", query_string={"season": SEASON})

    assert resp.status_code == 200, resp.get_json()
    player = resp.get_json()["data"][0]
    # salary is untouched (existing consumers unaffected) ...
    assert player["salary"] == REAL_SALARY
    # ... and value_price rides alongside it.
    assert player["value_price"] == VALUE_PRICE


def test_profile_serves_value_price_next_to_salary(app):
    supabase = _make_supabase()
    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        patch("api.players.ensure_ladder", return_value=True),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{PLAYER_ID}/profile", query_string={"season": SEASON}
            )

    assert resp.status_code == 200, resp.get_json()
    player = resp.get_json()["data"]["player"]
    assert player["salary"] == REAL_SALARY
    assert player["value_price"] == VALUE_PRICE


def test_value_price_is_none_when_player_not_on_the_ladder(app):
    """A player with no ladder rank still reads fine — value_price is just None."""
    value_ladder_cache.set_ladder(
        ValueLadder(active_prices={}, legend_prices={}), key=(SEASON, ACTIVE_RELEASE_ID)
    )
    supabase = _make_supabase()
    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
        patch("api.players.ensure_ladder", return_value=True),
    ):
        with app.test_client() as client:
            resp = client.get("/api/players/bulk", query_string={"season": SEASON})

    assert resp.status_code == 200, resp.get_json()
    player = resp.get_json()["data"][0]
    assert player["salary"] == REAL_SALARY
    assert player["value_price"] is None
