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
STANDARD_RULESET_ID = "55555555-5555-5555-5555-555555555555"
STANDARD_RULESET_VERSION_ID = "66666666-6666-6666-6666-666666666666"
STANDARD_RULES_HASH = "standard-v1"


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
            "rulesets": [
                {
                    "id": STANDARD_RULESET_ID,
                    "slug": "standard",
                    "name": "Standard",
                    "status": "active",
                }
            ],
            "ruleset_versions": [
                {
                    "id": STANDARD_RULESET_VERSION_ID,
                    "ruleset_id": STANDARD_RULESET_ID,
                    "version_label": "v1",
                    "rules_hash": STANDARD_RULES_HASH,
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
                }
            ],
            "legends": [{"id": LEGEND_ID, "name": "Hakeem Olajuwon"}],
            "saved_teams": [],
            "saved_team_players": [],
            "saved_team_evaluations": [],
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
    evaluation_payload = {
        "star_rating": 3.9,
        "star_rating_breakdown": {
            "starting_5": 0.82,
            "depth": 0.72,
            "archetype_diversity": 0.68,
            "floor": 0.74,
        },
        "starting_lineup": {
            "cohesion_score": 4.1,
            "subscores": {"spacing": 8.2, "anchor": 8.7},
            "synergies_applied": ["Hakeem interior coverage"],
            "accentuation": {
                "strength_amplification": 0.81,
                "weakness_coverage": 0.76,
            },
        },
        "player_composites": [
            {"player_id": LEGEND_ID, "name": "Hakeem Olajuwon", "base": {"anchor": 10.0}},
        ],
        "lineup_summary": {
            "total_lineups": 126,
            "viable_lineups": 88,
            "median_score": 7.9,
            "archetype_labels": ["defense-first"],
        },
        "notes": [
            {
                "type": "strength",
                "category": "defense",
                "severity": 0.91,
                "raw_value": 8.7,
                "text": "Elite rim protection travels across the Rotation.",
            }
        ],
        "team_description": "A sharp Hakeem build with real defensive bite.",
    }
    return {
        "ruleset_slug": "standard",
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "rules_hash": STANDARD_RULES_HASH,
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "cornerstone_legend_id": LEGEND_ID,
        "players": [valid_player(slot) for slot in range(1, 10)],
        "evaluation": evaluation_payload,
    }


def _player_insert_rows(saved_team_id: str) -> list[dict]:
    rows = []
    for player in valid_payload()["players"]:
        rows.append({
            "id": f"saved-team-player-{player['slot']}",
            "saved_team_id": saved_team_id,
            "player_id": player.get("player_id"),
            "legend_id": player.get("legend_id"),
            "slot": player["slot"],
            "is_cornerstone": player["is_cornerstone"],
            "salary_snapshot": player["salary_snapshot"],
            "player_name_snapshot": player["player_name_snapshot"],
            "team_snapshot": player.get("team_snapshot"),
            "position_snapshot": player.get("position_snapshot"),
            "skill_profile_snapshot": player.get("skill_profile_snapshot", {}),
        })
    return rows


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


def get_saved_teams(client, token: str | None = "test-token"):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.get("/api/saved-teams", headers=headers)
    return resp, resp.get_json()


