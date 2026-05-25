"""
Tests for admin auth gating on GET /api/evaluation-versions[/draft|/active].

Covers issue #44:
- list and draft require admin JWT (401 without)
- active stays public but returns a stripped payload
- active with a valid admin token returns the full payload
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    """Make every Bearer token verify as a known admin user."""
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
        c.auth_header = {"Authorization": "Bearer fake-admin-token"}
        yield c


@pytest.fixture()
def anon_client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _fake_version():
    """An EvaluationVersion-like object with a full payload."""
    from services.cohesion_engine.engine import EvaluationVersion

    return EvaluationVersion(
        id="00000000-0000-0000-0000-000000000001",
        slug="cohesion-v1",
        status="published",
        payload={
            "values": {
                "tier_values": {"Elite": 8, "Proficient": 4},
                "theoretical_max": {"spacing": 24.0, "finishing": 16.0},
                "composite_coefficients": {"spacing_off_dribble": 0.5},
                "weights": {"offense": 0.5, "defense": 0.5},
            },
            "taxonomy": {
                "subscore_tree": [{"key": "offense", "label": "Offense"}],
                "impact_traits": [{"key": "spacing", "label": "Spacing"}],
            },
            "formula_refs": {"spacing": "spacing_v1"},
        },
    )


# ---------------------------------------------------------------------------
# GET / (list) — admin only
# ---------------------------------------------------------------------------


class TestListVersionsAdminOnly:
    def test_unauthenticated_request_is_rejected(self, anon_client):
        resp = anon_client.get("/api/evaluation-versions")
        assert resp.status_code == 401

    def test_admin_request_returns_versions(self, admin_client):
        from services.evaluation_versions import repo

        with patch.object(repo, "list_versions", return_value=[_fake_version()]):
            resp = admin_client.get(
                "/api/evaluation-versions",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert len(body["data"]) == 1
        # Admin caller sees the full payload
        assert "composite_coefficients" in body["data"][0]["payload"]["values"]
        assert "weights" in body["data"][0]["payload"]["values"]


# ---------------------------------------------------------------------------
# GET /draft — admin only
# ---------------------------------------------------------------------------


class TestGetDraftAdminOnly:
    def test_unauthenticated_request_is_rejected(self, anon_client):
        resp = anon_client.get("/api/evaluation-versions/draft")
        assert resp.status_code == 401

    def test_admin_request_returns_draft(self, admin_client):
        from services.evaluation_versions import repo

        with patch.object(repo, "get_draft", return_value=_fake_version()):
            resp = admin_client.get(
                "/api/evaluation-versions/draft",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        # Admin caller sees the full payload
        assert "composite_coefficients" in body["data"]["payload"]["values"]

    def test_admin_request_returns_null_when_no_draft(self, admin_client):
        from services.evaluation_versions import repo

        with patch.object(repo, "get_draft", return_value=None):
            resp = admin_client.get(
                "/api/evaluation-versions/draft",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"] is None


# ---------------------------------------------------------------------------
# GET /active — public stripped, admin full
# ---------------------------------------------------------------------------


class TestGetActivePublicProjection:
    def test_unauthenticated_request_returns_stripped_payload(self, anon_client):
        from services.evaluation_versions import repo

        with patch.object(repo, "get_active", return_value=_fake_version()):
            resp = anon_client.get("/api/evaluation-versions/active")

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        payload = body["data"]["payload"]

        # Public projection keeps only Builder-required fields
        assert set(payload["values"].keys()) == {"tier_values", "theoretical_max"}
        assert set(payload["taxonomy"].keys()) == {"subscore_tree"}

        # Sensitive engine config is NOT exposed to anonymous callers
        assert "composite_coefficients" not in payload["values"]
        assert "weights" not in payload["values"]
        assert "impact_traits" not in payload["taxonomy"]
        assert "formula_refs" not in payload

    def test_admin_request_returns_full_payload(self, admin_client):
        from services.evaluation_versions import repo

        with patch.object(repo, "get_active", return_value=_fake_version()):
            resp = admin_client.get(
                "/api/evaluation-versions/active",
                headers=admin_client.auth_header,
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        payload = body["data"]["payload"]

        # Admin caller sees the full payload — calibration UIs need it
        assert "composite_coefficients" in payload["values"]
        assert "weights" in payload["values"]
        assert "impact_traits" in payload["taxonomy"]
        assert "formula_refs" in payload

    def test_invalid_token_falls_back_to_public_projection(self, anon_client):
        """A bad/expired token should not 401 — it degrades to the public projection."""
        from services.evaluation_versions import repo

        with patch.object(repo, "get_active", return_value=_fake_version()):
            resp = anon_client.get(
                "/api/evaluation-versions/active",
                headers={"Authorization": "Bearer garbage-token"},
            )

        # Endpoint stays reachable; payload is stripped because the token didn't verify.
        assert resp.status_code == 200
        payload = resp.get_json()["data"]["payload"]
        assert "composite_coefficients" not in payload["values"]
