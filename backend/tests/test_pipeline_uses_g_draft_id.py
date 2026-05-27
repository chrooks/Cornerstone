"""
test_pipeline_uses_g_draft_id.py — Asserts that each @require_open_draft-gated
Surface in api/pipeline.py reads the draft id at most once per request (from
flask.g), not via a second DB round-trip through _get_draft_id().

Each test monkeypatches snap_repo.get_draft with a call-counter so we can
assert it was called exactly once (by the decorator) and never a second time
from _get_draft_id inside the route body.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch, call
import pytest
from app import create_app
from services.snapshot_versions.repo import SnapshotRelease


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_DRAFT = SnapshotRelease(
    id="draft-g-test-uuid",
    label="draft-test",
    season="2025-26",
    status="draft",
    is_active=False,
    published_at=None,
    created_at="2026-01-01T00:00:00Z",
)


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin"})
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
def app_client(monkeypatch):
    _bypass_admin_auth(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


AUTH = {"Authorization": "Bearer fake-admin-token"}
_RUN_ID = "aaaaaaaa-1111-1111-1111-000000000001"


def _stub_start_run(monkeypatch, run_id=_RUN_ID):
    """Make runs_repo.start_run return a fixed run_id without hitting the DB."""
    from services.pipeline_runs import repo as runs_repo
    monkeypatch.setattr(runs_repo, "start_run", lambda *a, **kw: run_id)


# ---------------------------------------------------------------------------
# Helper — count calls to snap_repo.get_draft and assert at most 1 per request
# ---------------------------------------------------------------------------


def _assert_get_draft_called_once(monkeypatch, app_client, method, path, body=None):
    """
    Arrange: snap_repo.get_draft is patched with a counting mock that returns _DRAFT.
    Act: send the HTTP request.
    Assert: get_draft was called exactly once (decorator only, not the route body).
    """
    import api.auth as auth_mod

    call_count = {"n": 0}

    def counting_get_draft(client=None):
        call_count["n"] += 1
        return _DRAFT

    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", counting_get_draft)

    resp = getattr(app_client, method.lower())(
        path,
        headers=AUTH,
        json=body,
    )

    # Route may 200 or 500 — we don't care about handler success here,
    # only that get_draft was NOT called more than once.
    assert call_count["n"] == 1, (
        f"{method} {path}: snap_repo.get_draft called {call_count['n']} times, "
        f"expected exactly 1 (decorator only). "
        f"Response status: {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# Case 1: fetch_stats_batch — POST /api/pipeline/fetch-stats
# ---------------------------------------------------------------------------


def test_fetch_stats_batch_calls_get_draft_once(monkeypatch, app_client):
    """fetch_stats_batch must not call _get_draft_id() — read from g.draft_id only."""
    _stub_start_run(monkeypatch)
    # Stub out the background thread target so it doesn't actually run
    import threading
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    _assert_get_draft_called_once(monkeypatch, app_client, "POST", "/api/pipeline/fetch-stats", {})


# ---------------------------------------------------------------------------
# Case 2: salary_scrape_bulk — POST /api/pipeline/salary-scrape
# ---------------------------------------------------------------------------


def test_salary_scrape_bulk_calls_get_draft_once(monkeypatch, app_client):
    """salary_scrape_bulk must not call _get_draft_id()."""
    _stub_start_run(monkeypatch)
    import threading
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    _assert_get_draft_called_once(monkeypatch, app_client, "POST", "/api/pipeline/salary-scrape", {})


# ---------------------------------------------------------------------------
# Case 3: salary_scrape_player — POST /api/pipeline/salary-scrape/<player_id>
# ---------------------------------------------------------------------------


def test_salary_scrape_player_calls_get_draft_once(monkeypatch, app_client):
    """salary_scrape_player must not call _get_draft_id()."""
    _stub_start_run(monkeypatch)
    import threading
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    _assert_get_draft_called_once(
        monkeypatch, app_client,
        "POST", "/api/pipeline/salary-scrape/aaaaaaaa-0000-0000-0000-000000000001"
    )


# ---------------------------------------------------------------------------
# Case 4: bio_team_sync_bulk — POST /api/pipeline/bio-team-sync
# ---------------------------------------------------------------------------


def test_bio_team_sync_bulk_calls_get_draft_once(monkeypatch, app_client):
    """bio_team_sync_bulk must not call _get_draft_id()."""
    _stub_start_run(monkeypatch)
    import threading
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    _assert_get_draft_called_once(monkeypatch, app_client, "POST", "/api/pipeline/bio-team-sync", {})


# ---------------------------------------------------------------------------
# Case 5: bio_team_sync_player — POST /api/pipeline/bio-team-sync/<player_id>
# ---------------------------------------------------------------------------


def test_bio_team_sync_player_calls_get_draft_once(monkeypatch, app_client):
    """bio_team_sync_player must not call _get_draft_id()."""
    _stub_start_run(monkeypatch)
    import threading
    monkeypatch.setattr(threading.Thread, "start", lambda self: None)
    _assert_get_draft_called_once(
        monkeypatch, app_client,
        "POST", "/api/pipeline/bio-team-sync/aaaaaaaa-0000-0000-0000-000000000001"
    )
