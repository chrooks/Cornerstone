"""
API tests for GET /api/changelog (issue #18).

The endpoint is public. These tests patch the two Supabase fetch helpers so the
route + assembler + response envelope are exercised without touching the DB.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app import create_app


@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


RULESET_ROWS = [
    {
        "version_label": "v2",
        "published_at": "2026-05-10T12:00:00+00:00",
        "ruleset_name": "All-Time",
        "ruleset_slug": "all-time",
    }
]

EVAL_ROWS = [
    {
        "slug": "cohesion-v2",
        "changelog_note": "Rebalanced spacing weights.",
        "published_at": "2026-05-11T12:00:00+00:00",
    }
]

SNAPSHOT_ROWS = [
    {
        "id": "rel-abc",
        "label": "Opening Night",
        "season": "2025-26",
        "published_at": "2026-05-12T12:00:00+00:00",
    }
]


class TestChangelogEndpoint:
    def test_is_public_and_returns_merged_feed(self, client):
        import api.changelog as changelog_mod

        with patch.object(
            changelog_mod, "_fetch_published_ruleset_versions", return_value=RULESET_ROWS
        ), patch.object(
            changelog_mod, "_fetch_published_evaluation_versions", return_value=EVAL_ROWS
        ), patch.object(
            changelog_mod, "_fetch_published_snapshots", return_value=SNAPSHOT_ROWS
        ):
            resp = client.get("/api/changelog")

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["error"] is None

        data = body["data"]
        assert len(data) == 3
        # Newest first: snapshot (05-12), eval (05-11), ruleset (05-10).
        assert data[0]["type"] == "snapshot_release"
        assert data[1]["type"] == "evaluation_version"
        assert data[2]["type"] == "ruleset_version"

        # Each entry carries the required fields.
        for entry in data:
            assert {"type", "date", "version_label", "title", "summary", "link"} <= entry.keys()

        # RuleSet entry links into the Lab.
        ruleset_entry = data[2]
        assert ruleset_entry["link"] == "/lab/all-time"
        assert "All-Time" in ruleset_entry["title"]

        # Eval entry uses the admin changelog note as its summary.
        assert data[1]["summary"] == "Rebalanced spacing weights."

        # Snapshot Release entry links to its public release diff page and
        # carries the release label as its title.
        snapshot_entry = data[0]
        assert snapshot_entry["link"] == "/snapshots/rel-abc"
        assert snapshot_entry["title"] == "Opening Night"

    def test_empty_when_no_published_versions(self, client):
        import api.changelog as changelog_mod

        with patch.object(
            changelog_mod, "_fetch_published_ruleset_versions", return_value=[]
        ), patch.object(
            changelog_mod, "_fetch_published_evaluation_versions", return_value=[]
        ), patch.object(
            changelog_mod, "_fetch_published_snapshots", return_value=[]
        ):
            resp = client.get("/api/changelog")

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"] == []

    def test_limit_query_param_is_respected_and_clamped(self, client):
        import api.changelog as changelog_mod

        many_eval = [
            {
                "slug": f"cohesion-v{i}",
                "changelog_note": f"note {i}",
                "published_at": f"2026-05-{i:02d}T00:00:00+00:00",
            }
            for i in range(1, 6)
        ]

        with patch.object(
            changelog_mod, "_fetch_published_ruleset_versions", return_value=[]
        ), patch.object(
            changelog_mod, "_fetch_published_evaluation_versions", return_value=many_eval
        ), patch.object(
            changelog_mod, "_fetch_published_snapshots", return_value=[]
        ):
            resp = client.get("/api/changelog?limit=2")

        body = resp.get_json()
        assert len(body["data"]) == 2
        assert body["data"][0]["version_label"] == "cohesion-v5"

    def test_returns_500_envelope_on_fetch_error(self, client):
        import api.changelog as changelog_mod

        with patch.object(
            changelog_mod,
            "_fetch_published_ruleset_versions",
            side_effect=RuntimeError("db down"),
        ):
            resp = client.get("/api/changelog")

        assert resp.status_code == 500
        body = resp.get_json()
        assert body["success"] is False
        assert body["data"] is None
        assert body["error"]
