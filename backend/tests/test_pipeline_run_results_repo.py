"""
test_pipeline_run_results_repo.py — Unit tests for pipeline_run_results staging repo.

All tests mock the Supabase client — no live DB required.
Tests verify the public Contract of:
  - stage_profile_rows
  - stage_flag_rows
  - get_diff
  - discard_run
  - mark_committed
  - mark_discarded (in pipeline_runs repo)
"""

from __future__ import annotations

from dataclasses import asdict
from unittest.mock import MagicMock, call, patch

import pytest


# ---------------------------------------------------------------------------
# Imports under test
# ---------------------------------------------------------------------------


from services.pipeline_run_results.repo import (
    StagedProfileRow,
    StagedFlagRow,
    stage_profile_rows,
    stage_flag_rows,
    get_diff,
    discard_staged_rows,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_supabase():
    """Return a MagicMock that quacks like a Supabase client."""
    client = MagicMock()
    # Default: table().insert().execute() returns empty data
    client.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[])
    client.table.return_value.upsert.return_value.execute.return_value = MagicMock(data=[])
    client.table.return_value.delete.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    client.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    return client


# ---------------------------------------------------------------------------
# Case 1: stage_profile_rows inserts rows into pipeline_run_results
# ---------------------------------------------------------------------------


def test_stage_profile_rows_inserts_into_staging_table(mock_supabase):
    """stage_profile_rows must INSERT rows with run_id, player_id, season, source, profile."""
    rows = [
        StagedProfileRow(player_id="p1", season="2025-26", source="stats", profile={"Scorer": {"tier": "Elite"}}),
        StagedProfileRow(player_id="p2", season="2025-26", source="stats", profile={"Scorer": {"tier": "Capable"}}),
    ]

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_profile_rows("run-abc", rows)

    # Verify table name
    mock_supabase.table.assert_any_call("pipeline_run_results")


def test_stage_profile_rows_attaches_run_id(mock_supabase):
    """Each row in the upsert payload must include run_id."""
    rows = [StagedProfileRow(player_id="p1", season="2025-26", source="stats", profile={})]

    captured_payload = []

    def capture_upsert(payload, **kwargs):
        captured_payload.extend(payload)
        return mock_supabase.table.return_value.upsert.return_value

    mock_supabase.table.return_value.upsert.side_effect = capture_upsert

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_profile_rows("run-xyz", rows)

    assert len(captured_payload) == 1
    assert captured_payload[0]["run_id"] == "run-xyz"
    assert captured_payload[0]["player_id"] == "p1"


# ---------------------------------------------------------------------------
# Case 2: stage_flag_rows inserts rows into pipeline_run_flag_results
# ---------------------------------------------------------------------------


def test_stage_flag_rows_inserts_into_flag_staging_table(mock_supabase):
    """stage_flag_rows must INSERT into pipeline_run_flag_results."""
    rows = [
        StagedFlagRow(
            player_id="p1",
            skill_name="Scorer",
            flag_reason="tiers differ",
            claude_tier="Elite",
            stats_tier="Proficient",
            season="2025-26",
        ),
    ]

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_flag_rows("run-flag", rows)

    mock_supabase.table.assert_any_call("pipeline_run_flag_results")


def test_stage_flag_rows_attaches_run_id_and_season(mock_supabase):
    """Flag rows must include run_id and season in their insert payload."""
    rows = [
        StagedFlagRow(
            player_id="p-flag",
            skill_name="Rim",
            flag_reason="tiers differ",
            claude_tier=None,
            stats_tier="Elite",
            season="2025-26",
        )
    ]

    captured = []

    def capture_insert(payload):
        captured.extend(payload)
        return mock_supabase.table.return_value.insert.return_value

    # Only intercept calls to pipeline_run_flag_results table
    flag_table_mock = MagicMock()
    flag_table_mock.insert.side_effect = capture_insert
    flag_table_mock.insert.return_value.execute.return_value = MagicMock(data=[])

    def table_router(name):
        if name == "pipeline_run_flag_results":
            return flag_table_mock
        return mock_supabase.table.return_value

    mock_supabase.table.side_effect = table_router

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_flag_rows("run-flag-2", rows)

    assert len(captured) == 1
    assert captured[0]["run_id"] == "run-flag-2"
    assert captured[0]["season"] == "2025-26"


# ---------------------------------------------------------------------------
# Case 3: get_diff returns summary and change rows
# ---------------------------------------------------------------------------


