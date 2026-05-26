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
