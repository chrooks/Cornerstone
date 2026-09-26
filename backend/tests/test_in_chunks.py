"""
test_in_chunks.py — no listed call site sends an `.in_()` list longer than 100.

The dev gateway (Kong) returns HTTP 414 above about 220 UUIDs in one query
string; on 2026-09-22 GET /api/review/queue failed that way on dev. Every
player-wide id list goes through `supabase_client.in_chunks` (groups of 100).
The fake client below raises when an `.in_()` receives more than 100 values,
and each test drives one call site with 401 fake ids.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.supabase_client import in_chunks

_MAX_IN = 100
_IDS = [f"00000000-0000-0000-0000-{i:012d}" for i in range(401)]


_PAGE = 1000  # PostgREST returns at most 1,000 rows per request


class _Query:
    """Accepts any builder chain; `.in_()` enforces the 100-id ceiling and
    filters rows that carry the column; `execute()` caps rows at 1,000 like
    PostgREST and reports the full `count` (an empty page for `head=True`)."""

    def __init__(self, data):
        self._data = data
        self._head = False

    def select(self, *_cols, count=None, head=None):
        self._head = bool(head)
        return self

    def in_(self, column, values):
        if len(values) > _MAX_IN:
            raise AssertionError(f".in_() received {len(values)} values (max {_MAX_IN})")
        if isinstance(self._data, list):
            wanted = set(values)
            self._data = [r for r in self._data if column not in r or r[column] in wanted]
        return self

    def __getattr__(self, _name):
        # eq / is_ / order / limit / range / single / gte / update ...
        return lambda *_a, **_k: self

    def execute(self):
        if not isinstance(self._data, list):
            return SimpleNamespace(data=self._data, count=None)
        return SimpleNamespace(data=[] if self._head else self._data[:_PAGE], count=len(self._data))


class _FakeClient:
    def __init__(self, data_by_table: dict):
        self._data_by_table = data_by_table

    def table(self, name):
        return _Query(self._data_by_table.get(name, []))


def test_in_chunks_slices():
    assert in_chunks([]) == []
    assert [len(c) for c in in_chunks(_IDS)] == [100, 100, 100, 100, 1]
    assert [x for c in in_chunks(_IDS) for x in c] == _IDS
    assert in_chunks([1, 2, 3], size=2) == [[1, 2], [3]]


def test_drift_audit_fetch_helpers_chunk():
    from services.snapshot_versions import drift_audit

    client = _FakeClient({})
    drift_audit._fetch_composite_profiles(client, "2025-26", _IDS)
    drift_audit._fetch_latest_stats(client, "2025-26", _IDS)
    drift_audit._fetch_player_names(client, _IDS)


def test_validate_publishable_composite_and_flag_reads_chunk():
    from services.snapshot_versions import validator

    client = _FakeClient({
        "snapshot_releases": {"season": "2025-26"},
        # No nba_api_id: skips the canonical read, which sends short integers.
        "players": [{"id": pid, "name": pid} for pid in _IDS],
        "draft_skill_profiles": [{"id": pid, "player_id": pid} for pid in _IDS],
    })
    out = validator.validate_publishable("draft-1", client=client)
    assert out["players_missing_composite"] == 0


_ADMIN = {"Authorization": "Bearer fake-admin"}


def _as_admin(monkeypatch):
    """Bypass the #182 admin gate: fake the JWT and the user_roles lookup."""
    from unittest.mock import MagicMock
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "test-admin"})
    role = MagicMock()
    role.data = {"role": "admin"}
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = role
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: client)


