"""#134 — the matchup fetch, the G/F/C buckets and the two deployment signals.

No test here reaches NBA.com: the raw curl_cffi session is monkeypatched.
"""

from __future__ import annotations

import pandas as pd
import pytest

from services import nba_api_client, stats_assembler

COLS = ["DEF_PLAYER_ID", "OFF_PLAYER_ID", "PARTIAL_POSS", "MATCHUP_FG_PCT",
        "PLAYER_PTS", "MATCHUP_FGM", "MATCHUP_FGA"]
OG, OTHER = 1628384, 203999
ROWS = [
    [OG, 1, 120.0, 0.45, 30, 9, 20],
    [OG, 2, 90.0, 0.40, 18, 6, 15],
    [OTHER, 1, 200.0, 0.50, 40, 12, 24],
]


class _FakeResp:
    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def captured(monkeypatch):
    """Capture the params of the raw matchup call and return the fixture rows."""
    calls: list[dict] = []

    def fake_get(url, params=None, **kw):
        calls.append(params)
        return _FakeResp({"resultSets": [{"headers": COLS, "rowSet": ROWS}]})

    monkeypatch.setattr(nba_api_client._cffi_session, "get", fake_get)
    monkeypatch.setattr(nba_api_client, "_sleep", lambda: None)
    return calls


def test_league_matchups_one_call_grouped_by_defender(captured):
    result = nba_api_client.get_league_matchups("2025-26")

    assert set(result) == {OG, OTHER}
    assert isinstance(result[OG], pd.DataFrame)
    assert list(result[OG]["OFF_PLAYER_ID"]) == [1, 2]
    assert set(result[OG]["DEF_PLAYER_ID"]) == {OG}
    assert list(result[OTHER]["PARTIAL_POSS"]) == [200.0]

    assert len(captured) == 1
    params = captured[0]
    assert params["DefPlayerID"] == ""
    assert params["OffPlayerID"] == ""
    assert params["PerMode"] == "Totals"
    assert params["Season"] == "2025-26"
    assert not [k for k in params if k.endswith("Nullable")]


def test_league_matchups_failure_returns_empty(monkeypatch):
    def boom(*a, **kw):
        raise TimeoutError("slow")

    monkeypatch.setattr(nba_api_client._cffi_session, "get", boom)
    monkeypatch.setattr(nba_api_client, "_sleep", lambda: None)
    monkeypatch.setattr(nba_api_client.time, "sleep", lambda s: None)
    assert nba_api_client.get_league_matchups("2025-26") == {}


@pytest.fixture
def clean_bulk_cache(monkeypatch):
    """Empty caches; counts the 28 frame fetches (each returns None)."""
    frame_calls: list = []
    monkeypatch.setattr(nba_api_client, "_bulk_cache", {})
    monkeypatch.setattr(nba_api_client, "_bulk_cache_ts", {})
    monkeypatch.setattr(nba_api_client, "_matchups_tried_ts", {})
    monkeypatch.setattr(nba_api_client, "_safe_fetch", lambda *a, **kw: frame_calls.append(a[0]))
    return frame_calls


def test_bulk_stats_carries_league_matchups(clean_bulk_cache, captured):
    data = nba_api_client.get_bulk_stats("2025-26")

    og = data["matchups"][OG]
    assert set(og["DEF_PLAYER_ID"]) == {OG}
    assert len(og) == 2
    assert "2025-26" in nba_api_client._bulk_cache


