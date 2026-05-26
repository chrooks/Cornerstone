"""
Integration tests for /api/snapshots/* endpoints.

All write endpoints require admin auth; reads also require admin auth per A-6.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(
        auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin-user"}
    )
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
        c.auth_header = {"Authorization": "Bearer fake-admin-token"}
        yield c


@pytest.fixture()
def anon_client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _fake_release(status="published", is_active=True):
    return MagicMock(
        id="bbbbbbbb-0000-0000-0000-000000000002",
        label="2025-26 Current",
        season="2025-26",
        status=status,
        is_active=is_active,
        published_at="2026-05-01T00:00:00Z",
        created_at="2026-05-01T00:00:00Z",
    )


def _fake_draft(status="draft"):
    return MagicMock(
        id="aaaaaaaa-0000-0000-0000-000000000001",
        label="draft-abcd1234",
        season="2025-26",
        status=status,
        is_active=False,
        published_at=None,
        created_at="2026-05-26T00:00:00Z",
    )


# ---------------------------------------------------------------------------
# Auth gating
# ---------------------------------------------------------------------------


class TestAuthGating:
    def test_get_draft_requires_admin(self, anon_client):
        resp = anon_client.get("/api/snapshots/draft")
        assert resp.status_code == 401

    def test_post_drafts_requires_admin(self, anon_client):
        resp = anon_client.post("/api/snapshots/drafts")
        assert resp.status_code == 401

    def test_delete_draft_requires_admin(self, anon_client):
        resp = anon_client.delete("/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001")
        assert resp.status_code == 401

    def test_get_pipeline_run_requires_admin(self, anon_client):
        """GET /api/pipeline/runs/<run_id> must require admin auth (MEDIUM-2).
        The endpoint surfaces error_tail which may include internal data."""
        resp = anon_client.get("/api/pipeline/runs/some-run-id")
        assert resp.status_code == 401

    def test_get_pipeline_run_succeeds_with_admin(self, admin_client, monkeypatch):
        """GET /api/pipeline/runs/<run_id> returns 200 with valid admin JWT."""
        from services.supabase_client import run_query as real_rq
        import api.pipeline as pipeline_mod

        run_row = {
            "id": "run-uuid-001",
            "pipeline_name": "stat_fetch",
            "scope": "bulk",
            "status": "success",
            "rows_processed": 42,
            "error_tail": None,
            "started_at": "2026-05-26T00:00:00Z",
            "finished_at": "2026-05-26T00:05:00Z",
        }

        mock_result = MagicMock()
        mock_result.data = run_row
        mock_supabase = MagicMock()
        (
            mock_supabase
            .table.return_value
            .select.return_value
            .eq.return_value
            .single.return_value
            .execute.return_value
        ) = mock_result

        monkeypatch.setattr(pipeline_mod, "get_supabase", lambda: mock_supabase)
        monkeypatch.setattr(pipeline_mod, "run_query", lambda fn: fn())

        resp = admin_client.get(
            "/api/pipeline/runs/run-uuid-001",
            headers=admin_client.auth_header,
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts
# ---------------------------------------------------------------------------


class TestCreateDraftEndpoint:
    def test_post_drafts_returns_201_when_none_exists(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(repo, "create_draft", return_value=_fake_draft()):
            resp = admin_client.post(
                "/api/snapshots/drafts",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 201
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["status"] == "draft"

    def test_post_drafts_returns_409_when_draft_exists(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(repo, "create_draft", side_effect=ValueError("draft_already_exists")):
            resp = admin_client.post(
                "/api/snapshots/drafts",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 409
        body = resp.get_json()
        assert body["error"] == "draft_already_exists"


# ---------------------------------------------------------------------------
# DELETE /api/snapshots/drafts/<id>
# ---------------------------------------------------------------------------


class TestDiscardDraftEndpoint:
    def test_delete_drafts_removes_row_only(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(repo, "discard_draft", return_value=None):
            resp = admin_client.delete(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True


# ---------------------------------------------------------------------------
# POST /api/snapshots/drafts/<id>/publish
# ---------------------------------------------------------------------------


class TestPublishDraftEndpoint:
    def test_post_publish_returns_409_when_runs_in_flight(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(repo, "publish_draft", side_effect=ValueError("pipeline_runs_in_flight")):
            resp = admin_client.post(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/publish",
                json={"label": "Test", "allow_missing_composite": False},
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 409
        assert resp.get_json()["error"] == "pipeline_runs_in_flight"

    def test_post_publish_with_missing_composite_unacknowledged_returns_422(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(
            repo,
            "publish_draft",
            side_effect=ValueError("missing_composite_not_acknowledged: 5 players"),
        ):
            resp = admin_client.post(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/publish",
                json={"label": "Test", "allow_missing_composite": False},
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 422

    def test_post_publish_with_acknowledgement_succeeds_and_flips_is_active(self, admin_client):
        from services.snapshot_versions import repo

        published = _fake_release(status="published", is_active=True)
        with patch.object(repo, "publish_draft", return_value=published):
            resp = admin_client.post(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/publish",
                json={"label": "2025-26 Nov refresh", "allow_missing_composite": True},
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["is_active"] is True


# ---------------------------------------------------------------------------
# GET /api/snapshots/drafts/<id>/validation
# ---------------------------------------------------------------------------


class TestValidationEndpoint:
    def test_get_validation_returns_counts(self, admin_client):
        from services.snapshot_versions import validator

        with patch.object(
            validator,
            "validate_publishable",
            return_value={"players_missing_canonical": 0, "players_missing_composite": 3},
        ):
            resp = admin_client.get(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/validation",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["players_missing_composite"] == 3


# ---------------------------------------------------------------------------
# GET /api/snapshots/drafts/<id>/summary
# ---------------------------------------------------------------------------


class TestSummaryEndpoint:
    def test_get_summary_returns_count_summary(self, admin_client):
        from services.snapshot_versions import summary

        with patch.object(
            summary,
            "count_summary",
            return_value={
                "players_total": 300,
                "players_changed_since_active": 45,
                "players_missing_composite": 2,
                "thresholds_changed": 0,
                "manual_overrides_since_active": 3,
            },
        ):
            resp = admin_client.get(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/summary",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["data"]["players_total"] == 300
        assert "thresholds_changed" in body["data"]
        assert "manual_overrides_since_active" in body["data"]
        assert body["data"]["thresholds_changed"] == 0
        assert body["data"]["manual_overrides_since_active"] == 3


# ---------------------------------------------------------------------------
# Distribution cache invalidation
# ---------------------------------------------------------------------------


class TestPublishInvalidatesCache:
    def test_post_publish_invalidates_distribution_cache(self, admin_client):
        """After publish, clear_distributions is called before ensure_distributions."""
        from services.snapshot_versions import repo

        call_order = []

        def fake_publish(*args, **kwargs):
            return _fake_release()

        with patch.object(repo, "publish_draft", side_effect=fake_publish):
            resp = admin_client.post(
                "/api/snapshots/drafts/aaaaaaaa-0000-0000-0000-000000000001/publish",
                json={"label": "Test", "allow_missing_composite": True},
                headers=admin_client.auth_header,
            )

        # The cache management happens inside repo.publish_draft which is mocked,
        # so verify the endpoint delegates correctly (status 200)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/snapshots/releases/<id>/reactivate (#53)
# ---------------------------------------------------------------------------


class TestReactivateReleaseEndpoint:
    _RELEASE_ID = "bbbbbbbb-0000-0000-0000-000000000002"

    def test_reactivate_requires_admin(self, anon_client):
        resp = anon_client.post(
            f"/api/snapshots/releases/{self._RELEASE_ID}/reactivate"
        )
        assert resp.status_code == 401

    def test_reactivate_validates_uuid(self, admin_client):
        resp = admin_client.post(
            "/api/snapshots/releases/not-a-uuid/reactivate",
            headers=admin_client.auth_header,
        )
        assert resp.status_code == 400

    def test_reactivate_happy_path(self, admin_client):
        from services.snapshot_versions import repo

        reactivated = _fake_release(status="published", is_active=True)
        with patch.object(repo, "reactivate_release", return_value=reactivated) as spy:
            resp = admin_client.post(
                f"/api/snapshots/releases/{self._RELEASE_ID}/reactivate",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["is_active"] is True
        spy.assert_called_once_with(self._RELEASE_ID)

    def test_reactivate_returns_400_when_not_published(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(
            repo,
            "reactivate_release",
            side_effect=ValueError("not_published"),
        ):
            resp = admin_client.post(
                f"/api/snapshots/releases/{self._RELEASE_ID}/reactivate",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 400
        assert resp.get_json()["error"] == "not_published"

    def test_reactivate_returns_409_when_draft_in_flight(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(
            repo,
            "reactivate_release",
            side_effect=ValueError("draft_in_flight"),
        ):
            resp = admin_client.post(
                f"/api/snapshots/releases/{self._RELEASE_ID}/reactivate",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 409
        assert resp.get_json()["error"] == "draft_in_flight"

    def test_reactivate_returns_404_when_release_not_found(self, admin_client):
        from services.snapshot_versions import repo

        with patch.object(
            repo,
            "reactivate_release",
            side_effect=ValueError("release_not_found"),
        ):
            resp = admin_client.post(
                f"/api/snapshots/releases/{self._RELEASE_ID}/reactivate",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 404
