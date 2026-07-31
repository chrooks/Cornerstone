"""
Unit tests for backend/services/snapshot_versions/drift_audit.py (issue #86).

Uses a fake Supabase client to avoid real network IO. The evaluator itself
(evaluate_all_skills / apply_auto_promotions) has its own test coverage in
test_skill_mapping_service.py — these tests patch it to a fixed recompute
result so they exercise the diff/source-filter logic in isolation.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _result(data):
    r = MagicMock()
    r.data = data
    return r


def _stats_row(player_id: str, fetched_at: str = "2026-07-01T00:00:00Z") -> dict:
    return {
        "player_id": player_id,
        "stats": {"metadata": {"games_played": 70}, "totals": {"pts": 1000}},
        "fetched_at": fetched_at,
    }


def _make_client(*, composite_rows, stats_rows, player_rows):
    """Build a mock whose .table(name) branches to per-table canned results."""
    client = MagicMock()

    def table(name):
        m = MagicMock()
        if name == "draft_skill_profiles":
            # Both the (no player_ids) and (in_ player_ids) chains return the
            # same canned composite rows — the tests don't restrict player_ids.
            chain = m.select.return_value.eq.return_value.eq.return_value
            chain.execute.return_value = _result(composite_rows)
            chain.in_.return_value.execute.return_value = _result(composite_rows)
        elif name == "player_stats":
            (
                m.select.return_value.eq.return_value.in_.return_value
                .order.return_value.execute.return_value
            ) = _result(stats_rows)
        elif name == "players":
            m.select.return_value.in_.return_value.execute.return_value = _result(player_rows)
        return m

    client.table.side_effect = table
    return client


class TestFindTierDrift:
    def test_reports_drifted_stats_only_entry_and_skips_human_source(self):
        """A stale stats_only tier is reported; a manual_override entry for the
        same player is never reported even though its stored tier also
        disagrees with the recompute."""
        from services.snapshot_versions import drift_audit

        player_id = "p1"
        composite_rows = [
            {
                "player_id": player_id,
                "profile": {
                    "offensive_rebounder": {
                        "final_tier": "Elite",
                        "source": "stats_only",
                    },
                    "rebounder": {
                        # Also disagrees with the recompute, but human-decided —
                        # must never be reported as drift.
                        "final_tier": "Elite",
                        "source": "manual_override",
                    },
                },
            }
        ]
        client = _make_client(
            composite_rows=composite_rows,
            stats_rows=[_stats_row(player_id)],
            player_rows=[{"id": player_id, "name": "Giannis"}],
        )

        fresh_result = {
            "offensive_rebounder": {"tier": "Proficient"},
            "rebounder": {"tier": "Proficient"},
        }

        with patch.object(drift_audit, "get_thresholds", return_value={}), \
             patch.object(drift_audit, "get_league_averages", return_value={}), \
             patch.object(drift_audit, "evaluate_all_skills", return_value=fresh_result), \
             patch.object(drift_audit, "apply_auto_promotions", side_effect=lambda r, t: r):
            report = drift_audit.find_tier_drift("2025-26", client=client)

        assert len(report) == 1
        entry = report[0]
        assert entry.player_id == player_id
        assert entry.player_name == "Giannis"
        assert entry.skill_name == "offensive_rebounder"
        assert entry.stored_tier == "Elite"
        assert entry.recomputed_tier == "Proficient"
        assert entry.source == "stats_only"

    def test_no_drift_when_recompute_agrees(self):
        """Matching tiers produce an empty report."""
        from services.snapshot_versions import drift_audit

        player_id = "p1"
        composite_rows = [
            {
                "player_id": player_id,
                "profile": {
                    "offensive_rebounder": {"final_tier": "Proficient", "source": "stats_only"},
                },
            }
        ]
        client = _make_client(
            composite_rows=composite_rows,
            stats_rows=[_stats_row(player_id)],
            player_rows=[{"id": player_id, "name": "Giannis"}],
        )

        with patch.object(drift_audit, "get_thresholds", return_value={}), \
             patch.object(drift_audit, "get_league_averages", return_value={}), \
             patch.object(
                 drift_audit, "evaluate_all_skills",
                 return_value={"offensive_rebounder": {"tier": "Proficient"}},
             ), \
             patch.object(drift_audit, "apply_auto_promotions", side_effect=lambda r, t: r):
            report = drift_audit.find_tier_drift("2025-26", client=client)

        assert report == []

    def test_empty_player_universe_short_circuits(self):
        """No composite profiles for the season -> empty report, no further queries."""
        from services.snapshot_versions import drift_audit

        client = _make_client(composite_rows=[], stats_rows=[], player_rows=[])

        report = drift_audit.find_tier_drift("2025-26", client=client)

        assert report == []
