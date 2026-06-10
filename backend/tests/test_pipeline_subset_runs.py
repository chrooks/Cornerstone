"""
test_pipeline_subset_runs.py — #76 subset pipeline Contract.

POST /api/pipeline/salary-scrape and /api/pipeline/bio-team-sync accept an
optional `player_ids` subset, mirroring the fetch-stats Contract:
  - empty/omitted → scope="bulk" (unchanged behavior)
  - subset        → scope="player"; player_id set when exactly one id

Worker tests assert the subset path reuses the per-player logic:
  - salary subset resolves distinct teams and scrapes each once, filtered to
    the selected players only
  - bio/team subset loops run_player_bio_team_sync per player

All DB and network access is mocked — the linked Supabase is PRODUCTION.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app import create_app
from services.snapshot_versions.repo import SnapshotRelease


# ---------------------------------------------------------------------------
# Shared fixtures (same pattern as test_pipeline_uses_g_draft_id.py)
# ---------------------------------------------------------------------------

_DRAFT = SnapshotRelease(
    id="draft-subset-test-uuid",
    label="draft-test",
    season="2025-26",
    status="draft",
    is_active=False,
    published_at=None,
    created_at="2026-01-01T00:00:00Z",
)

AUTH = {"Authorization": "Bearer fake-admin-token"}
_RUN_ID = "bbbbbbbb-2222-2222-2222-000000000001"

_PID_1 = "aaaaaaaa-0000-0000-0000-000000000001"
_PID_2 = "aaaaaaaa-0000-0000-0000-000000000002"
_PID_3 = "aaaaaaaa-0000-0000-0000-000000000003"


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
    import api.auth as auth_mod

    _bypass_admin_auth(monkeypatch)
    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", lambda client=None: _DRAFT)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture()
def start_run_capture(monkeypatch):
    """Capture runs_repo.start_run kwargs without touching the DB."""
    from services.pipeline_runs import repo as runs_repo

    calls: list[dict] = []

    def fake_start_run(name, scope, snapshot_release_id=None, player_id=None, **kw):
        calls.append({
            "name": name,
            "scope": scope,
            "snapshot_release_id": snapshot_release_id,
            "player_id": player_id,
        })
        return _RUN_ID

    monkeypatch.setattr(runs_repo, "start_run", fake_start_run)
    return calls


@pytest.fixture()
def no_thread_start(monkeypatch):
    """Keep background workers from actually running during route tests."""
    import threading

    monkeypatch.setattr(threading.Thread, "start", lambda self: None)


# ---------------------------------------------------------------------------
# Route Contract — POST /api/pipeline/salary-scrape
# ---------------------------------------------------------------------------


def test_salary_scrape_subset_records_player_scope(
    app_client, start_run_capture, no_thread_start
):
    """player_ids subset → 200 with run_id, pipeline_runs scope='player'."""
    resp = app_client.post(
        "/api/pipeline/salary-scrape",
        json={"player_ids": [_PID_1, _PID_2]},
        headers=AUTH,
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert body["data"]["run_id"] == _RUN_ID
    assert start_run_capture == [{
        "name": "salary_scrape",
        "scope": "player",
        "snapshot_release_id": _DRAFT.id,
        "player_id": None,  # >1 id → no single player_id recorded
    }]


def test_salary_scrape_single_id_records_player_id(
    app_client, start_run_capture, no_thread_start
):
    """Exactly one id in the subset → player_id recorded, mirroring fetch-stats."""
    resp = app_client.post(
        "/api/pipeline/salary-scrape",
        json={"player_ids": [_PID_1]},
        headers=AUTH,
    )

    assert resp.status_code == 200
    assert start_run_capture[0]["scope"] == "player"
    assert start_run_capture[0]["player_id"] == _PID_1


def test_salary_scrape_empty_body_stays_bulk(
    app_client, start_run_capture, no_thread_start
):
    """No body / empty player_ids → scope='bulk' (unchanged Contract)."""
    resp = app_client.post("/api/pipeline/salary-scrape", json={}, headers=AUTH)

    assert resp.status_code == 200
    assert start_run_capture[0]["scope"] == "bulk"
    assert start_run_capture[0]["player_id"] is None


def test_salary_scrape_rejects_non_list_player_ids(
    app_client, start_run_capture, no_thread_start
):
    resp = app_client.post(
        "/api/pipeline/salary-scrape",
        json={"player_ids": "not-a-list"},
        headers=AUTH,
    )

    assert resp.status_code == 400
    assert start_run_capture == []


# ---------------------------------------------------------------------------
# Route Contract — POST /api/pipeline/bio-team-sync
# ---------------------------------------------------------------------------


def test_bio_team_sync_subset_records_player_scope(
    app_client, start_run_capture, no_thread_start
):
    resp = app_client.post(
        "/api/pipeline/bio-team-sync",
        json={"player_ids": [_PID_1, _PID_2, _PID_3]},
        headers=AUTH,
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["data"]["run_id"] == _RUN_ID
    assert start_run_capture == [{
        "name": "bio_team_sync",
        "scope": "player",
        "snapshot_release_id": _DRAFT.id,
        "player_id": None,
    }]


def test_bio_team_sync_single_id_records_player_id(
    app_client, start_run_capture, no_thread_start
):
    resp = app_client.post(
        "/api/pipeline/bio-team-sync",
        json={"player_ids": [_PID_2]},
        headers=AUTH,
    )

    assert resp.status_code == 200
    assert start_run_capture[0]["scope"] == "player"
    assert start_run_capture[0]["player_id"] == _PID_2


def test_bio_team_sync_empty_body_stays_bulk(
    app_client, start_run_capture, no_thread_start
):
    resp = app_client.post("/api/pipeline/bio-team-sync", json={}, headers=AUTH)

    assert resp.status_code == 200
    assert start_run_capture[0]["scope"] == "bulk"


def test_bio_team_sync_rejects_non_list_player_ids(
    app_client, start_run_capture, no_thread_start
):
    resp = app_client.post(
        "/api/pipeline/bio-team-sync",
        json={"player_ids": {"bad": "shape"}},
        headers=AUTH,
    )

    assert resp.status_code == 400
    assert start_run_capture == []


# ---------------------------------------------------------------------------
# Worker — _run_salary_scrape_job subset path
# ---------------------------------------------------------------------------


@pytest.fixture()
def runs_repo_capture(monkeypatch):
    """Capture update_progress / complete_run calls without touching the DB."""
    import api.pipeline as pipeline_mod

    captured: dict = {"progress": [], "complete": []}
    monkeypatch.setattr(
        pipeline_mod.runs_repo, "update_progress",
        lambda run_id, processed, total, client=None: captured["progress"].append(
            (processed, total)
        ),
    )
    monkeypatch.setattr(
        pipeline_mod.runs_repo, "complete_run",
        lambda run_id, rows_processed, error=None, client=None: captured["complete"].append(
            {"rows_processed": rows_processed, "error": error}
        ),
    )
    return captured


def test_salary_scrape_worker_scrapes_each_team_once_filtered_to_subset(
    monkeypatch, runs_repo_capture
):
    """Subset spanning two teams → one scrape per team, filtered to the subset ids."""
    import api.pipeline as pipeline_mod

    # Mock the players lookup: three players across two teams
    lookup_result = MagicMock()
    lookup_result.data = [
        {"id": _PID_1, "team": "BOS"},
        {"id": _PID_2, "team": "LAL"},
        {"id": _PID_3, "team": "BOS"},
    ]
    mock_supabase = MagicMock()
    (
        mock_supabase
        .table.return_value
        .select.return_value
        .in_.return_value
        .execute.return_value
    ) = lookup_result
    monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: mock_supabase)
    monkeypatch.setattr(pipeline_mod, "run_query", lambda fn: fn())

    scrape_calls: list[tuple] = []

    def fake_scrape(team_abbrev, supabase, player_ids=None):
        scrape_calls.append((team_abbrev, tuple(sorted(player_ids or []))))
        return {"matched": 2 if team_abbrev == "BOS" else 1, "unmatched": 0, "total": 2}

    monkeypatch.setattr(pipeline_mod, "run_bulk_salary_scrape", fake_scrape)

    pipeline_mod._run_salary_scrape_job(_RUN_ID, [_PID_1, _PID_2, _PID_3])

    assert scrape_calls == [
        ("BOS", (_PID_1, _PID_3)),
        ("LAL", (_PID_2,)),
    ]
    assert runs_repo_capture["complete"] == [{"rows_processed": 3, "error": None}]
    # Progress seeded at 0/2 then ticked per team
    assert runs_repo_capture["progress"] == [(0, 2), (1, 2), (2, 2)]


def test_salary_scrape_worker_bulk_path_unchanged(monkeypatch, runs_repo_capture):
    """Empty player_ids → single full-league scrape, no player_ids filter."""
    import api.pipeline as pipeline_mod

    monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: MagicMock())

    scrape_calls: list[tuple] = []

    def fake_scrape(team_abbrev, supabase, player_ids=None):
        scrape_calls.append((team_abbrev, player_ids))
        return {"matched": 42, "unmatched": 3, "total": 45}

    monkeypatch.setattr(pipeline_mod, "run_bulk_salary_scrape", fake_scrape)

    pipeline_mod._run_salary_scrape_job(_RUN_ID, [])

    assert scrape_calls == [(None, None)]
    assert runs_repo_capture["complete"] == [{"rows_processed": 42, "error": None}]


def test_salary_scrape_worker_records_error_on_failure(monkeypatch, runs_repo_capture):
    """A scrape exception completes the run with the error recorded, not silently."""
    import api.pipeline as pipeline_mod

    monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: MagicMock())

    def boom(team_abbrev, supabase, player_ids=None):
        raise RuntimeError("espn fell over")

    monkeypatch.setattr(pipeline_mod, "run_bulk_salary_scrape", boom)

    pipeline_mod._run_salary_scrape_job(_RUN_ID, [])

    assert runs_repo_capture["complete"] == [
        {"rows_processed": 0, "error": "espn fell over"}
    ]


# ---------------------------------------------------------------------------
# Worker — _run_bio_team_sync_job subset path
# ---------------------------------------------------------------------------


def test_bio_team_sync_worker_loops_per_player(monkeypatch, runs_repo_capture):
    """Subset → run_player_bio_team_sync per id; refreshed counts summed."""
    import api.pipeline as pipeline_mod

    monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: MagicMock())

    synced: list[str] = []

    def fake_player_sync(player_id, supabase):
        synced.append(player_id)
        return {"refreshed": 1, "errors": 0}

    monkeypatch.setattr(pipeline_mod, "run_player_bio_team_sync", fake_player_sync)

    bulk_called = []
    monkeypatch.setattr(
        pipeline_mod, "run_bulk_bio_team_sync",
        lambda season, supabase: bulk_called.append(season) or {"refreshed": 0, "errors": 0},
    )

    pipeline_mod._run_bio_team_sync_job(_RUN_ID, [_PID_1, _PID_2], "2025-26")

    assert synced == [_PID_1, _PID_2]
    assert bulk_called == []
    assert runs_repo_capture["complete"] == [{"rows_processed": 2, "error": None}]
    assert runs_repo_capture["progress"] == [(0, 2), (1, 2), (2, 2)]


def test_bio_team_sync_worker_bulk_path_unchanged(monkeypatch, runs_repo_capture):
    """Empty player_ids → one run_bulk_bio_team_sync call, no per-player loop."""
    import api.pipeline as pipeline_mod

    monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: MagicMock())

    player_sync_calls: list[str] = []
    monkeypatch.setattr(
        pipeline_mod, "run_player_bio_team_sync",
        lambda player_id, supabase: player_sync_calls.append(player_id)
        or {"refreshed": 1, "errors": 0},
    )

    bulk_calls: list[str] = []
    monkeypatch.setattr(
        pipeline_mod, "run_bulk_bio_team_sync",
        lambda season, supabase: bulk_calls.append(season)
        or {"refreshed": 200, "errors": 0},
    )

    pipeline_mod._run_bio_team_sync_job(_RUN_ID, [], "2025-26")

    assert player_sync_calls == []
    assert bulk_calls == ["2025-26"]
    assert runs_repo_capture["complete"] == [{"rows_processed": 200, "error": None}]
