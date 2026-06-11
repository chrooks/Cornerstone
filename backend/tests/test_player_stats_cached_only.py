"""
Tests for get_or_fetch_player_stats(cached_only=True).

The review/QA path must never trigger the ~18s live nba_api fetch
(ShotChartDetail + matchups). cached_only returns the cached blob if present,
or None when nothing is cached — but in no case calls nba_api.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services import players_service


def _client_with_cached_row(stats_blob, fetched_at="2000-01-01T00:00:00+00:00"):
    """Supabase mock whose player_stats lookup returns one (stale) cached row."""
    client = MagicMock()
    (
        client.table.return_value
        .select.return_value
        .eq.return_value
        .eq.return_value
        .order.return_value
        .limit.return_value
        .execute.return_value
    ) = MagicMock(data=[{"stats": stats_blob, "fetched_at": fetched_at}])
    return client


def _client_with_no_cache():
    client = MagicMock()
    (
        client.table.return_value
        .select.return_value
        .eq.return_value
        .eq.return_value
        .order.return_value
        .limit.return_value
        .execute.return_value
    ) = MagicMock(data=[])
    return client


@pytest.fixture(autouse=True)
def _stub_player_lookup(monkeypatch):
    monkeypatch.setattr(
        players_service,
        "_get_player_by_id",
        lambda pid, sb: {"nba_api_id": 1630703, "games_played": 50, "minutes_per_game": 30},
    )


def test_cached_only_returns_stale_blob_without_calling_nba_api(monkeypatch):
    client = _client_with_cached_row({"box_score": {"pts": 20}})
    with patch.object(players_service.nba_api_client, "get_bulk_stats") as bulk:
        result = players_service.get_or_fetch_player_stats(
            "p1", "2025-26", client, cached_only=True
        )
    assert result == {"box_score": {"pts": 20}}
    bulk.assert_not_called()  # the ~18s live path must never run


def test_cached_only_returns_none_when_no_cache_without_fetch(monkeypatch):
    client = _client_with_no_cache()
    with patch.object(players_service.nba_api_client, "get_bulk_stats") as bulk:
        result = players_service.get_or_fetch_player_stats(
            "p1", "2025-26", client, cached_only=True
        )
    assert result is None
    bulk.assert_not_called()
