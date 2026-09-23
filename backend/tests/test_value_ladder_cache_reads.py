"""`release_overalls` must order every paginated read (#119 M4 review).

Two reasons, one fix:

1. **Pages.** `_paginate` walks `.range()` windows. PostgREST gives no stable
   row order across pages without an ORDER BY, so a row can repeat or vanish
   between pages the first time the released pool passes 1,000 — silently
   corrupting every `overall` and every price. `dev_checks.pages` already
   documents the rule ("build() must order the rows").
2. **Ties.** `compute_overall` rounds to one decimal, so players tie: 143 of
   401 actives on dev today, and 61 of the 100 Ringer players sit in a tie
   group. Rank inside a group is decided by the order the rows come back, so
   an unordered read makes the harness's "reproduces exactly" a claim about
   the query planner.

`composites.build_distributions` is deliberately not covered here: it sorts its
own output (`{name: sorted(vals)}`) and takes `max()` for the clip, so row order
cannot reach a number, and it does not paginate.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services.snapshot_versions import value_ladder_cache

SEASON = "2025-26"
RELEASE_ID = "rel-0001"


def _values() -> dict:
    seed = (
        Path(__file__).resolve().parents[2]
        / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    )
    return json.loads(seed.read_text())["payload"]["values"]


class _Recorder:
    """A query that refuses to execute a paginated read without an ORDER BY."""

    def __init__(self, table: str, log: list[tuple[str, str]]):
        self.table = table
        self._log = log
        self.filters: dict = {}
        self.ordered: str | None = None
        self.ranged = False

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def in_(self, *_a):
        return self

    def limit(self, *_a):
        return self

    def order(self, column, **_k):
        self.ordered = column
        self._log.append((self.table, column))
        return self

    def range(self, *_a):
        self.ranged = True
        return self

    def execute(self):
        if self.ranged and self.ordered is None:
            raise AssertionError(
                f"unordered paginated read on {self.table}: rows can repeat or "
                "vanish across pages, and ties rank by whatever comes back"
            )
        if self.table == "released_players":
            if self.filters.get("is_legend") is True:
                data = [{"canonical_player_id": "c1", "skill_profile_snapshot": {}}]
            else:
                data = [{"source_player_id": "p1", "skill_profile_snapshot": {}}]
        elif self.table == "players":
            data = [{"id": "p1", "salary": 10_000_000}]
        elif self.table == "canonical_players":
            data = [{"id": "c1", "nba_api_id": 42}]
        else:
            data = []
        return SimpleNamespace(data=data)


@pytest.fixture()
def read_log(monkeypatch):
    log: list[tuple[str, str]] = []
    client = SimpleNamespace(table=lambda name: _Recorder(name, log))
    monkeypatch.setattr(
        "services.supabase_client.get_supabase", lambda: client, raising=False
    )
    return log


def test_release_overalls_orders_every_paginated_read(read_log):
    actives, salaries, legends = value_ladder_cache.release_overalls(
        SEASON, _values(), RELEASE_ID, {}
    )

    # The reads still return what the ladder needs.
    assert list(actives) == ["p1"]
    assert salaries == [10_000_000]
    assert list(legends) == ["42"]

    # Every paginated table carries an ORDER BY (an unordered one raises above).
    assert {table for table, _ in read_log} == {"released_players", "players"}
    assert [c for t, c in read_log if t == "released_players"] == [
        "source_player_id",
        "canonical_player_id",
    ]
