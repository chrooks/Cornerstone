"""
Integration tests for POST /api/saved-teams.
"""

from __future__ import annotations

import json

import pytest

from app import create_app
from api import auth, saved_teams
from services.evaluation_versions import repo as eval_versions_repo


USER_ID = "11111111-1111-1111-1111-111111111111"
SNAPSHOT_RELEASE_ID = "22222222-2222-2222-2222-222222222222"
LEGEND_ID = "33333333-3333-3333-3333-333333333333"
STANDARD_RULESET_ID = "55555555-5555-5555-5555-555555555555"
STANDARD_RULESET_VERSION_ID = "66666666-6666-6666-6666-666666666666"
STANDARD_RULES_HASH = "375b5966733c5d3dd5350098e70c55a0"
FFA_RULESET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
FFA_RULESET_VERSION_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
FFA_RULES_HASH = "ffa-multi-size-hash"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._insert_payload = None
        self._update_payload = None
        self._delete = False
        self._filters: dict[str, object] = {}
        self._in_filters: dict[str, list] = {}
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def delete(self):
        self._delete = True
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def in_(self, key, values):
        self._in_filters[key] = list(values)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self._limit = value
        return self

    def single(self):
        self._limit = 1
        self._single = True
        return self

    def execute(self):
        if self._insert_payload is not None:
            return _FakeResult(self.db.insert(self.table_name, self._insert_payload))
        if self._update_payload is not None:
            return _FakeResult(self.db.update(self.table_name, self._update_payload, self._filters))
        if self._delete:
            return _FakeResult(self.db.delete(self.table_name, self._filters))
        rows = self.db.select(self.table_name, self._filters, self._in_filters)
        if getattr(self, "_single", False) and rows:
            return _FakeResult(rows[0])
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
            "evaluation_versions": [
                {
                    "id": "v1-eval-version-id",
                    "slug": "cohesion-v1",
                    "status": "published",
                    "is_active": True,
                    "payload": {},
                }
            ],
        }

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name: str, filters: dict[str, object], in_filters: dict | None = None):
        if table_name == "snapshot_releases" and self.missing_snapshot_releases:
            raise RuntimeError("Could not find the table 'public.snapshot_releases' in the schema cache")
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        for key, values in (in_filters or {}).items():
            rows = [row for row in rows if row.get(key) in values]
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

    def update(self, table_name: str, payload: dict, filters: dict[str, object]):
        updated = []
        for row in self.rows.get(table_name, []):
            if all(row.get(key) == value for key, value in filters.items()):
                row.update(payload)
                updated.append(row)
        return updated

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
    # Patch evaluation_versions repo to use the same fake DB
    monkeypatch.setattr(eval_versions_repo, "get_supabase", lambda: db)
    monkeypatch.setattr(eval_versions_repo, "run_query", lambda fn: fn())
    # Patch the module-level import in saved_teams
    from services.cohesion_engine.engine import EvaluationVersion as _EV
    monkeypatch.setattr(saved_teams, "get_active_eval_version", lambda: _EV(
        id="v1-eval-version-id", slug="cohesion-v1", status="published", payload={},
    ))
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
    assert data["data"]["name"] == "Hakeem Olajuwon Rotation"
    assert data["data"]["ruleset_slug"] == "standard"
    assert data["data"]["ruleset_version_id"] == STANDARD_RULESET_VERSION_ID
    assert data["data"]["snapshot_release_id"] == SNAPSHOT_RELEASE_ID
    assert data["data"]["visibility"] == "private"

    saved_team = fake_supabase.rows["saved_teams"][0]
    assert saved_team["user_id"] == USER_ID
    assert saved_team["ruleset_id"] == STANDARD_RULESET_ID
    assert saved_team["ruleset_version_id"] == STANDARD_RULESET_VERSION_ID
    assert saved_team["ruleset_version_hash"] == STANDARD_RULES_HASH
    assert saved_team["total_salary"] == 134_000_000
    assert len(fake_supabase.rows["saved_team_players"]) == 9
    assert [row["slot"] for row in fake_supabase.rows["saved_team_players"]] == list(range(1, 10))
    saved_evaluation = fake_supabase.rows["saved_team_evaluations"][0]
    assert saved_evaluation["saved_team_id"] == saved_team["id"]
    assert saved_evaluation["evaluation_version_id"] is not None
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


