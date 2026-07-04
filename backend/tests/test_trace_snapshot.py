"""
Tests for services.snapshot_versions.trace_snapshot.snapshot_skill_traces().

Freezes a per-skill condition trace + resolved override history into
released_players.skill_trace_snapshot at Snapshot Release publish time.
See feature_requests/player-skill-provenance-plan.md (issue #82).
"""

from __future__ import annotations

import logging

import pytest

from services.snapshot_versions import trace_snapshot


RELEASE_ID = "11111111-1111-1111-1111-111111111111"
SEASON = "2025-26"

# Minimal real threshold rule + stats fixture exercised through the real
# collect_condition_results() — not mocked, per TDD guidance to exercise real
# collaborators rather than internal implementation details.
SPOT_UP_RULE = {
    "tiers": {
        "Elite": {
            "logic": "AND",
            "conditions": [{"stat": "fg3a", "operator": ">=", "value": 4.0}],
        }
    }
}
GOOD_STATS = {"fg3a": 5.2, "metadata": {"games_played": 70}}


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: dict[str, object] = {}
        self._in_filters: dict[str, list] = {}
        self._order_key: str | None = None
        self._order_desc = False
        self._limit: int | None = None
        self._update_data: dict | None = None

    def select(self, *_args, **_kwargs):
        return self

    def update(self, data: dict):
        self._update_data = data
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def in_(self, key, values):
        self._in_filters[key] = list(values)
        return self

    def order(self, key, *, desc: bool = False, **_kwargs):
        self._order_key = key
        self._order_desc = desc
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        if self._update_data is not None:
            return _FakeResult(self.db.update(self.table_name, self._update_data, self._filters))

        rows = self.db.select(self.table_name, self._filters, self._in_filters)
        if self._order_key is not None:
            rows = sorted(rows, key=lambda r: r.get(self._order_key) or "", reverse=self._order_desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    """In-memory Supabase double — mirrors the _FakeQuery/_FakeSupabase pattern
    already used in test_community_api.py, extended with .update() support."""

    def __init__(self, rows: dict[str, list[dict]]):
        self.rows = rows
        self.in_call_sizes: list[int] = []  # records len() of every in_() call, for batching tests
        self.raise_on_update_id: str | None = None  # simulates an unexpected per-row failure

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name, filters, in_filters):
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [r for r in rows if r.get(key) == value]
        for key, values in (in_filters or {}).items():
            self.in_call_sizes.append(len(values))
            rows = [r for r in rows if r.get(key) in values]
        return rows

    def update(self, table_name, data, filters):
        if table_name == "released_players" and filters.get("id") == self.raise_on_update_id:
            raise RuntimeError("simulated write failure")
        updated = []
        for row in self.rows.get(table_name, []):
            if all(row.get(k) == v for k, v in filters.items()):
                row.update(data)
                updated.append(row)
        return updated


def _make_thresholds(monkeypatch, rule: dict = SPOT_UP_RULE):
    monkeypatch.setattr(trace_snapshot, "get_thresholds", lambda _c: {"spot_up_shooter": rule})
    monkeypatch.setattr(trace_snapshot, "get_league_averages", lambda _s, _c: {})