def test_a_failed_matchup_call_caches_the_frames_and_retries_only_matchups(clean_bulk_cache, monkeypatch):
    # Review fix (2026-09-22): not caching at all made every later player repeat
    # all 28 frame calls plus two 60 s matchup timeouts (~15,000 NBA.com calls).
    results = [{}, {}, {OG: pd.DataFrame(ROWS[:2], columns=COLS)}]
    matchup_calls: list = []

    def fake_matchups(season):
        matchup_calls.append(season)
        return results[len(matchup_calls) - 1]

    monkeypatch.setattr(nba_api_client, "get_league_matchups", fake_matchups)

    data = nba_api_client.get_bulk_stats("2025-26")
    frames = len(clean_bulk_cache)
    assert data["matchups"] == {}
    assert "2025-26" in nba_api_client._bulk_cache  # the 28 frames are cached

    # Within the back-off: no call at all.
    assert nba_api_client.get_bulk_stats("2025-26")["matchups"] == {}
    assert len(matchup_calls) == 1

    # After the back-off: the matchup call alone is retried, twice here.
    for _ in range(2):
        nba_api_client._matchups_tried_ts["2025-26"] -= nba_api_client.timedelta(minutes=11)
        data = nba_api_client.get_bulk_stats("2025-26")
    assert len(matchup_calls) == 3
    assert len(clean_bulk_cache) == frames
    assert set(data["matchups"]) == {OG}
    assert set(nba_api_client._bulk_cache["2025-26"]["matchups"]) == {OG}


# ---------------------------------------------------------------------------
# M1.15-M1.17 — G/F/C buckets through the explicit map
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw, group", [
    ("PG", "G"), ("SG", "G"), ("G", "G"), ("GF", "G"), ("G-F", "G"),
    ("SF", "F"), ("PF", "F"), ("F", "F"), ("FC", "F"), ("F-C", "F"),
    ("C", "C"),
    (None, None), ("", None), ("XYZ", None),
])
def test_matchup_group(raw, group):
    assert stats_assembler._matchup_group(raw) == group


def _matchup_df(rows):
    """rows: [(off_id, poss, fg_pct)] for one defender."""
    return pd.DataFrame(
        [{"DEF_PLAYER_ID": OG, "OFF_PLAYER_ID": o, "PARTIAL_POSS": p, "MATCHUP_FG_PCT": f}
         for o, p, f in rows]
    )


def test_gfc_buckets_count_dual_positions():
    # 60% F (SF + FC), 30% G (GF), 10% C
    index = {11: {"position": "SF"}, 12: {"position": "FC"},
             13: {"position": "GF"}, 14: {"position": "C"}}
    df = _matchup_df([(11, 200.0, 0.4), (12, 100.0, 0.5), (13, 150.0, 0.45), (14, 50.0, 0.6)])

    out = stats_assembler._compute_matchup_defense(OG, df, {}, index)

    assert out["positional_groups_guarded"] == 2
    assert out["matchup_poss_at_f"] == 300.0
    assert out["matchup_poss_at_g"] == 150.0
    assert out["matchup_poss_at_c"] == 50.0
    assert (out["matchup_poss_at_g"] + out["matchup_poss_at_f"] + out["matchup_poss_at_c"]
            == out["total_matchup_poss"])
    assert out["matchup_fg_pct_at_f"] == round((0.4 * 200 + 0.5 * 100) / 300, 4)
    assert not [k for k in out if k.endswith(("_pg", "_sg", "_sf", "_pf"))]


def test_opponent_missing_from_player_index_is_skipped_without_a_network_call(monkeypatch):
    calls: list = []
    monkeypatch.setattr(nba_api_client._cffi_session, "request",
                        lambda *a, **kw: calls.append(a))
    monkeypatch.setattr(nba_api_client._cffi_session, "get",
                        lambda *a, **kw: calls.append(a))
    monkeypatch.setattr(nba_api_client, "_sleep", lambda: None)
    df = _matchup_df([(11, 250.0, 0.4), (99, 50.0, 0.5)])

    out = stats_assembler._compute_matchup_defense(OG, df, {}, {11: {"position": "C"}})

    assert calls == [], "no per-opponent NBA.com lookup allowed"
    assert out["matchup_poss_at_c"] == 250.0
    assert out["total_matchup_poss"] == 300.0


# ---------------------------------------------------------------------------
# M1.18-M1.20 — matchup_difficulty and handler_share
# ---------------------------------------------------------------------------

def _base(rows):
    """rows: {pid: (GP, PTS)} → a bulk 'base' frame."""
    return {pid: {"PLAYER_ID": pid, "GP": gp, "PTS": pts} for pid, (gp, pts) in rows.items()}