def test_save_team_persists_selected_allowed_team_size(client, fake_supabase):
    fake_supabase.rows["rulesets"].append({
        "id": FFA_RULESET_ID,
        "slug": "free-for-all",
        "name": "Free For All",
        "status": "active",
    })
    fake_supabase.rows["ruleset_versions"].append({
        "id": FFA_RULESET_VERSION_ID,
        "ruleset_id": FFA_RULESET_ID,
        "version_label": "v1",
        "rules_hash": FFA_RULES_HASH,
        "rules_json": {
            "team_size": 9,
            "team_label": "Rotation",
            "allowed_team_sizes": [5, 9, 12],
            "cornerstone_source": "all",
            "cornerstone_rule": "Any player",
            "player_pool": "2025-26 Snapshot + Legends",
        },
        "status": "published",
        "published_at": "2026-05-13T00:00:00Z",
    })
    body = valid_payload()
    body["ruleset_slug"] = "free-for-all"
    body["ruleset_version_id"] = FFA_RULESET_VERSION_ID
    body["rules_hash"] = FFA_RULES_HASH
    body["team_size"] = 5
    body["players"] = body["players"][:5]

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 201
    assert data["success"] is True
    assert data["data"]["name"] == "Hakeem Olajuwon Lineup"
    assert data["data"]["ruleset_slug"] == "free-for-all"
    assert data["data"]["team_size"] == 5
    saved_team = fake_supabase.rows["saved_teams"][0]
    assert saved_team["team_size"] == 5


def test_save_team_rejects_disallowed_team_size_for_ruleset(client, fake_supabase):
    fake_supabase.rows["ruleset_versions"][0]["rules_json"]["allowed_team_sizes"] = [9, 12]
    body = valid_payload()
    body["team_size"] = 5
    body["players"] = body["players"][:5]

    resp, data = post_saved_team(client, body)

    assert resp.status_code == 400
    assert data["success"] is False
    assert "allowed sizes" in data["error"]


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


CURRENT_SNAPSHOT_RELEASE_ID = "99999999-9999-9999-9999-999999999999"


def get_rebuild_check(client, saved_team_id: str, token: str | None = "test-token"):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.get(f"/api/saved-teams/{saved_team_id}/rebuild-check", headers=headers)
    return resp, resp.get_json()


