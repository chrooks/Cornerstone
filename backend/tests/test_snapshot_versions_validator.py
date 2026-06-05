"""
Unit tests for backend/services/snapshot_versions/validator.py

Covers the missing_composite_players list (issue #52) and open_flags count (M6).
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
                    _result([]),  # legends query (#74) — no legends
                    _result([]),  # open flags query (M6)
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
                    _result([]),  # legends query (#74) — no legends
                    _result([]),  # composite draft_skill_profiles — both missing
                    _result([]),  # open flags query (M6)
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
                    _result([]),  # legends query (#74) — no legends
                    _result([]),  # composite draft_skill_profiles — all missing
                    _result([]),  # open flags query (M6)
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
                    _result([]),  # legends query (#74) — no legends
                    _result(
                        [{"player_id": "p1"}, {"player_id": "p2"}]
                    ),  # composite draft_skill_profiles — none missing
                    _result([]),  # open flags query (M6)
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
                    _result([]),  # legends query (#74) — no legends
                    _result([]),  # open flags query (M6)
                ]
                result = validator.validate_publishable("draft-001")

        assert "players_missing_canonical" in result
        assert "legends_missing_canonical" in result
        assert "players_missing_composite" in result
        assert result["players_missing_canonical"] == 0
        assert result["legends_missing_canonical"] == 0
        assert result["players_missing_composite"] == 0


class TestValidatePublishableOpenFlags:
    """
    Validate open_flags count — M6.

    The RPC predicate (20260527000003_publish_open_flags_gate.sql) counts rows
    in draft_skill_flags WHERE resolution IS NULL. No season/source filter.
    The Python backend never writes the string 'unresolved'; NULL means open.
    """

    def _call_validator(self, mock_rq_returns: list):
        """Helper: patch _get_client + run_query, call validate_publishable."""
        from services.snapshot_versions import validator

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = mock_rq_returns
                return validator.validate_publishable("draft-001")

    def test_open_flags_scoped_to_current_season_composite_profiles(self):
        """
        Tracer: open_flags counts only unresolved flags hanging off current-season
        composite Skill Profiles (mirrors the Review queue scope, review.py).

        Query sequence when no players: players -> season-composite profile ids
        -> flags scoped to those ids.
        """
        result = self._call_validator([
            _result([]),  # players query (none)
            _result([]),  # legends query (#74) — no legends
            _result([{"id": "prof-1"}, {"id": "prof-2"}]),  # current-season composite profiles
            _result([{"id": "flag-1"}, {"id": "flag-2"}, {"id": "flag-3"}]),  # 3 unresolved
        ])
        assert result["open_flags"] == 3

    def test_open_flags_field_present_in_return(self):
        """open_flags key must exist even when no players exist."""
        result = self._call_validator([
            _result([]),  # players query
            _result([]),  # legends query (#74) — no legends
            _result([]),  # season-composite profile ids (none) -> open_flags short-circuits to 0
        ])
        assert "open_flags" in result

    def test_open_flags_zero_when_no_unresolved_flags(self):
        """Returns 0 when draft_skill_flags has no rows with resolution IS NULL."""
        result = self._call_validator([
            _result([]),  # players query (no players)
            _result([]),  # legends query (#74) — no legends
            _result([]),  # open flags query — empty
        ])
        assert result["open_flags"] == 0

    def test_open_flags_zero_when_all_flags_resolved(self):
        """
        Flags with a non-NULL resolution must not be counted.
        The mock returns empty (simulating WHERE resolution IS NULL returns nothing).
        """
        result = self._call_validator([
            _result([]),  # players query
            _result([]),  # legends query (#74) — no legends
            # run_query for flags returns empty — all resolved
            _result([]),
        ])
        assert result["open_flags"] == 0

    def test_open_flags_counts_only_null_resolution_rows(self):
        """Returns count equal to the number of NULL-resolution flag rows."""
        # Simulate 3 unresolved rows returned by the IS NULL query
        flag_rows = [{"id": f"flag-{i}"} for i in range(3)]
        result = self._call_validator([
            _result([]),                    # players query
            _result([]),                    # legends query (#74) — no legends
            _result([{"id": "prof-1"}]),    # current-season composite profile ids
            _result(flag_rows),             # open flags query — 3 unresolved
        ])
        assert result["open_flags"] == 3

    def test_open_flags_mixed_resolved_and_unresolved(self):
        """
        Only unresolved flags (resolution IS NULL) are counted.
        The query itself filters; validator counts rows returned.
        """
        # The DB query already filters; we simulate only unresolved rows returned.
        unresolved_rows = [{"id": "flag-1"}, {"id": "flag-2"}]
        result = self._call_validator([
            _result([]),                    # players query
            _result([]),                    # legends query (#74) — no legends
            _result([{"id": "prof-1"}]),    # current-season composite profile ids
            _result(unresolved_rows),       # 2 unresolved flags returned by IS NULL filter
        ])
        assert result["open_flags"] == 2

    def test_open_flags_large_count(self):
        """Handles large open_flags count without truncation."""
        flag_rows = [{"id": f"flag-{i}"} for i in range(150)]
        result = self._call_validator([
            _result([]),                    # players query
            _result([]),                    # legends query (#74) — no legends
            _result([{"id": "prof-1"}]),    # current-season composite profile ids
            _result(flag_rows),             # 150 open flags
        ])
        assert result["open_flags"] == 150

    def test_open_flags_zero_when_flags_exist_but_no_current_season_composite(self):
        """
        Flags hanging off prior-season / non-composite profiles do not block:
        with no current-season composite profiles, the flag query is skipped and
        open_flags is 0 even though unresolved flags exist elsewhere.
        """
        result = self._call_validator([
            _result([]),   # players query
            _result([]),   # legends query (#74) — no legends
            _result([]),   # NO current-season composite profiles -> short-circuit
            # (flag query never runs; any global unresolved flags are out of scope)
        ])
        assert result["open_flags"] == 0


class TestValidatePublishableLegendsMissingCanonical:
    """
    Validate legends_missing_canonical count — issue #74.

    The publish RPC hard-blocks with legends_missing_canonical_player when a
    Legend's nba_api_id has no canonical_players row. validate_publishable mirrors
    the RPC's predicate so the publish modal surfaces the block up front:

        SELECT COUNT(*) FROM legends l
        LEFT JOIN canonical_players cp ON cp.nba_api_id = l.nba_api_id
        WHERE cp.id IS NULL

    Query sequence with no current-season players: players (none) -> legends ->
    legend canonical_players (only when legends exist) -> season-composite -> flags.
    """

    def _call_validator(self, mock_rq_returns: list):
        from services.snapshot_versions import validator

        with patch.object(validator, "_get_client", return_value=MagicMock()):
            with patch.object(validator, "run_query") as mock_rq:
                mock_rq.side_effect = mock_rq_returns
                return validator.validate_publishable("draft-001")

    def test_field_present_when_no_legends(self):
        """legends_missing_canonical key exists and is 0 when there are no legends."""
        result = self._call_validator([
            _result([]),  # players query (none)
            _result([]),  # legends query — none (legend-canonical query skipped)
            _result([]),  # season-composite profile ids (none) -> open_flags 0
        ])
        assert "legends_missing_canonical" in result
        assert result["legends_missing_canonical"] == 0

    def test_counts_unlinked_legends(self):
        """
        Counts only the legends whose nba_api_id has no canonical_players row.
        Three legends, two linked -> one missing.
        """
        legends = [
            {"nba_api_id": 100},
            {"nba_api_id": 200},
            {"nba_api_id": 300},
        ]
        result = self._call_validator([
            _result([]),       # players query (none)
            _result(legends),  # legends query — 3 legends
            _result([{"nba_api_id": "100"}, {"nba_api_id": "200"}]),  # canonical_players — 2 linked
            _result([]),       # season-composite profile ids (none) -> open_flags 0
        ])
        assert result["legends_missing_canonical"] == 1

    def test_zero_when_all_legends_linked(self):
        """Returns 0 when every legend nba_api_id has a canonical_players row."""
        legends = [{"nba_api_id": 100}, {"nba_api_id": 200}]
        result = self._call_validator([
            _result([]),       # players query (none)
            _result(legends),  # legends query — 2 legends
            _result([{"nba_api_id": "100"}, {"nba_api_id": "200"}]),  # both linked
            _result([]),       # season-composite profile ids (none) -> open_flags 0
        ])
        assert result["legends_missing_canonical"] == 0

    def test_counts_all_when_none_linked(self):
        """Every legend missing a canonical row counts toward the block."""
        legends = [{"nba_api_id": i} for i in range(1, 6)]
        result = self._call_validator([
            _result([]),       # players query (none)
            _result(legends),  # legends query — 5 legends
            _result([]),       # canonical_players — none linked
            _result([]),       # season-composite profile ids (none) -> open_flags 0
        ])
        assert result["legends_missing_canonical"] == 5

    def test_ignores_legends_without_nba_api_id(self):
        """Legends with a null/missing nba_api_id are not counted as missing."""
        legends = [
            {"nba_api_id": 100},
            {"nba_api_id": None},
            {},
        ]
        result = self._call_validator([
            _result([]),       # players query (none)
            _result(legends),  # legends query — only one has an nba_api_id
            _result([]),       # canonical_players — 100 not linked
            _result([]),       # season-composite profile ids (none) -> open_flags 0
        ])
        # Only the one legend with an nba_api_id (100) is unlinked.
        assert result["legends_missing_canonical"] == 1
