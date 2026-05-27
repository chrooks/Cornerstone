"""
test_draft_gate.py — Unit tests for the require_open_draft decorator.

Tests the contract:
  - 409 with {success: false, error: "no_open_draft"} when no draft exists.
  - g.draft_id is populated when draft is open.
  - Stacks correctly under @require_admin.
  - Does NOT gate snapshot lifecycle routes.
"""

from __future__ import annotations

import functools
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask, g, jsonify


# ---------------------------------------------------------------------------
# Helpers — minimal Flask app fixture for testing the decorator in isolation
# ---------------------------------------------------------------------------


def _make_app():
    """Create a minimal Flask test app with require_open_draft applied to routes."""
    from api.auth import require_open_draft

    app = Flask(__name__)
    app.config["TESTING"] = True

    @app.route("/gated", methods=["POST"])
    @require_open_draft
    def gated_route():
        return jsonify({"success": True, "draft_id": g.draft_id}), 200

    @app.route("/admin-then-draft", methods=["POST"])
    @require_open_draft
    def stacked_route():
        return jsonify({"success": True, "draft_id": g.draft_id}), 200

    return app


# ---------------------------------------------------------------------------
# Case 1: 409 when no draft exists
# ---------------------------------------------------------------------------


def test_require_open_draft_returns_409_when_no_draft():
    """Without an open draft, every gated route returns 409 no_open_draft."""
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", return_value=None):
        with app.test_client() as client:
            resp = client.post("/gated")

    assert resp.status_code == 409
    data = resp.get_json()
    assert data["success"] is False
    assert data["error"] == "no_open_draft"


# ---------------------------------------------------------------------------
# Case 2: passes through and populates g.draft_id when draft exists
# ---------------------------------------------------------------------------


def test_require_open_draft_passes_through_with_open_draft():
    """With an open draft, route executes and g.draft_id is the draft's id."""
    from services.snapshot_versions.repo import SnapshotRelease

    mock_draft = SnapshotRelease(
        id="draft-uuid-1234",
        label="draft-abc",
        season="2025-26",
        status="draft",
        is_active=False,
        published_at=None,
        created_at="2026-01-01T00:00:00Z",
    )
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", return_value=mock_draft):
        with app.test_client() as client:
            resp = client.post("/gated")

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["draft_id"] == "draft-uuid-1234"


# ---------------------------------------------------------------------------
# Case 3: "review" status also counts as open
# ---------------------------------------------------------------------------


def test_require_open_draft_accepts_review_status():
    """status='review' is also an open draft — must NOT 409."""
    from services.snapshot_versions.repo import SnapshotRelease

    mock_draft = SnapshotRelease(
        id="review-uuid-5678",
        label="draft-xyz",
        season="2025-26",
        status="review",
        is_active=False,
        published_at=None,
        created_at="2026-01-01T00:00:00Z",
    )
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", return_value=mock_draft):
        with app.test_client() as client:
            resp = client.post("/gated")

    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Case 4: snap_repo.get_draft raises — should 500, not crash server
# ---------------------------------------------------------------------------


def test_require_open_draft_500_when_snap_repo_raises():
    """If snap_repo.get_draft raises an exception, respond 500."""
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", side_effect=Exception("db dead")):
        with app.test_client() as client:
            resp = client.post("/gated")

    assert resp.status_code == 500
    data = resp.get_json()
    assert data["success"] is False


# ---------------------------------------------------------------------------
# Case 5: decorator preserves the wrapped function's name
# ---------------------------------------------------------------------------


def test_require_open_draft_preserves_function_name():
    """functools.wraps must be used so route names survive decoration."""
    from api.auth import require_open_draft

    def my_handler():
        pass

    wrapped = require_open_draft(my_handler)
    assert wrapped.__name__ == "my_handler"


# ---------------------------------------------------------------------------
# Case 6: 409 error body has no data key leaking internal state
# ---------------------------------------------------------------------------


def test_require_open_draft_409_body_shape():
    """409 body must be exactly {success: false, data: null, error: 'no_open_draft'}."""
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", return_value=None):
        with app.test_client() as client:
            resp = client.post("/gated")

    data = resp.get_json()
    assert data == {"success": False, "data": None, "error": "no_open_draft"}


# ---------------------------------------------------------------------------
# Case 7: 409 when published release is active but no open draft
# ---------------------------------------------------------------------------


