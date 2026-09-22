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


# ---------------------------------------------------------------------------
# M2.14 / M2.15 — the Skill-scoped run with fresh Claude
# ---------------------------------------------------------------------------


from types import SimpleNamespace  # noqa: E402


def _fake_client(stats_rows, profiles_by_source):
    """Fake Supabase client that answers player_stats and draft_skill_profiles.

    draft_skill_profiles is keyed by the `source` the query filters on, so a
    composite read and a claude read of the same table return different rows.
    """
    class _Q:
        def __init__(self, table_name):
            self.table_name = table_name
            self.source = None

        def select(self, *a, **k):
            return self

        def eq(self, col, val):
            if col == "source":
                self.source = val
            return self

        def in_(self, *a, **k):
            return self

        def order(self, *a, **k):
            return self

        def execute(self):
            if self.table_name == "player_stats":
                return SimpleNamespace(data=list(stats_rows))
            if self.table_name == "draft_skill_profiles":
                return SimpleNamespace(data=list(profiles_by_source.get(self.source, [])))
            return SimpleNamespace(data=[])

    client = MagicMock()
    client.table.side_effect = _Q
    return client


def _run_with_claude(
    player_ids,
    skill_filter,
    profiles_by_source,
    claude_side_effect,
    fake_skills=None,
    recomputed=None,
):
    """Run evaluate_skills_for_run(with_claude=True) with Claude patched out."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    fake_skills = fake_skills or {
        "cutter": {"tier": "Capable", "stat_confidence": "high"},
        "rebounder": {"tier": "Capable", "stat_confidence": "high"},
    }
    stats_rows = [
        {"player_id": pid, "season": "2025-26", "stats": {"x": 1},
         "fetched_at": "2026-09-01T00:00:00"}
        for pid in player_ids
    ]

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}), \
         patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}), \
         patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.get_notability_score", return_value=80), \
         patch("services.skill_engine.evaluation_only.composite_skill",
               return_value=recomputed or {"final_tier": "Capable", "flagged": False}), \
         patch("services.skill_engine.evaluation_only._get_client",
               return_value=_fake_client(stats_rows, profiles_by_source)), \
         patch("services.skill_engine.evaluation_only.get_claude_assessment",
               side_effect=claude_side_effect) as mock_claude, \
         patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage, \
         patch("services.skill_engine.evaluation_only.stage_flag_rows"):
        evaluate_skills_for_run(
            run_id="run-claude",
            player_ids=list(player_ids),
            season="2025-26",
            skill_filter=skill_filter,
            recompute_composite=True,
            with_claude=True,
        )
    return mock_claude, mock_stage


def _ok_claude(tier="Elite"):
    def _call(player_id, season, stat_skills_result, client, skills=None):
        return {
            "skills": {s: {"tier": tier, "confidence": "high",
                           "justification": "because", "claude_failed": False}
                       for s in (skills or [])},
            "claude_failed": False,
            "input_tokens": 1,
            "output_tokens": 1,
        }
    return _call


def test_with_claude_calls_claude_once_per_player_with_scoped_skills():
    """One scoped call per player; HIGH-confidence Skills never go to Claude."""
    profiles = {
        "composite": [
            {"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}},
            {"player_id": "p2", "profile": {"cutter": {"final_tier": "None"}}},
        ],
        "claude": [],
    }

    mock_claude, _ = _run_with_claude(
        ["p1", "p2"], ["cutter", "rebounder"], profiles, _ok_claude(),
    )

    assert mock_claude.call_count == 2
    called_for = {c.args[0] for c in mock_claude.call_args_list}
    assert called_for == {"p1", "p2"}
    for c in mock_claude.call_args_list:
        assert c.kwargs["skills"] == ["cutter"]   # rebounder is HIGH — never asked


def test_with_claude_not_called_when_filter_is_high_confidence_only():
    """A HIGH-only filter has nothing for Claude to rate — skip the API entirely."""
    profiles = {
        "composite": [{"player_id": "p1", "profile": {"rebounder": {"final_tier": "None"}}}],
        "claude": [],
    }

    mock_claude, mock_stage = _run_with_claude(
        ["p1"], ["rebounder"], profiles, _ok_claude(),
    )

    mock_claude.assert_not_called()
    assert len(mock_stage.call_args[0][1]) == 1   # still stages the composite


def test_with_claude_does_not_stage_players_whose_claude_call_failed():
    """A failed Claude call must never stage a data_missing overwrite for that player."""
    profiles = {
        "composite": [
            {"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}},
            {"player_id": "p2", "profile": {"cutter": {"final_tier": "None"}}},
        ],
        "claude": [],
    }

    def _half_failing(player_id, season, stat_skills_result, client, skills=None):
        if player_id == "p2":
            return {"skills": {}, "claude_failed": True,
                    "input_tokens": 0, "output_tokens": 0}
        return _ok_claude()(player_id, season, stat_skills_result, client, skills=skills)

    _, mock_stage = _run_with_claude(["p1", "p2"], ["cutter"], profiles, _half_failing)

    staged = mock_stage.call_args[0][1]
    assert {r.player_id for r in staged} == {"p1"}


def test_with_claude_does_not_stage_player_when_claude_raises():
    """An exception from the Claude call is a failure too — skip, never stage.

    Two players, so this stays a per-player skip: a run where EVERY call fails
    is a different case and raises (test_with_claude_raises_when_no_player...).
    """
    profiles = {
        "composite": [
            {"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}},
            {"player_id": "p2", "profile": {"cutter": {"final_tier": "None"}}},
        ],
        "claude": [],
    }

    def _boom(player_id, season, stat_skills_result, client, skills=None):
        if player_id == "p2":
            raise RuntimeError("anthropic 529")
        return _ok_claude()(player_id, season, stat_skills_result, client, skills=skills)

    _, mock_stage = _run_with_claude(["p1", "p2"], ["cutter"], profiles, _boom)

    assert {r.player_id for r in mock_stage.call_args[0][1]} == {"p1"}


def test_with_claude_stages_merged_claude_row_not_a_replacement():
    """The commit replaces a whole row per source, so the staged claude row must
    carry the player's existing Claude tiers plus the freshly rated Skills."""
    profiles = {
        "composite": [{"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}}],
        "claude": [{"player_id": "p1", "profile": {"passer": "Elite", "cutter": "Capable"}}],
    }

    _, mock_stage = _run_with_claude(["p1"], ["cutter"], profiles, _ok_claude("Elite"))

    staged = mock_stage.call_args[0][1]
    claude_rows = [r for r in staged if r.source == "claude"]
    assert len(claude_rows) == 1
    assert claude_rows[0].profile["cutter"] == "Elite"     # fresh tier written
    assert claude_rows[0].profile["passer"] == "Elite"     # untouched Skill preserved


def test_with_claude_requires_recompute_composite():
    """with_claude only makes sense on the composite path — refuse it otherwise."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    with pytest.raises(ValueError):
        evaluate_skills_for_run(
            run_id="run-bad", player_ids=["p1"], season="2025-26",
            skill_filter=["cutter"], with_claude=True,
        )


def test_filtered_stats_run_merges_into_existing_stats_profile():
    """M2.15: a filtered stats run must keep the Skills it did not evaluate —
    the commit replaces the whole stats row."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    fake_skills = {
        "cutter": {"tier": "Elite", "stat_confidence": "high"},
        "passer": {"tier": "Capable", "stat_confidence": "high"},
    }
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"x": 1},
                   "fetched_at": "2026-09-01T00:00:00"}]
    profiles = {"stats": [{"player_id": "p1", "profile": {
        "rebounder": "Proficient", "cutter": "None",
    }}]}

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}), \
         patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}), \
         patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only._get_client",
               return_value=_fake_client(stats_rows, profiles)), \
         patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
        evaluate_skills_for_run(
            run_id="run-filtered", player_ids=["p1"], season="2025-26",
            skill_filter=["cutter"],
        )

    profile = mock_stage.call_args[0][1][0].profile
    assert profile["cutter"]["tier"] == "Elite"      # the filtered Skill, re-evaluated
    assert profile["rebounder"] == "Proficient"      # unfiltered Skill preserved
    assert "passer" not in profile                   # filter still scopes the run


