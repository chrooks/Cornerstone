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
PID2 = "1f2e3d4c-5b6a-4978-8899-aabbccddeeff"
PROFILE_ID2 = "prof-2"


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
        self._range: tuple[int, int] | None = None

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
        # The dev gateway returns HTTP 414 above ~220 ids in one query string,
        # so every `.in_()` list goes through supabase_client.in_chunks.
        assert len(values) <= 100, f".in_() received {len(values)} values (max 100)"
        self._filters.append(lambda row: row.get(key) in values)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, n, *_args, **_kwargs):
        self._limit = n
        return self

    def range(self, start, end):
        """PostgREST's inclusive row window."""
        self._range = (start, end)
        return self

    def execute(self):
        if self._insert_payload is not None:
            return _FakeResult(self.db.insert(self.table_name, self._insert_payload))
        if self._update_payload is not None:
            return _FakeResult(self.db.update(self.table_name, self._filters, self._update_payload))
        rows = self.db.select(self.table_name, self._filters)
        if self._range is not None:
            start, end = self._range
            rows = rows[start : end + 1]
        # PostgREST refuses to return more than db-max-rows in one response,
        # and says nothing about the rows it dropped.
        if self.db.row_cap is not None:
            rows = rows[: self.db.row_cap]
        return _FakeResult(rows[: self._limit] if self._limit else rows)


class _FakeSupabase:
    row_cap: int | None = None

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


def _seed_player(
    db: _FakeSupabase,
    player_id: str,
    profile_id: str,
    profile: dict,
    flags: list[dict],
    name: str = "Player",
):
    """Seed one player with an explicit composite profile and flag set."""
    db.rows["draft_skill_profiles"].append({
        "id": profile_id,
        "player_id": player_id,
        "season": "2025-26",
        "source": "composite",
        "profile": profile,
    })
    for f in flags:
        db.rows["draft_skill_flags"].append({
            "skill_profile_id": profile_id,
            "resolution": None,
            "resolved_value": None,
            "flag_reason": None,
            **f,
        })
    db.rows.setdefault("players", []).append(
        {"id": player_id, "name": name, "team": "BOS", "position": "F"}
    )


def _entry(final_tier: str, stat_tier: str | None = None, claude_tier: str | None = None) -> dict:
    return {
        "final_tier":  final_tier,
        "stat_tier":   stat_tier,
        "claude_tier": claude_tier,
        "source":      "flagged",
    }


def _profile(db) -> dict:
    return db.rows["draft_skill_profiles"][0]["profile"]


def _profile_of(db, profile_id: str) -> dict:
    return next(p for p in db.rows["draft_skill_profiles"] if p["id"] == profile_id)["profile"]


def _flag(db, flag_id) -> dict:
    return next(f for f in db.rows["draft_skill_flags"] if f["id"] == flag_id)


def _bulk(client, resolution="trust_claude"):
    return client.post(
        "/api/review/bulk-resolve",
        json={"player_id": PID, "resolution": resolution},
        headers=client.auth_header,
    )


def _bulk_scope(client, player_ids, resolution="trust_claude", **extra):
    """POST /bulk-resolve in the M2.4 multi-player / per-Skill shape."""
    return client.post(
        "/api/review/bulk-resolve",
        json={"player_ids": player_ids, "resolution": resolution, **extra},
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


# ---------------------------------------------------------------------------
# M2 — per-Skill bulk resolve (#152)
# ---------------------------------------------------------------------------


def _core_defensive_all_none() -> dict:
    """A composite whose every core defensive Skill reads 'None' (D21)."""
    from api.review import _CORE_DEFENSIVE_SKILLS

    return {s: _entry("None", "None", "None") for s in _CORE_DEFENSIVE_SKILLS}


def test_bulk_trust_stats_skips_defensive_keys(admin_client, db):
    """M2.2 — a whole-player Trust Stats never writes a D19 defensive key."""
    _seed_player(
        db, PID, PROFILE_ID,
        {
            "versatile_defender": _entry("None", "Capable", "None"),
            "high_flyer":         _entry("None", "None", "Capable"),
        },
        [
            {"id": "f-vd", "skill_name": "versatile_defender", "stat_rating": "Capable", "claude_rating": "None"},
            {"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"},
        ],
    )

    data = _bulk(admin_client, resolution="trust_stats").get_json()["data"]

    assert data["resolved_count"] == 1
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "versatile_defender", "reason": "defensive_key"}
    ]
    assert _profile(db)["versatile_defender"]["final_tier"] == "None"
    assert _flag(db, "f-vd")["resolution"] is None
    assert _flag(db, "f-hf")["resolution"] == "trust_stats"


