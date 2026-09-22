"""Stats-fetch fixes that ride the one M1 refetch (#17, plan M1.22-M1.24).

- Traded players: per-team rows merge per-game aware (a naive sum doubles POSS).
- The blob carries pace, possessions and GP; games and minutes come from the
  fresh base row, not the stale players table.
- Prior-season 3-point totals (decision d): career minus this season, once.

No test here reaches NBA.com or a database: every call is monkeypatched.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pandas as pd
import pytest

from services import nba_api_client, players_service
from services.stats_assembler import assemble_stats_blob

NBA_ID = 1628384  # OG Anunoby


# ---------------------------------------------------------------------------
# M1.22 — traded-player row merge
# ---------------------------------------------------------------------------

_SYNERGY_COLS = ["PLAYER_ID", "TEAM_ID", "TEAM_ABBREVIATION", "GP", "POSS", "POSS_PCT", "PTS", "PPP", "PERCENTILE"]


def test_traded_player_rows_merge_per_game_aware():
    """Stints (GP 10, POSS 3.0) and (GP 40, POSS 5.0) are per-game: the naive sum is 8.0."""
    df = pd.DataFrame(
        [
            [NBA_ID, 1, "NYK", 10, 3.0, 0.20, 3.0, 1.0, 0.40],
            [NBA_ID, 2, "TOR", 40, 5.0, 0.25, 5.5, 1.1, 0.60],
        ],
        columns=_SYNERGY_COLS,
    )

    row = nba_api_client._df_to_player_dict(df)[NBA_ID]

    assert row["GP"] == 50
    assert row["POSS"] == pytest.approx(4.6)             # (30 + 200) / 50
    assert row["POSS_PCT"] == pytest.approx(230 / 950)   # (30 + 200) / (150 + 800)
    assert row["PPP"] == pytest.approx(250 / 230)        # (30 + 220) / (30 + 200)
    assert row["PTS"] == pytest.approx(5.0)              # (30 + 220) / 50
    assert row["PERCENTILE"] == pytest.approx(0.56)      # GP-weighted mean (approximate)
    assert row["TEAM_ABBREVIATION"] == "TOR"             # text keeps the last row
    assert row["TEAM_ID"] == 2                           # ids are never averaged


def test_one_row_per_player_frame_is_unchanged():
    rows = [
        [NBA_ID, 1, "NYK", 70, 4.0, 0.2, 4.4, 1.1, 0.5],
        [201939, 3, "GSW", 60, 6.0, 0.3, 7.2, 1.2, 0.9],
    ]
    df = pd.DataFrame(rows, columns=_SYNERGY_COLS)

    got = nba_api_client._df_to_player_dict(df)

    assert got == {r[0]: dict(zip(_SYNERGY_COLS, r)) for r in rows}


# ---------------------------------------------------------------------------
# M1.23 — pace, possessions, GP; games and minutes from the base row
# ---------------------------------------------------------------------------

def _bulk(gp: int = 70, mpg: float = 33.0) -> dict:
    return {
        "base": {NBA_ID: {"PLAYER_ID": NBA_ID, "GP": gp, "MIN": mpg, "PTS": 16.4, "FGA": 12.1}},
        "advanced": {NBA_ID: {"PLAYER_ID": NBA_ID, "PACE": 97.8, "POSS": 66.3, "USG_PCT": 0.19}},
        "matchups": {1: pd.DataFrame()},  # the league call succeeded (this player has no rows)
    }


def test_blob_carries_pace_poss_and_gp():
    blob = assemble_stats_blob(
        nba_api_id=NBA_ID, bulk_data=_bulk(), shot_chart_df=None, matchup_df=None,
        salary=None, season="2025-26", games_played=70, minutes_per_game=33.0,
    )

    assert blob["advanced"]["pace"] == 97.8
    assert blob["advanced"]["poss"] == 66.3
    assert blob["box_score"]["gp"] == 70


def _fetch(monkeypatch, *, players_gp: int, bulk: dict, career: dict | None) -> tuple[dict | None, list]:
    """Drive get_or_fetch_player_stats down its live path with the real assembler."""
    monkeypatch.setattr(
        players_service, "_get_player_by_id",
        lambda pid, sb: {"id": pid, "nba_api_id": NBA_ID, "games_played": players_gp,
                         "minutes_per_game": 20.0, "salary": None, "weight": 232},
    )
    monkeypatch.setattr(players_service, "run_query", lambda fn: MagicMock(data=[]))
    monkeypatch.setattr(players_service.nba_api_client, "get_bulk_stats", lambda s: bulk)
    monkeypatch.setattr(players_service.nba_api_client, "get_player_index", lambda s: {})
    monkeypatch.setattr(players_service.nba_api_client, "get_player_shot_chart", lambda i, s: None)
    calls: list = []

    def _career(nba_api_id, season):
        calls.append((nba_api_id, season))
        return career

    monkeypatch.setattr(players_service.nba_api_client, "get_player_career_stats", _career)
    monkeypatch.setattr(players_service, "_persist_stats_blob", lambda *a, **k: None)
    blob = players_service.get_or_fetch_player_stats("og-uuid", "2025-26", MagicMock())
    return blob, calls


def test_games_and_minutes_come_from_the_base_row(monkeypatch):
    """The Stat Fetch never refreshes the players table, so its games can be stale."""
    blob, _ = _fetch(monkeypatch, players_gp=40, bulk=_bulk(gp=70, mpg=33.0), career=None)

    assert blob["metadata"]["games_played"] == 70
    assert blob["metadata"]["minutes_per_game"] == 33.0


# ---------------------------------------------------------------------------
# M1.24 — prior-season 3-point makes and attempts (decision d)
# ---------------------------------------------------------------------------

_SEASON_COLS = ["SEASON_ID", "TEAM_ABBREVIATION", "GP", "FG3M", "FG3A"]


class _FakeCareer:
    def __init__(self, season_rows: list, career_row: list):
        self._frames = [
            pd.DataFrame(season_rows, columns=_SEASON_COLS),
            pd.DataFrame([career_row], columns=["GP", "FG3M", "FG3A"]),
        ]

    def __call__(self, player_id):
        return self

    def get_data_frames(self):
        return self._frames


def _career_call(monkeypatch, season_rows, career_row):
    import nba_api.stats.endpoints as endpoints

    monkeypatch.setattr(nba_api_client, "_sleep", lambda: None)
    monkeypatch.setattr(endpoints, "PlayerCareerStats", _FakeCareer(season_rows, career_row))
    return nba_api_client.get_player_career_stats(NBA_ID, "2025-26")


def test_prior_fg3_subtracts_the_season_row(monkeypatch):
    got = _career_call(
        monkeypatch,
        [["2023-24", "NYK", 50, 200, 500], ["2024-25", "NYK", 60, 150, 400], ["2025-26", "NYK", 70, 150, 400]],
        [180, 500, 1300],
    )

    assert (got["prior_fg3m"], got["prior_fg3a"]) == (350, 900)
    assert got["career_games_played"] == 180  # the career-cache fields still come back


def test_prior_fg3_subtracts_a_traded_players_tot_row_once(monkeypatch):
    got = _career_call(
        monkeypatch,
        [["2024-25", "NYK", 60, 350, 900],
         ["2025-26", "NYK", 20, 50, 150], ["2025-26", "TOR", 50, 100, 250], ["2025-26", "TOT", 70, 150, 400]],
        [130, 500, 1300],
    )

    assert (got["prior_fg3m"], got["prior_fg3a"]) == (350, 900)


def test_prior_fg3_is_zero_for_a_rookie(monkeypatch):
    got = _career_call(monkeypatch, [["2025-26", "NYK", 70, 150, 400]], [70, 150, 400])

    assert (got["prior_fg3m"], got["prior_fg3a"]) == (0, 0)


def test_stat_fetch_stores_shooting_history(monkeypatch):
    blob, calls = _fetch(monkeypatch, players_gp=70, bulk=_bulk(),
                         career={"career_games_played": 180, "seasons_played": 3,
                                 "prior_fg3m": 350, "prior_fg3a": 900})

    assert calls == [(NBA_ID, "2025-26")]  # one career call per player, for this season
    assert blob["shooting_history"] == {"prior_fg3m": 350, "prior_fg3a": 900}


def test_failed_career_call_leaves_shooting_history_unknown(monkeypatch):
    blob, _ = _fetch(monkeypatch, players_gp=70, bulk=_bulk(), career=None)

    assert blob["shooting_history"] == {"prior_fg3m": None, "prior_fg3a": None}


# ---------------------------------------------------------------------------
# Review fix (2026-09-22) — a failed league matchup call is never persisted
# ---------------------------------------------------------------------------

def test_a_failed_league_matchup_call_is_not_persisted(monkeypatch):
    # Persisting would stamp a fresh fetched_at on a null matchup_defense, and
    # the 7-day skip would keep that hole through every retry of the refetch.
    bulk = {k: v for k, v in _bulk().items() if k != "matchups"}
    _fetch(monkeypatch, players_gp=70, bulk=bulk, career=None)  # installs the fakes
    persisted, careers = [], []
    monkeypatch.setattr(players_service, "_persist_stats_blob", lambda *a, **k: persisted.append(a))
    monkeypatch.setattr(players_service.nba_api_client, "get_player_career_stats", lambda *a: careers.append(a))

    assert players_service.get_or_fetch_player_stats("og-uuid", "2025-26", MagicMock()) is None
    assert persisted == []
    assert careers == []  # no career call either