# ---------------------------------------------------------------------------
# Review findings — the Claude pass pays only for players the run can use,
# and a total Claude outage is an error, not a green run with nothing staged.
# ---------------------------------------------------------------------------


def test_with_claude_skips_players_that_have_no_composite_row():
    """A player with no composite row is dropped after staging — so asking
    Claude about him is a paid call whose answer is thrown away."""
    profiles = {
        "composite": [{"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}}],
        "claude": [],
    }

    mock_claude, mock_stage = _run_with_claude(
        ["p1", "p2"], ["cutter"], profiles, _ok_claude(),
    )

    assert {c.args[0] for c in mock_claude.call_args_list} == {"p1"}
    assert mock_claude.call_count == 1
    assert {r.player_id for r in mock_stage.call_args[0][1]} == {"p1"}


def test_with_claude_raises_when_no_player_could_be_rated():
    """Claude down for every player stages nothing. Returning normally reports
    a successful run over N players with "No changes" — indistinguishable from
    "nothing moved", and Chris re-runs the spend."""
    profiles = {
        "composite": [
            {"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}},
            {"player_id": "p2", "profile": {"cutter": {"final_tier": "None"}}},
        ],
        "claude": [],
    }

    def _all_failing(player_id, season, stat_skills_result, client, skills=None):
        return {"skills": {}, "claude_failed": True, "input_tokens": 0, "output_tokens": 0}

    with pytest.raises(RuntimeError, match="claude_unavailable"):
        _run_with_claude(["p1", "p2"], ["cutter"], profiles, _all_failing)


def test_with_claude_does_not_raise_when_one_player_survives():
    """A partial outage is still a real run — only a total one is an error."""
    profiles = {
        "composite": [
            {"player_id": "p1", "profile": {"cutter": {"final_tier": "None"}}},
            {"player_id": "p2", "profile": {"cutter": {"final_tier": "None"}}},
        ],
        "claude": [],
    }

    def _half_failing(player_id, season, stat_skills_result, client, skills=None):
        if player_id == "p2":
            return {"skills": {}, "claude_failed": True, "input_tokens": 0, "output_tokens": 0}
        return _ok_claude()(player_id, season, stat_skills_result, client, skills=skills)

    _, mock_stage = _run_with_claude(["p1", "p2"], ["cutter"], profiles, _half_failing)

    assert {r.player_id for r in mock_stage.call_args[0][1]} == {"p1"}