def test_review_queue_filters_by_skill_and_counts_agreements(admin_client, db):
    """M2.3 — ?skill_name= narrows the queue and reports per-player agreements."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("None", "Capable", "Capable")},
        [{"id": "f-hf1", "skill_name": "high_flyer", "stat_rating": "Capable", "claude_rating": "Capable"}],
        name="Agreeing Player",
    )
    _seed_player(
        db, PID2, PROFILE_ID2,
        {"passer": _entry("None", "Capable", "Elite")},
        [{"id": "f-pass", "skill_name": "passer", "stat_rating": "Capable", "claude_rating": "Elite"}],
        name="Other Player",
    )

    resp = admin_client.get("/api/review/queue?skill_name=high_flyer")

    assert resp.status_code == 200, resp.get_json()
    queue = resp.get_json()["data"]
    assert [e["player_id"] for e in queue] == [PID]
    assert queue[0]["unresolved_flag_count"] == 1
    assert queue[0]["agreement_count"] == 1


def test_review_queue_without_skill_name_has_no_agreement_count(admin_client, db):
    _seed(db)
    db.rows["players"] = [{"id": PID, "name": "OG", "team": "BOS", "position": "F"}]

    queue = admin_client.get("/api/review/queue").get_json()["data"]

    assert "agreement_count" not in queue[0]


def test_review_queue_agreement_count_ignores_high_and_placeholder_none(admin_client, db):
    """A HIGH Skill and the 'None' placeholder are never counted as agreements."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"rim_protector": _entry("Elite", "Elite", None)},
        [{"id": "f-rim", "skill_name": "rim_protector", "stat_rating": "Elite", "claude_rating": "Elite"}],
    )

    queue = admin_client.get("/api/review/queue?skill_name=rim_protector").get_json()["data"]

    assert queue[0]["agreement_count"] == 0


def test_bulk_per_skill_trust_claude_across_two_players(admin_client, db):
    """M2.4 — one Skill, many players, one call."""
    for pid, prof_id in ((PID, PROFILE_ID), (PID2, PROFILE_ID2)):
        _seed_player(
            db, pid, prof_id,
            {"high_flyer": _entry("None", "None", "Capable"),
             "passer": _entry("None", "Capable", "Elite")},
            [
                {"id": f"hf-{prof_id}", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"},
                {"id": f"ps-{prof_id}", "skill_name": "passer", "stat_rating": "Capable", "claude_rating": "Elite"},
            ],
        )

    data = _bulk_scope(admin_client, [PID, PID2], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 2
    assert data["skipped"] == []
    assert _profile_of(db, PROFILE_ID)["high_flyer"]["final_tier"] == "Capable"
    assert _profile_of(db, PROFILE_ID2)["high_flyer"]["final_tier"] == "Capable"
    # The other Skill's flags stay open — a per-Skill bulk touches one Skill.
    assert _flag(db, f"ps-{PROFILE_ID}")["resolution"] is None
    assert data["all_flags_resolved"] is False


def test_bulk_trust_stats_on_a_defensive_key_returns_400(admin_client, db):
    _seed_player(
        db, PID, PROFILE_ID,
        {"versatile_defender": _entry("None", "Capable", "None")},
        [{"id": "f-vd", "skill_name": "versatile_defender", "stat_rating": "Capable", "claude_rating": "None"}],
    )

    resp = _bulk_scope(admin_client, [PID], resolution="trust_stats", skill_name="versatile_defender")

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "defensive_key_trust_stats_blocked"
    assert db.updates == []


def test_bulk_agreements_only_resolves_the_agreement_and_reports_the_disagreement(admin_client, db):
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("None", "Proficient", "Proficient")},
        [{"id": "f-agree", "skill_name": "high_flyer", "stat_rating": "Proficient",
          "claude_rating": "Proficient", "flag_reason": "always_flag_for_review"}],
    )
    _seed_player(
        db, PID2, PROFILE_ID2,
        {"high_flyer": _entry("None", "None", "Elite")},
        [{"id": "f-disagree", "skill_name": "high_flyer", "stat_rating": "None",
          "claude_rating": "Elite", "flag_reason": "two_tier_disagreement"}],
    )

    data = _bulk_scope(
        admin_client, [PID, PID2], skill_name="high_flyer", agreements_only=True
    ).get_json()["data"]

    assert data["resolved_count"] == 1
    assert data["skipped"] == [
        {"player_id": PID2, "skill_name": "high_flyer", "reason": "disagreement"}
    ]
    assert _profile_of(db, PROFILE_ID)["high_flyer"]["final_tier"] == "Proficient"
    assert _flag(db, "f-disagree")["resolution"] is None


