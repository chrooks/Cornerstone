"""
Integration tests for RuleSet read endpoints.
"""

from __future__ import annotations

from app import create_app
from api import rulesets


STANDARD_RULESET_ID = "11111111-1111-1111-1111-111111111111"
STANDARD_VERSION_ID = "22222222-2222-2222-2222-222222222222"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: dict[str, object] = {}
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = self.db.select(self.table_name, self._filters)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self):
        self.rows = {
            "rulesets": [
                {
                    "id": STANDARD_RULESET_ID,
                    "slug": "standard",
                    "name": "Standard",
                    "description": "The classic format.",
                    "status": "active",
                    "display_order": 1,
                },
                {
                    "id": "33333333-3333-3333-3333-333333333333",
                    "slug": "free-for-all",
                    "name": "Free For All",
                    "description": "Pure best-of.",
                    "status": "coming_soon",
                    "display_order": 2,
                },
            ],
            "ruleset_versions": [
                {
                    "id": STANDARD_VERSION_ID,
                    "ruleset_id": STANDARD_RULESET_ID,
                    "version_label": "v1",
                    "rules_hash": "standard-v1",
                    "rules_json": {
                        "team_size": 9,
                        "team_label": "Rotation",
                        "salary_cap": 195_000_000,
                        "cornerstone_rule": "1 Legend required ($54M)",
                        "player_pool": "2025-26 Snapshot + Legends",
                        "rookie_deal_limit": 2,
                    },
                    "status": "published",
                    "published_at": "2026-05-11T00:00:00Z",
                },
            ],
        }

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name: str, filters: dict[str, object]):
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        return rows


def test_list_rulesets_returns_published_versions(monkeypatch):
    monkeypatch.setattr(rulesets, "get_supabase", lambda: _FakeSupabase())

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        resp = client.get("/api/rulesets")

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["error"] is None
    assert data["data"][0]["slug"] == "standard"
    assert data["data"][0]["current_version"]["id"] == STANDARD_VERSION_ID
    assert data["data"][0]["rules"]["team_size"] == 9
    assert data["data"][1]["slug"] == "free-for-all"
    assert data["data"][1]["current_version"] is None
