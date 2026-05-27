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


def test_commit_pipeline_run_propagates_rpc_error(admin_client):
    """If the commit RPC raises, the route returns 500 — never silently swallow.

    The Python-side fallback was removed; the RPC is the sole Contract for
    commits. An RPC failure must surface, not be masked by a fallback path
    that may not satisfy the same atomicity guarantees.
    """
    with patch("services.pipeline_runs.repo.get_run", return_value=_mock_run("run-explode")):
        with patch(
            "services.pipeline_run_results.commit.commit_run",
            side_effect=RuntimeError("RPC blew up"),
        ):
            resp = admin_client.post(
                "/api/pipeline-runs/run-explode/commit", headers=AUTH
            )

    assert resp.status_code == 500
    body = resp.get_json()
    assert body["success"] is False


def test_commit_pipeline_run_returns_canonical_rpc_timestamp(admin_client):
    """The committed_at returned to the client is the value the RPC produced.

    Read-back consistency: whatever string commit_run returns (sourced from
    the Postgres RPC, never a Python datetime.now()) is what surfaces in the
    response body. No drift between server clock and DB clock.
    """
    canonical = "2026-05-27T12:34:56.789Z"
    with patch("services.pipeline_runs.repo.get_run", return_value=_mock_run("run-canon")):
        with patch(
            "services.pipeline_run_results.commit.commit_run",
            return_value=canonical,
        ):
            resp = admin_client.post(
                "/api/pipeline-runs/run-canon/commit", headers=AUTH
            )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["data"]["committed_at"] == canonical


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


# ---------------------------------------------------------------------------
# Concern 4: duplicate GET /api/pipeline/runs/<id> route removed
# ---------------------------------------------------------------------------


def test_legacy_pipeline_runs_route_removed(admin_client, monkeypatch):
    """GET /api/pipeline/runs/<id> must 404 at the routing layer — route deleted.

    We stub out the Supabase table().select().eq().single().execute() chain so
    the surviving route handler (if any) would return 200. If the route has been
    deleted, Flask returns a 404 with no JSON envelope.
    """
    from flask import current_app
    import api.pipeline as pipeline_mod

    # Stub run_query so any surviving handler sees a "found" run and 200s
    mock_result = MagicMock()
    mock_result.data = _mock_run("aaaaaaaa-0000-0000-0000-000000000001")
    monkeypatch.setattr(pipeline_mod, "run_query", lambda fn: mock_result)

    resp = admin_client.get(
        "/api/pipeline/runs/aaaaaaaa-0000-0000-0000-000000000001",
        headers=AUTH,
    )
    assert resp.status_code == 404, (
        f"Legacy /api/pipeline/runs/<id> route still registered — got {resp.status_code}. "
        "DELETE the route from api/pipeline.py and update frontend getPipelineRun()."
    )
    # Flask routing 404 returns HTML, not our JSON envelope
    body = resp.get_json(silent=True)
    assert body is None or not body.get("success"), (
        "Route handler returned success — the route was NOT deleted."
    )


def test_discard_run_returns_409_for_already_discarded_run(admin_client):
    """POST discard returns 409 run_already_discarded if run is already discarded.

    Discarding twice must be idempotent at the API level (safe for retry UI),
    but the second call should signal the caller clearly rather than silently
    re-issuing a no-op discard against the DB.
    """
    already_discarded_run = _mock_run("run-already-discarded", status="discarded")
    with patch("services.pipeline_runs.repo.get_run", return_value=already_discarded_run):
        resp = admin_client.post("/api/pipeline-runs/run-already-discarded/discard", headers=AUTH)

    assert resp.status_code == 409
    body = resp.get_json()
    assert body["success"] is False
    assert "run_already_discarded" in body["error"]


def test_discard_errored_run_succeeds(admin_client):
    """Discard of an errored run (cleanup path) must succeed."""
    error_run = _mock_run("run-err", status="error")
    with patch("services.pipeline_runs.repo.get_run", return_value=error_run):
        with patch("services.pipeline_run_results.commit.discard_run") as mock_discard:
            resp = admin_client.post("/api/pipeline-runs/run-err/discard", headers=AUTH)

    assert resp.status_code == 200
    mock_discard.assert_called_once_with("run-err")