def test_single_player_gets_computed_true_with_condition_results(monkeypatch):
    _make_thresholds(monkeypatch)
    db = _FakeSupabase({
        "released_players": [
            {"id": "rp-1", "source_player_id": "p-1", "source_skill_profile_id": "sp-1",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
        ],
        "draft_skill_flags": [],
        "player_stats": [
            {"player_id": "p-1", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
        ],
    })

    updated = trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)

    assert updated == 1
    row = db.rows["released_players"][0]
    assert row["skill_trace_snapshot"]["computed"] is True
    spot_up = row["skill_trace_snapshot"]["skills"]["spot_up_shooter"]
    assert spot_up["condition_results"][0]["passed"] is True
    assert spot_up["condition_results"][0]["actual_value"] == 5.2
    assert spot_up["override"] is None


def test_resolved_flag_attaches_only_to_its_own_skill(monkeypatch):
    _make_thresholds(monkeypatch)
    db = _FakeSupabase({
        "released_players": [
            {"id": "rp-1", "source_player_id": "p-1", "source_skill_profile_id": "sp-1",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
        ],
        "draft_skill_flags": [
            {"skill_profile_id": "sp-1", "skill_name": "spot_up_shooter",
             "resolution": "manual_override", "resolved_value": "Elite",
             "resolved_at": "2026-06-30T18:04:00Z",
             "notes": "INTERNAL TEST NOTE — never allowed to leak into the frozen trace"},
        ],
        "player_stats": [
            {"player_id": "p-1", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
        ],
    })

    trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)

    skills = db.rows["released_players"][0]["skill_trace_snapshot"]["skills"]
    assert skills["spot_up_shooter"]["override"] == {
        "resolution": "manual_override",
        "resolved_value": "Elite",
        "resolved_at": "2026-06-30T18:04:00Z",
    }
    # Every other skill in ALL_SKILLS has no override.
    other_skill = next(s for s in skills if s != "spot_up_shooter")
    assert skills[other_skill]["override"] is None
    # notes must never leak into the frozen trace, even though the source row has one.
    assert "notes" not in skills["spot_up_shooter"]["override"]
    assert "INTERNAL TEST NOTE" not in str(db.rows["released_players"][0]["skill_trace_snapshot"])


def test_missing_player_stats_sets_computed_false_without_blocking_other_players(monkeypatch):
    _make_thresholds(monkeypatch)
    db = _FakeSupabase({
        "released_players": [
            {"id": "rp-missing", "source_player_id": "p-missing", "source_skill_profile_id": "sp-missing",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
            {"id": "rp-good", "source_player_id": "p-good", "source_skill_profile_id": "sp-good",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
        ],
        "draft_skill_flags": [],
        "player_stats": [
            {"player_id": "p-good", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
        ],
    })

    updated = trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)

    assert updated == 2  # both rows processed, no exception raised
    missing_trace = next(r for r in db.rows["released_players"] if r["id"] == "rp-missing")["skill_trace_snapshot"]
    good_trace = next(r for r in db.rows["released_players"] if r["id"] == "rp-good")["skill_trace_snapshot"]

    assert missing_trace["computed"] is False
    assert all(s["condition_results"] == [] and s["override"] is None for s in missing_trace["skills"].values())
    assert good_trace["computed"] is True


def test_duplicate_flag_rows_latest_resolved_at_wins(monkeypatch):
    _make_thresholds(monkeypatch)
    db = _FakeSupabase({
        "released_players": [
            {"id": "rp-1", "source_player_id": "p-1", "source_skill_profile_id": "sp-1",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
        ],
        "draft_skill_flags": [
            {"skill_profile_id": "sp-1", "skill_name": "spot_up_shooter",
             "resolution": "trust_stats", "resolved_value": "Proficient",
             "resolved_at": "2026-01-01T00:00:00Z"},
            {"skill_profile_id": "sp-1", "skill_name": "spot_up_shooter",
             "resolution": "manual_override", "resolved_value": "Elite",
             "resolved_at": "2026-06-30T18:04:00Z"},  # later — this one should win
        ],
        "player_stats": [
            {"player_id": "p-1", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
        ],
    })

    trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)

    override = db.rows["released_players"][0]["skill_trace_snapshot"]["skills"]["spot_up_shooter"]["override"]
    assert override["resolution"] == "manual_override"
    assert override["resolved_value"] == "Elite"


def test_batches_reads_at_scale_and_resolves_every_player(monkeypatch):
    """230 players -> 3 draft_skill_flags batches and 3 player_stats batches
    (100 + 100 + 30), same PostgREST IN(...) limit as the codebase's existing
    fetch_profiles_by_source_player_ids / _fetch_stats_bulk. Every player,
    including ones in the last partial batch, must still resolve correctly."""
    _make_thresholds(monkeypatch)
    n = 230
    released = [
        {"id": f"rp-{i}", "source_player_id": f"p-{i}", "source_skill_profile_id": f"sp-{i}",
         "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False}
        for i in range(n)
    ]
    stats = [
        {"player_id": f"p-{i}", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"}
        for i in range(n)
    ]
    flags = [
        {"skill_profile_id": f"sp-{i}", "skill_name": "spot_up_shooter",
         "resolution": "manual_override", "resolved_value": "Elite", "resolved_at": "2026-06-30T18:04:00Z"}
        for i in range(n)
    ]
    db = _FakeSupabase({"released_players": released, "draft_skill_flags": flags, "player_stats": stats})

    updated = trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)

    assert updated == n
    assert all(size <= 100 for size in db.in_call_sizes)
    # Spot-check the first, a middle, and the last (partial-batch) player.
    for i in (0, 150, n - 1):
        trace = next(r for r in db.rows["released_players"] if r["id"] == f"rp-{i}")["skill_trace_snapshot"]
        assert trace["computed"] is True
        assert trace["skills"]["spot_up_shooter"]["override"]["resolved_value"] == "Elite"


def test_unexpected_write_failure_never_raises_and_logs_completeness_gap(monkeypatch, caplog):
    _make_thresholds(monkeypatch)
    db = _FakeSupabase({
        "released_players": [
            {"id": "rp-bad", "source_player_id": "p-bad", "source_skill_profile_id": "sp-bad",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
            {"id": "rp-good", "source_player_id": "p-good", "source_skill_profile_id": "sp-good",
             "stat_season": SEASON, "snapshot_release_id": RELEASE_ID, "is_legend": False},
        ],
        "draft_skill_flags": [],
        "player_stats": [
            {"player_id": "p-bad", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
            {"player_id": "p-good", "season": SEASON, "stats": GOOD_STATS, "fetched_at": "2026-06-01T00:00:00Z"},
        ],
    })
    db.raise_on_update_id = "rp-bad"

    with caplog.at_level(logging.WARNING, logger="services.snapshot_versions.trace_snapshot"):
        updated = trace_snapshot.snapshot_skill_traces(RELEASE_ID, SEASON, client=db)  # must not raise

    assert updated == 1  # only the good row actually committed
    good_row = next(r for r in db.rows["released_players"] if r["id"] == "rp-good")
    assert good_row["skill_trace_snapshot"]["computed"] is True
    # A completeness-check WARNING names the release and that a row was missed.
    assert any(RELEASE_ID in msg and "incomplete" in msg.lower() for msg in caplog.messages)
