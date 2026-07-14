"""
test_skill_evaluation_pipeline.py — Unit tests for evaluation_only.py.

Tests the Contract of evaluate_skills_for_run():
  - Reads player_stats from Supabase (no NBA API calls).
  - Evaluates against thresholds (or override thresholds for threshold_edit runs).
  - Stages results in pipeline_run_results and pipeline_run_flag_results.
  - Claude assessment is NOT called (source='stats' only per blueprint Q1 default).
  - Respects optional skill_filter.
  - Handles missing stats gracefully (skips player, logs warning).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _mock_supabase_with_player_stats(player_ids: list[str], stats_blob: dict):
    """Return a mock Supabase client that returns stats for given player_ids."""
    client = MagicMock()

    def table_router(name):
        mock = MagicMock()
        if name == "player_stats":
            # Mirrors the real query: player_stats is INSERTed (never upserted), so
            # the batch read MUST order newest-first — see evaluate_skills_for_run.
            # Keep this chain in step with it, or the mock silently stops matching.
            mock.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                data=[
                    {"player_id": pid, "season": "2025-26", "stats": stats_blob,
                     "fetched_at": "2026-07-13T16:44:07"}
                    for pid in player_ids
                ]
            )
            # For single-player lookups
            mock.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
                data=[{"stats": stats_blob}] if player_ids else []
            )
        elif name == "draft_skill_thresholds":
            mock.select.return_value.execute.return_value = MagicMock(data=[])
        elif name == "pipeline_run_results":
            mock.insert.return_value.execute.return_value = MagicMock(data=[])
        elif name == "pipeline_run_flag_results":
            mock.insert.return_value.execute.return_value = MagicMock(data=[])
        return mock

    client.table.side_effect = table_router
    return client


# ---------------------------------------------------------------------------
# Case 1: evaluate_skills_for_run calls evaluate_all_skills without NBA API
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_does_not_call_nba_api():
    """The evaluation-only path must NOT call get_or_fetch_player_stats (NBA API)."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    with patch("services.skill_engine.evaluation_only.get_or_fetch_player_stats") as mock_nba:
        with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}):
            with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
                with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                    mock_sb = MagicMock()
                    mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(data=[])
                    mock_client.return_value = mock_sb

                    evaluate_skills_for_run(
                        run_id="run-1",
                        player_ids=["p1"],
                        season="2025-26",
                    )

        mock_nba.assert_not_called()


# ---------------------------------------------------------------------------
# Case 2: evaluate_skills_for_run stages profile rows for each player
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_stages_profile_rows():
    """evaluate_skills_for_run must call stage_profile_rows with non-empty list."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    fake_skills = {"Scorer": {"tier": "Elite", "review_recommended": False}}
    stats_blob = {"pts": 28.0}

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}):
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills):
                with patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills):
                    with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                        mock_sb = MagicMock()
                        # player_stats lookup returns one row
                        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                            data=[{"player_id": "p1", "season": "2025-26", "stats": stats_blob}]
                        )
                        mock_client.return_value = mock_sb

                        with patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
                            evaluate_skills_for_run(
                                run_id="run-stage",
                                player_ids=["p1"],
                                season="2025-26",
                            )

    mock_stage.assert_called_once()
    staged_rows = mock_stage.call_args[0][1]
    assert len(staged_rows) >= 1
    assert staged_rows[0].player_id == "p1"
    assert staged_rows[0].source == "stats"


# ---------------------------------------------------------------------------
# Case 3: skill_filter restricts which skills are included in the profile
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_respects_skill_filter():
    """With skill_filter=['Scorer'], only Scorer data goes into the staged profile."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    full_skills = {
        "Scorer": {"tier": "Elite", "review_recommended": False},
        "Playmaker": {"tier": "Proficient", "review_recommended": False},
    }
    stats_blob = {"pts": 28.0}

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}):
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=full_skills):
                with patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=full_skills):
                    with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                        mock_sb = MagicMock()
                        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                            data=[{"player_id": "p1", "season": "2025-26", "stats": stats_blob}]
                        )
                        mock_client.return_value = mock_sb

                        with patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
                            evaluate_skills_for_run(
                                run_id="run-filter",
                                player_ids=["p1"],
                                season="2025-26",
                                skill_filter=["Scorer"],
                            )

    mock_stage.assert_called_once()
    staged_rows = mock_stage.call_args[0][1]
    assert len(staged_rows) == 1
    # Only Scorer in staged profile
    assert "Scorer" in staged_rows[0].profile
    assert "Playmaker" not in staged_rows[0].profile


