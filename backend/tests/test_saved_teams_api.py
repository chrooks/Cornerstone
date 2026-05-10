"""
Integration tests for POST /api/saved-teams.
"""

from __future__ import annotations

import json

import pytest

from app import create_app
from api import auth, saved_teams


USER_ID = "11111111-1111-1111-1111-111111111111"
SNAPSHOT_RELEASE_ID = "22222222-2222-2222-2222-222222222222"
LEGEND_ID = "33333333-3333-3333-3333-333333333333"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._insert_payload = None
        self._delete = False
        self._filters: dict[str, object] = {}
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def delete(self):
        self._delete = True
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
        if self._insert_payload is not None:
            return _FakeResult(self.db.insert(self.table_name, self._insert_payload))
        if self._delete:
            return _FakeResult(self.db.delete(self.table_name, self._filters))
        rows = self.db.select(self.table_name, self._filters)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self, *, missing_snapshot_releases: bool = False):
        self.missing_snapshot_releases = missing_snapshot_releases
        self.rows = {
            "snapshot_releases": [
                {
                    "id": SNAPSHOT_RELEASE_ID,
                    "season": "2024-25",
                    "label": "2024-25 Current",
                    "status": "published",
                }
            ],
            "legends": [{"id": LEGEND_ID, "name": "Hakeem Olajuwon"}],
            "saved_teams": [],
            "saved_team_players": [],
        }

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name: str, filters: dict[str, object]):
        if table_name == "snapshot_releases" and self.missing_snapshot_releases:
            raise RuntimeError("Could not find the table 'public.snapshot_releases' in the schema cache")
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        return rows

    def insert(self, table_name: str, payload):
        rows = payload if isinstance(payload, list) else [payload]
        inserted = []
        for row in rows:
            stored = dict(row)
            stored.setdefault("id", f"{table_name}-{len(self.rows[table_name]) + 1}")
            self.rows[table_name].append(stored)
            inserted.append(stored)
        return inserted

    def delete(self, table_name: str, filters: dict[str, object]):
        before = len(self.rows.get(table_name, []))
        self.rows[table_name] = [
            row
            for row in self.rows.get(table_name, [])
            if not all(row.get(key) == value for key, value in filters.items())
        ]
        return [{"deleted": before - len(self.rows[table_name])}]


@pytest.fixture()
def fake_supabase(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(auth, "_verify_jwt", lambda _token: {"sub": USER_ID})
    monkeypatch.setattr(saved_teams, "get_supabase", lambda: db)
    return db


@pytest.fixture()
def client(fake_supabase):
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def valid_player(slot: int) -> dict:
    if slot == 1:
        return {
            "slot": 1,
            "is_cornerstone": True,
            "legend_id": LEGEND_ID,
            "player_id": None,
            "salary_snapshot": 54_000_000,
            "player_name_snapshot": "Hakeem Olajuwon",
            "team_snapshot": None,
            "position_snapshot": "C",
            "skill_profile_snapshot": {"rim_protector": "All-Time Great"},
        }

    return {
        "slot": slot,
        "is_cornerstone": False,
        "legend_id": None,
        "player_id": f"44444444-4444-4444-4444-44444444444{slot}",
        "salary_snapshot": 10_000_000,
        "player_name_snapshot": f"Player {slot}",
        "team_snapshot": "OKC",
        "position_snapshot": "G",
        "skill_profile_snapshot": {"spot_up_shooter": "Elite"},
    }


def valid_payload() -> dict:
    return {
        "ruleset_slug": "standard",
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "cornerstone_legend_id": LEGEND_ID,
        "players": [valid_player(slot) for slot in range(1, 10)],
        "evaluation": {
            "star_rating": 3.9,
            "starting_lineup_score": 4.1,
            "team_description": "A sharp Hakeem build with real defensive bite.",
        },
    }


def post_saved_team(client, body: dict, token: str | None = "test-token"):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.post(
        "/api/saved-teams",
        data=json.dumps(body),
        headers=headers,
    )
    return resp, resp.get_json()


def test_save_team_requires_authenticated_user(client):
    resp, data = post_saved_team(client, valid_payload(), token=None)

    assert resp.status_code == 401
    assert data["success"] is False
    assert data["data"] is None
    assert "Authorization" in data["error"]


def test_save_team_persists_valid_standard_rotation(client, fake_supabase):
    resp, data = post_saved_team(client, valid_payload())

    assert resp.status_code == 201
    assert data["success"] is True
    assert data["data"]["name"] == "Hakeem Olajuwon Standard Rotation"
    assert data["data"]["ruleset_slug"] == "standard"
    assert data["data"]["snapshot_release_id"] == SNAPSHOT_RELEASE_ID
    assert data["data"]["visibility"] == "private"

    saved_team = fake_supabase.rows["saved_teams"][0]
    assert saved_team["user_id"] == USER_ID
    assert saved_team["total_salary"] == 134_000_000
    assert saved_team["star_rating"] == 3.9
    assert saved_team["starting_lineup_score"] == 4.1
    assert len(fake_supabase.rows["saved_team_players"]) == 9
    assert [row["slot"] for row in fake_supabase.rows["saved_team_players"]] == list(range(1, 10))


def test_save_team_rejects_incomplete_standard_rotation(client):
    body = valid_payload()
    body["players"] = body["players"][:8]

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "9 players" in data["error"]


def test_save_team_rejects_standard_rotation_over_salary_cap(client):
    body = valid_payload()
    for player in body["players"]:
        if not player["is_cornerstone"]:
            player["salary_snapshot"] = 20_000_000

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "SalaryCap" in data["error"]


def test_save_team_reports_missing_snapshot_release_migration(monkeypatch):
    db = _FakeSupabase(missing_snapshot_releases=True)
    monkeypatch.setattr(auth, "_verify_jwt", lambda _token: {"sub": USER_ID})
    monkeypatch.setattr(saved_teams, "get_supabase", lambda: db)

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        resp, data = post_saved_team(client, valid_payload())

    assert resp.status_code == 503
    assert data["success"] is False
    assert "Snapshot Release migration has not been applied" in data["error"]
