"""
Tests for services.snapshot_versions.released_repo.fetch_skill_trace_by_source_player_id().

See feature_requests/player-skill-provenance-plan.md (issue #82).
"""

from __future__ import annotations

from services.snapshot_versions import released_repo


ACTIVE_RELEASE_ID = "22222222-2222-2222-2222-222222222222"
OTHER_RELEASE_ID = "33333333-3333-3333-3333-333333333333"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._filters: dict[str, object] = {}
        self._limit: int | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = [r for r in self._rows if all(r.get(k) == v for k, v in self._filters.items())]
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self, released_players: list[dict]):
        self._released_players = released_players

    def table(self, name: str):
        assert name == "released_players"
        return _FakeQuery(self._released_players)


def test_returns_trace_for_matching_non_legend_row():
    db = _FakeSupabase([
        {"source_player_id": "p-1", "snapshot_release_id": ACTIVE_RELEASE_ID, "is_legend": False,
         "skill_trace_snapshot": {"computed": True, "skills": {"spot_up_shooter": {"condition_results": [], "override": None}}}},
    ])

    trace = released_repo.fetch_skill_trace_by_source_player_id("p-1", ACTIVE_RELEASE_ID, client=db)

    assert trace == {"computed": True, "skills": {"spot_up_shooter": {"condition_results": [], "override": None}}}


def test_returns_none_when_no_matching_release_row():
    db = _FakeSupabase([
        {"source_player_id": "p-1", "snapshot_release_id": OTHER_RELEASE_ID, "is_legend": False,
         "skill_trace_snapshot": {"computed": True, "skills": {}}},
    ])

    assert released_repo.fetch_skill_trace_by_source_player_id("p-1", ACTIVE_RELEASE_ID, client=db) is None


def test_returns_none_for_legend_row():
    db = _FakeSupabase([
        {"source_player_id": "p-1", "snapshot_release_id": ACTIVE_RELEASE_ID, "is_legend": True,
         "skill_trace_snapshot": {"computed": True, "skills": {}}},
    ])

    assert released_repo.fetch_skill_trace_by_source_player_id("p-1", ACTIVE_RELEASE_ID, client=db) is None
