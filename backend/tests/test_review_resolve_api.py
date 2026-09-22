"""
Review resolve API tests (#154): single and bulk resolve against a fake Supabase.

A flag's `claude_rating` is NOT NULL; the commit RPC stores the string 'None'
when Claude has no tier (HIGH Skills, failed calls). Trust Claude must never
write that string over a real stats tier.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app import create_app

PID = "ddc0c97b-782a-4878-8a88-baaf9945baa8"
PROFILE_ID = "prof-1"


# ---------------------------------------------------------------------------
# Fake Supabase (from test_profile_api.py, plus is_ / in_ / order and a log
# of every update payload in db.updates)
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: list = []
        self._insert_payload = None
        self._update_payload = None
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def eq(self, key, value):
        self._filters.append(lambda row: row.get(key) == value)
        return self

    def is_(self, key, value):
        assert value == "null"
        self._filters.append(lambda row: row.get(key) is None)
        return self

    def in_(self, key, values):
        self._filters.append(lambda row: row.get(key) in values)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, n, *_args, **_kwargs):
        self._limit = n
        return self

    def execute(self):
        if self._insert_payload is not None:
            return _FakeResult(self.db.insert(self.table_name, self._insert_payload))
        if self._update_payload is not None:
            return _FakeResult(self.db.update(self.table_name, self._filters, self._update_payload))
        rows = self.db.select(self.table_name, self._filters)
        return _FakeResult(rows[: self._limit] if self._limit else rows)


class _FakeSupabase:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {
            "draft_skill_profiles": [],
            "draft_skill_flags": [],
        }
        self.updates: list[tuple[str, dict]] = []

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name, filters):
        return [dict(r) for r in self.rows.get(table_name, []) if all(f(r) for f in filters)]

    def insert(self, table_name, payload):
        stored = dict(payload)
        stored.setdefault("id", f"{table_name}-{len(self.rows.setdefault(table_name, [])) + 1}")
        self.rows[table_name].append(stored)
        return [stored]

    def update(self, table_name, filters, payload):
        self.updates.append((table_name, payload))
        updated = []
        for row in self.rows.get(table_name, []):
            if all(f(row) for f in filters):
                row.update(payload)
                updated.append(dict(row))
        return updated


# ---------------------------------------------------------------------------
# Auth + draft-gate bypass (from test_exclude_from_snapshot_api.py)
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "test-admin"})
    role = MagicMock()
    role.data = {"role": "admin"}
    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value
        .maybe_single.return_value.execute.return_value
    ) = role
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: client)


def _bypass_open_draft(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(
        auth_mod.snap_repo, "get_draft",
        lambda *a, **k: MagicMock(id="draft-1"),
    )


@pytest.fixture()
def admin_client(monkeypatch):
    _bypass_admin_auth(monkeypatch)
    _bypass_open_draft(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        c.auth_header = {"Authorization": "Bearer fake"}
        yield c


@pytest.fixture()
def db(monkeypatch):
    import api.review as review

    fake = _FakeSupabase()
    monkeypatch.setattr(review, "get_supabase", lambda: fake)
    return fake


def _seed(db: _FakeSupabase, extra_profile: dict | None = None, extra_flags: list | None = None):
    """One player: a HIGH `rim_protector` flag (no Claude tier, stored as the
    string 'None') and a LOW `high_flyer` flag Claude rated Capable."""
    db.rows["draft_skill_profiles"].append({
        "id": PROFILE_ID,
        "player_id": PID,
        "season": "2025-26",
        "source": "composite",
        "profile": {
            "rim_protector": {"final_tier": "Elite", "stat_tier": "Elite", "claude_tier": None, "source": "flagged"},
            "high_flyer": {"final_tier": "None", "stat_tier": "None", "claude_tier": "Capable", "source": "flagged"},
            **(extra_profile or {}),
        },
    })
    flags = [
        {"id": "flag-rim", "skill_name": "rim_protector", "stat_rating": "Elite", "claude_rating": "None"},
        {"id": "flag-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"},
        *(extra_flags or []),
    ]
    for f in flags:
        db.rows["draft_skill_flags"].append(
            {"skill_profile_id": PROFILE_ID, "resolution": None, "resolved_value": None, **f}
        )


def _profile(db) -> dict:
    return db.rows["draft_skill_profiles"][0]["profile"]


def _flag(db, flag_id) -> dict:
    return next(f for f in db.rows["draft_skill_flags"] if f["id"] == flag_id)


def _bulk(client, resolution="trust_claude"):
    return client.post(
        "/api/review/bulk-resolve",
        json={"player_id": PID, "resolution": resolution},
        headers=client.auth_header,
    )


def _resolve(client, skill_name, resolution="trust_claude"):
    return client.post(
        f"/api/review/{PID}/resolve",
        json={"skill_name": skill_name, "resolution": resolution},
        headers=client.auth_header,
    )


# ---------------------------------------------------------------------------
# Bulk trust_claude (#154)
# ---------------------------------------------------------------------------


def test_bulk_trust_claude_mixed_flags(admin_client, db):
    _seed(db)

    resp = _bulk(admin_client)

    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()["data"]
    assert _profile(db)["high_flyer"]["final_tier"] == "Capable"
    assert _profile(db)["rim_protector"]["final_tier"] == "Elite"
    assert _flag(db, "flag-rim")["resolution"] is None
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "rim_protector", "reason": "no_claude_tier"}
    ]
    assert data["all_flags_resolved"] is False
    # No recorded write puts None / 'None' over a non-None stats tier.
    for table, payload in db.updates:
        if table != "draft_skill_profiles" or "profile" not in payload:
            continue
        for entry in payload["profile"].values():
            if entry.get("stat_tier") not in (None, "None"):
                assert entry.get("final_tier") not in (None, "None")


def test_bulk_trust_claude_skips_failed_claude_call(admin_client, db):
    """A MODERATE Skill whose Claude call failed: flag 'None', entry claude_tier None."""
    _seed(
        db,
        extra_profile={"passer": {"final_tier": "Capable", "stat_tier": "Capable", "claude_tier": None, "source": "flagged"}},
        extra_flags=[{"id": "flag-passer", "skill_name": "passer", "stat_rating": "Capable", "claude_rating": "None"}],
    )

    data = _bulk(admin_client).get_json()["data"]

    assert {s["skill_name"] for s in data["skipped"]} == {"rim_protector", "passer"}
    assert _profile(db)["passer"]["final_tier"] == "Capable"
    assert _flag(db, "flag-passer")["resolution"] is None
    assert data["resolved_count"] == 1


# ---------------------------------------------------------------------------
# Single trust_claude (#154)
# ---------------------------------------------------------------------------


def test_single_trust_claude_without_claude_tier_returns_409(admin_client, db):
    _seed(db)

    resp = _resolve(admin_client, "rim_protector")

    assert resp.status_code == 409
    assert resp.get_json()["error"] == (
        "No Claude tier for 'rim_protector' — use Trust Stats or Override"
    )
    assert db.updates == []


def test_single_trust_claude_real_claude_none_resolves(admin_client, db):
    """A real Claude None (entry claude_tier 'None') is a tier, so it resolves."""
    _seed(
        db,
        extra_profile={"passer": {"final_tier": "Capable", "stat_tier": "Capable", "claude_tier": "None", "source": "flagged"}},
        extra_flags=[{"id": "flag-passer", "skill_name": "passer", "stat_rating": "Capable", "claude_rating": "None"}],
    )

    resp = _resolve(admin_client, "passer")

    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["data"]["resolved_tier"] == "None"
    assert _profile(db)["passer"]["final_tier"] == "None"
    assert _flag(db, "flag-passer")["resolution"] == "trust_claude"


def test_single_trust_claude_with_claude_tier_resolves(admin_client, db):
    _seed(db)

    resp = _resolve(admin_client, "high_flyer")

    assert resp.status_code == 200, resp.get_json()
    assert _profile(db)["high_flyer"]["final_tier"] == "Capable"


# ---------------------------------------------------------------------------
# Manual override Skill validation (M1.10)
# ---------------------------------------------------------------------------


def test_manual_override_unknown_skill_returns_400(admin_client, db):
    _seed(db)

    resp = admin_client.post(
        f"/api/review/{PID}/manual-override",
        json={"skill_name": "not_a_skill", "resolved_value": "Elite"},
        headers=admin_client.auth_header,
    )

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "unknown_skill"
    assert db.updates == []


# ---------------------------------------------------------------------------
# Review fixes (2026-09-22)
# ---------------------------------------------------------------------------


def test_trust_claude_without_a_composite_entry_fails_closed(admin_client, db):
    """No composite entry for the Skill: the flag's 'None' is still a placeholder."""
    _seed(db, extra_flags=[
        {"id": "flag-passer", "skill_name": "passer", "stat_rating": "Capable", "claude_rating": "None"},
    ])

    assert _resolve(admin_client, "passer").status_code == 409
    data = _bulk(admin_client).get_json()["data"]

    assert {s["skill_name"] for s in data["skipped"]} == {"rim_protector", "passer"}
    assert _flag(db, "flag-passer")["resolution"] is None


def test_bulk_with_every_flag_skipped_writes_no_profile(admin_client, db):
    """Nothing resolved → no whole-profile rewrite (it could clobber a concurrent resolve)."""
    _seed(db)
    _flag(db, "flag-hf")["resolution"] = "trust_stats"

    data = _bulk(admin_client).get_json()["data"]

    assert data["resolved_count"] == 0
    assert [p for t, p in db.updates if t == "draft_skill_profiles" and "profile" in p] == []


def test_player_flags_carry_the_server_claude_tier_rule(admin_client, db):
    """The page counts stats-only flags from the same rule the bulk skip uses."""
    _seed(db)
    db.rows["players"] = [{"id": PID, "name": "OG", "season": "2025-26"}]

    resp = admin_client.get(f"/api/review/{PID}/flags", headers=admin_client.auth_header)

    assert resp.status_code == 200, resp.get_json()
    flags = {f["skill_name"]: f["has_claude_tier"] for f in resp.get_json()["data"]["flags"]}
    assert flags == {"rim_protector": False, "high_flyer": True}