def _seed_saved_team(fake_supabase, *, missing_slots: list[int] | None = None):
    """Populate fake DB with a saved team, its players, and current snapshot players.

    Returns the saved_team_id. Adds a second published snapshot release
    (CURRENT_SNAPSHOT_RELEASE_ID) so rebuild resolves against a different release
    than the one the team was saved under.

    If missing_slots is provided, those slot numbers will NOT have a matching
    snapshot player in the current release (simulating a missing player).
    """
    saved_team_id = "saved-team-rebuild"
    missing = set(missing_slots or [])

    # Mark old release as superseded so the new one is the only published release
    for release in fake_supabase.rows["snapshot_releases"]:
        if release["id"] == SNAPSHOT_RELEASE_ID:
            release["status"] = "superseded"

    fake_supabase.rows["snapshot_releases"].append({
        "id": CURRENT_SNAPSHOT_RELEASE_ID,
        "season": "2025-26",
        "label": "2025-26 Current",
        "status": "published",
        "published_at": "2026-05-12T00:00:00Z",
    })

    fake_supabase.rows["saved_teams"].append({
        "id": saved_team_id,
        "user_id": USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": STANDARD_RULES_HASH,
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "team_size": 9,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })

    # Cornerstone (slot 1, legend)
    fake_supabase.rows["saved_team_players"].append({
        "id": "stp-1",
        "saved_team_id": saved_team_id,
        "player_id": None,
        "source_player_id": None,
        "snapshot_player_id": None,
        "canonical_player_id": None,
        "legend_id": LEGEND_ID,
        "slot": 1,
        "is_cornerstone": True,
        "salary_snapshot": 54_000_000,
        "player_name_snapshot": "Hakeem Olajuwon",
        "team_snapshot": None,
        "position_snapshot": "C",
        "skill_profile_snapshot": {"rim_protector": "All-Time Great"},
    })

    # Supporting players (slots 2-9)
    for slot in range(2, 10):
        fake_supabase.rows["saved_team_players"].append({
            "id": f"stp-{slot}",
            "saved_team_id": saved_team_id,
            "player_id": f"44444444-4444-4444-4444-44444444444{slot}",
            "source_player_id": f"44444444-4444-4444-4444-44444444444{slot}",
            "snapshot_player_id": SNAPSHOT_PLAYER_IDS[slot],
            "canonical_player_id": CANONICAL_PLAYER_IDS[slot],
            "legend_id": None,
            "slot": slot,
            "is_cornerstone": False,
            "salary_snapshot": 10_000_000,
            "player_name_snapshot": f"Player {slot}",
            "team_snapshot": "OKC",
            "position_snapshot": "G",
            "skill_profile_snapshot": {"spot_up_shooter": "Elite"},
        })

    # Current snapshot players (in the new release)
    for slot in range(2, 10):
        if slot in missing:
            continue
        fake_supabase.rows.setdefault("snapshot_players", []).append({
            "id": f"current-snap-{slot}",
            "snapshot_release_id": CURRENT_SNAPSHOT_RELEASE_ID,
            "canonical_player_id": CANONICAL_PLAYER_IDS[slot],
            "source_player_id": f"44444444-4444-4444-4444-44444444444{slot}",
            "name": f"Player {slot}",
            "team": "OKC",
            "position": "G",
            "salary": 12_000_000,
            "skill_profile_snapshot": {"spot_up_shooter": "Elite", "defender": "Proficient"},
        })

    return saved_team_id


# ---------------------------------------------------------------------------
# rebuild-check endpoint tests
# ---------------------------------------------------------------------------


def test_rebuild_check_all_matched(client, fake_supabase):
    """All players resolve against current Snapshot Release."""
    saved_team_id = _seed_saved_team(fake_supabase)

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    assert data["success"] is True
    result = data["data"]
    assert result["saved_team_id"] == saved_team_id
    assert result["ruleset_slug"] == "standard"
    assert result["rebuild_ready"] is True

    # Cornerstone
    assert result["cornerstone"]["legend_id"] == LEGEND_ID
    assert result["cornerstone"]["available"] is True
    assert result["cornerstone"]["status"] == "legend"

    # All 8 supporting players matched
    players = result["players"]
    assert len(players) == 8
    for report in players:
        assert report["status"] == "matched"
        assert report["current"] is not None
        assert report["current"]["salary"] == 12_000_000

    # Version drift unchanged (same version)
    assert result["version_drift"]["changed"] is False

    # Builder URL params complete
    params = result["builder_url_params"]
    assert params["cornerstone"] == LEGEND_ID
    for slot in range(2, 10):
        assert f"s{slot}" in params


def test_rebuild_check_player_missing(client, fake_supabase):
    """One player absent from current Snapshot Release → status 'missing'."""
    saved_team_id = _seed_saved_team(fake_supabase, missing_slots=[5])

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    result = data["data"]
    assert result["rebuild_ready"] is True

    by_slot = {p["slot"]: p for p in result["players"]}
    assert by_slot[5]["status"] == "missing"
    assert by_slot[5]["current"] is None
    assert by_slot[5]["saved"]["player_name_snapshot"] == "Player 5"

    # Missing slot absent from builder_url_params
    assert "s5" not in result["builder_url_params"]
    # Other matched slots present
    assert "s2" in result["builder_url_params"]