def test_matchup_difficulty_weights_opponent_scoring_percentile():
    # Four GP>=20 scorers at percentiles .25/.5/.75/1.0; player 5 has GP 10 (excluded).
    bulk = {"base": _base({1: (60, 8.0), 2: (60, 12.0), 3: (60, 20.0), 4: (60, 30.0), 5: (10, 40.0)})}
    index = {pid: {"position": "F"} for pid in range(1, 6)}
    df = _matchup_df([(4, 100.0, 0.4), (1, 300.0, 0.4), (5, 80.0, 0.4)])

    out = stats_assembler._compute_matchup_defense(OG, df, bulk, index)

    assert out["matchup_difficulty"] == round((100 * 1.0 + 300 * 0.25) / 400, 4) == 0.4375


def test_opponent_pts_percentile_ties_take_the_average_rank():
    bulk = {"base": _base({1: (30, 10.0), 2: (30, 10.0), 3: (30, 20.0), 4: (5, 50.0)})}

    pct = stats_assembler._opponent_pts_percentile(bulk)

    assert set(pct) == {1, 2, 3}
    assert pct[1] == pct[2] == pytest.approx(0.5)
    assert pct[3] == pytest.approx(1.0)


def test_matchup_difficulty_is_none_without_ranked_opponents():
    df = _matchup_df([(1, 300.0, 0.4)])
    out = stats_assembler._compute_matchup_defense(OG, df, {}, {1: {"position": "G"}})
    assert out["matchup_difficulty"] is None


def test_handler_share_counts_pnr_plus_iso_heavy_opponents():
    # Opponent 1: 0.30 PnR + 0.15 iso = 0.45 → handler. Opponent 2: 0.30 + 0.05 → not.
    # Opponent 3: absent from both Synergy frames → 0, not a handler.
    bulk = {
        "synergy_prballhandler": {1: {"POSS_PCT": 0.30}, 2: {"POSS_PCT": 0.30}},
        "synergy_isolation": {1: {"POSS_PCT": 0.15}, 2: {"POSS_PCT": 0.05}},
    }
    index = {pid: {"position": "G"} for pid in (1, 2, 3)}
    df = _matchup_df([(1, 150.0, 0.4), (2, 200.0, 0.4), (3, 50.0, 0.4)])

    out = stats_assembler._compute_matchup_defense(OG, df, bulk, index)

    assert out["handler_share"] == round(150 / 400, 4)


def test_handler_share_is_none_without_synergy_frames():
    df = _matchup_df([(1, 300.0, 0.4)])
    out = stats_assembler._compute_matchup_defense(OG, df, {}, {1: {"position": "G"}})
    assert out["handler_share"] is None


# ---------------------------------------------------------------------------
# Review fix (2026-09-22) — FG% from makes and attempts, not FG% x possessions
# ---------------------------------------------------------------------------

def test_a_shotless_matchup_row_does_not_move_group_fg_pct():
    # 62,653 of 147,805 league rows have MATCHUP_FGA 0 and store MATCHUP_FG_PCT 0.0;
    # weighting FG% by PARTIAL_POSS counted each of those possessions as a miss.
    df = pd.DataFrame([
        {"DEF_PLAYER_ID": OG, "OFF_PLAYER_ID": 11, "PARTIAL_POSS": 200.0,
         "MATCHUP_FG_PCT": 0.4, "MATCHUP_FGM": 8.0, "MATCHUP_FGA": 20.0},
        {"DEF_PLAYER_ID": OG, "OFF_PLAYER_ID": 12, "PARTIAL_POSS": 100.0,
         "MATCHUP_FG_PCT": 0.0, "MATCHUP_FGM": 0.0, "MATCHUP_FGA": 0.0},
    ])
    index = {11: {"position": "F"}, 12: {"position": "F"}}

    out = stats_assembler._compute_matchup_defense(OG, df, {}, index)

    assert out["matchup_fg_pct_at_f"] == 0.4
    assert out["matchup_poss_at_f"] == 300.0  # the possessions still count