def test_bulk_per_skill_skips_a_negative_candidates_none(admin_client, db):
    """D21 — a player who could drive a negative label is resolved one by one."""
    _seed_player(
        db, PID, PROFILE_ID,
        {**_core_defensive_all_none(), "high_flyer": _entry("None", "None", "None")},
        [{"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "None"}],
    )

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 0
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "high_flyer", "reason": "negative_candidate"}
    ]
    assert _flag(db, "f-hf")["resolution"] is None


def test_bulk_per_skill_resolves_a_none_when_the_player_is_not_a_negative_candidate(admin_client, db):
    profile = _core_defensive_all_none()
    profile[next(iter(profile))] = _entry("Elite", "Elite", "Elite")
    profile["high_flyer"] = _entry("None", "None", "None")
    _seed_player(
        db, PID, PROFILE_ID, profile,
        [{"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "None"}],
    )

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 1
    assert _profile(db)["high_flyer"]["source"] == "resolved"


def test_bulk_per_skill_skips_a_human_decision_contradiction(admin_client, db):
    """M2.5 — a contradiction flag over a human decision is never bulk-resolved."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("Capable", "None", "Capable")},
        [{"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable",
          "flag_reason": "human_decision_contradicted:trust_stats"}],
    )

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 0
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "high_flyer", "reason": "human_decision"}
    ]
    assert _flag(db, "f-hf")["resolution"] is None
    assert _profile(db)["high_flyer"]["final_tier"] == "Capable"


# ---------------------------------------------------------------------------
# M2.6 — the positive human_reviewed marker (D21)
# ---------------------------------------------------------------------------


def test_bulk_resolve_leaves_no_human_reviewed_marker(admin_client, db):
    _seed(db)

    _bulk(admin_client)

    assert "human_reviewed" not in _profile(db)["high_flyer"]


def test_one_by_one_resolve_sets_human_reviewed(admin_client, db):
    _seed(db)

    _resolve(admin_client, "high_flyer")

    assert _profile(db)["high_flyer"]["human_reviewed"] is True


def test_manual_override_sets_human_reviewed(admin_client, db):
    _seed(db)

    admin_client.post(
        f"/api/review/{PID}/manual-override",
        json={"skill_name": "high_flyer", "resolved_value": "Elite"},
        headers=admin_client.auth_header,
    )

    assert _profile(db)["high_flyer"]["human_reviewed"] is True


def test_bulk_after_an_individual_resolve_leaves_the_decision_alone(admin_client, db):
    """M2.6, strengthened: a bulk cannot clear the marker, because it never
    reaches a marked entry. The marker records the last decision AND guards it."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("None", "None", "Capable")},
        [{"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"}],
    )
    _resolve(admin_client, "high_flyer")
    assert _profile(db)["high_flyer"]["human_reviewed"] is True
    resolved_tier = _profile(db)["high_flyer"]["final_tier"]
    # A fresh flag on the same Skill (a later recompute re-flagged it), with an
    # ordinary reason — the #120 contradiction prefix is not the only way back.
    db.rows["draft_skill_flags"].append({
        "id": "f-hf2", "skill_profile_id": PROFILE_ID, "skill_name": "high_flyer",
        "stat_rating": "None", "claude_rating": "Capable",
        "flag_reason": "two_tier_disagreement",
        "resolution": None, "resolved_value": None,
    })

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 0
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "high_flyer", "reason": "human_decision"}
    ]
    assert _profile(db)["high_flyer"]["human_reviewed"] is True
    assert _profile(db)["high_flyer"]["final_tier"] == resolved_tier
    assert _flag(db, "f-hf2")["resolution"] is None