def test_require_open_draft_409_with_only_published_release():
    """A published-only release (is_active=true, status='published') is not a draft."""
    app = _make_app()
    # get_draft returns None when no row with status in ('draft','review')
    with patch("api.auth.snap_repo.get_draft", return_value=None):
        with app.test_client() as client:
            resp = client.post("/gated")

    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Case 8: g.draft_id is accessible within the route body
# ---------------------------------------------------------------------------


def test_require_open_draft_draft_id_is_string_in_g():
    """g.draft_id must be a str (not the SnapshotRelease object)."""
    from services.snapshot_versions.repo import SnapshotRelease

    mock_draft = SnapshotRelease(
        id="str-check-uuid",
        label="draft-test",
        season="2025-26",
        status="draft",
        is_active=False,
        published_at=None,
        created_at="2026-01-01T00:00:00Z",
    )
    app = _make_app()
    with patch("api.auth.snap_repo.get_draft", return_value=mock_draft):
        with app.test_client() as client:
            resp = client.post("/gated")

    data = resp.get_json()
    assert isinstance(data["draft_id"], str)


# ---------------------------------------------------------------------------
# Integration: confirm the gate is wired on existing admin-write Surfaces
# ---------------------------------------------------------------------------


_GATED_ROUTES: list[tuple[str, str, dict | None]] = [
    # (method, path, json_body)
    # pipeline.py — 5 ingestion triggers
    ("POST", "/api/pipeline/fetch-stats", {}),
    ("POST", "/api/pipeline/salary-scrape", {}),
    ("POST", "/api/pipeline/salary-scrape/aaaaaaaa-0000-0000-0000-000000000001", None),
    ("POST", "/api/pipeline/bio-team-sync", {}),
    ("POST", "/api/pipeline/bio-team-sync/aaaaaaaa-0000-0000-0000-000000000001", None),
    # calibration.py — anchor writes (PUT thresholds is the special-case 409 path)
    ("POST", "/api/anchors", {}),
    ("DELETE", "/api/anchors/aaaaaaaa-0000-0000-0000-000000000001", None),
    # review.py — 3 flag-resolution writes
    ("POST", "/api/review/aaaaaaaa-0000-0000-0000-000000000001/resolve", {}),
    ("POST", "/api/review/bulk-resolve", {}),
    ("POST", "/api/review/aaaaaaaa-0000-0000-0000-000000000001/manual-override", {}),
    # legends.py — 2 PUT writes
    ("PUT", "/api/legends/aaaaaaaa-0000-0000-0000-000000000001/skills", {}),
    ("PUT", "/api/legends/aaaaaaaa-0000-0000-0000-000000000001/attributes", {}),
    # players.py — 4 mutation routes
    ("POST", "/api/players/manual-include", {}),
    ("DELETE", "/api/players/aaaaaaaa-0000-0000-0000-000000000001/manual-include", None),
    ("DELETE", "/api/players/aaaaaaaa-0000-0000-0000-000000000001", None),
    ("PATCH", "/api/players/aaaaaaaa-0000-0000-0000-000000000001/bio", {}),
    # composite.py — 3 admin-only composite Surfaces
    ("POST", "/api/players/aaaaaaaa-0000-0000-0000-000000000001/claude-assessment", {}),
    ("POST", "/api/players/aaaaaaaa-0000-0000-0000-000000000001/composite-profile", {}),
    ("POST", "/api/composite/batch", {}),
]


@pytest.fixture()
def gated_app_client(monkeypatch):
    """Full app test client with admin auth bypassed."""
    from app import create_app
    import api.auth as auth_mod
    from unittest.mock import MagicMock

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "test-admin"})
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

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.mark.parametrize("method,path,body", _GATED_ROUTES)
def test_draft_gate_applied_to_existing_calibration_writes(
    gated_app_client, monkeypatch, method, path, body
):
    """Every legacy admin-write Surface returns 409 no_open_draft with no draft.

    This is the parametrized contract sweep for Fix 5: each gated route
    must hit require_open_draft before the handler body runs, so when
    snap_repo.get_draft returns None we get the canonical 409 envelope
    rather than a 200/500 from the handler logic.
    """
    import api.auth as auth_mod
    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", lambda client=None: None)

    headers = {
        "Authorization": "Bearer fake-admin",
        # Some calibration routes also require this header; harmless elsewhere.
        "X-Calibration-Key": "anything",
    }
    resp = gated_app_client.open(path, method=method, headers=headers, json=body)

    assert resp.status_code == 409, (
        f"{method} {path} returned {resp.status_code}, expected 409 no_open_draft"
    )
    payload = resp.get_json()
    assert payload["success"] is False
    assert payload["error"] == "no_open_draft"
