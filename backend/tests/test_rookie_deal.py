"""
test_rookie_deal.py — Unit tests for rookie deal derivation logic.

Tests the derive_is_rookie_deal() and enrich_with_rookie_deal() functions
from players_service.py.
"""

import pytest

from services.players_service import derive_is_rookie_deal, enrich_with_rookie_deal


class TestDeriveIsRookieDeal:
    """Test the is_rookie_deal derivation: draft_round == 1 AND season_exp <= 3."""

    def test_first_round_rookie_is_true(self):
        assert derive_is_rookie_deal({"draft_round": 1, "season_exp": 0}) is True

    def test_first_round_year_three_is_true(self):
        assert derive_is_rookie_deal({"draft_round": 1, "season_exp": 3}) is True

    def test_first_round_year_four_is_false(self):
        """Year 4 = rookie extension territory, no longer rookie scale."""
        assert derive_is_rookie_deal({"draft_round": 1, "season_exp": 4}) is False

    def test_second_round_pick_is_false(self):
        assert derive_is_rookie_deal({"draft_round": 2, "season_exp": 1}) is False

    def test_undrafted_is_false(self):
        assert derive_is_rookie_deal({"draft_round": None, "season_exp": 1}) is False

    def test_missing_season_exp_is_false(self):
        assert derive_is_rookie_deal({"draft_round": 1, "season_exp": None}) is False

    def test_missing_both_is_false(self):
        assert derive_is_rookie_deal({}) is False


class TestEnrichWithRookieDeal:
    """Test that enrich_with_rookie_deal adds the flag without mutating input."""

    def test_adds_flag_to_each_player(self):
        players = [
            {"name": "Rookie", "draft_round": 1, "season_exp": 2},
            {"name": "Veteran", "draft_round": 1, "season_exp": 10},
        ]
        result = enrich_with_rookie_deal(players)
        assert result[0]["is_rookie_deal"] is True
        assert result[1]["is_rookie_deal"] is False

    def test_does_not_mutate_input(self):
        original = {"name": "Test", "draft_round": 1, "season_exp": 0}
        enrich_with_rookie_deal([original])
        assert "is_rookie_deal" not in original