def test_individual_resolve_after_a_bulk_sets_human_reviewed(admin_client, db):
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("None", "None", "Capable")},
        [{"id": "f-hf", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"}],
    )
    _bulk_scope(admin_client, [PID], skill_name="high_flyer")
    assert "human_reviewed" not in _profile(db)["high_flyer"]
    db.rows["draft_skill_flags"].append({
        "id": "f-hf2", "skill_profile_id": PROFILE_ID, "skill_name": "high_flyer",
        "stat_rating": "None", "claude_rating": "Capable", "flag_reason": None,
        "resolution": None, "resolved_value": None,
    })

    _resolve(admin_client, "high_flyer")

    assert _profile(db)["high_flyer"]["human_reviewed"] is True


# ---------------------------------------------------------------------------
# M2.7 — batched writes
# ---------------------------------------------------------------------------


def test_bulk_batches_flag_writes_by_tier(admin_client, db):
    _seed_player(
        db, PID, PROFILE_ID,
        {
            "passer":  _entry("None", "None", "Capable"),
            "cutter":  _entry("None", "None", "Capable"),
            "driver":  _entry("None", "None", "Elite"),
        },
        [
            {"id": "f-passer", "skill_name": "passer", "stat_rating": "None", "claude_rating": "Capable"},
            {"id": "f-cutter", "skill_name": "cutter", "stat_rating": "None", "claude_rating": "Capable"},
            {"id": "f-driver", "skill_name": "driver", "stat_rating": "None", "claude_rating": "Elite"},
        ],
    )

    data = _bulk(admin_client).get_json()["data"]

    assert data["resolved_count"] == 3
    flag_writes = [p for t, p in db.updates if t == "draft_skill_flags"]
    assert len(flag_writes) == 2  # one write per resolved tier, not one per flag
    assert {w["resolved_value"] for w in flag_writes} == {"Capable", "Elite"}
    profile_writes = [p for t, p in db.updates if t == "draft_skill_profiles" and "profile" in p]
    assert len(profile_writes) == 1
    assert data["all_flags_resolved"] is True
    assert db.rows["draft_skill_profiles"][0]["reviewed"] is True


# ---------------------------------------------------------------------------
# M2.4 — input validation
# ---------------------------------------------------------------------------


def test_bulk_rejects_a_non_boolean_agreements_only(admin_client, db):
    _seed(db)

    resp = _bulk_scope(admin_client, [PID], agreements_only="yes")

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "invalid_agreements_only"
    assert db.updates == []


def test_bulk_rejects_an_unknown_skill_name(admin_client, db):
    _seed(db)

    resp = _bulk_scope(admin_client, [PID], skill_name="not_a_skill")

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "unknown_skill"


def test_bulk_rejects_a_bad_uuid(admin_client, db):
    _seed(db)

    resp = _bulk_scope(admin_client, [PID, "nope"])

    assert resp.status_code == 400
    assert db.updates == []


def test_bulk_caps_the_player_list(admin_client, db):
    _seed(db)

    resp = _bulk_scope(admin_client, [f"00000000-0000-0000-0000-{i:012d}" for i in range(601)])

    assert resp.status_code == 400
    assert resp.get_json()["error"] == "too_many_players"


def test_bulk_chunks_every_id_list(admin_client, db):
    """M2.4/M2.7 — 250 players, and no `.in_()` above the 100-id ceiling."""
    ids = [f"00000000-0000-0000-0000-{i:012d}" for i in range(250)]
    for i, pid in enumerate(ids):
        _seed_player(
            db, pid, f"prof-{i}",
            {"high_flyer": _entry("None", "None", "Capable")},
            [{"id": f"f-{i}", "skill_name": "high_flyer", "stat_rating": "None", "claude_rating": "Capable"}],
        )

    data = _bulk_scope(admin_client, ids, skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 250


# ---------------------------------------------------------------------------
# Review findings — a human decision must survive every bulk path
# ---------------------------------------------------------------------------


def test_bulk_whole_player_skips_a_human_decision_contradiction(admin_client, db):
    """The per-player "Trust All Claude" button sends no skill_name.

    A skip gated on per-Skill mode never runs there, so the override is
    overwritten and `skipped` reports nothing.
    """
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": {
            **_entry("Capable", "None", "Capable"),
            "source":         "manual_override",
            "human_reviewed": True,
        }},
        [{"id": "f-hf", "skill_name": "high_flyer",
          "stat_rating": "None", "claude_rating": "Capable",
          "flag_reason": "human_decision_contradicted:manual_override:Capable"}],
    )

    data = _bulk(admin_client).get_json()["data"]

    assert data["resolved_count"] == 0
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "high_flyer", "reason": "human_decision"}
    ]
    assert _flag(db, "f-hf")["resolution"] is None
    assert _profile(db)["high_flyer"]["final_tier"] == "Capable"
    assert _profile(db)["high_flyer"]["human_reviewed"] is True