def get_saved_team_detail(client, saved_team_id: str, token: str | None = "test-token"):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.get(f"/api/saved-teams/{saved_team_id}", headers=headers)
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
    assert data["data"]["ruleset_version_id"] == STANDARD_RULESET_VERSION_ID
    assert data["data"]["snapshot_release_id"] == SNAPSHOT_RELEASE_ID
    assert data["data"]["visibility"] == "private"

    saved_team = fake_supabase.rows["saved_teams"][0]
    assert saved_team["user_id"] == USER_ID
    assert saved_team["ruleset_id"] == STANDARD_RULESET_ID
    assert saved_team["ruleset_version_id"] == STANDARD_RULESET_VERSION_ID
    assert saved_team["ruleset_version_hash"] == "standard-v1"
    assert saved_team["total_salary"] == 134_000_000
    assert len(fake_supabase.rows["saved_team_players"]) == 9
    assert [row["slot"] for row in fake_supabase.rows["saved_team_players"]] == list(range(1, 10))
    saved_evaluation = fake_supabase.rows["saved_team_evaluations"][0]
    assert saved_evaluation["saved_team_id"] == saved_team["id"]
    assert saved_evaluation["evaluation_version"] == "cohesion-v1"
    assert saved_evaluation["star_rating"] == 3.9
    assert saved_evaluation["starting_lineup_score"] == 4.1
    assert saved_evaluation["team_description"] == "A sharp Hakeem build with real defensive bite."
    assert saved_evaluation["evaluation_payload"] == valid_payload()["evaluation"]


def test_save_team_accepts_full_final_eval_payload_over_64kb(client, fake_supabase):
    body = valid_payload()
    body["evaluation"]["lineup_combinations"] = [
        {
            "rank": index + 1,
            "combination_index": index,
            "is_viable": True,
            "player_ids": [player["legend_id"] or player["player_id"] for player in body["players"][:5]],
            "player_names": [player["player_name_snapshot"] for player in body["players"][:5]],
            "is_starting_lineup": index == 0,
            "cohesion_score": 8.1,
            "subscores": {
                "spacing_creation_ratio": 8.3,
                "paint_touch_total": 7.7,
                "anchor_total": 8.8,
                "collective_passing": 7.9,
                "defensive_gaps": 8.0,
            },
            "synergies_applied": [
                "Hakeem protects the rim while perimeter defenders apply pressure.",
                "Secondary actions keep the spacing intact.",
            ],
            "archetype_labels": ["defense-first", "pace-control"],
            "accentuation": {
                "strength_amplification": 0.82,
                "weakness_coverage": 0.74,
            },
        }
        for index in range(126)
    ]

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 201
    assert data["success"] is True
    saved_evaluation = fake_supabase.rows["saved_team_evaluations"][0]
    assert len(saved_evaluation["evaluation_payload"]["lineup_combinations"]) == 126


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


def test_save_team_requires_ruleset_version_id_and_rules_hash(client):
    body = valid_payload()
    del body["ruleset_version_id"]
    del body["rules_hash"]

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "ruleset_version_id" in data["error"]


def test_save_team_reads_team_size_from_rules_json(client, fake_supabase):
    """Prove validator reads team_size from rules_json, not a Python constant."""
    fake_supabase.rows["ruleset_versions"][0]["rules_json"]["team_size"] = 5
    body = valid_payload()

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "5" in data["error"]


CANONICAL_PLAYER_IDS = {
    slot: f"77777777-7777-7777-7777-77777777777{slot}" for slot in range(2, 10)
}
SNAPSHOT_PLAYER_IDS = {
    slot: f"88888888-8888-8888-8888-88888888888{slot}" for slot in range(2, 10)
}


def test_save_team_resolves_snapshot_player_ids_on_insert(client, fake_supabase):
    """Server resolves snapshot_player_id + canonical_player_id from source_player_id."""
    for slot in range(2, 10):
        source_player_id = f"44444444-4444-4444-4444-44444444444{slot}"
        fake_supabase.rows.setdefault("snapshot_players", []).append({
            "id": SNAPSHOT_PLAYER_IDS[slot],
            "snapshot_release_id": SNAPSHOT_RELEASE_ID,
            "canonical_player_id": CANONICAL_PLAYER_IDS[slot],
            "source_player_id": source_player_id,
            "name": f"Player {slot}",
        })

    resp, data = post_saved_team(client, valid_payload())

    assert resp.status_code == 201
    assert data["success"] is True

    saved_players = fake_supabase.rows["saved_team_players"]
    for row in saved_players:
        if row["is_cornerstone"]:
            assert row.get("snapshot_player_id") is None
            continue
        slot = row["slot"]
        assert row["snapshot_player_id"] == SNAPSHOT_PLAYER_IDS[slot]
        assert row["canonical_player_id"] == CANONICAL_PLAYER_IDS[slot]