def test_review_queue_chunks(monkeypatch):
    import api.review as review
    from app import create_app

    client = _FakeClient({
        "draft_skill_profiles": [{"id": pid, "player_id": pid} for pid in _IDS],
        "draft_skill_flags": [
            {"id": f"f{i}", "skill_profile_id": pid, "skill_name": "passer", "flag_reason": "x"}
            for i, pid in enumerate(_IDS)
        ],
        "players": [{"id": pid, "name": pid, "team": "BOS", "position": "G"} for pid in _IDS],
    })
    monkeypatch.setattr(review, "get_supabase", lambda: client)
    _as_admin(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        resp = c.get("/api/review/queue", headers=_ADMIN)
    assert resp.status_code == 200, resp.get_json()
    assert len(resp.get_json()["data"]) == len(_IDS)


def test_evaluate_skills_for_run_stats_and_composite_reads_chunk(monkeypatch):
    from services.skill_engine import evaluation_only

    staged = {}
    monkeypatch.setattr(evaluation_only, "_get_client", lambda: _FakeClient({}))
    monkeypatch.setattr(evaluation_only, "get_thresholds", lambda _c: {})
    monkeypatch.setattr(evaluation_only, "get_league_averages", lambda _s, _c: {})
    monkeypatch.setattr(evaluation_only, "stage_profile_rows", lambda run_id, rows: staged.update(rows=rows))
    monkeypatch.setattr(evaluation_only, "stage_flag_rows", lambda *_a: pytest.fail("no flags expected"))

    evaluation_only.evaluate_skills_for_run("run-1", _IDS, "2025-26", recompute_composite=True)
    assert staged["rows"] == []


def test_league_average_compute_chunks():
    from services.skill_engine import cache

    client = _FakeClient({"players": [{"id": pid} for pid in _IDS]})
    cache.compute_and_store_league_averages("2025-26", client)


# ---------------------------------------------------------------------------
# Review fixes (2026-09-22)
# ---------------------------------------------------------------------------

_NBA_IDS = [str(1_600_000 + i) for i in range(401)]


def test_validate_publishable_canonical_reads_chunk():
    from services.snapshot_versions import validator

    client = _FakeClient({
        "snapshot_releases": {"season": "2025-26"},
        "players": [{"id": pid, "name": pid, "nba_api_id": nba} for pid, nba in zip(_IDS, _NBA_IDS)],
        "legends": [{"nba_api_id": nba} for nba in _NBA_IDS],
        "canonical_players": [{"nba_api_id": nba} for nba in _NBA_IDS[:-1]],  # the last one is missing
    })
    out = validator.validate_publishable("draft-1", client=client)
    assert out["players_missing_canonical"] == 1
    assert out["legends_missing_canonical"] == 1


def test_count_summary_chunks():
    from services.snapshot_versions import summary

    client = _FakeClient({
        "snapshot_releases": {"season": "2025-26"},
        "players": [{"id": pid} for pid in _IDS],
        "draft_skill_profiles": [{"id": pid, "player_id": pid} for pid in _IDS],
    })
    out = summary.count_summary("draft-1", client=client)
    assert out["players_total"] == len(_IDS)
    assert out["players_missing_composite"] == 0


def test_pipeline_status_chunks_and_counts_past_the_row_cap(monkeypatch):
    import api.pipeline as pipeline
    from app import create_app

    flags = [{"id": f"{pid}-{k}", "skill_profile_id": pid} for pid in _IDS for k in range(12)]
    client = _FakeClient({
        "players": [{"id": pid} for pid in _IDS],
        "draft_skill_profiles": [{"id": pid, "player_id": pid} for pid in _IDS],
        "draft_skill_flags": flags,  # 1,200 rows per 100-profile chunk
    })
    monkeypatch.setattr(pipeline, "get_supabase", lambda: client)
    monkeypatch.setattr(pipeline.runs_repo, "list_recent", lambda limit: [])
    _as_admin(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        resp = c.get("/api/pipeline/status", headers=_ADMIN)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["data"]["total_flags"] == len(flags)


def test_league_averages_use_each_players_newest_usable_row():
    from services.skill_engine import cache

    key = "tracking_shooting.catch_shoot_fg3_pct"

    def blob(pct, pts=20.0):
        return {"box_score": {"pts": pts}, "tracking_shooting": {"catch_shoot_fg3_pct": pct}}

    # player_stats is insert-only; rows come newest first (order fetched_at desc).
    client = _FakeClient({
        "players": [{"id": "a"}, {"id": "b"}],
        "player_stats": [
            {"player_id": "a", "stats": {"box_score": {"pts": None}}},  # newest: failed fetch
            {"player_id": "a", "stats": blob(0.40)},
            {"player_id": "a", "stats": blob(0.10)},                    # older: ignored
            {"player_id": "b", "stats": blob(0.30)},
        ],
    })
    out = cache.compute_and_store_league_averages("2025-26", client)
    assert out[key] == pytest.approx(0.35)


def test_salary_scrape_subset_read_chunks(monkeypatch):
    import api.pipeline as pipeline

    done = []
    monkeypatch.setattr(pipeline, "get_supabase", lambda: _FakeClient({}))
    monkeypatch.setattr(pipeline.runs_repo, "update_progress", lambda *a: None)
    monkeypatch.setattr(pipeline.runs_repo, "complete_run", lambda run_id, **k: done.append(k))

    pipeline._run_salary_scrape_job("run-1", _IDS)

    assert done == [{"rows_processed": 0, "error": None}]