def test_league_avg_fg_pct_weights_each_player_by_games():
    # Base rows are per game: a 5-game player must not weigh as much as a 70-game one.
    bulk = {"base": {1: {"GP": 70, "FGM": 10.0, "FGA": 20.0},
                     2: {"GP": 5, "FGM": 1.0, "FGA": 10.0}}}
    index = {1: {"position": "G"}, 2: {"position": "G"}}

    avg = stats_assembler._compute_league_avg_fg_pct_by_position(bulk, index)

    assert avg["G"] == round((10 * 70 + 1 * 5) / (20 * 70 + 10 * 5), 4)


def test_handler_share_is_none_when_one_synergy_frame_failed():
    # One failed Synergy fetch would count every opponent 0 for that play type
    # and undercount handler_share with no warning; unknown beats wrong.
    bulk = {"synergy_prballhandler": {1: {"POSS_PCT": 0.45}}}
    df = _matchup_df([(1, 300.0, 0.4)])

    out = stats_assembler._compute_matchup_defense(OG, df, bulk, {1: {"position": "G"}})

    assert out["handler_share"] is None


# ---------------------------------------------------------------------------
# Review fix (2026-09-22) — a dashed dual keeps its primary (first) position
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw, group", [
    ("F-G", "F"), ("G-F", "G"), ("C-F", "C"), ("F-C", "F"),
])
def test_matchup_group_buckets_a_raw_dual_by_its_first_letter(raw, group):
    # normalize_position folds F-G and G-F both to GF (and C-F, F-C to FC),
    # which loses the primary position the NBA lists first.
    assert stats_assembler._matchup_group(raw) == group


def test_player_index_keeps_the_raw_position(monkeypatch):
    df = pd.DataFrame([{"PERSON_ID": 7, "POSITION": "F-G", "HEIGHT": "6-7", "WEIGHT": "220",
                        "DRAFT_ROUND": "1", "DRAFT_YEAR": "2020"}])
    monkeypatch.setattr(nba_api_client, "_bulk_cache", {})
    monkeypatch.setattr(nba_api_client, "_safe_fetch", lambda *a, **kw: df)

    entry = nba_api_client.get_player_index("2025-26")[7]

    assert entry["position"] == "GF"
    assert entry["position_raw"] == "F-G"


def test_matchup_buckets_read_the_raw_position():
    index = {11: {"position": "GF", "position_raw": "F-G"}, 12: {"position": "FC", "position_raw": "C-F"}}
    df = _matchup_df([(11, 200.0, 0.4), (12, 100.0, 0.5)])

    out = stats_assembler._compute_matchup_defense(OG, df, {}, index)

    assert (out["matchup_poss_at_g"], out["matchup_poss_at_f"], out["matchup_poss_at_c"]) == (0.0, 200.0, 100.0)


def test_stat_fetch_job_stops_when_the_league_matchup_call_failed(monkeypatch):
    # Review fix (2026-09-22): check the one league call before the player loop,
    # so a bulk refetch never runs ~500 players against a failed matchup call.
    import api.pipeline as pipeline

    fetched, done = [], []
    monkeypatch.setattr(pipeline, "get_supabase", lambda: None)
    monkeypatch.setattr(pipeline.nba_api_client, "get_bulk_stats",
                        lambda season: {"base": {1: {"GP": 70}}, "matchups": {}})
    monkeypatch.setattr(pipeline, "get_or_fetch_player_stats", lambda *a, **k: fetched.append(a))
    monkeypatch.setattr(pipeline.runs_repo, "update_progress", lambda *a: None)
    monkeypatch.setattr(pipeline.runs_repo, "complete_run", lambda run_id, **k: done.append(k))

    pipeline._run_fetch_stats_job("run-1", ["p1", "p2"], "2025-26", False)

    assert fetched == []
    assert len(done) == 1
    assert done[0]["rows_processed"] == 0
    assert "LeagueSeasonMatchups failed" in done[0]["error"]
