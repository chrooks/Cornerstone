"""Unit tests for backend/services/season.py — NBA season format validation."""

from __future__ import annotations

import pytest

from services.season import SEASON_FORMAT_MESSAGE, validate_nba_season


@pytest.mark.parametrize("season", ["2025-26", "1999-00", "2024-25", "1946-47"])
def test_accepts_valid_seasons(season):
    # Act / Assert: returns the season unchanged.
    assert validate_nba_season(season) == season


@pytest.mark.parametrize(
    "season",
    [
        "2025",        # missing tail
        "2025-27",     # tail not first+1
        "2025-24",     # tail goes backwards
        "25-26",       # short head
        "2025/26",     # wrong separator
        "",            # empty
        "  ",          # whitespace only
        "2025-2026",   # 4-digit tail
        "abcd-ef",     # non-numeric
        "2025-26 ",    # trailing space (strict)
    ],
)
def test_rejects_invalid_seasons(season):
    with pytest.raises(ValueError):
        validate_nba_season(season)


def test_rejects_none():
    with pytest.raises(ValueError):
        validate_nba_season(None)  # type: ignore[arg-type]


def test_error_message_is_the_shared_constant():
    with pytest.raises(ValueError) as exc:
        validate_nba_season("2025")
    assert SEASON_FORMAT_MESSAGE in str(exc.value)


def test_century_rollover_tail_wraps_mod_100():
    # 1999-00: tail is (99 + 1) mod 100 == 0 -> "00".
    assert validate_nba_season("1999-00") == "1999-00"
    with pytest.raises(ValueError):
        validate_nba_season("1999-01")