def test_bulk_skips_an_entry_marked_human_reviewed(admin_client, db):
    """D21's marker is a guard, not a note.

    A re-flagged Skill carries an ordinary reason, so the flag_reason test
    alone leaves the human decision unprotected.
    """
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": {
            **_entry("Elite", "None", "Capable"),
            "source":         "resolved",
            "human_reviewed": True,
        }},
        [{"id": "f-hf", "skill_name": "high_flyer",
          "stat_rating": "None", "claude_rating": "Capable",
          "flag_reason": "two_tier_disagreement"}],
    )

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 0
    assert data["skipped"] == [
        {"player_id": PID, "skill_name": "high_flyer", "reason": "human_decision"}
    ]
    assert _flag(db, "f-hf")["resolution"] is None
    assert _profile(db)["high_flyer"]["final_tier"] == "Elite"


def test_bulk_still_resolves_an_entry_a_previous_bulk_wrote(admin_client, db):
    """A bulk writes source='resolved' too, so source alone cannot be the gate."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": {**_entry("None", "None", "Capable"), "source": "resolved"}},
        [{"id": "f-hf", "skill_name": "high_flyer",
          "stat_rating": "None", "claude_rating": "Capable",
          "flag_reason": "two_tier_disagreement"}],
    )

    data = _bulk_scope(admin_client, [PID], skill_name="high_flyer").get_json()["data"]

    assert data["resolved_count"] == 1
    assert _profile(db)["high_flyer"]["final_tier"] == "Capable"


def test_manual_override_stamps_the_open_flag_not_a_resolved_one(admin_client, db):
    """Two rows on one Skill: the override must close the OPEN one.

    Stamping the resolved row leaves the live flag open for the next bulk,
    which then overwrites the override.
    """
    _seed_player(db, PID, PROFILE_ID, {"high_flyer": _entry("None", "None", "Capable")}, [])
    db.rows["draft_skill_flags"].extend([
        {"id": "f-old", "skill_profile_id": PROFILE_ID, "skill_name": "high_flyer",
         "stat_rating": "None", "claude_rating": "Capable",
         "flag_reason": "two_tier_disagreement",
         "resolution": "trust_claude", "resolved_value": "Capable"},
        {"id": "f-open", "skill_profile_id": PROFILE_ID, "skill_name": "high_flyer",
         "stat_rating": "None", "claude_rating": "Capable",
         "flag_reason": "two_tier_disagreement",
         "resolution": None, "resolved_value": None},
    ])

    resp = admin_client.post(
        f"/api/review/{PID}/manual-override",
        json={"skill_name": "high_flyer", "resolved_value": "Elite"},
        headers=admin_client.auth_header,
    )

    assert resp.status_code == 200, resp.get_json()
    assert _flag(db, "f-open")["resolution"] == "manual_override"
    assert _flag(db, "f-open")["resolved_value"] == "Elite"
    assert _flag(db, "f-old")["resolved_value"] == "Capable"


# ---------------------------------------------------------------------------
# Review findings — the queue's count and the click read one authority
# ---------------------------------------------------------------------------


def test_review_queue_counts_a_real_claude_none_as_an_agreement(admin_client, db):
    """'None' is a tier. When the composite holds it, the bulk resolves it."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": _entry("None", "None", "None")},
        [{"id": "f-hf", "skill_name": "high_flyer",
          "stat_rating": "None", "claude_rating": "None"}],
    )

    queue = admin_client.get("/api/review/queue?skill_name=high_flyer").get_json()["data"]
    assert queue[0]["agreement_count"] == 1

    data = _bulk_scope(
        admin_client, [PID], skill_name="high_flyer", agreements_only=True
    ).get_json()["data"]
    assert data["resolved_count"] == 1


