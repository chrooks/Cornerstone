"""
Unit tests for backend/services/snapshot_versions/repo.py

Uses a fake Supabase client to avoid real network IO.
TDD vertical-slice order matches the implementation order.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Fake Supabase client helpers
# ---------------------------------------------------------------------------


def _result(data):
    """Wrap data in a minimal Supabase result object."""
    r = MagicMock()
    r.data = data
    return r


def _make_draft_row(**overrides):
    base = {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "label": "draft-abcd1234",
        "season": "2025-26",
        "status": "draft",
        "is_active": False,
        "published_at": None,
        "created_at": "2026-05-26T00:00:00Z",
    }
    base.update(overrides)
    return base


def _make_published_row(**overrides):
    base = {
        "id": "bbbbbbbb-0000-0000-0000-000000000002",
        "label": "2025-26 Current",
        "season": "2025-26",
        "status": "published",
        "is_active": True,
        "published_at": "2026-05-01T00:00:00Z",
        "created_at": "2026-05-01T00:00:00Z",
    }
    base.update(overrides)
    return base


def _fake_client_returning(rows_or_row):
    """
    Build a mock that chains .table().select().*.execute() → result.
    Works for both single-row (dict) and multi-row (list) returns.
    """
    client = MagicMock()
    data = [rows_or_row] if isinstance(rows_or_row, dict) else rows_or_row
    execute_result = _result(data)
    (
        client
        .table.return_value
        .select.return_value
        .eq.return_value
        .execute.return_value
    ) = execute_result
    (
        client
        .table.return_value
        .select.return_value
        .eq.return_value
        .eq.return_value
        .execute.return_value
    ) = execute_result
    (
        client
        .table.return_value
        .select.return_value
        .eq.return_value
        .single.return_value
        .execute.return_value
    ) = _result(rows_or_row if isinstance(rows_or_row, dict) else (rows_or_row[0] if rows_or_row else None))
    return client


# ---------------------------------------------------------------------------
# Tests: create_draft
# ---------------------------------------------------------------------------


class TestCreateDraft:
    def test_create_draft_succeeds_when_none_exists(self):
        """Returns a draft SnapshotRelease when no draft exists."""
        from services.snapshot_versions import repo

        draft_row = _make_draft_row()
        client = MagicMock()

        # get_draft: no existing draft → empty list
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = _result([])
        # insert: returns the new draft row
        client.table.return_value.insert.return_value.execute.return_value = _result([draft_row])

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.create_draft()

        assert result.id == draft_row["id"]
        assert result.status == "draft"
        assert result.is_active is False

    def test_create_draft_raises_when_draft_already_exists(self):
        """Raises ValueError('draft_already_exists') when a draft row is open."""
        from services.snapshot_versions import repo

        client = MagicMock()
        # get_draft: existing draft row
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            _result([_make_draft_row()])
        )

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="draft_already_exists"):
                repo.create_draft()

    def test_create_draft_raises_when_review_exists(self):
        """A row with status='review' counts as an open draft."""
        from services.snapshot_versions import repo

        client = MagicMock()
        client.table.return_value.select.return_value.in_.return_value.execute.return_value = (
            _result([_make_draft_row(status="review")])
        )

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="draft_already_exists"):
                repo.create_draft()


# ---------------------------------------------------------------------------
# Tests: move_to_review / move_to_draft
# ---------------------------------------------------------------------------


class TestMoveToReview:
    def test_move_to_review_blocks_when_runs_in_flight(self):
        """Raises ValueError('pipeline_runs_in_flight') when a run is active."""
        from services.snapshot_versions import repo

        client = MagicMock()
        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=True):
                with pytest.raises(ValueError, match="pipeline_runs_in_flight"):
                    repo.move_to_review(draft_id)

    def test_move_to_review_succeeds_when_no_runs(self):
        """Returns a review-status SnapshotRelease when no runs are in flight."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        review_row = _make_draft_row(status="review")
        client = MagicMock()
        (
            client
            .table.return_value
            .update.return_value
            .eq.return_value
            .eq.return_value
            .execute.return_value
        ) = _result([review_row])

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                result = repo.move_to_review(draft_id)

        assert result.status == "review"

    def test_move_to_draft_reverses_review(self):
        """Flips review status back to draft."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        draft_row = _make_draft_row(status="draft")
        client = MagicMock()
        (
            client
            .table.return_value
            .update.return_value
            .eq.return_value
            .eq.return_value
            .execute.return_value
        ) = _result([draft_row])

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.move_to_draft(draft_id)

        assert result.status == "draft"


# ---------------------------------------------------------------------------
# Tests: discard_draft
# ---------------------------------------------------------------------------


class TestDiscardDraft:
    def test_discard_draft_deletes_only_the_row(self):
        """discard_draft() issues a DELETE on snapshot_releases only."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        client = MagicMock()
        (
            client
            .table.return_value
            .delete.return_value
            .eq.return_value
            .in_.return_value
            .execute.return_value
        ) = _result([_make_draft_row()])

        with patch.object(repo, "_get_client", return_value=client):
            repo.discard_draft(draft_id)  # should not raise

        # Verify DELETE was called on snapshot_releases, NOT on draft_skill_profiles
        assert client.table.call_args_list[0][0][0] == "snapshot_releases"
        all_tables_accessed = [call[0][0] for call in client.table.call_args_list]
        assert "draft_skill_profiles" not in all_tables_accessed


