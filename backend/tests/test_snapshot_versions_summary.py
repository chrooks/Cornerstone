"""
Unit tests for backend/services/snapshot_versions/summary.py

Focuses on the count_summary function and its returned fields.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _result(data):
    r = MagicMock()
    r.data = data
    return r


def _make_player(player_id: str = "player-001", season: str = "2025-26"):
    return {"id": player_id, "season": season}


def _make_skill_profile(player_id: str, source: str = "composite"):
    return {"player_id": player_id, "source": source}


class TestCountSummaryFields:
    """Verify count_summary returns all required fields including new Open Q2 fields."""

    def _build_client(
        self,
        players=None,
        composite_profiles=None,
        active_release_published_at="2026-05-01T00:00:00Z",
        changed_profiles=None,
        manual_profiles=None,
    ):
        """Build a mock client with the query responses needed for count_summary."""
        players = players or []
        composite_profiles = composite_profiles or []
        changed_profiles = changed_profiles or []
        manual_profiles = manual_profiles or []

        client = MagicMock()

        # The summary module chains multiple queries. We sequence them via
        # side_effect on execute.
        active_row = [{"published_at": active_release_published_at}]

        # Chain execute calls: players → composite profiles → active release →
        # changed_profiles → manual_profiles
        execute_seq = [
            _result(players),           # players query
            _result(composite_profiles),# composite profiles chunk
            _result(active_row),        # active snapshot_releases
            _result(changed_profiles),  # draft_skill_profiles updated after published_at
            _result(manual_profiles),   # manual draft_skill_profiles updated after published_at
        ]

        exec_mock = MagicMock(side_effect=execute_seq)

        # Wire into the deeply-nested mock chain
        table_mock = client.table.return_value
        table_mock.select.return_value.eq.return_value.execute = exec_mock
        table_mock.select.return_value.eq.return_value.in_.return_value.execute = exec_mock
        table_mock.select.return_value.eq.return_value.eq.return_value.execute = exec_mock
        table_mock.select.return_value.eq.return_value.eq.return_value.gt.return_value.execute = exec_mock

        return client, exec_mock

    def test_count_summary_returns_thresholds_changed_zero(self):
        """thresholds_changed must be present and always 0 in this slice
        (#7 owns threshold versioning)."""
        from services.snapshot_versions import summary

        player = _make_player("p1")
        composite = _make_skill_profile("p1")

        with patch.object(summary, "_get_client", return_value=MagicMock()):
            with patch.object(summary, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result([player]),       # all_players
                    _result([composite]),    # composite profiles chunk
                    _result([{"published_at": "2026-05-01T00:00:00Z"}]),  # active release
                    _result([]),             # changed since active
                    _result([]),             # manual overrides
                ]
                result = summary.count_summary("draft-id-001")

        assert "thresholds_changed" in result
        assert result["thresholds_changed"] == 0

    def test_count_summary_returns_manual_overrides_since_active(self):
        """manual_overrides_since_active must be present and count manual
        draft_skill_profiles updated after the active snapshot's published_at."""
        from services.snapshot_versions import summary

        manual_profile = _make_skill_profile("p1", source="manual")

        with patch.object(summary, "_get_client", return_value=MagicMock()):
            with patch.object(summary, "run_query") as mock_rq:
                # Call order: all_players (empty → no composite chunk),
                # active_release, changed_composites, manual_overrides
                mock_rq.side_effect = [
                    _result([]),             # all_players — empty so no composite chunk
                    _result([{"published_at": "2026-05-01T00:00:00Z"}]),  # active release
                    _result([]),             # changed since active (composite updated_at)
                    _result([manual_profile]),  # manual overrides
                ]
                result = summary.count_summary("draft-id-001")

        assert "manual_overrides_since_active" in result
        assert result["manual_overrides_since_active"] == 1

    def test_count_summary_all_fields_present(self):
        """All five required fields must be present in the return value."""
        from services.snapshot_versions import summary

        required_fields = {
            "players_total",
            "players_changed_since_active",
            "players_missing_composite",
            "thresholds_changed",
            "manual_overrides_since_active",
        }

        with patch.object(summary, "_get_client", return_value=MagicMock()):
            with patch.object(summary, "run_query") as mock_rq:
                mock_rq.side_effect = [
                    _result([]),   # all_players (empty — skip composite chunk)
                    _result([{"published_at": "2026-05-01T00:00:00Z"}]),  # active release
                    _result([]),   # changed since active
                    _result([]),   # manual overrides
                ]
                result = summary.count_summary("draft-id-001")

        assert required_fields.issubset(set(result.keys())), (
            f"Missing fields: {required_fields - set(result.keys())}"
        )