def test_get_diff_returns_expected_shape(mock_supabase):
    """get_diff must return a dict with 'summary' and 'changes' keys."""
    # Staged rows from pipeline_run_results
    staged_rows = [
        {
            "run_id": "run-1",
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": {"Scorer": {"tier": "Elite"}},
        }
    ]
    # Current draft_skill_profiles row for same player
    current_rows = [
        {
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": {"Scorer": {"tier": "Proficient"}},
        }
    ]

    def table_router(name):
        mock = MagicMock()
        if name == "pipeline_run_results":
            # staged_rows fetch is paginated via .range(); mirror that chain.
            mock.select.return_value.eq.return_value.range.return_value.execute.return_value = MagicMock(data=staged_rows)
        elif name == "draft_skill_profiles":
            mock.select.return_value.in_.return_value.execute.return_value = MagicMock(data=current_rows)
        return mock

    mock_supabase.table.side_effect = table_router

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        result = get_diff("run-1")

    assert "summary" in result
    assert "changes" in result
    assert result["run_id"] == "run-1"


def test_get_diff_counts_promotion_correctly(mock_supabase):
    """A tier move from Proficient → Elite is counted as a promotion."""
    staged_rows = [
        {
            "run_id": "run-diff",
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": {"Scorer": {"tier": "Elite"}},
        }
    ]
    current_rows = [
        {
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": {"Scorer": {"tier": "Proficient"}},
        }
    ]

    def table_router(name):
        mock = MagicMock()
        if name == "pipeline_run_results":
            # staged_rows fetch is paginated via .range(); mirror that chain.
            mock.select.return_value.eq.return_value.range.return_value.execute.return_value = MagicMock(data=staged_rows)
        elif name == "draft_skill_profiles":
            mock.select.return_value.in_.return_value.execute.return_value = MagicMock(data=current_rows)
        return mock

    mock_supabase.table.side_effect = table_router

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        result = get_diff("run-diff")

    scorer_summary = result["summary"]["per_skill"].get("Scorer", {})
    assert scorer_summary.get("promotions", 0) >= 1


# ---------------------------------------------------------------------------
# Case 3b: flat (committed) vs nested (staged) profile shapes.
#
# Staged rows nest per-skill metadata ({"tier": ...}); committed
# draft_skill_profiles store the bare tier string. get_diff must classify
# correctly across the shape mismatch, otherwise every change looks like "new".
# ---------------------------------------------------------------------------


def _diff_with(staged_profile, current_profile, mock_supabase):
    staged_rows = [
        {
            "run_id": "run-shape",
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": staged_profile,
        }
    ]
    current_rows = [
        {
            "player_id": "p1",
            "season": "2025-26",
            "source": "stats",
            "profile": current_profile,
        }
    ]

    def table_router(name):
        mock = MagicMock()
        if name == "pipeline_run_results":
            # staged_rows fetch is paginated via .range(); mirror that chain.
            mock.select.return_value.eq.return_value.range.return_value.execute.return_value = MagicMock(data=staged_rows)
        elif name == "draft_skill_profiles":
            mock.select.return_value.in_.return_value.execute.return_value = MagicMock(data=current_rows)
        return mock

    mock_supabase.table.side_effect = table_router
    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        return get_diff("run-shape")


def test_get_diff_detects_promotion_against_flat_committed_profile(mock_supabase):
    """Staged nested Elite vs committed flat 'Proficient' is a promotion, not 'new'."""
    result = _diff_with(
        {"spot_up_shooter": {"tier": "Elite"}},
        {"spot_up_shooter": "Proficient"},
        mock_supabase,
    )
    stats = result["summary"]["per_skill"]["spot_up_shooter"]
    assert stats["promotions"] == 1
    assert stats["new"] == 0
    assert result["changes"][0]["change_type"] == "promotion"
    assert result["changes"][0]["old_tier"] == "Proficient"


def test_get_diff_detects_demotion_against_flat_committed_profile(mock_supabase):
    """Staged nested Capable vs committed flat 'Proficient' is a demotion."""
    result = _diff_with(
        {"spot_up_shooter": {"tier": "Capable"}},
        {"spot_up_shooter": "Proficient"},
        mock_supabase,
    )
    stats = result["summary"]["per_skill"]["spot_up_shooter"]
    assert stats["demotions"] == 1
    assert result["changes"][0]["change_type"] == "demotion"


def test_get_diff_treats_committed_none_string_as_new(mock_supabase):
    """The literal 'None' tier means no prior tier, so a real tier reads as 'new'."""
    result = _diff_with(
        {"spot_up_shooter": {"tier": "Capable"}},
        {"spot_up_shooter": "None"},
        mock_supabase,
    )
    stats = result["summary"]["per_skill"]["spot_up_shooter"]
    assert stats["new"] == 1
    assert result["changes"][0]["change_type"] == "new"
    assert result["changes"][0]["old_tier"] is None