# ---------------------------------------------------------------------------
# Tests: publish_draft
# ---------------------------------------------------------------------------


class TestPublishDraft:
    def test_publish_draft_invokes_rpc_with_args(self):
        """repo.publish_draft() calls the RPC with the correct arguments."""
        from services.snapshot_versions import repo
        from services.snapshot_versions import validator as snap_validator

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        label = "2025-26 Nov refresh"
        published_row = _make_published_row(id=draft_id, label=label)

        client = MagicMock()
        # RPC call
        client.rpc.return_value.execute.return_value = _result(None)
        # get_release call after publish
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            # Guard: no runs in flight
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                # Guard: no missing composites (allow_missing_composite=False path)
                with patch.object(
                    snap_validator,
                    "validate_publishable",
                    return_value={"players_missing_canonical": 0, "players_missing_composite": 0},
                ):
                    with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                        with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                            with patch("services.evaluation_versions.repo.get_active") as mock_active:
                                from services.cohesion_engine.engine import EvaluationVersion
                                mock_active.return_value = EvaluationVersion(
                                    id="ev-1", slug="cohesion-v1", status="published",
                                    payload={"values": {}}
                                )
                                result = repo.publish_draft(draft_id, label, allow_missing_composite=False)

        rpc_call = client.rpc.call_args
        assert rpc_call[0][0] == "publish_snapshot_draft"
        assert rpc_call[1]["params"]["p_draft_id"] == draft_id
        assert rpc_call[1]["params"]["p_label"] == label
        assert result.label == label

    def test_publish_draft_forwards_acknowledged_open_flags(self):
        """Issue #71: the acknowledged open-flags count is forwarded to the RPC
        as p_acknowledged_open_flags so the DB can count-pin the override."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id, label="L")

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                    with patch("services.evaluation_versions.repo.get_active") as mock_active:
                        from services.cohesion_engine.engine import EvaluationVersion
                        mock_active.return_value = EvaluationVersion(
                            id="ev-1", slug="cohesion-v1", status="published",
                            payload={"values": {}}
                        )
                        repo.publish_draft(
                            draft_id,
                            "L",
                            allow_missing_composite=True,
                            allow_open_flags=True,
                            acknowledged_open_flags=3,
                        )

        params = client.rpc.call_args[1]["params"]
        assert params["p_allow_open_flags"] is True
        assert params["p_acknowledged_open_flags"] == 3

    def test_publish_draft_translates_open_flags_changed_to_value_error(self):
        """Issue #71: the RPC's open_flags_changed exception becomes a ValueError
        so the API layer maps it to 409."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        client = MagicMock()
        client.rpc.return_value.execute.side_effect = Exception(
            "open_flags_changed: live=5 acknowledged=2"
        )

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="open_flags_changed"):
                repo.publish_draft(
                    draft_id,
                    "L",
                    allow_missing_composite=True,
                    allow_open_flags=True,
                    acknowledged_open_flags=2,
                )

    def test_publish_draft_clears_and_rewarms_cache(self):
        """publish_draft() calls clear_distributions then ensure_distributions."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        call_order = []

        with patch.object(repo, "_get_client", return_value=client):
            with patch(
                "services.snapshot_versions.distribution_cache.force_clear_distributions",
                side_effect=lambda: call_order.append("clear"),
            ):
                with patch(
                    "services.snapshot_versions.distribution_cache.ensure_distributions",
                    side_effect=lambda *a, **kw: call_order.append("ensure"),
                ):
                    with patch("services.evaluation_versions.repo.get_active") as mock_active:
                        from services.cohesion_engine.engine import EvaluationVersion
                        mock_active.return_value = EvaluationVersion(
                            id="ev-1", slug="cohesion-v1", status="published",
                            payload={"values": {}}
                        )
                        repo.publish_draft(draft_id, "label", allow_missing_composite=True)

        assert call_order == ["clear", "ensure"]

    def test_publish_draft_tolerates_trace_snapshot_failure(self):
        """Issue #82: a skill-trace freeze failure must never block publish —
        publish_draft() still returns the published release even if
        trace_snapshot.snapshot_skill_traces() raises."""
        from services.snapshot_versions import repo
        from services.snapshot_versions import trace_snapshot

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch.object(
                trace_snapshot, "snapshot_skill_traces", side_effect=RuntimeError("boom")
            ) as mock_snapshot:
                with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                    with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                        with patch("services.evaluation_versions.repo.get_active") as mock_active:
                            from services.cohesion_engine.engine import EvaluationVersion
                            mock_active.return_value = EvaluationVersion(
                                id="ev-1", slug="cohesion-v1", status="published",
                                payload={"values": {}}
                            )
                            result = repo.publish_draft(draft_id, "label", allow_missing_composite=True)

        assert result.label == published_row["label"]  # publish_draft did not raise
        mock_snapshot.assert_called_once()

    def test_publish_rewarm_rebuilds_distributions_from_snapshot_rows(self, monkeypatch):
        """Issue #50: the publish rewarm rebuilds normalization distributions
        from the newly active release's released_players.skill_profile_snapshot
        rows (frozen snapshot data) — not from live skill_profiles. Legends are
        frozen into released_players by the publish RPC, so legend profiles are
        sourced from the same snapshot table."""
        import json
        from pathlib import Path

        import services.snapshot_versions.active as snapshots_active_mod
        from services.cohesion_engine import composites
        from services.cohesion_engine.engine import EvaluationVersion
        from services.snapshot_versions import distribution_cache, repo

        seed_path = (
            Path(__file__).resolve().parents[2]
            / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
        )
        values = json.loads(seed_path.read_text())["payload"]["values"]

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)

        # Repo-side fake client: RPC + get_release after publish
        repo_client = MagicMock()
        repo_client.rpc.return_value.execute.return_value = _result(None)
        (
            repo_client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        # Composites-side fake DB: released_players rows frozen for the new release
        class FakeResult:
            def __init__(self, data):
                self.data = data

        class FakeQuery:
            def __init__(self):
                self.filters = {}

            def select(self, _columns):
                return self

            def eq(self, key, value):
                self.filters[key] = value
                return self

            def execute(self):
                if self.filters.get("snapshot_release_id") != draft_id:
                    return FakeResult([])
                if self.filters.get("is_legend") is True:
                    return FakeResult(
                        [{"skill_profile_snapshot": {"crafty_finisher": {"final_tier": "Elite"}}}]
                    )
                return FakeResult(
                    [
                        {"skill_profile_snapshot": {"spot_up_shooter": {"final_tier": "Elite"}}},
                        {"skill_profile_snapshot": {"spot_up_shooter": {"final_tier": "Proficient"}}},
                    ]
                )

        class FakeClient:
            def table(self, _name):
                return FakeQuery()

        monkeypatch.setattr(composites, "_get_supabase_client", lambda: FakeClient())
        monkeypatch.setattr(composites, "_run_query", lambda query: query())
        # Publish flipped is_active to the freshly published release
        monkeypatch.setattr(
            snapshots_active_mod,
            "_query_active_release_id",
            lambda client=None: draft_id,
        )

        distribution_cache.force_clear_distributions()
        try:
            with patch.object(repo, "_get_client", return_value=repo_client):
                with patch("services.pipeline_runs.repo.any_running", return_value=False):
                    with patch("services.pipeline_runs.repo.any_pending_commit", return_value=False):
                        with patch("services.evaluation_versions.repo.get_active") as mock_active:
                            mock_active.return_value = EvaluationVersion(
                                id="ev-1", slug="cohesion-v1", status="published",
                                payload={"values": values},
                            )
                            repo.publish_draft(draft_id, "label", allow_missing_composite=True)

            # Distributions reflect the frozen snapshot rows of the new release:
            # spot_up Elite (spacing 8.0), spot_up Proficient (4.0), legend
            # crafty_finisher Elite (spacing 0.0, finishing 8.0).
            state = distribution_cache.get_state()
            assert state.distributions["spacing"] == [0.0, 4.0, 8.0]
            assert state.distributions["finishing"] == [0.0, 0.0, 8.0]
        finally:
            distribution_cache.force_clear_distributions()


# ---------------------------------------------------------------------------
# Tests: publish_draft — pipeline_runs_in_flight guard
# ---------------------------------------------------------------------------


class TestPublishDraftRunsGuard:
    def test_publish_draft_raises_when_runs_in_flight(self):
        """publish_draft raises ValueError('pipeline_runs_in_flight') when
        any pipeline_run is still running for the draft."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        client = MagicMock()

        with patch.object(repo, "_get_client", return_value=client):
            with patch(
                "services.pipeline_runs.repo.any_running",
                return_value=True,
            ):
                with pytest.raises(ValueError, match="pipeline_runs_in_flight"):
                    repo.publish_draft(
                        draft_id,
                        label="Test label",
                        allow_missing_composite=True,
                    )

        # RPC must NOT have been called
        client.rpc.assert_not_called()

    def test_publish_draft_proceeds_when_no_runs_in_flight(self):
        """publish_draft does NOT raise when no runs are active."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                    with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                        with patch("services.evaluation_versions.repo.get_active") as mock_active:
                            from services.cohesion_engine.engine import EvaluationVersion
                            mock_active.return_value = EvaluationVersion(
                                id="ev-1", slug="cohesion-v1", status="published",
                                payload={"values": {}}
                            )
                            result = repo.publish_draft(
                                draft_id, label="Test label", allow_missing_composite=True
                            )

        assert result is not None
        client.rpc.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: publish_draft — pending_commits_exist guard
# ---------------------------------------------------------------------------


class TestPublishDraftPendingCommitsGuard:
    """publish_draft must block when any Pipeline run has status='success',
    committed_at IS NULL, and snapshot_release_id=draft_id. This prevents
    publishing a draft while staged results are waiting to be committed or
    discarded (data would otherwise be silently dropped)."""

    _DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"

    def test_publish_raises_pending_commits_exist_when_uncommitted_success_run(self):
        """publish_draft raises ValueError('pending_commits_exist') when a
        Pipeline run has status='success', committed_at=NULL, and
        snapshot_release_id matches the draft."""
        from services.snapshot_versions import repo

        client = MagicMock()

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch(
                    "services.pipeline_runs.repo.any_pending_commit",
                    return_value=True,
                ):
                    with pytest.raises(ValueError, match="pending_commits_exist"):
                        repo.publish_draft(
                            self._DRAFT_ID,
                            label="Test label",
                            allow_missing_composite=True,
                        )

        # RPC must NOT have been called
        client.rpc.assert_not_called()

    def test_publish_proceeds_when_pending_commit_for_different_draft(self):
        """publish_draft proceeds when the pending-commit run belongs to a
        different draft (snapshot_release_id != draft_id). The any_pending_commit
        query is scoped to the specific draft_id."""
        from services.snapshot_versions import repo

        published_row = _make_published_row(id=self._DRAFT_ID)
        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                # any_pending_commit returns False — this draft has no pending runs
                with patch(
                    "services.pipeline_runs.repo.any_pending_commit",
                    return_value=False,
                ):
                    with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                        with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                            with patch("services.evaluation_versions.repo.get_active") as mock_active:
                                from services.cohesion_engine.engine import EvaluationVersion
                                mock_active.return_value = EvaluationVersion(
                                    id="ev-1", slug="cohesion-v1", status="published",
                                    payload={"values": {}},
                                )
                                result = repo.publish_draft(
                                    self._DRAFT_ID,
                                    label="Test label",
                                    allow_missing_composite=True,
                                )

        # RPC was called — publish proceeded
        assert result is not None
        client.rpc.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: publish_draft — missing_composite_not_acknowledged preflight
# ---------------------------------------------------------------------------


class TestPublishDraftMissingCompositePreflight:
    def test_publish_draft_raises_python_error_when_missing_composite_unacknowledged(self):
        """publish_draft raises ValueError('missing_composite_not_acknowledged')
        in Python before calling the RPC when allow_missing_composite=False and
        validation shows missing composites. This ensures the API layer's
        except ValueError catches it (not a Postgres APIError)."""
        from services.snapshot_versions import repo
        from services.snapshot_versions import validator as snap_validator

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        client = MagicMock()

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch.object(
                    snap_validator,
                    "validate_publishable",
                    return_value={
                        "players_missing_canonical": 0,
                        "players_missing_composite": 5,
                    },
                ):
                    with pytest.raises(ValueError, match="missing_composite_not_acknowledged"):
                        repo.publish_draft(
                            draft_id,
                            label="Test label",
                            allow_missing_composite=False,
                        )

        # RPC must NOT have been called
        client.rpc.assert_not_called()

    def test_publish_draft_skips_preflight_when_allow_missing_composite(self):
        """When allow_missing_composite=True, the preflight is skipped and
        the RPC is called regardless of missing composites."""
        from services.snapshot_versions import repo
        from services.snapshot_versions import validator as snap_validator

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                # validate_publishable should NOT be called when allow=True
                with patch.object(
                    snap_validator,
                    "validate_publishable",
                ) as mock_validate:
                    with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                        with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                            with patch("services.evaluation_versions.repo.get_active") as mock_active:
                                from services.cohesion_engine.engine import EvaluationVersion
                                mock_active.return_value = EvaluationVersion(
                                    id="ev-1", slug="cohesion-v1", status="published",
                                    payload={"values": {}}
                                )
                                repo.publish_draft(
                                    draft_id,
                                    label="Test label",
                                    allow_missing_composite=True,
                                )

        mock_validate.assert_not_called()
        client.rpc.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: publish_draft — data_cutoff_at set in RPC params (HIGH-1)
# The column is added in migration 20260526000002.
# This test verifies the Python repo passes the column via the RPC—
# once the column exists, the RPC will set it.
# ---------------------------------------------------------------------------


class TestPublishDraftDataCutoffAt:
    def test_publish_draft_result_has_data_cutoff_at_field(self):
        """After publish, the returned SnapshotRelease row should carry
        data_cutoff_at once the DB column exists (migration 20260526000002).
        The fake row simulates what the DB will return post-migration."""
        from services.snapshot_versions import repo

        draft_id = "aaaaaaaa-0000-0000-0000-000000000001"
        published_row = _make_published_row(id=draft_id)
        # Simulate the DB returning the new column
        published_row["data_cutoff_at"] = "2026-05-26T10:00:00Z"

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                    with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                        with patch("services.evaluation_versions.repo.get_active") as mock_active:
                            from services.cohesion_engine.engine import EvaluationVersion
                            mock_active.return_value = EvaluationVersion(
                                id="ev-1", slug="cohesion-v1", status="published",
                                payload={"values": {}}
                            )
                            # Should not raise even if data_cutoff_at extra field exists
                            result = repo.publish_draft(
                                draft_id, label="Test label", allow_missing_composite=True
                            )

        # The RPC was called — data_cutoff_at is set by the DB, not by Python
        client.rpc.assert_called_once()
        rpc_params = client.rpc.call_args[1]["params"]
        assert rpc_params["p_draft_id"] == draft_id


# ---------------------------------------------------------------------------
# Tests: reset_working_state_from_active (Open Q1 — verifies RPC is called)
# ---------------------------------------------------------------------------


class TestResetWorkingState:
    def test_reset_calls_rpc(self):
        """reset_working_state_from_active() calls the Postgres RPC."""
        from services.snapshot_versions import repo

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)

        with patch.object(repo, "_get_client", return_value=client):
            repo.reset_working_state_from_active()

        client.rpc.assert_called_once()
        assert client.rpc.call_args[0][0] == "reset_working_state_from_active"


# ---------------------------------------------------------------------------
# Tests: reactivate_release (#53)
# ---------------------------------------------------------------------------


class TestReactivateRelease:
    _RELEASE_ID = "bbbbbbbb-0000-0000-0000-000000000002"

    def _wire_release_fetch(self, client, row):
        (
            client
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(row)

    def test_reactivate_calls_rpc_with_release_id(self):
        from services.snapshot_versions import repo

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        self._wire_release_fetch(client, _make_published_row(id=self._RELEASE_ID))

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                with patch("services.snapshot_versions.distribution_cache.ensure_distributions"):
                    with patch("services.evaluation_versions.repo.get_active") as mock_active:
                        from services.cohesion_engine.engine import EvaluationVersion
                        mock_active.return_value = EvaluationVersion(
                            id="ev-1", slug="cohesion-v1", status="published",
                            payload={"values": {}},
                        )
                        result = repo.reactivate_release(self._RELEASE_ID)

        rpc_call = client.rpc.call_args
        assert rpc_call[0][0] == "reactivate_snapshot_release"
        assert rpc_call[0][1] == {"p_release_id": self._RELEASE_ID}
        assert result.id == self._RELEASE_ID

    def test_reactivate_rewarms_cache_in_order(self):
        from services.snapshot_versions import repo

        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        self._wire_release_fetch(client, _make_published_row(id=self._RELEASE_ID))

        call_order = []
        with patch.object(repo, "_get_client", return_value=client):
            with patch(
                "services.snapshot_versions.distribution_cache.force_clear_distributions",
                side_effect=lambda: call_order.append("clear"),
            ):
                with patch(
                    "services.snapshot_versions.distribution_cache.ensure_distributions",
                    side_effect=lambda *a, **kw: call_order.append("ensure"),
                ):
                    with patch("services.evaluation_versions.repo.get_active") as mock_active:
                        from services.cohesion_engine.engine import EvaluationVersion
                        mock_active.return_value = EvaluationVersion(
                            id="ev-1", slug="cohesion-v1", status="published",
                            payload={"values": {}},
                        )
                        repo.reactivate_release(self._RELEASE_ID)

        assert call_order == ["clear", "ensure"]

    @pytest.mark.parametrize(
        "rpc_message,expected_code",
        [
            ("ERROR: not_published", "not_published"),
            ("ERROR: draft_in_flight", "draft_in_flight"),
            ("ERROR: release_not_found", "release_not_found"),
        ],
    )
    def test_reactivate_translates_rpc_errors(self, rpc_message, expected_code):
        from services.snapshot_versions import repo

        client = MagicMock()
        client.rpc.return_value.execute.side_effect = Exception(rpc_message)

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError) as exc_info:
                repo.reactivate_release(self._RELEASE_ID)

        assert str(exc_info.value) == expected_code

    @staticmethod
    def _stale_check_client(release_legend_count: int, legends_total: int):
        """Fake client whose count queries answer the structural-staleness check.

        released_players: .table().select(count).eq().eq().execute() -> count
        legends:          .table().select(count).execute()           -> count
        """

        class FakeResult:
            def __init__(self, count):
                self.count = count
                self.data = []

        class FakeQuery:
            def __init__(self, count):
                self._count = count

            def select(self, *args, **kwargs):
                return self

            def eq(self, *args, **kwargs):
                return self

            def execute(self):
                return FakeResult(self._count)

        client = MagicMock()
        client.table.side_effect = lambda name: FakeQuery(
            release_legend_count if name == "released_players" else legends_total
        )
        return client

    def test_reactivate_refuses_structurally_stale_release(self):
        """A Release frozen before the legends-freeze era (zero is_legend rows
        while legends exist) must be refused — reactivating it silently empties
        the Lab's legends."""
        from services.snapshot_versions import repo

        client = self._stale_check_client(release_legend_count=0, legends_total=36)

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="release_structurally_stale"):
                repo.reactivate_release(self._RELEASE_ID)

        client.rpc.assert_not_called()

    def test_reactivate_allow_stale_overrides_guard(self):
        from services.snapshot_versions import repo

        client = self._stale_check_client(release_legend_count=0, legends_total=36)
        client.rpc.return_value.execute.side_effect = Exception("not_published")

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="not_published"):
                repo.reactivate_release(self._RELEASE_ID, allow_stale=True)

        client.rpc.assert_called_once()

    def test_reactivate_proceeds_when_release_has_legend_rows(self):
        from services.snapshot_versions import repo

        client = self._stale_check_client(release_legend_count=36, legends_total=36)
        client.rpc.return_value.execute.side_effect = Exception("not_published")

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="not_published"):
                repo.reactivate_release(self._RELEASE_ID)

        client.rpc.assert_called_once()

    def test_reactivate_proceeds_when_no_legends_exist_at_all(self):
        """Zero legend rows is only stale when legends exist to be frozen."""
        from services.snapshot_versions import repo

        client = self._stale_check_client(release_legend_count=0, legends_total=0)
        client.rpc.return_value.execute.side_effect = Exception("not_published")

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="not_published"):
                repo.reactivate_release(self._RELEASE_ID)

        client.rpc.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: issue #72 — season-from-draft
