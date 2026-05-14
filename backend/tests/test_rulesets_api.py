"""
Integration tests for RuleSet endpoints (read + admin write).
"""

from __future__ import annotations

import uuid

import pytest

from app import create_app
from api import auth, rulesets


STANDARD_RULESET_ID = "11111111-1111-1111-1111-111111111111"
STANDARD_VERSION_ID = "22222222-2222-2222-2222-222222222222"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    """Chainable query builder that supports select, insert, update, and filter ops."""

    def __init__(self, db: "_FakeSupabase", table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: dict[str, object] = {}
        self._limit = None
        self._insert_data: dict | None = None
        self._update_data: dict | None = None

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

    def maybe_single(self):
        return self

    def insert(self, data: dict):
        self._insert_data = data
        return self

    def update(self, data: dict):
        self._update_data = data
        return self

    def execute(self):
        if self._insert_data is not None:
            return self.db.do_insert(self.table_name, self._insert_data)
        if self._update_data is not None:
            return self.db.do_update(self.table_name, self._filters, self._update_data)
        rows = self.db.do_select(self.table_name, self._filters)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {
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
                    "rules_hash": "375b5966733c5d3dd5350098e70c55a0",
                    "rules_json": {
                        "team_size": 9,
                        "team_label": "Rotation",
                        "salary_cap": 195_000_000,
                        "salary_cap_display": "$195M",
                        "cornerstone_rule": "1 Legend required ($54M)",
                        "cornerstone_salary": 54_000_000,
                        "player_pool": "2025-26 Snapshot + Legends",
                        "rookie_deal_limit": 2,
                    },
                    "status": "published",
                    "published_at": "2026-05-11T00:00:00Z",
                },
            ],
            "user_roles": [
                {"user_id": "admin-user", "role": "admin"},
            ],
        }

    def table(self, name: str):
        return _FakeQuery(self, name)

    def do_select(self, table_name: str, filters: dict[str, object]) -> list[dict]:
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        return rows

    # Alias kept for backwards compat with old test helper name
    select = do_select

    def do_insert(self, table_name: str, data: dict) -> _FakeResult:
        row = {**data, "id": data.get("id", str(uuid.uuid4()))}
        self.rows.setdefault(table_name, []).append(row)
        return _FakeResult([row])

    def do_update(self, table_name: str, filters: dict[str, object], data: dict) -> _FakeResult:
        updated: list[dict] = []
        for row in self.rows.get(table_name, []):
            if all(row.get(k) == v for k, v in filters.items()):
                row.update(data)
                updated.append(row)
        return _FakeResult(updated)


@pytest.fixture()
def fake_db():
    return _FakeSupabase()


@pytest.fixture()
def admin_client(monkeypatch, fake_db):
    """Test client with admin auth bypassed and fake Supabase wired up."""
    monkeypatch.setattr(auth, "_verify_jwt", lambda _token: {"sub": "admin-user"})
    monkeypatch.setattr(auth, "get_supabase", lambda: fake_db)
    monkeypatch.setattr(rulesets, "get_supabase", lambda: fake_db)

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_canonical_rules_hash_is_deterministic():
    """Same rules_json produces same hash regardless of key order."""
    from api.rulesets import canonical_rules_hash

    ordered_a = {"salary_cap": 195_000_000, "team_size": 9, "rookie_deal_limit": 2}
    ordered_b = {"team_size": 9, "rookie_deal_limit": 2, "salary_cap": 195_000_000}

    assert canonical_rules_hash(ordered_a) == canonical_rules_hash(ordered_b)
    assert len(canonical_rules_hash(ordered_a)) == 32


def test_list_rulesets_returns_published_versions(admin_client):
    resp = admin_client.get("/api/rulesets")

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["error"] is None
    assert data["data"][0]["slug"] == "standard"
    assert data["data"][0]["current_version"]["id"] == STANDARD_VERSION_ID
    assert data["data"][0]["rules"]["team_size"] == 9
    assert data["data"][1]["slug"] == "free-for-all"
    assert data["data"][1]["current_version"] is None


def test_get_ruleset_returns_single_ruleset(admin_client):
    resp = admin_client.get("/api/rulesets/standard")

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["slug"] == "standard"
    assert data["data"]["current_version"]["id"] == STANDARD_VERSION_ID


def test_get_ruleset_returns_404_for_unknown_slug(admin_client):
    resp = admin_client.get("/api/rulesets/nonexistent")

    data = resp.get_json()
    assert resp.status_code == 404
    assert data["success"] is False


# ---------------------------------------------------------------------------
# Write endpoints
# ---------------------------------------------------------------------------


