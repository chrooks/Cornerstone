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


class TestChangelogEndpoint:
    def test_is_public_and_returns_merged_feed(self, client):
        import api.changelog as changelog_mod

        with patch.object(
            changelog_mod, "_fetch_published_ruleset_versions", return_value=RULESET_ROWS
        ), patch.object(
            changelog_mod, "_fetch_published_evaluation_versions", return_value=EVAL_ROWS
        ):
            resp = client.get("/api/changelog")

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["error"] is None

        data = body["data"]
        assert len(data) == 2
        # Newest first: eval (05-11) before ruleset (05-10).
        assert data[0]["type"] == "evaluation_version"
        assert data[1]["type"] == "ruleset_version"

        # Each entry carries the required fields.
        for entry in data:
            assert {"type", "date", "version_label", "title", "summary", "link"} <= entry.keys()

        # RuleSet entry links into the Lab.
        ruleset_entry = data[1]
        assert ruleset_entry["link"] == "/lab/all-time"
        assert "All-Time" in ruleset_entry["title"]

        # Eval entry uses the admin changelog note as its summary.
        assert data[0]["summary"] == "Rebalanced spacing weights."

    def test_empty_when_no_published_versions(self, client):
        import api.changelog as changelog_mod

        with patch.object(
            changelog_mod, "_fetch_published_ruleset_versions", return_value=[]
        ), patch.object(
            changelog_mod, "_fetch_published_evaluation_versions", return_value=[]
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