def test_rebuild_check_cornerstone_unavailable(client, fake_supabase):
    """Legend deleted → cornerstone.available is False, 'cornerstone' absent from URL params."""
    saved_team_id = _seed_saved_team(fake_supabase)
    fake_supabase.rows["legends"].clear()

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    result = data["data"]
    assert result["rebuild_ready"] is True
    assert result["cornerstone"]["available"] is False
    assert "cornerstone" not in result["builder_url_params"]


def test_rebuild_check_version_changed(client, fake_supabase):
    """Original and current RuleSet Versions differ → version_drift.changed is True."""
    saved_team_id = _seed_saved_team(fake_supabase)

    # Add a newer published version
    new_version_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fake_supabase.rows["ruleset_versions"].append({
        "id": new_version_id,
        "ruleset_id": STANDARD_RULESET_ID,
        "version_label": "v2",
        "rules_hash": "new-hash-v2",
        "rules_json": {"team_size": 9, "salary_cap": 210_000_000},
        "status": "published",
        "published_at": "2026-05-12T00:00:00Z",
    })
    # Mark original as superseded so the fake returns the new one
    fake_supabase.rows["ruleset_versions"][0]["status"] = "superseded"

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    result = data["data"]
    drift = result["version_drift"]
    assert drift["changed"] is True
    assert drift["original"]["id"] == STANDARD_RULESET_VERSION_ID
    assert drift["current"]["id"] == new_version_id
    assert drift["current"]["rules_json"]["salary_cap"] == 210_000_000


def test_rebuild_check_version_unchanged(client, fake_supabase):
    """Same RuleSet Version → version_drift.changed is False."""
    saved_team_id = _seed_saved_team(fake_supabase)

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    drift = data["data"]["version_drift"]
    assert drift["changed"] is False
    assert drift["original"]["id"] == drift["current"]["id"]


def test_rebuild_check_not_found(client, fake_supabase):
    """Nonexistent Saved Team → 404."""
    resp, data = get_rebuild_check(client, "nonexistent-id")

    assert resp.status_code == 404
    assert data["success"] is False
    assert "not found" in data["error"]


def test_rebuild_check_no_published_snapshot(client, fake_supabase):
    """No published Snapshot Release → 400."""
    saved_team_id = _seed_saved_team(fake_supabase)
    # Remove all published releases
    fake_supabase.rows["snapshot_releases"] = [
        r for r in fake_supabase.rows["snapshot_releases"] if r["status"] != "published"
    ]

    resp, data = get_rebuild_check(client, saved_team_id)

    assert resp.status_code == 400
    assert "Snapshot Release" in data["error"]


SAVED_TEAM_FIXTURE = {
    "id": "saved-team-1",
    "user_id": USER_ID,
    "ruleset_slug": "standard",
    "ruleset_id": STANDARD_RULESET_ID,
    "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
    "ruleset_version_hash": STANDARD_RULES_HASH,
    "snapshot_release_id": SNAPSHOT_RELEASE_ID,
    "name": "Hakeem Standard Rotation",
    "visibility": "private",
    "cornerstone_legend_id": LEGEND_ID,
    "total_salary": 134_000_000,
    "created_at": "2026-05-11T00:00:00Z",
    "updated_at": "2026-05-11T00:00:00Z",
}


def _seed_existing_saved_team(fake_supabase):
    fake_supabase.rows["saved_teams"].append(dict(SAVED_TEAM_FIXTURE))
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))
    fake_supabase.rows["saved_team_evaluations"].append({
        "id": "saved-eval-1",
        "saved_team_id": "saved-team-1",
        "evaluation_version_id": "v1-eval-version-id",
        "star_rating": 4.2,
        "starting_lineup_score": 4.5,
        "team_description": "A real saved evaluation.",
        "created_at": "2026-05-11T00:00:00Z",
    })


