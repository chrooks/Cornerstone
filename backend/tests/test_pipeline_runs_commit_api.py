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
    """GET /api/pipeline-runs/<id>/diff returns the live diff for an uncommitted run."""
    diff_payload = {
        "run_id": "run-diff",
        "summary": {
            "per_skill": {"Scorer": {"promotions": 1, "demotions": 0, "new": 0, "unchanged": 0}},
            "total_changed": 1,
        },
        "changes": [],
    }

    with patch("services.pipeline_runs.repo.get_run", return_value=_mock_run("run-diff")):
        with patch("services.pipeline_run_results.repo.get_diff", return_value=diff_payload):
            resp = admin_client.get("/api/pipeline-runs/run-diff/diff", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["run_id"] == "run-diff"


def test_get_pipeline_run_diff_returns_persisted_diff_for_committed_run(admin_client):
    """A committed run returns its persisted committed_diff snapshot, NOT a live recompute.

    After commit the staged rows are deleted, so a live recompute is empty. The
    persisted snapshot is what lets the committed run still show what it changed.
    """
    persisted = {
        "run_id": "run-committed",
        "summary": {
            "per_skill": {"rebounder": {"promotions": 1, "demotions": 0, "new": 0, "unchanged": 0}},
            "total_changed": 1,
        },
        "changes": [],
    }
    committed_run = _mock_run("run-committed", committed_at="2026-06-12T16:23:53Z")
    committed_run["committed_diff"] = persisted

    with patch("services.pipeline_runs.repo.get_run", return_value=committed_run):
        # If the handler wrongly recomputed live, this empty diff would surface instead.
        with patch(
            "services.pipeline_run_results.repo.get_diff",
            return_value={"run_id": "run-committed", "summary": {"per_skill": {}, "total_changed": 0}, "changes": []},
        ) as mock_live:
            resp = admin_client.get("/api/pipeline-runs/run-committed/diff", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["summary"]["total_changed"] == 1
    mock_live.assert_not_called()


def test_get_pipeline_run_diff_serves_empty_but_present_snapshot(admin_client):
    """A committed run whose snapshot staged zero changes serves that empty snapshot.

    The gate is `is not None`, not truthiness — an empty-but-present RunDiff is a
    real snapshot (the run genuinely changed nothing), not an absent one, so it
    must NOT fall through to a live recompute.
    """
    empty_snapshot = {
        "run_id": "run-zero",
        "summary": {"per_skill": {}, "total_changed": 0},
        "changes": [],
    }
    committed_run = _mock_run("run-zero", committed_at="2026-06-12T16:23:53Z")
    committed_run["committed_diff"] = empty_snapshot

    with patch("services.pipeline_runs.repo.get_run", return_value=committed_run):
        with patch("services.pipeline_run_results.repo.get_diff") as mock_live:
            resp = admin_client.get("/api/pipeline-runs/run-zero/diff", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["data"]["summary"]["total_changed"] == 0
    mock_live.assert_not_called()


def test_get_pipeline_run_diff_falls_back_to_live_for_legacy_committed_run(admin_client):
    """A committed run with NO persisted diff (pre-migration) falls back to the live recompute."""
    legacy_run = _mock_run("run-legacy", committed_at="2026-01-01T00:00:00Z")
    legacy_run["committed_diff"] = None
    live_empty = {"run_id": "run-legacy", "summary": {"per_skill": {}, "total_changed": 0}, "changes": []}

    with patch("services.pipeline_runs.repo.get_run", return_value=legacy_run):
        with patch("services.pipeline_run_results.repo.get_diff", return_value=live_empty) as mock_live:
            resp = admin_client.get("/api/pipeline-runs/run-legacy/diff", headers=AUTH)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["data"]["summary"]["total_changed"] == 0
    mock_live.assert_called_once_with("run-legacy")


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


# ---------------------------------------------------------------------------
# Slice 2: status='success' guard — commit RPC rejects non-success runs
# ---------------------------------------------------------------------------


def test_commit_rpc_rejects_run_not_in_success_state(admin_client):
    """POST /commit returns 409 run_not_in_success_state when RPC rejects a running run.

    Migration 20260527000009 adds a status='success' guard inside the RPC.
    A run with status='running' must raise a Postgres exception whose message
    contains 'run_not_in_success_state'. The route must translate this to 409,
    not 500, so the frontend can surface a clear error.
    """
    running_run = _mock_run("run-still-running", status="running")

    with patch("services.pipeline_runs.repo.get_run", return_value=running_run):
        with patch(
            "services.pipeline_run_results.commit.commit_run",
            side_effect=Exception(
                "{'message': 'run_not_in_success_state: run run-still-running has status=running', "
                "'code': 'P0001', 'hint': None, 'details': None}"
            ),
        ):
            resp = admin_client.post(
                "/api/pipeline-runs/run-still-running/commit", headers=AUTH
            )

    assert resp.status_code == 409, (
        f"Expected 409 for run_not_in_success_state, got {resp.status_code}: "
        f"{resp.get_json()}"
    )
    body = resp.get_json()
    assert body["success"] is False
    assert "run_not_in_success_state" in body["error"]


def test_commit_rpc_rejects_discarded_run(admin_client):
    """POST /commit returns 409 run_not_in_success_state when RPC rejects a discarded run.

    A discarded run also fails the status='success' guard in the RPC. The route
    translates the Postgres error to a 409 with the same error code.
    """
    discarded_run = _mock_run("run-discarded", status="discarded")

    with patch("services.pipeline_runs.repo.get_run", return_value=discarded_run):
        with patch(
            "services.pipeline_run_results.commit.commit_run",
            side_effect=Exception(
                "{'message': 'run_not_in_success_state: run run-discarded has status=discarded', "
                "'code': 'P0001', 'hint': None, 'details': None}"
            ),
        ):
            resp = admin_client.post(
                "/api/pipeline-runs/run-discarded/commit", headers=AUTH
            )

    assert resp.status_code == 409, (
        f"Expected 409 for run_not_in_success_state on discarded run, got {resp.status_code}: "
        f"{resp.get_json()}"
    )
    body = resp.get_json()
    assert body["success"] is False
    assert "run_not_in_success_state" in body["error"]
