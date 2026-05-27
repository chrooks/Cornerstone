"""
test_lab_read_pin.py — Integration tests asserting that draft edits do NOT
leak to Lab-facing read Surfaces.

Contract under test (M3):
- GET /api/players/<id>/profile reads released_players, not draft_skill_profiles.
- GET /api/players (bulk) reads released_players for composite profiles.
- GET /api/players (legends section) reads released_players for legend profiles.
- flag_summary is always {total: 0, unresolved: 0} on Lab reads (no flag table
  in released_players).
- ActiveReleaseMissingError in snapshots_active → 503 from Lab routes.

All tests use Flask test client with patched DB dependencies — no live DB needed.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch, call
from typing import Any

import pytest
from flask import Flask

from app import create_app


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ACTIVE_RELEASE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
LEGEND_ID = "cccccccc-0000-0000-0000-000000000001"
CANONICAL_PLAYER_ID = "dddddddd-0000-0000-0000-000000000001"
NBA_API_ID = 1234567

RELEASED_PROFILE = {
    "Scorer": {"final_tier": "Elite", "stat_tier": "Elite", "claude_tier": "Elite"},
    "RimProtector": {"final_tier": "None"},
}

DRAFT_MUTATED_PROFILE = {
    "Scorer": {"final_tier": "Capable", "stat_tier": "Capable", "claude_tier": "Capable"},
    "RimProtector": {"final_tier": "None"},
}

RELEASED_LEGEND_PROFILE = {
    "Scorer": "Elite",
    "RimProtector": "Proficient",
}

DRAFT_MUTATED_LEGEND_PROFILE = {
    "Scorer": "Capable",
    "RimProtector": "None",
}

SEASON = "2025-26"


# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, data):
        self.data = data


def _make_supabase_with_released_player(profile: dict) -> MagicMock:
    """Build a mock Supabase client that returns the given profile from released_players
    and an unrelated row from draft_skill_profiles for the same player.
    """
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
            q.execute.return_value = _FakeResult([{
                "id": PLAYER_ID,
                "name": "Test Player",
                "team": "LAL",
                "position": "SF",
                "age": 28,
                "games_played": 70,
                "minutes_per_game": 34.0,
                "salary": 10_000_000,
                "height": 79,
                "weight": 220,
                "season": SEASON,
                "nba_api_id": NBA_API_ID,
                "manually_included": False,
            }])
        elif name == "released_players":
            q.execute.return_value = _FakeResult([{
                "id": "rp-row-001",
                "snapshot_release_id": ACTIVE_RELEASE_ID,
                "canonical_player_id": CANONICAL_PLAYER_ID,
                "source_player_id": PLAYER_ID,
                "skill_profile_snapshot": profile,
                "name": "Test Player",
                "team": "LAL",
                "position": "SF",
                "salary": 10_000_000,
                "stat_season": SEASON,
                "is_legend": False,
            }])
        elif name == "draft_skill_profiles":
            # Draft has a DIFFERENT (mutated) profile — should NOT appear in Lab reads
            q.execute.return_value = _FakeResult([{
                "id": "dsp-row-001",
                "player_id": PLAYER_ID,
                "season": SEASON,
                "source": "composite",
                "profile": DRAFT_MUTATED_PROFILE,
            }])
        elif name == "draft_skill_flags":
            q.execute.return_value = _FakeResult([
                {"id": "flag-001", "resolution": None},
                {"id": "flag-002", "resolution": None},
            ])
        else:
            q.execute.return_value = _FakeResult([])

        return q

    supabase.table.side_effect = table_side_effect
    return supabase


def _make_supabase_with_released_legends(legend_profile: dict) -> MagicMock:
    """Build a mock Supabase client for the legends listing read site."""
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

        if name == "legends":
            q.execute.return_value = _FakeResult([{
                "id": LEGEND_ID,
                "name": "Hakeem Olajuwon",
                "team": None,
                "position": "C",
                "age": None,
                "height": 84,
                "weight": 255,
                "peak_year": 1994,
                "nba_api_id": NBA_API_ID,
            }])
        elif name == "released_players":
            q.execute.return_value = _FakeResult([{
                "id": "rp-legend-001",
                "snapshot_release_id": ACTIVE_RELEASE_ID,
                "canonical_player_id": CANONICAL_PLAYER_ID,
                "source_player_id": None,
                "skill_profile_snapshot": legend_profile,
                "name": "Hakeem Olajuwon",
                "team": None,
                "position": "C",
                "salary": 54_000_000,
                "stat_season": None,
                "is_legend": True,
            }])
        elif name == "canonical_players":
            q.execute.return_value = _FakeResult([{
                "id": CANONICAL_PLAYER_ID,
                "nba_api_id": NBA_API_ID,
            }])
        elif name == "draft_skill_profiles":
            # Draft legend row with mutated profile — must NOT leak
            q.execute.return_value = _FakeResult([{
                "id": "dsp-legend-001",
                "legend_id": LEGEND_ID,
                "is_legend": True,
                "source": "manual",
                "profile": DRAFT_MUTATED_LEGEND_PROFILE,
            }])
        else:
            q.execute.return_value = _FakeResult([])

        return q

    supabase.table.side_effect = table_side_effect
    return supabase


# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------


@pytest.fixture()
def app():
    app = create_app()
    app.config["TESTING"] = True
    return app


# ---------------------------------------------------------------------------
# Tracer bullet: single Player detail does NOT expose draft edits
# ---------------------------------------------------------------------------


def test_draft_edit_does_not_leak_to_lab_player_detail(app):
    """
    Arrange: active release has Scorer=Elite; draft_skill_profiles mutated to Capable.
    Act: GET /api/players/<id>/profile
    Assert: response returns Scorer=Elite (from released_players), NOT Capable (from draft).
    Also assert: flag_summary is {total: 0, unresolved: 0} — no flag table on released path.
    """
    supabase = _make_supabase_with_released_player(RELEASED_PROFILE)

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch(
            "services.snapshots_active.get_active_release_id",
            return_value=ACTIVE_RELEASE_ID,
        ),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{PLAYER_ID}/profile",
                query_string={"season": SEASON},
            )

    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["success"] is True
    skills = body["data"]["skills"]
    scorer = skills.get("Scorer")
    assert scorer is not None, f"Scorer key missing from skills: {skills}"
    # Accept dict shape {"final_tier": ...} or plain string tier
    if isinstance(scorer, dict):
        tier = scorer.get("final_tier")
    else:
        tier = scorer
    assert tier == "Elite", (
        f"Expected Scorer=Elite (released), got {tier!r} — draft leak detected"
    )

    flag_summary = body["data"]["flag_summary"]
    assert flag_summary == {"total": 0, "unresolved": 0}, (
        f"flag_summary should be zero on Lab reads, got {flag_summary}"
    )


# ---------------------------------------------------------------------------
# Bulk players list does NOT expose draft edits
# ---------------------------------------------------------------------------


def test_draft_edit_does_not_leak_to_bulk_players_list(app):
    """
    Arrange: active release has Scorer=Elite; draft_skill_profiles mutated to Capable.
    Act: GET /api/players/bulk (bulk list for the active season)
    Assert: the player's composite profile reflects released tier, not draft tier.
    """
    supabase = MagicMock()

    players_row = {
        "id": PLAYER_ID,
        "name": "Test Player",
        "team": "LAL",
        "position": "SF",
        "age": 28,
        "games_played": 70,
        "minutes_per_game": 34.0,
        "salary": 10_000_000,
        "height": 79,
        "weight": 220,
        "season": SEASON,
        "nba_api_id": NBA_API_ID,
        "manually_included": False,
        "draft_round": None,
        "season_exp": 5,
    }

    released_row = {
        "id": "rp-row-002",
        "snapshot_release_id": ACTIVE_RELEASE_ID,
        "canonical_player_id": CANONICAL_PLAYER_ID,
        "source_player_id": PLAYER_ID,
        "skill_profile_snapshot": RELEASED_PROFILE,
        "name": "Test Player",
        "team": "LAL",
        "position": "SF",
        "salary": 10_000_000,
        "is_legend": False,
    }

    def table_side_effect(name: str):
        q = MagicMock()
        q.select.return_value = q
        q.eq.return_value = q
        q.in_.return_value = q
        q.or_.return_value = q
        q.order.return_value = q
        q.limit.return_value = q

        if name == "players":
            q.execute.return_value = _FakeResult([players_row])
        elif name == "released_players":
            q.execute.return_value = _FakeResult([released_row])
        elif name == "draft_skill_profiles":
            # Should NOT be queried on Lab path after M3
            q.execute.return_value = _FakeResult([{
                "id": "dsp-002",
                "player_id": PLAYER_ID,
                "season": SEASON,
                "source": "composite",
                "profile": DRAFT_MUTATED_PROFILE,
            }])
        elif name == "draft_skill_flags":
            q.execute.return_value = _FakeResult([
                {"id": "flag-001", "resolution": None},
            ])
        else:
            q.execute.return_value = _FakeResult([])

        return q

    supabase.table.side_effect = table_side_effect

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch(
            "services.snapshots_active.get_active_release_id",
            return_value=ACTIVE_RELEASE_ID,
        ),
    ):
        with app.test_client() as client:
            resp = client.get("/api/players/bulk", query_string={"season": SEASON})

    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["success"] is True
    players = body["data"] if isinstance(body["data"], list) else body["data"].get("players", [])
    assert isinstance(players, list)
    assert len(players) >= 1

    player = next((p for p in players if p["id"] == PLAYER_ID), None)
    assert player is not None, f"Expected player {PLAYER_ID} in response"

    skills = player.get("skills")
    assert skills is not None, "skills key missing"
    scorer = skills.get("Scorer")
    if isinstance(scorer, dict):
        tier = scorer.get("final_tier")
    else:
        tier = scorer
    assert tier == "Elite", (
        f"Expected Scorer=Elite (released), got {tier!r} — draft leak detected"
    )


# ---------------------------------------------------------------------------
# Legend listing does NOT expose draft edits
# ---------------------------------------------------------------------------


def test_draft_edit_does_not_leak_to_legends_listing(app):
    """
    Arrange: active release has legend Scorer=Elite; draft_skill_profiles mutated to Capable.
    Act: GET /api/players (legends=true or legends section)
    Assert: legend's skill profile reflects released tier.
    """
    supabase = _make_supabase_with_released_legends(RELEASED_LEGEND_PROFILE)

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch(
            "services.snapshots_active.get_active_release_id",
            return_value=ACTIVE_RELEASE_ID,
        ),
    ):
        with app.test_client() as client:
            resp = client.get("/api/players/bulk", query_string={"include_legends": "true"})

    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["success"] is True
    players = body["data"] if isinstance(body["data"], list) else body["data"].get("players", [])
    assert isinstance(players, list)

    legend = next((p for p in players if p.get("is_legend") is True), None)
    assert legend is not None, f"No legend entry in response: {players}"

    skills = legend.get("skills")
    assert skills is not None
    scorer = skills.get("Scorer")
    if isinstance(scorer, dict):
        tier = scorer.get("final_tier")
    else:
        tier = scorer
    assert tier == "Elite", (
        f"Expected Scorer=Elite (released), got {tier!r} — draft legend leak detected"
    )


# ---------------------------------------------------------------------------
# snapshots_active.get_active_release_id unit tests
# ---------------------------------------------------------------------------


class _FakeRelease:
    def __init__(self, release_id: str):
        self.id = release_id
        self.label = "test"
        self.season = SEASON
        self.status = "published"
        self.is_active = True
        self.published_at = None
        self.created_at = "2026-01-01T00:00:00Z"


def test_get_active_release_id_returns_id_outside_request():
    """Outside a request context, returns the release id from repo."""
    from services.snapshots_active import get_active_release_id

    with patch(
        "services.snapshots_active._query_active_release_id",
        return_value=ACTIVE_RELEASE_ID,
    ):
        result = get_active_release_id()

    assert result == ACTIVE_RELEASE_ID


def test_get_active_release_id_memoizes_within_request(app):
    """Within a request context, repeated calls return cached value without re-querying."""
    from services.snapshots_active import get_active_release_id

    call_count = 0

    def _fake_query(client=None) -> str:
        nonlocal call_count
        call_count += 1
        return ACTIVE_RELEASE_ID

    with patch("services.snapshots_active._query_active_release_id", side_effect=_fake_query):
        with app.test_request_context("/"):
            id1 = get_active_release_id()
            id2 = get_active_release_id()
            id3 = get_active_release_id()

    assert id1 == id2 == id3 == ACTIVE_RELEASE_ID
    assert call_count == 1, f"Expected 1 DB call (memoized), got {call_count}"


def test_get_active_release_id_raises_on_missing_release():
    """Raises ActiveReleaseMissingError when repo raises."""
    from services.snapshots_active import get_active_release_id, ActiveReleaseMissingError

    with patch(
        "services.snapshots_active._query_active_release_id",
        side_effect=ActiveReleaseMissingError("no active release"),
    ):
        with pytest.raises(ActiveReleaseMissingError):
            get_active_release_id()


def test_get_active_release_id_does_not_memoize_outside_request():
    """Outside a request context, every call hits _query_active_release_id."""
    from services.snapshots_active import get_active_release_id

    call_count = 0

    def _fake_query(client=None) -> str:
        nonlocal call_count
        call_count += 1
        return ACTIVE_RELEASE_ID

    with patch("services.snapshots_active._query_active_release_id", side_effect=_fake_query):
        get_active_release_id()
        get_active_release_id()

    assert call_count == 2, f"Expected 2 DB calls (no memoization outside request), got {call_count}"


# ---------------------------------------------------------------------------
# Lab routes return 503 when no active release exists
# ---------------------------------------------------------------------------


def test_player_detail_returns_503_when_no_active_release(app):
    """GET /api/players/<id>/profile returns 503 when ActiveReleaseMissingError raised."""
    from services.snapshots_active import ActiveReleaseMissingError

    supabase = MagicMock()
    q = MagicMock()
    q.select.return_value = q
    q.eq.return_value = q
    q.limit.return_value = q
    q.execute.return_value = _FakeResult([{
        "id": PLAYER_ID,
        "name": "Test Player",
        "team": "LAL",
        "position": "SF",
        "age": 28,
        "games_played": 70,
        "minutes_per_game": 34.0,
        "salary": 10_000_000,
        "height": 79,
        "weight": 220,
        "season": SEASON,
        "nba_api_id": NBA_API_ID,
        "manually_included": False,
    }])
    supabase.table.return_value = q

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch(
            "services.snapshots_active.get_active_release_id",
            side_effect=ActiveReleaseMissingError("no active release"),
        ),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{PLAYER_ID}/profile",
                query_string={"season": SEASON},
            )

    assert resp.status_code == 503
    body = resp.get_json()
    assert body["success"] is False
    assert "no_active_release" in body["error"]
