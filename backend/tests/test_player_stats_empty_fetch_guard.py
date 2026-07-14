"""A failed NBA.com fetch must never be persisted over good data.

`get_or_fetch_player_stats` INSERTs (not upserts) a new player_stats row on every
fetch, and every reader takes the newest row. So an all-null blob from a failed
bulk fetch does not merely fail — it *shadows* the player's real stats. Luka,
Giannis and Wembanyama each ended up looking like players with no stats at all,
two minutes after a perfectly good row was written.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from services import players_service


EMPTY_SECTIONS = {
    "box_score": {"pts": None, "fga": None, "tov": None},
    "tracking_defense": {"deflections": None, "contested_shots": None},
    "matchup_defense": {"total_matchup_poss": None},
    "play_type": {"cut_ppp": None},
}

GOOD_SECTIONS = {
    "box_score": {"pts": 28.2, "fga": 20.1, "tov": 4.0},
    "tracking_defense": {"deflections": 1.4, "contested_shots": 6.0},
    "matchup_defense": {"total_matchup_poss": 410.0},
    "play_type": {"cut_ppp": 1.2},
}


def test_a_blob_with_no_box_score_data_is_not_usable():
    assert players_service._blob_has_data(GOOD_SECTIONS) is True
    assert players_service._blob_has_data(EMPTY_SECTIONS) is False


def test_a_blob_missing_box_score_entirely_is_not_usable():
    assert players_service._blob_has_data({}) is False
    assert players_service._blob_has_data({"box_score": {}}) is False


def _patch_fetch(monkeypatch, blob):
    """Drive get_or_fetch_player_stats down its live-fetch path, returning `blob`."""
    supabase = MagicMock()
    monkeypatch.setattr(
        players_service, "_get_player_by_id",
        lambda pid, sb: {"id": pid, "nba_api_id": 1629029, "games_played": 60,
                         "minutes_per_game": 35.0, "salary": None, "weight": 230},
    )
    # No cached row -> take the live-fetch branch.
    monkeypatch.setattr(players_service, "run_query", lambda fn: MagicMock(data=[]))
    monkeypatch.setattr(players_service.nba_api_client, "get_bulk_stats", lambda s: {})
    monkeypatch.setattr(players_service.nba_api_client, "get_player_index", lambda s: {})
    monkeypatch.setattr(players_service.nba_api_client, "get_player_shot_chart", lambda i, s: None)
    monkeypatch.setattr(players_service.nba_api_client, "get_player_matchups", lambda i, s: None)
    monkeypatch.setattr(players_service, "assemble_stats_blob", lambda **kw: blob)

    inserted: list = []
    monkeypatch.setattr(players_service, "_persist_stats_blob",
                        lambda *a, **k: inserted.append(a))
    return supabase, inserted


def test_an_empty_fetch_is_never_persisted(monkeypatch):
    """The regression. An all-null blob must not be written over the good row."""
    supabase, inserted = _patch_fetch(monkeypatch, dict(EMPTY_SECTIONS))

    result = players_service.get_or_fetch_player_stats("luka-uuid", "2025-26", supabase)

    assert result is None, "a failed fetch must report failure, not return an empty blob"
    assert inserted == [], "a failed fetch must NOT write a row — it would shadow real stats"


def test_a_good_fetch_is_still_persisted(monkeypatch):
    """The guard must not block the happy path."""
    supabase, inserted = _patch_fetch(monkeypatch, dict(GOOD_SECTIONS))

    result = players_service.get_or_fetch_player_stats("luka-uuid", "2025-26", supabase)

    assert result is not None
    assert len(inserted) == 1


def test_evaluator_picks_the_newest_USABLE_row_not_a_poisoned_one(monkeypatch):
    """The reader must survive poison already sitting in the table.

    player_stats is INSERTed, never upserted, so a player accumulates a row per
    fetch. Wembanyama has fourteen. The evaluator used to take whichever row
    Postgres returned first — arbitrary. Now it takes the newest row that
    actually has data, so a failed fetch cannot shadow a real one.
    """
    from services.skill_engine import evaluation_only

    # Newest-first, exactly as the (now explicitly ordered) query returns them.
    rows = [
        # newest, but a failed fetch — must be ignored
        {"player_id": "luka", "season": "2025-26", "fetched_at": "2026-07-13T16:46:30",
         "stats": dict(EMPTY_SECTIONS)},
        # the real row, two minutes older — must win
        {"player_id": "luka", "season": "2025-26", "fetched_at": "2026-07-13T16:44:07",
         "stats": dict(GOOD_SECTIONS)},
        # stale April row — must lose to the one above
        {"player_id": "luka", "season": "2025-26", "fetched_at": "2026-04-02T03:57:42",
         "stats": {"box_score": {"pts": 1.0, "fga": 1.0, "tov": 1.0}}},
    ]

    monkeypatch.setattr(evaluation_only, "_get_client", lambda: MagicMock())
    monkeypatch.setattr(evaluation_only, "run_query", lambda fn: MagicMock(data=rows))
    monkeypatch.setattr(evaluation_only, "get_thresholds", lambda c: {})
    monkeypatch.setattr(evaluation_only, "get_league_averages", lambda s, c: {})
    monkeypatch.setattr(evaluation_only, "stage_profile_rows", lambda run_id, rows_: None)
    monkeypatch.setattr(evaluation_only, "apply_auto_promotions", lambda r, t: r)

    # Capture the blob the evaluator was actually handed — that IS the assertion.
    seen: list[dict] = []

    def _spy(stats_blob, thresholds, league_avgs):
        seen.append(stats_blob)
        return {}

    monkeypatch.setattr(evaluation_only, "evaluate_all_skills", _spy)

    evaluation_only.evaluate_skills_for_run(
        run_id="run-1", player_ids=["luka"], season="2025-26",
    )

    assert len(seen) == 1, "Luka must still be evaluated — not dropped"
    assert seen[0]["box_score"]["pts"] == 28.2, (
        "the evaluator was handed the wrong row: it must take the newest row that "
        "HAS data, never the all-null failed fetch and never the stale April row"
    )
