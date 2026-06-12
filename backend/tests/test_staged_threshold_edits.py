"""
test_staged_threshold_edits.py

Powers the authoritative "Staged" pending-commit badge: which skills have an
uncommitted threshold_edit run in the open draft. Deriving the badge from this
(rather than session-only state) means it clears once the run is committed or
discarded — the badge's source of truth is the actual pending run set.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.pipeline_runs import repo as runs_repo


def _client_returning(rows):
    """Mock client whose pipeline_runs query chain resolves to `rows`."""
    client = MagicMock()
    (
        client.table.return_value
        .select.return_value
        .eq.return_value          # snapshot_release_id
        .eq.return_value          # pipeline_name
        .eq.return_value          # status = success
        .is_.return_value         # committed_at IS NULL
        .execute.return_value
    ) = MagicMock(data=rows)
    return client


def test_staged_threshold_edits_maps_skill_to_run_id():
    """Pending threshold_edit runs map params.skill_name -> run id."""
    rows = [
        {"id": "run-1", "params": {"skill_name": "rebounder", "thresholds": {}}},
        {"id": "run-2", "params": {"skill_name": "cutter", "thresholds": {}}},
    ]
    client = _client_returning(rows)

    out = runs_repo.staged_threshold_edits("draft-1", client=client)

    assert out == {"rebounder": "run-1", "cutter": "run-2"}


def test_staged_threshold_edits_empty_when_none_pending():
    """No pending runs → empty map."""
    client = _client_returning([])
    assert runs_repo.staged_threshold_edits("draft-1", client=client) == {}


def test_staged_threshold_edits_skips_rows_without_skill_name():
    """A malformed run (no params.skill_name) is skipped, not crashed on."""
    rows = [
        {"id": "run-1", "params": {"skill_name": "rebounder"}},
        {"id": "run-2", "params": {}},
        {"id": "run-3", "params": None},
    ]
    client = _client_returning(rows)
    assert runs_repo.staged_threshold_edits("draft-1", client=client) == {"rebounder": "run-1"}


def test_staged_threshold_edits_none_draft_returns_empty():
    """No open draft → empty map, no query."""
    client = MagicMock()
    assert runs_repo.staged_threshold_edits(None, client=client) == {}
    client.table.assert_not_called()


# ---------------------------------------------------------------------------
# Endpoint: GET /api/skills/thresholds/staged-edits
# ---------------------------------------------------------------------------


def _admin_client(monkeypatch):
    import api.auth as auth_mod
    from app import create_app

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "admin"})
    role = MagicMock()
    role.data = {"role": "admin"}
    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value
        .maybe_single.return_value.execute.return_value
    ) = role
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: client)
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


_AUTH = {"Authorization": "Bearer fake"}


def test_endpoint_returns_map_for_open_draft(monkeypatch):
    c = _admin_client(monkeypatch)
    draft = MagicMock()
    draft.id = "draft-1"
    with patch("services.snapshot_versions.repo.get_draft", return_value=draft), \
         patch("services.pipeline_runs.repo.staged_threshold_edits",
               return_value={"rebounder": "run-1"}):
        resp = c.get("/api/skills/thresholds/staged-edits", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.get_json()["data"] == {"rebounder": "run-1"}


def test_endpoint_returns_empty_when_no_draft(monkeypatch):
    c = _admin_client(monkeypatch)
    with patch("services.snapshot_versions.repo.get_draft", return_value=None):
        resp = c.get("/api/skills/thresholds/staged-edits", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.get_json()["data"] == {}