def test_save_team_rejects_too_many_rookie_deals(client):
    """Prove validator enforces rookie_deal_limit from rules_json."""
    body = valid_payload()
    rookie_count = 0
    for player in body["players"]:
        if not player["is_cornerstone"] and rookie_count < 3:
            player["is_rookie_deal"] = True
            rookie_count += 1

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "rookie-deal" in data["error"]
    assert "2" in data["error"]


def test_save_team_reads_salary_cap_from_rules_json(client, fake_supabase):
    """Prove validator reads salary_cap from rules_json, not a Python constant."""
    fake_supabase.rows["ruleset_versions"][0]["rules_json"]["salary_cap"] = 100_000_000
    body = valid_payload()

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "SalaryCap" in data["error"]
    assert "100,000,000" in data["error"]


def test_save_team_rejects_rules_hash_mismatch(client):
    body = valid_payload()
    body["rules_hash"] = "wrong-hash-from-stale-client"

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 409
    assert data["success"] is False
    assert "changed" in data["error"]


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


def test_list_saved_teams_returns_current_user_summaries(client, fake_supabase):
    fake_supabase.rows["saved_teams"].append({
        "id": "saved-team-1",
        "user_id": USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": "standard-v1",
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))
    fake_supabase.rows["saved_team_evaluations"].append({
        "id": "saved-eval-1",
        "saved_team_id": "saved-team-1",
        "evaluation_version": "cohesion-v1",
        "star_rating": 4.2,
        "starting_lineup_score": 4.5,
        "team_description": "A real saved evaluation.",
        "created_at": "2026-05-11T00:00:00Z",
    })

    resp, data = get_saved_teams(client)

    assert resp.status_code == 200
    assert data["success"] is True
    assert len(data["data"]) == 1
    saved_team = data["data"][0]
    assert saved_team["id"] == "saved-team-1"
    assert saved_team["name"] == "Hakeem Standard Rotation"
    assert saved_team["ruleset_slug"] == "standard"
    assert saved_team["ruleset_version_id"] == STANDARD_RULESET_VERSION_ID
    assert saved_team["evaluation"]["star_rating"] == 4.2
    assert saved_team["players"][0]["legend_id"] == LEGEND_ID
    assert saved_team["players"][0]["player_name_snapshot"] == "Hakeem Olajuwon"


def test_get_saved_team_detail_is_scoped_to_current_user(client, fake_supabase):
    fake_supabase.rows["saved_teams"].append({
        "id": "saved-team-1",
        "user_id": USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": "standard-v1",
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))

    resp, data = get_saved_team_detail(client, "saved-team-1")

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["id"] == "saved-team-1"
    assert len(data["data"]["players"]) == 9


def test_get_saved_team_detail_returns_full_historical_eval_payload(client, fake_supabase):
    full_eval_payload = valid_payload()["evaluation"]
    fake_supabase.rows["saved_teams"].append({
        "id": "saved-team-1",
        "user_id": USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": "standard-v1",
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))
    fake_supabase.rows["saved_team_evaluations"].append({
        "id": "saved-eval-1",
        "saved_team_id": "saved-team-1",
        "evaluation_version": "cohesion-v1",
        "star_rating": 3.9,
        "starting_lineup_score": 4.1,
        "team_description": "A sharp Hakeem build with real defensive bite.",
        "evaluation_payload": full_eval_payload,
        "created_at": "2026-05-11T00:00:00Z",
    })

    resp, data = get_saved_team_detail(client, "saved-team-1")

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["evaluation"]["evaluation_payload"] == full_eval_payload
    assert data["data"]["evaluation"]["evaluation_payload"]["lineup_summary"]["total_lineups"] == 126