# ---------------------------------------------------------------------------
# Case 4: player with no stats is skipped gracefully
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_skips_player_with_no_stats():
    """If no stats exist for a player, skip without raising."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}):
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                mock_sb = MagicMock()
                # Empty stats — no rows returned
                mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(data=[])
                mock_client.return_value = mock_sb

                with patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
                    # Should not raise
                    evaluate_skills_for_run(
                        run_id="run-no-stats",
                        player_ids=["p-ghost"],
                        season="2025-26",
                    )

    # No rows staged for player with no stats
    mock_stage.assert_called_once()
    staged_rows = mock_stage.call_args[0][1]
    assert len(staged_rows) == 0


# ---------------------------------------------------------------------------
# Case 5: thresholds_override replaces live thresholds for threshold_edit run
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_uses_thresholds_override():
    """With thresholds_override, get_thresholds should NOT be called."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    override = {"Scorer": {"tiers": {"Elite": {"logic": "AND", "conditions": []}}}}
    stats_blob = {"pts": 28.0}

    with patch("services.skill_engine.evaluation_only.get_thresholds") as mock_get_thresh:
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value={}):
                with patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value={}):
                    with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                        mock_sb = MagicMock()
                        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                            data=[{"player_id": "p1", "season": "2025-26", "stats": stats_blob}]
                        )
                        mock_client.return_value = mock_sb

                        with patch("services.skill_engine.evaluation_only.stage_profile_rows"):
                            evaluate_skills_for_run(
                                run_id="run-override",
                                player_ids=["p1"],
                                season="2025-26",
                                thresholds_override=override,
                            )

    # get_thresholds must NOT be called when thresholds_override is provided
    mock_get_thresh.assert_not_called()


# ---------------------------------------------------------------------------
# Case 6: evaluate_all_skills receives the correct thresholds
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_passes_thresholds_to_evaluator():
    """evaluate_all_skills must be called with the resolved thresholds dict."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    live_thresholds = {"Scorer": {"tiers": {}}}
    stats_blob = {"pts": 20.0}

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value=live_thresholds):
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only.evaluate_all_skills") as mock_eval:
                mock_eval.return_value = {}
                with patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value={}):
                    with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                        mock_sb = MagicMock()
                        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                            data=[{"player_id": "p1", "season": "2025-26", "stats": stats_blob}]
                        )
                        mock_client.return_value = mock_sb

                        with patch("services.skill_engine.evaluation_only.stage_profile_rows"):
                            evaluate_skills_for_run(
                                run_id="run-thresh",
                                player_ids=["p1"],
                                season="2025-26",
                            )

    mock_eval.assert_called_once()
    call_kwargs = mock_eval.call_args
    # Second positional arg is thresholds
    assert call_kwargs[0][1] == live_thresholds


# ---------------------------------------------------------------------------
# Case 7: multiple players produce multiple staged rows
# ---------------------------------------------------------------------------


def test_evaluate_skills_for_run_handles_multiple_players():
    """All provided players produce staged rows (one per player)."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    fake_skills = {"Scorer": {"tier": "Elite", "review_recommended": False}}
    stats_blob = {"pts": 25.0}

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}):
        with patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}):
            with patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills):
                with patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills):
                    with patch("services.skill_engine.evaluation_only._get_client") as mock_client:
                        mock_sb = MagicMock()
                        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
                            data=[
                                {"player_id": "p1", "season": "2025-26", "stats": stats_blob},
                                {"player_id": "p2", "season": "2025-26", "stats": stats_blob},
                            ]
                        )
                        mock_client.return_value = mock_sb

                        with patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
                            evaluate_skills_for_run(
                                run_id="run-multi",
                                player_ids=["p1", "p2"],
                                season="2025-26",
                            )

    staged_rows = mock_stage.call_args[0][1]
    staged_player_ids = {r.player_id for r in staged_rows}
    assert "p1" in staged_player_ids
    assert "p2" in staged_player_ids
