"""
test_pipeline_runs_commit_api.py — Integration tests for pipeline-runs API endpoints.

Tests the HTTP Surface:
  GET  /api/pipeline-runs/<id>          — run metadata
  GET  /api/pipeline-runs/<id>/diff     — staged diff
  POST /api/pipeline-runs/<id>/commit   — commit staged rows
  POST /api/pipeline-runs/<id>/discard  — discard staged rows

Uses Flask test client via create_app(). Bypasses auth with monkeypatch.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app


# ---------------------------------------------------------------------------
# Auth bypass (mirrors pattern from test_snapshot_versions_api.py)
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin-user"})
    mock_role_result = MagicMock()
    mock_role_result.data = {"role": "admin"}
    mock_client = MagicMock()
    (
        mock_client
        .table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = mock_role_result
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: mock_client)


@pytest.fixture()
def admin_client(monkeypatch):
    _bypass_admin_auth(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


AUTH = {"Authorization": "Bearer fake-admin-token"}


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------


def _mock_run(run_id: str, status: str = "success", committed_at=None) -> dict:
    return {
        "id": run_id,
        "pipeline_name": "skill_evaluation",
        "scope": "bulk",
        "status": status,
        "committed_at": committed_at,
        "rows_processed": 10,
        "started_at": "2026-01-01T00:00:00Z",
        "finished_at": "2026-01-01T00:01:00Z",
        "snapshot_release_id": "release-uuid",
    }


# ---------------------------------------------------------------------------
# GET /api/pipeline-runs/<id>
# ---------------------------------------------------------------------------


def test_get_pipeline_run_returns_run_data(admin_client):
    """GET /api/pipeline-runs/<id> returns run metadata."""
    run_data = _mock_run("run-abc")

    with patch("services.pipeline_runs.repo.get_run", return_value=run_data):
        resp = admin_client.get("/api/pipeline-runs/run-abc", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["id"] == "run-abc"
    assert body["data"]["status"] == "success"


def test_get_pipeline_run_404_when_not_found(admin_client):
    """GET /api/pipeline-runs/<id> returns 404 when run does not exist."""
    with patch("services.pipeline_runs.repo.get_run", return_value=None):
        resp = admin_client.get("/api/pipeline-runs/no-such-run", headers=AUTH)

    assert resp.status_code == 404
    body = resp.get_json()
    assert body["success"] is False


# ---------------------------------------------------------------------------
# GET /api/pipeline-runs/<id>/diff
# ---------------------------------------------------------------------------


def test_get_pipeline_run_diff_returns_diff(admin_client):
    """GET /api/pipeline-runs/<id>/diff returns diff payload."""
    diff_payload = {
        "run_id": "run-diff",
        "summary": {
            "per_skill": {"Scorer": {"promotions": 1, "demotions": 0, "new": 0, "unchanged": 0}},
            "total_changed": 1,
        },
        "changes": [],
    }

    with patch("services.pipeline_run_results.repo.get_diff", return_value=diff_payload):
        resp = admin_client.get("/api/pipeline-runs/run-diff/diff", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["run_id"] == "run-diff"


# ---------------------------------------------------------------------------
# POST /api/pipeline-runs/<id>/commit
# ---------------------------------------------------------------------------


def test_commit_pipeline_run_success(admin_client):
    """POST /api/pipeline-runs/<id>/commit calls commit_run and returns committed_at."""
    with patch("services.pipeline_runs.repo.get_run", return_value=_mock_run("run-commit")):
        with patch("services.pipeline_run_results.commit.commit_run") as mock_commit:
            mock_commit.return_value = "2026-01-01T00:05:00Z"
            resp = admin_client.post("/api/pipeline-runs/run-commit/commit", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert "committed_at" in body["data"]
    mock_commit.assert_called_once_with("run-commit")


def test_commit_pipeline_run_404_when_run_not_found(admin_client):
    """POST /api/pipeline-runs/<id>/commit returns 404 when run not found."""
    with patch("services.pipeline_runs.repo.get_run", return_value=None):
        resp = admin_client.post("/api/pipeline-runs/ghost/commit", headers=AUTH)

    assert resp.status_code == 404


def test_commit_pipeline_run_409_when_already_committed(admin_client):
    """POST commit returns 409 if run already has committed_at set."""
    already_committed_run = _mock_run("run-already", committed_at="2026-01-01T00:00:00Z")
    with patch("services.pipeline_runs.repo.get_run", return_value=already_committed_run):
        resp = admin_client.post("/api/pipeline-runs/run-already/commit", headers=AUTH)

    assert resp.status_code == 409
    body = resp.get_json()
    assert "already_committed" in body["error"]


# ---------------------------------------------------------------------------
# POST /api/pipeline-runs/<id>/discard
# ---------------------------------------------------------------------------


def test_discard_pipeline_run_success(admin_client):
    """POST /api/pipeline-runs/<id>/discard calls discard_run and returns 200."""
    with patch("services.pipeline_runs.repo.get_run", return_value=_mock_run("run-discard")):
        with patch("services.pipeline_run_results.commit.discard_run") as mock_discard:
            resp = admin_client.post("/api/pipeline-runs/run-discard/discard", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    mock_discard.assert_called_once_with("run-discard")


def test_discard_pipeline_run_404_when_run_not_found(admin_client):
    """POST /api/pipeline-runs/<id>/discard returns 404 when run not found."""
    with patch("services.pipeline_runs.repo.get_run", return_value=None):
        resp = admin_client.post("/api/pipeline-runs/ghost/discard", headers=AUTH)

    assert resp.status_code == 404


def test_discard_pipeline_run_409_when_already_committed(admin_client):
    """POST discard returns 409 if run already committed (cannot undo commits)."""
    already_committed_run = _mock_run("run-committed", committed_at="2026-01-01T00:00:00Z")
    with patch("services.pipeline_runs.repo.get_run", return_value=already_committed_run):
        resp = admin_client.post("/api/pipeline-runs/run-committed/discard", headers=AUTH)

    assert resp.status_code == 409


def test_discard_errored_run_succeeds(admin_client):
    """Discard of an errored run (cleanup path) must succeed."""
    error_run = _mock_run("run-err", status="error")
    with patch("services.pipeline_runs.repo.get_run", return_value=error_run):
        with patch("services.pipeline_run_results.commit.discard_run") as mock_discard:
            resp = admin_client.post("/api/pipeline-runs/run-err/discard", headers=AUTH)

    assert resp.status_code == 200
    mock_discard.assert_called_once_with("run-err")