def test_get_diff_treats_matching_none_strings_as_unchanged(mock_supabase):
    """'None' staged vs 'None' committed is unchanged, not a spurious change."""
    result = _diff_with(
        {"spot_up_shooter": {"tier": "None"}},
        {"spot_up_shooter": "None"},
        mock_supabase,
    )
    stats = result["summary"]["per_skill"]["spot_up_shooter"]
    assert stats["unchanged"] == 1
    assert result["summary"]["total_changed"] == 0
    assert result["changes"] == []


# ---------------------------------------------------------------------------
# Case 4: discard_staged_rows deletes from both staging tables
# ---------------------------------------------------------------------------


def test_discard_staged_rows_deletes_from_both_tables(mock_supabase):
    """discard_staged_rows must DELETE from pipeline_run_results and pipeline_run_flag_results."""
    deleted_tables = []

    def table_router(name):
        mock = MagicMock()
        deleted_tables.append(name)

        def delete_chain():
            d = MagicMock()
            d.eq.return_value.execute.return_value = MagicMock(data=[])
            return d

        mock.delete.side_effect = lambda: delete_chain()
        return mock

    mock_supabase.table.side_effect = table_router

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        discard_staged_rows("run-del")

    assert "pipeline_run_results" in deleted_tables
    assert "pipeline_run_flag_results" in deleted_tables


# ---------------------------------------------------------------------------
# Case 5: stage_profile_rows with empty list is a no-op
# ---------------------------------------------------------------------------


def test_stage_profile_rows_empty_list_is_noop(mock_supabase):
    """stage_profile_rows([]) must not call supabase.table at all for inserts."""
    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_profile_rows("run-noop", [])

    # No insert call should have been made
    for call_args in mock_supabase.table.call_args_list:
        table_name = call_args[0][0]
        assert table_name != "pipeline_run_results", "Should not insert into staging for empty rows"


# ---------------------------------------------------------------------------
# Case 5b: stage_profile_rows is idempotent on duplicate (run_id, player_id, source)
# ---------------------------------------------------------------------------


def test_stage_profile_rows_is_idempotent_on_duplicate_pk(mock_supabase):
    """Staging the same (run_id, player_id, source) twice must call upsert, not insert.

    This verifies worker-retry safety: if a worker crashes mid-run and re-stages
    results, the second stage call must overwrite rather than raise a unique-key error.
    The second call's profile blob should be the one that survives.
    """
    row_v1 = StagedProfileRow(player_id="p-dupe", season="2025-26", source="stats", profile={"Scorer": {"tier": "Capable"}})
    row_v2 = StagedProfileRow(player_id="p-dupe", season="2025-26", source="stats", profile={"Scorer": {"tier": "Elite"}})

    upsert_calls = []

    def capture_upsert(payload, **kwargs):
        upsert_calls.extend(payload)
        return mock_supabase.table.return_value.upsert.return_value

    mock_supabase.table.return_value.upsert.side_effect = capture_upsert

    with patch("services.pipeline_run_results.repo._get_client", return_value=mock_supabase):
        stage_profile_rows("run-dupe", [row_v1])
        stage_profile_rows("run-dupe", [row_v2])

    # upsert must have been called twice — once per stage_profile_rows call
    assert len(upsert_calls) == 2, f"Expected 2 upsert calls, got {len(upsert_calls)}"
    # The second call carries the newer profile
    assert upsert_calls[1]["profile"] == {"Scorer": {"tier": "Elite"}}
    # insert must NOT have been called for the staging table
    for c in mock_supabase.table.return_value.insert.call_args_list:
        assert False, "insert() was called — expected upsert() for idempotent staging"


# ---------------------------------------------------------------------------
# Case 6: StagedProfileRow is a frozen dataclass (immutable)
# ---------------------------------------------------------------------------


def test_staged_profile_row_is_frozen():
    """StagedProfileRow must be a frozen dataclass — mutation raises FrozenInstanceError."""
    row = StagedProfileRow(player_id="p1", season="2025-26", source="stats", profile={})
    with pytest.raises((AttributeError, TypeError)):
        row.player_id = "mutated"  # type: ignore


# ---------------------------------------------------------------------------
# Case 7: StagedFlagRow is a frozen dataclass (immutable)
# ---------------------------------------------------------------------------


def test_staged_flag_row_is_frozen():
    """StagedFlagRow must be a frozen dataclass."""
    row = StagedFlagRow(
        player_id="p1",
        skill_name="Scorer",
        flag_reason="tiers differ",
        claude_tier=None,
        stats_tier="Elite",
        season="2025-26",
    )
    with pytest.raises((AttributeError, TypeError)):
        row.skill_name = "mutated"  # type: ignore
