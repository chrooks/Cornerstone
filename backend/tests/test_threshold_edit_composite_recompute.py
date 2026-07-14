"""
test_threshold_edit_composite_recompute.py

A committed threshold_edit must update the COMPOSITE profile (what the Player
Pool / publish read), not just the stats profile. The worker recomputes the
affected Skill's composite, merges it into each player's existing composite
profile, and stages source='composite' rows so commit (which replaces the
profile JSONB) updates what users see.

Also covers _extract_tier learning to read the composite `final_tier` shape so
the run diff reflects the composite outcome.

All Supabase access is mocked.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from services.pipeline_run_results.repo import _extract_tier


# ---------------------------------------------------------------------------
# _extract_tier — composite shape support
# ---------------------------------------------------------------------------


def test_extract_tier_reads_final_tier_from_composite_shape():
    """Composite entries store {'final_tier': ...}; the diff must read it."""
    assert _extract_tier({"final_tier": "Capable", "stat_tier": "Capable"}) == "Capable"


def test_extract_tier_still_reads_stats_tier_shape():
    """Staged stats entries store {'tier': ...}; still supported."""
    assert _extract_tier({"tier": "Elite"}) == "Elite"


def test_extract_tier_reads_bare_string():
    """Committed stats profiles store the bare tier string; still supported."""
    assert _extract_tier("Proficient") == "Proficient"


def test_extract_tier_final_tier_none_normalizes():
    """final_tier of 'None' / None means no tier."""
    assert _extract_tier({"final_tier": "None"}) is None
    assert _extract_tier({"final_tier": None, "tier": None}) is None


def test_extract_tier_final_tier_null_wins_over_tier_key():
    """A composite entry owns the tier via final_tier even when SQL-null —
    it must NOT fall through to a stray `tier` key (explicit key priority)."""
    assert _extract_tier({"final_tier": None, "tier": "Capable"}) is None


# ---------------------------------------------------------------------------
# Worker — recompute_composite stages full-merged composite rows
# ---------------------------------------------------------------------------


def _mock_client(stats_rows, composite_rows):
    """Mock client: player_stats query (one .eq) vs draft_skill_profiles (two .eq)."""
    sb = MagicMock()
    # player_stats: .select().eq(season).in_(player_id).order(fetched_at desc).execute()
    # The .order() is load-bearing in the real query — player_stats is INSERTed, so
    # a player has many rows and the newest must win. Keep this chain in step with it.
    sb.table.return_value.select.return_value.eq.return_value.in_.return_value.order.return_value.execute.return_value = MagicMock(
        data=stats_rows
    )
    # draft_skill_profiles composite: .select().eq(source).eq(season).in_(player_id).execute()
    sb.table.return_value.select.return_value.eq.return_value.eq.return_value.in_.return_value.execute.return_value = MagicMock(
        data=composite_rows
    )
    return sb


def _run_worker_recompute(stats_rows, composite_rows, skill_filter, fake_skills):
    """Invoke the worker with recompute_composite=True and capture staged rows."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}), \
         patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}), \
         patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only._get_client", return_value=_mock_client(stats_rows, composite_rows)), \
         patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage:
        evaluate_skills_for_run(
            run_id="run-comp",
            player_ids=["p1"],
            season="2025-26",
            skill_filter=skill_filter,
            recompute_composite=True,
        )
    return mock_stage


def _run_worker_capturing_flags(stats_rows, composite_rows, skill_filter, fake_skills, composite_entry):
    """Run recompute with composite_skill stubbed; capture staged flag rows."""
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}), \
         patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}), \
         patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.get_notability_score", return_value=80), \
         patch("services.skill_engine.evaluation_only.composite_skill", return_value=composite_entry), \
         patch("services.skill_engine.evaluation_only._get_client", return_value=_mock_client(stats_rows, composite_rows)), \
         patch("services.skill_engine.evaluation_only.stage_profile_rows"), \
         patch("services.skill_engine.evaluation_only.stage_flag_rows") as mock_flags:
        evaluate_skills_for_run(
            run_id="run-comp",
            player_ids=["p1"],
            season="2025-26",
            skill_filter=skill_filter,
            recompute_composite=True,
        )
    return mock_flags


def test_recompute_stages_flag_for_flagged_skill():
    """A flagged composite (Claude disagreement) stages a review flag row."""
    fake_skills = {"cutter": {"tier": "Elite", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"x": 1}}]
    composite_rows = [{"player_id": "p1", "profile": {"cutter": {"final_tier": "Capable", "claude_tier": "Capable"}}}]
    flagged_entry = {
        "final_tier": "Capable", "stat_tier": "Elite", "claude_tier": "Capable",
        "flagged": True, "flag_reason": "stat_claude_disagreement",
    }

    mock_flags = _run_worker_capturing_flags(stats_rows, composite_rows, ["cutter"], fake_skills, flagged_entry)

    mock_flags.assert_called_once()
    rows = mock_flags.call_args[0][1]
    assert len(rows) == 1
    flag = rows[0]
    assert flag.skill_name == "cutter"
    assert flag.flag_reason == "stat_claude_disagreement"
    assert flag.stats_tier == "Elite"
    assert flag.claude_tier == "Capable"
    assert flag.season == "2025-26"


