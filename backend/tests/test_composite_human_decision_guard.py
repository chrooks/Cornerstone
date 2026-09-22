"""
test_composite_human_decision_guard.py — M2.19 guard on the whole-profile
Claude endpoints.

POST /api/players/<id>/composite-profile and POST /api/composite/batch both
REPLACE a player's composite profile. When the existing draft composite already
holds a human's call — a flag adjudicated in /admin/review (source="resolved")
or an admin's direct tier (source="manual_override") — that replace would erase
it. Both routes refuse with 409 "human_decisions_present" unless ?force=true.

Entries the composite itself produced ("auto_accepted", "flagged") are not human
decisions and must not block the route.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app import create_app
from services.snapshot_versions.repo import SnapshotRelease


SEASON = "2025-26"
PID = "11111111-2222-3333-4444-555555555555"
PID_B = "66666666-7777-8888-9999-000000000000"
AUTH = {"Authorization": "Bearer fake-admin-token"}
_RUN_ID = "aaaaaaaa-1111-1111-1111-000000000001"

_DRAFT = SnapshotRelease(
    id="draft-composite-guard-uuid",
    label="draft-test",
    season=SEASON,
    status="draft",
    is_active=False,
    published_at=None,
    created_at="2026-01-01T00:00:00Z",
)

_STAT_PROFILE = {"scorer": {"tier": "Elite"}}


def _composite_row(player_id: str, source: str) -> dict:
    """A draft composite row whose rim_protector entry carries `source`."""
    return {
        "player_id": player_id,
        "season": SEASON,
        "source": "composite",
        "profile": {
            "scorer": {"final_tier": "Elite", "source": "auto_accepted"},
            "rim_protector": {"final_tier": "Proficient", "source": source},
        },
    }


def _stats_row(player_id: str) -> dict:
    return {
        "player_id": player_id,
        "season": SEASON,
        "source": "stats",
        "profile": _STAT_PROFILE,
    }


# ---------------------------------------------------------------------------
# A fake Supabase client — enough of the PostgREST builder for these routes
# ---------------------------------------------------------------------------


class _FakeTable:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._eq: dict = {}
        self._in: tuple | None = None

    def select(self, *_a, **_kw):
        return self

    def limit(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def gte(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def in_(self, col, vals):
        self._in = (col, list(vals))
        return self

    def execute(self):
        rows = [r for r in self._rows if all(r.get(k) == v for k, v in self._eq.items())]
        if self._in is not None:
            col, vals = self._in
            rows = [r for r in rows if r.get(col) in vals]
        return SimpleNamespace(data=rows)


class _FakeClient:
    def __init__(self, rows_by_table: dict[str, list[dict]]):
        self.rows_by_table = rows_by_table

    def table(self, name: str):
        return _FakeTable(self.rows_by_table.get(name, []))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin"})
    role_result = MagicMock()
    role_result.data = {"role": "admin"}
    client = MagicMock()
    (
        client.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = role_result
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: client)
    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", lambda *a, **kw: _DRAFT)


@pytest.fixture()
def app_client(monkeypatch):
    _bypass_admin_auth(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def persist_spy(monkeypatch):
    """Patch every collaborator the routes need and hand back the persist spy."""
    import api.composite as composite_mod

    spy = MagicMock(return_value={"composite_profile_id": "cid"})
    monkeypatch.setattr(composite_mod, "persist_profiles", spy)
    monkeypatch.setattr(composite_mod, "get_notability_score", lambda *a, **kw: 50)
    monkeypatch.setattr(
        composite_mod,
        "get_claude_assessment",
        lambda *a, **kw: {"skills": {}, "claude_failed": False,
                          "input_tokens": 1, "output_tokens": 1},
    )
    monkeypatch.setattr(composite_mod, "composite_profile", lambda *a, **kw: {})
    monkeypatch.setattr(composite_mod.runs_repo, "start_run", lambda *a, **kw: _RUN_ID)
    monkeypatch.setattr(composite_mod.runs_repo, "complete_run", lambda *a, **kw: None)
    monkeypatch.setattr(
        composite_mod.skill_engine, "get_thresholds", lambda *a, **kw: {}
    )
    monkeypatch.setattr(
        composite_mod.skill_engine, "get_league_averages", lambda *a, **kw: {}
    )
    monkeypatch.setattr(
        composite_mod.skill_engine, "evaluate_all_skills", lambda *a, **kw: _STAT_PROFILE
    )
    monkeypatch.setattr(
        composite_mod.skill_engine, "apply_auto_promotions", lambda s, *a, **kw: s
    )
    return spy


def _install_client(monkeypatch, profile_rows: list[dict], stats_rows: list[dict] | None = None):
    import api.composite as composite_mod

    client = _FakeClient({
        "draft_skill_profiles": profile_rows,
        "player_stats": stats_rows or [],
    })
    monkeypatch.setattr(composite_mod, "get_supabase", lambda: client)
    return client


def _player_stats_row(player_id: str) -> dict:
    return {"player_id": player_id, "season": SEASON, "stats": {"box_score": {"pts": 20}}}


# ---------------------------------------------------------------------------
# POST /api/players/<id>/composite-profile
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("human_source", ["resolved", "manual_override"])
def test_composite_profile_409_when_human_decision_present(
    monkeypatch, app_client, persist_spy, human_source
):
    """One resolved / manual_override entry refuses the whole-profile persist."""
    _install_client(
        monkeypatch,
        [_composite_row(PID, human_source), _stats_row(PID)],
    )

    resp = app_client.post(f"/api/players/{PID}/composite-profile", headers=AUTH, json={})

    assert resp.status_code == 409
    assert resp.get_json()["error"] == "human_decisions_present"
    persist_spy.assert_not_called()


def test_composite_profile_proceeds_when_only_engine_sources(
    monkeypatch, app_client, persist_spy
):
    """auto_accepted / flagged are the engine's own output, not a human's call."""
    _install_client(
        monkeypatch,
        [_composite_row(PID, "auto_accepted"), _stats_row(PID)],
    )

    resp = app_client.post(f"/api/players/{PID}/composite-profile", headers=AUTH, json={})

    assert resp.status_code == 200
    persist_spy.assert_called_once()


def test_composite_profile_force_true_bypasses_the_guard(
    monkeypatch, app_client, persist_spy
):
    _install_client(
        monkeypatch,
        [_composite_row(PID, "resolved"), _stats_row(PID)],
    )

    resp = app_client.post(
        f"/api/players/{PID}/composite-profile?force=true", headers=AUTH, json={}
    )

    assert resp.status_code == 200
    persist_spy.assert_called_once()


# ---------------------------------------------------------------------------
# POST /api/composite/batch
# ---------------------------------------------------------------------------


def test_composite_batch_409_when_any_player_holds_a_human_decision(
    monkeypatch, app_client, persist_spy
):
    """One human decision anywhere in the batch refuses the whole request."""
    _install_client(
        monkeypatch,
        [_composite_row(PID, "auto_accepted"), _composite_row(PID_B, "manual_override")],
        [_player_stats_row(PID), _player_stats_row(PID_B)],
    )

    resp = app_client.post(
        "/api/composite/batch", headers=AUTH, json={"player_ids": [PID, PID_B]}
    )

    assert resp.status_code == 409
    assert resp.get_json()["error"] == "human_decisions_present"
    persist_spy.assert_not_called()


def test_composite_batch_proceeds_when_no_human_decisions(
    monkeypatch, app_client, persist_spy
):
    _install_client(
        monkeypatch,
        [_composite_row(PID, "auto_accepted")],
        [_player_stats_row(PID)],
    )

    resp = app_client.post("/api/composite/batch", headers=AUTH, json={"player_ids": [PID]})

    assert resp.status_code == 200
    persist_spy.assert_called_once()


def test_composite_batch_force_true_bypasses_the_guard(
    monkeypatch, app_client, persist_spy
):
    _install_client(
        monkeypatch,
        [_composite_row(PID, "resolved")],
        [_player_stats_row(PID)],
    )

    resp = app_client.post(
        "/api/composite/batch?force=true", headers=AUTH, json={"player_ids": [PID]}
    )

    assert resp.status_code == 200
    persist_spy.assert_called_once()
