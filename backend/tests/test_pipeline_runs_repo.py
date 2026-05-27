"""
Unit tests for backend/services/pipeline_runs/repo.py
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _result(data):
    r = MagicMock()
    r.data = data
    return r


def _run_row(**overrides):
    base = {
        "id": "run-uuid-0001",
        "pipeline_name": "stat_fetch",
        "scope": "bulk",
        "player_id": None,
        "snapshot_release_id": "snap-uuid-0001",
        "status": "running",
        "rows_processed": 0,
        "error_tail": None,
        "started_at": "2026-05-26T00:00:00Z",
        "finished_at": None,
    }
    base.update(overrides)
    return base


class TestStartRun:
    def test_start_run_creates_running_row(self):
        """start_run() inserts a row with status='running' and returns the run_id."""
        from services.pipeline_runs import repo

        run_row = _run_row()
        client = MagicMock()
        client.table.return_value.insert.return_value.execute.return_value = _result([run_row])

        with patch.object(repo, "_get_client", return_value=client):
            run_id = repo.start_run(
                name="stat_fetch",
                scope="bulk",
                snapshot_release_id="snap-uuid-0001",
            )

        assert run_id == "run-uuid-0001"
        inserted = client.table.return_value.insert.call_args[0][0]
        assert inserted["status"] == "running"
        assert inserted["pipeline_name"] == "stat_fetch"


class TestCompleteRun:
    def test_complete_run_marks_success_and_rows(self):
        """complete_run() with no error sets status='success' and rows_processed."""
        from services.pipeline_runs import repo

        client = MagicMock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value = _result(
            [_run_row(status="success", rows_processed=42)]
        )

        with patch.object(repo, "_get_client", return_value=client):
            repo.complete_run("run-uuid-0001", rows_processed=42)

        updated = client.table.return_value.update.call_args[0][0]
        assert updated["status"] == "success"
        assert updated["rows_processed"] == 42
        assert updated["error_tail"] is None

    def test_complete_run_with_error_marks_error(self):
        """complete_run() with error sets status='error' and populates error_tail."""
        from services.pipeline_runs import repo

        client = MagicMock()
        client.table.return_value.update.return_value.eq.return_value.execute.return_value = _result(
            [_run_row(status="error", error_tail="Timeout")]
        )

        with patch.object(repo, "_get_client", return_value=client):
            repo.complete_run("run-uuid-0001", rows_processed=5, error="Timeout")

        updated = client.table.return_value.update.call_args[0][0]
        assert updated["status"] == "error"
        assert updated["error_tail"] == "Timeout"


class TestGetRun:
    def test_get_run_returns_none_for_not_found(self):
        """get_run() returns None when the DB responds with PGRST116 (no rows)."""
        import postgrest.exceptions

        from services.pipeline_runs import repo

        client = MagicMock()
        err = postgrest.exceptions.APIError({"code": "PGRST116", "message": "no rows", "hint": None, "details": None})
        client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = err

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.get_run("run-not-found")

        assert result is None

    def test_get_run_propagates_non_not_found_errors(self):
        """get_run() must re-raise errors that are NOT PGRST116 (not-found).

        Swallowing transient DB errors (connection timeout, auth failure, etc.)
        causes 404 responses to callers who should instead see 500. The exception
        must propagate so Flask's error handling can surface the real issue.
        """
        import postgrest.exceptions

        from services.pipeline_runs import repo

        client = MagicMock()
        # A non-PGRST116 API error (e.g., auth failure, connection reset)
        transient_err = postgrest.exceptions.APIError(
            {"code": "28P01", "message": "password authentication failed", "hint": None, "details": None}
        )
        client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = transient_err

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(postgrest.exceptions.APIError):
                repo.get_run("run-any-id")


class TestAnyRunning:
    def test_any_running_returns_true_for_matching_snapshot(self):
        """any_running() returns True when a running row exists for the snapshot."""
        from services.pipeline_runs import repo

        client = MagicMock()
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .eq.return_value
            .limit.return_value
            .execute.return_value
        ) = _result([_run_row()])

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.any_running("snap-uuid-0001")

        assert result is True

    def test_any_running_returns_false_when_no_running_rows(self):
        """any_running() returns False when no running rows exist."""
        from services.pipeline_runs import repo

        client = MagicMock()
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .eq.return_value
            .limit.return_value
            .execute.return_value
        ) = _result([])

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.any_running("snap-uuid-0001")

        assert result is False

    def test_any_running_returns_false_when_snapshot_release_id_is_none(self):
        """any_running(None) returns False immediately — no draft means no
        Invariant to enforce. Must not query the DB for global running rows."""
        from services.pipeline_runs import repo

        client = MagicMock()

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.any_running(None)

        assert result is False
        # DB must not be queried — returning False is a short-circuit
        client.table.assert_not_called()