def test_review_queue_agreement_count_skips_a_human_reviewed_entry(admin_client, db):
    """The button never promises a flag the server will refuse."""
    _seed_player(
        db, PID, PROFILE_ID,
        {"high_flyer": {
            **_entry("Capable", "Capable", "Capable"),
            "source":         "resolved",
            "human_reviewed": True,
        }},
        [{"id": "f-hf", "skill_name": "high_flyer",
          "stat_rating": "Capable", "claude_rating": "Capable"}],
    )

    queue = admin_client.get("/api/review/queue?skill_name=high_flyer").get_json()["data"]

    assert queue[0]["agreement_count"] == 0


# ---------------------------------------------------------------------------
# Review findings — bulk_resolve's flag reads page past the row cap
# ---------------------------------------------------------------------------


def test_bulk_pages_the_flag_reads_past_the_row_cap(admin_client, db, monkeypatch):
    """draft_skill_flags holds many rows per profile — an unpaged read truncates."""
    from services import supabase_client

    monkeypatch.setattr(supabase_client, "PAGE_SIZE", 5)
    db.row_cap = 5

    skills = sorted(_all_skills())
    assert len(skills) >= 12, f"need 12 bulk-resolvable Skills, taxonomy gave {len(skills)}"
    skills = skills[:12]

    _seed_player(
        db, PID, PROFILE_ID,
        {s: _entry("None", "None", "Capable") for s in skills},
        [{"id": f"f-{s}", "skill_name": s, "stat_rating": "None", "claude_rating": "Capable"}
         for s in skills],
    )

    data = _bulk(admin_client).get_json()["data"]

    assert data["resolved_count"] == 12
    assert all(_flag(db, f"f-{s}")["resolution"] == "trust_claude" for s in skills)


def _all_skills() -> set[str]:
    """Skills a whole-player bulk trust_claude can actually resolve."""
    from services.skills import (
        ALL_SKILLS,
        HIGH_CONFIDENCE_SKILLS,
        NO_BULK_TRUST_STATS_SKILLS,
    )

    return set(ALL_SKILLS) - set(HIGH_CONFIDENCE_SKILLS) - set(NO_BULK_TRUST_STATS_SKILLS)