def delete_saved_team(client, saved_team_id: str, token: str | None = "test-token"):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.delete(f"/api/saved-teams/{saved_team_id}", headers=headers)
    return resp, resp.get_json()


def patch_saved_team(client, saved_team_id: str, body: dict, token: str | None = "test-token"):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    resp = client.patch(
        f"/api/saved-teams/{saved_team_id}",
        data=json.dumps(body),
        headers=headers,
    )
    return resp, resp.get_json()


# ---------------------------------------------------------------------------
# DELETE /api/saved-teams/<id>
# ---------------------------------------------------------------------------


def test_delete_saved_team_removes_team_and_children(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = delete_saved_team(client, "saved-team-1")

    assert resp.status_code == 200
    assert data["success"] is True
    assert len(fake_supabase.rows["saved_teams"]) == 0
    assert len(fake_supabase.rows["saved_team_players"]) == 0
    assert len(fake_supabase.rows["saved_team_evaluations"]) == 0


def test_delete_saved_team_not_found(client, fake_supabase):
    resp, data = delete_saved_team(client, "nonexistent-id")

    assert resp.status_code == 404
    assert data["success"] is False


def test_delete_saved_team_requires_auth(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = delete_saved_team(client, "saved-team-1", token=None)

    assert resp.status_code == 401
    assert len(fake_supabase.rows["saved_teams"]) == 1


# ---------------------------------------------------------------------------
# PATCH /api/saved-teams/<id>
# ---------------------------------------------------------------------------


def test_rename_saved_team(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {"name": "Dream Shake Squad"})

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["name"] == "Dream Shake Squad"
    assert fake_supabase.rows["saved_teams"][0]["name"] == "Dream Shake Squad"


def test_rename_saved_team_rejects_empty_name(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {"name": "   "})

    assert resp.status_code == 400
    assert data["success"] is False
    assert fake_supabase.rows["saved_teams"][0]["name"] == "Hakeem Standard Rotation"


def test_rename_saved_team_not_found(client, fake_supabase):
    resp, data = patch_saved_team(client, "nonexistent-id", {"name": "Nope"})

    assert resp.status_code == 404
    assert data["success"] is False


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
        "ruleset_version_hash": STANDARD_RULES_HASH,
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "team_size": 9,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))
    fake_supabase.rows["saved_team_evaluations"].append({
        "id": "saved-eval-1",
        "saved_team_id": "saved-team-1",
        "evaluation_version_id": "v1-eval-version-id",
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
    assert saved_team["team_size"] == 9
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
        "ruleset_version_hash": STANDARD_RULES_HASH,
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Hakeem Standard Rotation",
        "visibility": "private",
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "team_size": 9,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows("saved-team-1"))

    resp, data = get_saved_team_detail(client, "saved-team-1")

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["id"] == "saved-team-1"
    assert data["data"]["team_size"] == 9
    assert len(data["data"]["players"]) == 9


def test_get_saved_team_detail_returns_full_historical_eval_payload(client, fake_supabase):
    full_eval_payload = valid_payload()["evaluation"]
    fake_supabase.rows["saved_teams"].append({
        "id": "saved-team-1",
        "user_id": USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": STANDARD_RULES_HASH,
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
        "evaluation_version_id": "v1-eval-version-id",
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


# ---------------------------------------------------------------------------
# Shared (unauthenticated) endpoints: GET /api/shared/<id>
# ---------------------------------------------------------------------------

OTHER_USER_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"


SHARED_TEAM_ID = "99999999-9999-9999-9999-999999999999"


def _seed_shared_team(fake_supabase, *, visibility: str = "public") -> str:
    """Seed a saved team owned by another user with configurable visibility."""
    saved_team_id = SHARED_TEAM_ID
    fake_supabase.rows["saved_teams"].append({
        "id": saved_team_id,
        "user_id": OTHER_USER_ID,
        "ruleset_slug": "standard",
        "ruleset_id": STANDARD_RULESET_ID,
        "ruleset_version_id": STANDARD_RULESET_VERSION_ID,
        "ruleset_version_hash": STANDARD_RULES_HASH,
        "snapshot_release_id": SNAPSHOT_RELEASE_ID,
        "name": "Public Hakeem Build",
        "visibility": visibility,
        "cornerstone_legend_id": LEGEND_ID,
        "total_salary": 134_000_000,
        "team_size": 9,
        "created_at": "2026-05-11T00:00:00Z",
        "updated_at": "2026-05-11T00:00:00Z",
    })
    fake_supabase.rows["saved_team_players"].extend(_player_insert_rows(saved_team_id))
    fake_supabase.rows["saved_team_evaluations"].append({
        "id": "shared-eval-1",
        "saved_team_id": saved_team_id,
        "evaluation_version_id": "v1-eval-version-id",
        "star_rating": 4.0,
        "starting_lineup_score": 4.3,
        "team_description": "Shared evaluation narrative.",
        "evaluation_payload": {"star_rating": 4.0},
        "created_at": "2026-05-11T00:00:00Z",
    })
    return saved_team_id


def get_shared_team(client, saved_team_id: str):
    """GET /api/shared/<id> with NO auth header."""
    resp = client.get(f"/api/shared/{saved_team_id}")
    return resp, resp.get_json()


def test_shared_get_returns_public_team_without_auth(client, fake_supabase):
    saved_team_id = _seed_shared_team(fake_supabase, visibility="public")

    resp, data = get_shared_team(client, saved_team_id)

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["id"] == saved_team_id
    assert data["data"]["name"] == "Public Hakeem Build"
    assert data["data"]["visibility"] == "public"
    assert len(data["data"]["players"]) == 9
    assert data["data"]["evaluation"]["evaluation_payload"] == {"star_rating": 4.0}


def test_shared_get_returns_player_portrait_ids(client, fake_supabase):
    saved_team_id = _seed_shared_team(fake_supabase, visibility="public")
    active_player_id = valid_player(2)["player_id"]
    canonical_player_id = "77777777-7777-7777-7777-777777777777"
    fake_supabase.rows["legends"][0]["nba_api_id"] = 165
    fake_supabase.rows["saved_team_players"][1]["canonical_player_id"] = canonical_player_id
    fake_supabase.rows.setdefault("players", []).append({
        "id": active_player_id,
        "nba_api_id": 9999999,
    })
    fake_supabase.rows.setdefault("canonical_players", []).append({
        "id": canonical_player_id,
        "nba_api_id": 1630162,
        "display_name": "Player 2",
    })

    resp, data = get_shared_team(client, saved_team_id)

    assert resp.status_code == 200
    assert data["success"] is True

    players_by_slot = {player["slot"]: player for player in data["data"]["players"]}
    assert players_by_slot[1]["nba_api_id"] == 165
    assert players_by_slot[2]["nba_api_id"] == 1630162


def test_shared_get_returns_unlisted_team_without_auth(client, fake_supabase):
    saved_team_id = _seed_shared_team(fake_supabase, visibility="unlisted")

    resp, data = get_shared_team(client, saved_team_id)

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["visibility"] == "unlisted"


def test_shared_get_returns_404_for_private_team(client, fake_supabase):
    saved_team_id = _seed_shared_team(fake_supabase, visibility="private")

    resp, data = get_shared_team(client, saved_team_id)

    assert resp.status_code == 404
    assert data["success"] is False


def test_shared_get_returns_404_for_nonexistent_team(client, fake_supabase):
    resp, data = get_shared_team(client, "00000000-0000-0000-0000-000000000000")

    assert resp.status_code == 404
    assert data["success"] is False


# ---------------------------------------------------------------------------
# PATCH /api/saved-teams/<id> — visibility changes
# ---------------------------------------------------------------------------


def test_patch_visibility_to_public(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {"visibility": "public"})

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["visibility"] == "public"
    assert fake_supabase.rows["saved_teams"][0]["visibility"] == "public"


def test_patch_visibility_to_private(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)
    fake_supabase.rows["saved_teams"][0]["visibility"] = "public"

    resp, data = patch_saved_team(client, "saved-team-1", {"visibility": "private"})

    assert resp.status_code == 200
    assert data["data"]["visibility"] == "private"


def test_patch_visibility_rejects_invalid_value(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {"visibility": "secret"})

    assert resp.status_code == 400
    assert data["success"] is False
    assert "visibility" in data["error"]


def test_patch_visibility_only_no_name(client, fake_supabase):
    """PATCH with visibility but no name should succeed."""
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {"visibility": "unlisted"})

    assert resp.status_code == 200
    assert data["data"]["visibility"] == "unlisted"
    # Name unchanged
    assert fake_supabase.rows["saved_teams"][0]["name"] == "Hakeem Standard Rotation"


def test_patch_name_and_visibility_together(client, fake_supabase):
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {
        "name": "Dream Build",
        "visibility": "public",
    })

    assert resp.status_code == 200
    assert data["data"]["name"] == "Dream Build"
    assert data["data"]["visibility"] == "public"


def test_patch_rejects_empty_body(client, fake_supabase):
    """PATCH with neither name nor visibility should fail."""
    _seed_existing_saved_team(fake_supabase)

    resp, data = patch_saved_team(client, "saved-team-1", {})

    assert resp.status_code == 400
    assert data["success"] is False


# ---------------------------------------------------------------------------
# Shared rebuild-check: GET /api/shared/<id>/rebuild-check
# ---------------------------------------------------------------------------


def get_shared_rebuild_check(client, saved_team_id: str):
    """GET /api/shared/<id>/rebuild-check with NO auth header."""
    resp = client.get(f"/api/shared/{saved_team_id}/rebuild-check")
    return resp, resp.get_json()


def _seed_shared_team_for_rebuild(fake_supabase, *, visibility: str = "public") -> str:
    """Seed a public team owned by another user, with a current snapshot release."""
    saved_team_id = _seed_shared_team(fake_supabase, visibility=visibility)

    # Add current snapshot release + snapshot players for rebuild resolution
    fake_supabase.rows["snapshot_releases"].append({
        "id": CURRENT_SNAPSHOT_RELEASE_ID,
        "season": "2025-26",
        "label": "2025-26 Current",
        "status": "published",
        "published_at": "2026-05-12T00:00:00Z",
    })
    # Mark original as superseded
    for release in fake_supabase.rows["snapshot_releases"]:
        if release["id"] == SNAPSHOT_RELEASE_ID:
            release["status"] = "superseded"

    for slot in range(2, 10):
        source_player_id = f"44444444-4444-4444-4444-44444444444{slot}"
        fake_supabase.rows.setdefault("snapshot_players", []).append({
            "id": f"current-snap-{slot}",
            "snapshot_release_id": CURRENT_SNAPSHOT_RELEASE_ID,
            "canonical_player_id": CANONICAL_PLAYER_IDS.get(slot),
            "source_player_id": source_player_id,
            "name": f"Player {slot}",
            "team": "OKC",
            "position": "G",
            "salary": 12_000_000,
            "skill_profile_snapshot": {"spot_up_shooter": "Elite"},
        })

    return saved_team_id


def test_shared_rebuild_check_works_for_public_team(client, fake_supabase):
    saved_team_id = _seed_shared_team_for_rebuild(fake_supabase, visibility="public")

    resp, data = get_shared_rebuild_check(client, saved_team_id)

    assert resp.status_code == 200
    assert data["success"] is True
    assert data["data"]["saved_team_id"] == saved_team_id
    assert data["data"]["rebuild_ready"] is True
    assert data["data"]["cornerstone"]["available"] is True


def test_shared_rebuild_check_404_for_private_team(client, fake_supabase):
    saved_team_id = _seed_shared_team_for_rebuild(fake_supabase, visibility="private")

    resp, data = get_shared_rebuild_check(client, saved_team_id)

    assert resp.status_code == 404
    assert data["success"] is False
