"""Tests for POST /api/players/exclude-from-snapshot."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "test-admin"})
    role = MagicMock()
    role.data = {"role": "admin"}
    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value
        .maybe_single.return_value.execute.return_value
    ) = role
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: client)


def _bypass_open_draft(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(
        auth_mod.snap_repo, "get_draft",
        lambda *a, **k: MagicMock(id="draft-1"),
    )


@pytest.fixture()
def admin_client(monkeypatch):
    _bypass_admin_auth(monkeypatch)
    _bypass_open_draft(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        c.auth_header = {"Authorization": "Bearer fake"}
        yield c


_PID = "ddc0c97b-782a-4878-8a88-baaf9945baa8"


def test_exclude_updates_players(admin_client, monkeypatch):
    captured = {}
    sb = MagicMock()

    def _update(payload):
        captured["payload"] = payload
        chain = MagicMock()
        chain.in_.return_value.execute.return_value = MagicMock(data=[])
        return chain

    sb.table.return_value.update.side_effect = _update
    monkeypatch.setattr("api.players.get_supabase", lambda: sb)

    resp = admin_client.post(
        "/api/players/exclude-from-snapshot",
        headers=admin_client.auth_header,
        json={"player_ids": [_PID], "excluded": True},
    )
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"] == {"updated": 1, "excluded": True}
    assert captured["payload"] == {"excluded_from_snapshot": True}


def test_exclude_rejects_empty_player_ids(admin_client):
    resp = admin_client.post(
        "/api/players/exclude-from-snapshot",
        headers=admin_client.auth_header,
        json={"player_ids": [], "excluded": True},
    )
    assert resp.status_code == 400


def test_exclude_rejects_non_bool_excluded(admin_client):
    resp = admin_client.post(
        "/api/players/exclude-from-snapshot",
        headers=admin_client.auth_header,
        json={"player_ids": [_PID], "excluded": "yes"},
    )
    assert resp.status_code == 400


def test_exclude_rejects_bad_uuid(admin_client):
    resp = admin_client.post(
        "/api/players/exclude-from-snapshot",
        headers=admin_client.auth_header,
        json={"player_ids": ["not-a-uuid"], "excluded": True},
    )
    assert resp.status_code == 400
