"""Tests for Evaluation Version reactivation (repo + API)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _bypass_admin_auth(monkeypatch):
    """Patch JWT verification and role check to let requests through."""
    import api.auth as auth_mod

    monkeypatch.setattr(
        auth_mod,
        "_verify_jwt",
        lambda _token: {"sub": "test-admin-user"},
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
        c.auth_header = {"Authorization": "Bearer fake-token"}
        yield c


@pytest.fixture()
def anon_client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# repo.reactivate() unit tests
# ---------------------------------------------------------------------------


class TestReactivateRepo:
    """Unit tests for repo-level reactivation logic."""

    def test_reactivate_calls_rpc_with_version_id(self):
        """reactivate() should call the DB RPC with the version ID."""
        from services.evaluation_versions import repo

        mock_client = MagicMock()
        mock_rpc = MagicMock()
        mock_rpc.execute.return_value = MagicMock(data="fake-uuid")
        mock_client.rpc.return_value = mock_rpc

        mock_version_row = {
            "id": "abc-123",
            "slug": "cohesion-v1",
            "status": "published",
            "payload": {"values": {}, "taxonomy": {}, "formula_refs": {}},
        }
        mock_select = MagicMock()
        mock_select.execute.return_value = MagicMock(data=mock_version_row)
        mock_eq_single = MagicMock()
        mock_eq_single.single.return_value = mock_select
        mock_eq = MagicMock()
        mock_eq.eq.return_value = mock_eq_single
        mock_table_select = MagicMock()
        mock_table_select.select.return_value = mock_eq
        mock_client.table.return_value = mock_table_select

        with patch.object(repo, "get_supabase", return_value=mock_client), \
             patch.object(repo, "run_query", side_effect=lambda fn: fn()):
            result = repo.reactivate("abc-123")

        mock_client.rpc.assert_called_once_with(
            "reactivate_evaluation_version",
            {"p_version_id": "abc-123"},
        )
        assert result.id == "abc-123"
        assert result.slug == "cohesion-v1"

    def test_reactivate_raises_on_not_published(self):
        """reactivate() raises ValueError when RPC reports not published."""
        from services.evaluation_versions import repo

        mock_client = MagicMock()
        mock_rpc = MagicMock()
        mock_rpc.execute.side_effect = Exception("is not published")
        mock_client.rpc.return_value = mock_rpc

        with patch.object(repo, "get_supabase", return_value=mock_client), \
             patch.object(repo, "run_query", side_effect=lambda fn: fn()), \
             pytest.raises(ValueError, match="version_not_published"):
            repo.reactivate("abc-123")

    def test_reactivate_raises_on_already_active(self):
        """reactivate() raises ValueError when RPC reports already active."""
        from services.evaluation_versions import repo

        mock_client = MagicMock()
        mock_rpc = MagicMock()
        mock_rpc.execute.side_effect = Exception("is already active")
        mock_client.rpc.return_value = mock_rpc

        with patch.object(repo, "get_supabase", return_value=mock_client), \
             patch.object(repo, "run_query", side_effect=lambda fn: fn()), \
             pytest.raises(ValueError, match="version_already_active"):
            repo.reactivate("abc-123")


# ---------------------------------------------------------------------------
# API endpoint tests
# ---------------------------------------------------------------------------


class TestReactivateEndpoint:
    """Integration tests for POST /api/evaluation-versions/<id>/reactivate."""

    def test_reactivate_success(self, admin_client):
        """Happy path: reactivation returns the reactivated version."""
        from services.evaluation_versions import repo as ev_repo
        from services.cohesion_engine.engine import EvaluationVersion

        version_id = "00000000-0000-0000-0000-000000000001"
        fake_version = EvaluationVersion(
            id=version_id,
            slug="cohesion-v1",
            status="published",
            payload={"values": {}, "taxonomy": {}, "formula_refs": {}},
        )

        with patch.object(ev_repo, "reactivate", return_value=fake_version):
            resp = admin_client.post(
                f"/api/evaluation-versions/{version_id}/reactivate",
                headers=admin_client.auth_header,
            )
            data = resp.get_json()

        assert resp.status_code == 200
        assert data["success"] is True
        assert data["data"]["id"] == version_id
        assert data["data"]["slug"] == "cohesion-v1"

    def test_reactivate_invalid_uuid(self, admin_client):
        """Invalid UUID returns 400."""
        resp = admin_client.post(
            "/api/evaluation-versions/not-a-uuid/reactivate",
            headers=admin_client.auth_header,
        )
        data = resp.get_json()
        assert resp.status_code == 400
        assert data["success"] is False

    def test_reactivate_requires_admin(self, anon_client):
        """Request without auth returns 401."""
        resp = anon_client.post(
            "/api/evaluation-versions/00000000-0000-0000-0000-000000000001/reactivate"
        )
        assert resp.status_code == 401

    def test_reactivate_not_published_returns_400(self, admin_client):
        """Reactivating a non-published version returns 400."""
        from services.evaluation_versions import repo as ev_repo

        with patch.object(
            ev_repo, "reactivate",
            side_effect=ValueError("version_not_published"),
        ):
            resp = admin_client.post(
                "/api/evaluation-versions/00000000-0000-0000-0000-000000000001/reactivate",
                headers=admin_client.auth_header,
            )
            data = resp.get_json()

        assert resp.status_code == 400
        assert data["success"] is False
        assert "not_published" in data["error"]

    def test_reactivate_already_active_returns_400(self, admin_client):
        """Reactivating the already-active version returns 400."""
        from services.evaluation_versions import repo as ev_repo

        with patch.object(
            ev_repo, "reactivate",
            side_effect=ValueError("version_already_active"),
        ):
            resp = admin_client.post(
                "/api/evaluation-versions/00000000-0000-0000-0000-000000000001/reactivate",
                headers=admin_client.auth_header,
            )
            data = resp.get_json()

        assert resp.status_code == 400
        assert data["success"] is False
        assert "already_active" in data["error"]
