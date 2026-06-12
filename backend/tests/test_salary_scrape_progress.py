"""
test_salary_scrape_progress.py — #70 determinate progress for the bulk
full-league salary scrape.

run_bulk_salary_scrape accepts an optional progress_cb(processed, total)
callback. The bulk full-league path loops per-player while matching/updating
salaries, so it reports determinate progress (processed / total) the same way
_run_fetch_stats_job does — seed 0/N up front, then tick on a throttled cadence.

Bio/team sync bulk stays indeterminate by design (single bulk nba_api fetch,
no per-player seam) — see issue #70 wontfix note. No test asserts progress for it.

All DB and network access is mocked — the linked Supabase is PRODUCTION.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import services.players_service as players_service


def _make_supabase(player_rows: list[dict]) -> MagicMock:
    """A supabase mock whose players SELECT returns the given rows and whose
    UPDATE chain is a no-op (we only care about the progress callback)."""
    select_result = MagicMock()
    select_result.data = player_rows

    mock = MagicMock()
    # players SELECT ... .eq(season).execute()  → select_result
    mock.table.return_value.select.return_value.eq.return_value.execute.return_value = (
        select_result
    )
    # players UPDATE ... .eq(id).execute()  → harmless
    mock.table.return_value.update.return_value.eq.return_value.execute.return_value = (
        MagicMock()
    )
    return mock


def test_bulk_salary_scrape_reports_determinate_progress(monkeypatch):
    """Bulk scrape seeds 0/N then ticks to N/N through the per-player loop."""
    players = [{"id": f"p{i}", "name": f"Player {i}", "team": "BOS", "salary": None}
               for i in range(5)]

    monkeypatch.setattr(
        players_service.salary_scraper, "scrape_all_salaries",
        lambda: {"player 0": 1_000_000},
    )

    # match sets a salary on the first player so an UPDATE path is exercised.
    def fake_match(salary_map, rows):
        rows[0]["salary"] = 1_000_000
        return (1, len(rows) - 1)

    monkeypatch.setattr(
        players_service.salary_scraper, "match_salaries_to_players", fake_match,
    )

    progress: list[tuple[int, int]] = []
    result = players_service.run_bulk_salary_scrape(
        None,
        _make_supabase(players),
        progress_cb=lambda processed, total: progress.append((processed, total)),
    )

    # Seeded at 0/5 and reached 5/5 by the end.
    assert progress[0] == (0, 5)
    assert progress[-1] == (5, 5)
    # Monotonic non-decreasing processed, total constant.
    assert all(total == 5 for _, total in progress)
    assert [p for p, _ in progress] == sorted(p for p, _ in progress)
    assert result["total"] == 5


def test_bulk_salary_scrape_progress_optional(monkeypatch):
    """No callback → behaves exactly as before (no crash, returns counts)."""
    players = [{"id": "p1", "name": "Player 1", "team": "BOS", "salary": 5}]
    monkeypatch.setattr(
        players_service.salary_scraper, "scrape_all_salaries",
        lambda: {"player 1": 5},
    )
    monkeypatch.setattr(
        players_service.salary_scraper, "match_salaries_to_players",
        lambda salary_map, rows: (1, 0),
    )

    result = players_service.run_bulk_salary_scrape(None, _make_supabase(players))
    assert result["total"] == 1


def test_bulk_salary_scrape_empty_scrape_seeds_zero_progress(monkeypatch):
    """An empty scrape still reports a determinate 0/0 so the card leaves the
    indeterminate pulse rather than hanging without a denominator."""
    monkeypatch.setattr(
        players_service.salary_scraper, "scrape_all_salaries", lambda: {},
    )

    progress: list[tuple[int, int]] = []
    result = players_service.run_bulk_salary_scrape(
        None,
        _make_supabase([]),
        progress_cb=lambda processed, total: progress.append((processed, total)),
    )

    assert result == {"matched": 0, "unmatched": 0, "total": 0}
    assert progress == [(0, 0)]
