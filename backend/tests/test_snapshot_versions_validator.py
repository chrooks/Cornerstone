"""
Unit tests for backend/services/snapshot_versions/validator.py

Covers the missing_composite_players list (issue #52).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _result(data):
    r = MagicMock()
    r.data = data
    return r


def _player(
    player_id: str,
    name: str = "Test Player",
    team: str = "LAL",
    position: str = "G",
    nba_api_id: int = 1,
):
    return {
        "id": player_id,
        "nba_api_id": nba_api_id,
        "name": name,
        "team": team,
        "position": position,
    }


class TestValidatePublishableMissingCompositePlayers:
    """Validate the missing_composite_players list shape and behavior."""

    def test_returns_missing_composite_players_field(self):
        from services.snapshot_versions import validator

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result([]),  # players query
                ]
                result = validator.validate_publishable("draft-001")

        assert "missing_composite_players" in result
        assert result["missing_composite_players"] == []

    def test_missing_player_entries_carry_id_name_team_position(self):
        from services.snapshot_versions import validator

        players = [
            _player("p1", name="LeBron James", team="LAL", position="F"),
            _player("p2", name="Stephen Curry", team="GSW", position="G"),
        ]

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result(players),  # players query
                    _result([{"nba_api_id": "1"}, {"nba_api_id": "1"}]),  # canonical_players
                    _result([]),  # composite draft_skill_profiles — both missing
                ]
                result = validator.validate_publishable("draft-001")

        entries = result["missing_composite_players"]
        assert len(entries) == 2
        for entry in entries:
            assert set(entry.keys()) == {"id", "name", "team", "position"}

        names = {e["name"] for e in entries}
        assert names == {"LeBron James", "Stephen Curry"}

    def test_returns_full_list_when_many_players_missing(self):
        from services.snapshot_versions import validator

        players = [
            _player(f"p{i:03d}", name=f"Player {i}", nba_api_id=i)
            for i in range(75)
        ]

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result(players),  # players query
                    _result(
                        [{"nba_api_id": str(i)} for i in range(75)]
                    ),  # canonical_players — all match
                    _result([]),  # composite draft_skill_profiles — all missing
                ]
                result = validator.validate_publishable("draft-001")

        assert result["players_missing_composite"] == 75
        assert len(result["missing_composite_players"]) == 75

    def test_empty_list_when_all_players_have_composite(self):
        from services.snapshot_versions import validator

        players = [_player("p1"), _player("p2")]

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result(players),  # players query
                    _result([{"nba_api_id": "1"}]),  # canonical_players
                    _result(
                        [{"player_id": "p1"}, {"player_id": "p2"}]
                    ),  # composite draft_skill_profiles — none missing
                ]
                result = validator.validate_publishable("draft-001")

        assert result["players_missing_composite"] == 0
        assert result["missing_composite_players"] == []

    def test_existing_count_fields_preserved(self):
        from services.snapshot_versions import validator

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result([]),  # players query
                ]
                result = validator.validate_publishable("draft-001")

        assert "players_missing_canonical" in result
        assert "players_missing_composite" in result
        assert result["players_missing_canonical"] == 0
        assert result["players_missing_composite"] == 0