def test_create_ruleset_returns_201_with_created_data(admin_client):
    resp = admin_client.post(
        "/api/rulesets",
        json={
            "slug": "budget",
            "name": "Budget",
            "description": "Build on a shoestring.",
            "status": "coming_soon",
            "display_order": 3,
        },
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 201
    assert data["success"] is True
    assert data["data"]["slug"] == "budget"
    assert data["data"]["name"] == "Budget"
    assert data["data"]["status"] == "coming_soon"
    assert data["data"]["display_order"] == 3
    assert "id" in data["data"]


def test_create_ruleset_rejects_missing_slug(admin_client):
    resp = admin_client.post(
        "/api/rulesets",
        json={"name": "No Slug"},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert data["success"] is False
    assert "slug" in data["error"].lower()


def test_create_ruleset_rejects_invalid_status(admin_client):
    resp = admin_client.post(
        "/api/rulesets",
        json={"slug": "test", "name": "Test", "status": "bogus"},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert data["success"] is False
    assert "status" in data["error"].lower()


def test_update_ruleset_returns_updated_fields(admin_client):
    resp = admin_client.patch(
        "/api/rulesets/standard",
        json={"name": "Standard+", "description": "Updated.", "display_order": 10},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["name"] == "Standard+"
    assert data["data"]["description"] == "Updated."
    assert data["data"]["display_order"] == 10


def test_update_ruleset_returns_404_for_unknown_slug(admin_client):
    resp = admin_client.patch(
        "/api/rulesets/nonexistent",
        json={"name": "Nope"},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 404
    assert data["success"] is False


def test_list_versions_returns_all_versions_for_ruleset(admin_client, fake_db):
    # Add a draft version alongside the published one
    fake_db.rows["ruleset_versions"].append({
        "id": "44444444-4444-4444-4444-444444444444",
        "ruleset_id": STANDARD_RULESET_ID,
        "version_label": "v2",
        "rules_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1",
        "rules_json": {"team_size": 7},
        "status": "draft",
        "published_at": None,
        "created_at": "2026-05-12T00:00:00Z",
    })

    resp = admin_client.get(
        "/api/rulesets/standard/versions",
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert len(data["data"]) == 2
    labels = {v["version_label"] for v in data["data"]}
    assert labels == {"v1", "v2"}


def test_create_version_returns_201_with_server_computed_hash(admin_client):
    rules = {"team_size": 5, "salary_cap": 100_000_000}

    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "v2", "rules_json": rules},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 201
    assert data["success"] is True
    assert data["data"]["version_label"] == "v2"
    assert data["data"]["status"] == "draft"
    # team_label is derived server-side from team_size
    assert data["data"]["rules_json"]["team_size"] == 5
    assert data["data"]["rules_json"]["team_label"] == "Lineup"
    assert data["data"]["rules_json"]["salary_cap"] == 100_000_000
    # Hash must be server-computed, not empty
    assert len(data["data"]["rules_hash"]) == 32


def test_create_version_accepts_allowed_team_sizes(admin_client):
    rules = {
        "team_size": 9,
        "allowed_team_sizes": [5, 9, 12],
        "cornerstone_source": "all",
    }

    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "multi-size", "rules_json": rules},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 201
    assert data["success"] is True
    assert data["data"]["rules_json"]["team_size"] == 9
    assert data["data"]["rules_json"]["team_label"] == "Rotation"
    assert data["data"]["rules_json"]["allowed_team_sizes"] == [5, 9, 12]


def test_create_version_rejects_invalid_allowed_team_sizes(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "multi-size", "rules_json": {"team_size": 9, "allowed_team_sizes": [5, 7, 12]}},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert data["success"] is False
    assert "allowed_team_sizes" in data["error"]


def test_create_version_rejects_duplicate_allowed_team_sizes(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "multi-size", "rules_json": {"team_size": 9, "allowed_team_sizes": [5, 9, 9]}},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert data["success"] is False
    assert "duplicates" in data["error"]


def test_create_version_rejects_team_size_outside_allowed_team_sizes(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "multi-size", "rules_json": {"team_size": 9, "allowed_team_sizes": [5, 12]}},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert data["success"] is False
    assert "team_size" in data["error"]



def test_create_version_rejects_invalid_team_size(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "v2", "rules_json": {"team_size": 7}},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert "team_size" in data["error"].lower()


def test_create_version_derives_team_label_from_team_size(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "v2", "rules_json": {"team_size": 5, "salary_cap": 100_000_000}},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 201
    assert data["data"]["rules_json"]["team_label"] == "Lineup"


def test_create_version_rejects_missing_rules_json(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions",
        json={"version_label": "v2"},
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert "rules_json" in data["error"].lower()


def test_publish_version_sets_published_and_retires_old(admin_client, fake_db):
    # Add a draft version
    draft_id = "55555555-5555-5555-5555-555555555555"
    fake_db.rows["ruleset_versions"].append({
        "id": draft_id,
        "ruleset_id": STANDARD_RULESET_ID,
        "version_label": "v2",
        "rules_hash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "rules_json": {"team_size": 7},
        "status": "draft",
        "published_at": None,
    })

    resp = admin_client.post(
        f"/api/rulesets/standard/versions/{draft_id}/publish",
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["status"] == "published"
    assert data["data"]["published_at"] is not None

    # Old published version should now be retired
    old_version = next(
        v for v in fake_db.rows["ruleset_versions"] if v["id"] == STANDARD_VERSION_ID
    )
    assert old_version["status"] == "retired"


def test_publish_version_rejects_non_draft(admin_client):
    """Cannot publish an already-published version."""
    resp = admin_client.post(
        f"/api/rulesets/standard/versions/{STANDARD_VERSION_ID}/publish",
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 400
    assert "draft" in data["error"].lower()


def test_publish_version_returns_404_for_unknown_version(admin_client):
    resp = admin_client.post(
        "/api/rulesets/standard/versions/99999999-9999-9999-9999-999999999999/publish",
        headers={"Authorization": "Bearer fake-token"},
    )

    data = resp.get_json()
    assert resp.status_code == 404
    assert data["success"] is False