# ---------------------------------------------------------------------------


class TestPublishDraftSeasonMissing:
    """The RPC raises season_missing when the draft's season is NULL/blank;
    repo.publish_draft translates it to a ValueError so the API maps it to 409.
    Safe against production: the RPC raises before any freeze."""

    _DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"

    def test_season_missing_translates_to_value_error(self):
        from services.snapshot_versions import repo

        client = MagicMock()
        client.rpc.return_value.execute.side_effect = Exception(
            "season_missing"
        )

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch("services.pipeline_runs.repo.any_pending_commit", return_value=False):
                    with pytest.raises(ValueError, match="season_missing"):
                        repo.publish_draft(
                            self._DRAFT_ID,
                            "L",
                            allow_missing_composite=True,
                        )

        # No cache rewarm path reached — the RPC raised first.
        client.rpc.assert_called_once()


class TestUpdateDraftSeason:
    """repo.update_draft_season persists an edited season onto an open draft."""

    _DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"

    def test_update_draft_season_writes_and_returns_row(self):
        from services.snapshot_versions import repo

        updated_row = _make_draft_row(id=self._DRAFT_ID, season="2026-27")
        client = MagicMock()
        (
            client.table.return_value
            .update.return_value
            .eq.return_value
            .in_.return_value
            .execute.return_value
        ) = _result([updated_row])

        with patch.object(repo, "_get_client", return_value=client):
            result = repo.update_draft_season(self._DRAFT_ID, "2026-27")

        assert result.season == "2026-27"

    def test_update_draft_season_raises_when_no_open_row(self):
        from services.snapshot_versions import repo

        client = MagicMock()
        (
            client.table.return_value
            .update.return_value
            .eq.return_value
            .in_.return_value
            .execute.return_value
        ) = _result([])

        with patch.object(repo, "_get_client", return_value=client):
            with pytest.raises(ValueError, match="draft_not_found_or_not_open"):
                repo.update_draft_season(self._DRAFT_ID, "2026-27")