def test_recompute_stages_no_flag_for_unflagged_skill():
    """A high-confidence skill is never flagged → no flag staged."""
    fake_skills = {"rebounder": {"tier": "Capable", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"x": 1}}]
    composite_rows = [{"player_id": "p1", "profile": {"rebounder": {"final_tier": "None"}}}]
    unflagged_entry = {"final_tier": "Capable", "stat_tier": "Capable", "flagged": False}

    mock_flags = _run_worker_capturing_flags(stats_rows, composite_rows, ["rebounder"], fake_skills, unflagged_entry)

    mock_flags.assert_not_called()


def test_recompute_stages_composite_for_high_confidence_skill():
    """rebounder (high-confidence): committed composite.final_tier follows the new stat tier."""
    # New stats evaluation: rebounder now Capable.
    fake_skills = {"rebounder": {"tier": "Capable", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"box_score": {"dreb": 4.5}}}]
    # Existing composite: rebounder None, plus an untouched skill to preserve.
    composite_rows = [{
        "player_id": "p1",
        "profile": {
            "rebounder": {"final_tier": "None", "stat_tier": "None"},
            "Scorer": {"final_tier": "Elite", "stat_tier": "Elite"},
        },
    }]

    mock_stage = _run_worker_recompute(stats_rows, composite_rows, ["rebounder"], fake_skills)

    mock_stage.assert_called_once()
    staged = mock_stage.call_args[0][1]
    assert len(staged) == 1
    row = staged[0]
    assert row.source == "composite"
    # Affected skill recomputed to the new tier.
    assert row.profile["rebounder"]["final_tier"] == "Capable"
    # Untouched skill preserved (commit replaces the whole JSONB).
    assert row.profile["Scorer"]["final_tier"] == "Elite"


def test_recompute_skips_player_without_existing_composite():
    """No existing composite → skip (do not stage a partial profile that would clobber)."""
    fake_skills = {"rebounder": {"tier": "Capable", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"box_score": {"dreb": 4.5}}}]
    composite_rows = []  # no composite profile for p1

    mock_stage = _run_worker_recompute(stats_rows, composite_rows, ["rebounder"], fake_skills)

    mock_stage.assert_called_once()
    staged = mock_stage.call_args[0][1]
    assert staged == []


def test_recompute_does_not_stage_stats_source():
    """recompute_composite path stages composite only — never a single-skill stats row."""
    fake_skills = {"rebounder": {"tier": "Capable", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"box_score": {"dreb": 4.5}}}]
    composite_rows = [{"player_id": "p1", "profile": {"rebounder": {"final_tier": "None"}}}]

    mock_stage = _run_worker_recompute(stats_rows, composite_rows, ["rebounder"], fake_skills)

    staged = mock_stage.call_args[0][1]
    assert all(r.source == "composite" for r in staged)


def test_recompute_moderate_skill_reconstructs_claude_from_existing_composite():
    """A Claude-rated (moderate) skill recomputes with claude context from the existing composite.

    The worker's job is to reconstruct the claude_result and feed it to
    composite_skill (whose merge rules are tested elsewhere). cutter is a
    moderate-confidence skill, so claude must NOT be None.
    """
    fake_skills = {"cutter": {"tier": "Elite", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"x": 1}}]
    composite_rows = [{
        "player_id": "p1",
        "profile": {
            "cutter": {
                "final_tier": "Capable",
                "stat_tier": "Capable",
                "claude_tier": "Capable",
                "claude_confidence": "high",
            },
        },
    }]

    with patch("services.skill_engine.evaluation_only.get_notability_score", return_value=80), \
         patch("services.skill_engine.evaluation_only.composite_skill",
               return_value={"final_tier": "Capable"}) as mock_composite:
        _run_worker_recompute(stats_rows, composite_rows, ["cutter"], fake_skills)

    mock_composite.assert_called_once()
    args, _ = mock_composite.call_args
    # composite_skill(skill_name, stat_result, claude_result, notability_score)
    skill_name, stat_result, claude_result, notability = args
    assert skill_name == "cutter"
    assert stat_result["tier"] == "Elite"            # new stats from this run
    assert claude_result is not None                 # moderate skill → claude reconstructed
    assert claude_result["tier"] == "Capable"        # pulled from existing composite
    assert claude_result["claude_failed"] is False
    assert notability == 80


def test_recompute_high_confidence_skill_passes_claude_none():
    """A high-confidence skill must pass claude_result=None (composite = stats passthrough)."""
    fake_skills = {"rebounder": {"tier": "Capable", "stat_confidence": "high"}}
    stats_rows = [{"player_id": "p1", "season": "2025-26", "stats": {"x": 1}}]
    composite_rows = [{"player_id": "p1", "profile": {"rebounder": {"final_tier": "None"}}}]

    with patch("services.skill_engine.evaluation_only.composite_skill",
               return_value={"final_tier": "Capable"}) as mock_composite, \
         patch("services.skill_engine.evaluation_only.get_notability_score") as mock_notability:
        _run_worker_recompute(stats_rows, composite_rows, ["rebounder"], fake_skills)

    _, _, claude_result, _ = mock_composite.call_args[0]
    assert claude_result is None
    # High-confidence → notability never fetched.
    mock_notability.assert_not_called()
