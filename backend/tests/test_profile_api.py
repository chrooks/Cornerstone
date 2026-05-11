"""
Integration tests for User Profile endpoints.
"""

from __future__ import annotations

import json

from app import create_app
from api import auth, profile


USER_ID = "11111111-1111-1111-1111-111111111111"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: dict[str, object] = {}
        self._insert_payload = None
        self._update_payload = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        if self._insert_payload is not None:
            return _FakeResult(self.db.insert(self.table_name, self._insert_payload))
        if self._update_payload is not None:
            return _FakeResult(self.db.update(self.table_name, self._filters, self._update_payload))
        return _FakeResult(self.db.select(self.table_name, self._filters))


class _FakeSupabase:
    def __init__(self):
        self.rows = {"user_profiles": []}

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name: str, filters: dict[str, object]):
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        return rows

    def insert(self, table_name: str, payload):
        stored = dict(payload)
        stored.setdefault("id", f"{table_name}-1")
        self.rows[table_name].append(stored)
        return [stored]

    def update(self, table_name: str, filters: dict[str, object], payload):
        updated = []
        for row in self.rows[table_name]:
            if all(row.get(key) == value for key, value in filters.items()):
                row.update(payload)
                updated.append(dict(row))
        return updated


def test_patch_profile_creates_minimal_user_profile(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(auth, "_verify_jwt", lambda _token: {"sub": USER_ID})
    monkeypatch.setattr(profile, "get_supabase", lambda: db)

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        resp = client.patch(
            "/api/me/profile",
            data=json.dumps({
                "display_name": "Cornerstone GM",
                "favorite_player_name": "Hakeem Olajuwon",
            }),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer test-token",
            },
        )

    data = resp.get_json()
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["user_id"] == USER_ID
    assert data["data"]["display_name"] == "Cornerstone GM"
    assert data["data"]["favorite_player_name"] == "Hakeem Olajuwon"
    assert db.rows["user_profiles"][0]["user_id"] == USER_ID