class TestPublishCacheWarmSeason:
    """Issue #72/M5: the publish cache-warm passes the published Release's own
    season to ensure_distributions, NOT the hardcoded CURRENT_SEASON."""

    _DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"

    def test_publish_warms_with_release_season(self):
        from services.snapshot_versions import repo

        published_row = _make_published_row(id=self._DRAFT_ID, season="2030-31")
        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client.table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(published_row)

        captured = {}

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.pipeline_runs.repo.any_running", return_value=False):
                with patch("services.pipeline_runs.repo.any_pending_commit", return_value=False):
                    with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                        with patch(
                            "services.snapshot_versions.distribution_cache.ensure_distributions",
                            side_effect=lambda season, *a, **kw: captured.update(season=season),
                        ):
                            with patch("services.evaluation_versions.repo.get_active") as mock_active:
                                from services.cohesion_engine.engine import EvaluationVersion
                                mock_active.return_value = EvaluationVersion(
                                    id="ev-1", slug="cohesion-v1", status="published",
                                    payload={"values": {}}
                                )
                                repo.publish_draft(
                                    self._DRAFT_ID, "L", allow_missing_composite=True
                                )

        assert captured["season"] == "2030-31"


class TestReactivateCacheWarmSeason:
    """Issue #72/M5: reactivate cache-warm passes the reactivated Release's own
    season to ensure_distributions, NOT the hardcoded CURRENT_SEASON."""

    _RELEASE_ID = "bbbbbbbb-0000-0000-0000-000000000002"

    def test_reactivate_warms_with_release_season(self):
        from services.snapshot_versions import repo

        reactivated_row = _make_published_row(id=self._RELEASE_ID, season="2027-28")
        client = MagicMock()
        client.rpc.return_value.execute.return_value = _result(None)
        (
            client.table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = _result(reactivated_row)

        captured = {}

        with patch.object(repo, "_get_client", return_value=client):
            with patch("services.snapshot_versions.distribution_cache.force_clear_distributions"):
                with patch(
                    "services.snapshot_versions.distribution_cache.ensure_distributions",
                    side_effect=lambda season, *a, **kw: captured.update(season=season),
                ):
                    with patch("services.evaluation_versions.repo.get_active") as mock_active:
                        from services.cohesion_engine.engine import EvaluationVersion
                        mock_active.return_value = EvaluationVersion(
                            id="ev-1", slug="cohesion-v1", status="published",
                            payload={"values": {}}
                        )
                        repo.reactivate_release(self._RELEASE_ID)

        assert captured["season"] == "2027-28"
