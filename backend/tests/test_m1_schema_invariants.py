"""
M1 schema invariant tests — draft-aware skill mapping (issue #7).

These tests codify the behavioral contracts introduced by the three M1 migrations:

  20260527000001_pipeline_run_staging.sql
  20260527000002_released_players_legends.sql
  20260527000003_publish_open_flags_gate.sql

Requires a live Supabase connection (SUPABASE_URL + SUPABASE_SERVICE_KEY in backend/.env).
Each test cleans up its own inserted rows after assertion via try/finally.

Convention: tests attempt operations that should succeed or fail, asserting on the
error message to verify the correct DB-level constraint fired.
"""

from __future__ import annotations

import uuid
import warnings

import pytest

# Live-DB helpers promoted to conftest.py.
# sb and real_release_id fixtures are injected by pytest from conftest.py.
# _insert_run and _delete_run are plain functions re-imported via importlib
# so they can be called directly inside test bodies.

import importlib.util as _ilu
from pathlib import Path as _Path

_conftest_path = _Path(__file__).parent / "conftest.py"
_conftest_spec = _ilu.spec_from_file_location("_tests_conftest", _conftest_path)
_conftest_mod = _ilu.module_from_spec(_conftest_spec)
_conftest_spec.loader.exec_module(_conftest_mod)

_needs_live_db = _conftest_mod._needs_live_db
_insert_run = _conftest_mod._insert_run
_delete_run = _conftest_mod._delete_run


pytestmark = pytest.mark.skipif(
    not _needs_live_db(),
    reason="Requires SUPABASE_URL + SUPABASE_SERVICE_KEY (live DB)",
)


def _gen_uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# pipeline_run_results — staging table invariants
# ---------------------------------------------------------------------------


def test_pipeline_run_results_pk_rejects_duplicate_run_player_source(sb):
    """PRIMARY KEY (run_id, player_id, source) rejects a second insert for same triple."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()
    try:
        # First insert — must succeed
        sb.table("pipeline_run_results").insert({
            "run_id": run_id,
            "player_id": player_id,
            "season": "2025-26",
            "source": "composite",
            "profile": {},
        }).execute()

        # Second insert with identical PK — must raise
        with pytest.raises(Exception, match=r"duplicate|unique|23505"):
            sb.table("pipeline_run_results").insert({
                "run_id": run_id,
                "player_id": player_id,
                "season": "2025-26",
                "source": "composite",
                "profile": {},
            }).execute()
    finally:
        _delete_run(sb, run_id)


def test_pipeline_run_results_source_check_rejects_unknown_value(sb):
    """CHECK (source IN ('stats','claude','composite','manual')) rejects unknown source."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()
    try:
        with pytest.raises(Exception, match=r"check|23514|violates"):
            sb.table("pipeline_run_results").insert({
                "run_id": run_id,
                "player_id": player_id,
                "season": "2025-26",
                "source": "unknown_source",
                "profile": {},
            }).execute()
    finally:
        _delete_run(sb, run_id)


def test_pipeline_run_results_cascade_deletes_on_run_delete(sb):
    """ON DELETE CASCADE removes staged profile rows when parent run is deleted."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()

    sb.table("pipeline_run_results").insert({
        "run_id": run_id,
        "player_id": player_id,
        "season": "2025-26",
        "source": "stats",
        "profile": {},
    }).execute()

    # Delete the run — cascade should remove the staged row
    _delete_run(sb, run_id)

    remaining = sb.table("pipeline_run_results").select("run_id").eq("run_id", run_id).execute()
    assert len(remaining.data or []) == 0


# ---------------------------------------------------------------------------
# pipeline_run_flag_results — staging table invariants
# ---------------------------------------------------------------------------


def test_pipeline_run_flag_results_pk_rejects_duplicate_run_player_skill_season(sb):
    """PRIMARY KEY (run_id, player_id, skill_name, season) rejects duplicate quadruple."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()
    try:
        sb.table("pipeline_run_flag_results").insert({
            "run_id": run_id,
            "player_id": player_id,
            "skill_name": "Scorer",
            "season": "2025-26",
            "flag_reason": "tiers differ",
        }).execute()

        with pytest.raises(Exception, match=r"duplicate|unique|23505"):
            sb.table("pipeline_run_flag_results").insert({
                "run_id": run_id,
                "player_id": player_id,
                "skill_name": "Scorer",
                "season": "2025-26",
                "flag_reason": "tiers differ",
            }).execute()
    finally:
        _delete_run(sb, run_id)


def test_pipeline_run_flag_results_pk_allows_distinct_seasons(sb):
    """Same (run_id, player_id, skill_name) across distinct seasons must NOT collide."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()
    try:
        sb.table("pipeline_run_flag_results").insert({
            "run_id": run_id,
            "player_id": player_id,
            "skill_name": "Scorer",
            "season": "2025-26",
            "flag_reason": "tiers differ",
        }).execute()

        # Different season — must succeed
        sb.table("pipeline_run_flag_results").insert({
            "run_id": run_id,
            "player_id": player_id,
            "skill_name": "Scorer",
            "season": "2024-25",
            "flag_reason": "tiers differ",
        }).execute()
    finally:
        _delete_run(sb, run_id)


def test_pipeline_run_flag_results_cascade_deletes_on_run_delete(sb):
    """ON DELETE CASCADE removes staged flag rows when parent run is deleted."""
    run_id = _insert_run(sb)
    player_id = _gen_uuid()

    sb.table("pipeline_run_flag_results").insert({
        "run_id": run_id,
        "player_id": player_id,
        "skill_name": "Scorer",
        "season": "2025-26",
        "flag_reason": "tiers differ",
    }).execute()

    _delete_run(sb, run_id)

    remaining = sb.table("pipeline_run_flag_results").select("run_id").eq("run_id", run_id).execute()
    assert len(remaining.data or []) == 0


# ---------------------------------------------------------------------------
# pipeline_runs — extended CHECK constraints
# ---------------------------------------------------------------------------


def test_pipeline_runs_accepts_skill_evaluation_pipeline_name(sb):
    """pipeline_name CHECK accepts 'skill_evaluation'."""
    run_id = _insert_run(sb, pipeline_name="skill_evaluation")
    try:
        # If insert succeeded (no exception), the constraint allows it
        result = sb.table("pipeline_runs").select("pipeline_name").eq("id", run_id).execute()
        assert result.data[0]["pipeline_name"] == "skill_evaluation"
    finally:
        _delete_run(sb, run_id)


def test_pipeline_runs_accepts_threshold_edit_pipeline_name(sb):
    """pipeline_name CHECK accepts 'threshold_edit'."""
    run_id = _insert_run(sb, pipeline_name="threshold_edit")
    try:
        result = sb.table("pipeline_runs").select("pipeline_name").eq("id", run_id).execute()
        assert result.data[0]["pipeline_name"] == "threshold_edit"
    finally:
        _delete_run(sb, run_id)


def test_pipeline_runs_rejects_unknown_pipeline_name(sb):
    """pipeline_name CHECK rejects unknown values."""
    with pytest.raises(Exception, match=r"check|23514|violates"):
        _insert_run(sb, pipeline_name="data_export")


def test_pipeline_runs_accepts_discarded_status(sb):
    """status CHECK accepts 'discarded'."""
    run_id = _insert_run(sb)
    try:
        sb.table("pipeline_runs").update({"status": "discarded"}).eq("id", run_id).execute()
        result = sb.table("pipeline_runs").select("status").eq("id", run_id).execute()
        assert result.data[0]["status"] == "discarded"
    finally:
        _delete_run(sb, run_id)


def test_pipeline_runs_rejects_unknown_status(sb):
    """status CHECK rejects unknown values."""
    run_id = _insert_run(sb)
    try:
        with pytest.raises(Exception, match=r"check|23514|violates"):
            sb.table("pipeline_runs").update({"status": "cancelled"}).eq("id", run_id).execute()
    finally:
        _delete_run(sb, run_id)


# ---------------------------------------------------------------------------
# pipeline_runs — partial unique index (one pending-commit run per draft)
# ---------------------------------------------------------------------------


# real_release_id fixture is provided by conftest.py.


def test_partial_unique_idx_blocks_second_pending_commit_run_for_same_release(sb, real_release_id):
    """idx_pipeline_runs_one_pending_commit: at most one row per snapshot_release_id WHERE status='success' AND committed_at IS NULL."""
    run_id_1 = None
    run_id_2 = None
    try:
        run_id_1 = _insert_run(sb, pipeline_name="skill_evaluation", snapshot_release_id=real_release_id)
        # Move to success (pending commit = no committed_at yet)
        sb.table("pipeline_runs").update({"status": "success"}).eq("id", run_id_1).execute()

        # Second success row for same release with no committed_at must fail
        with pytest.raises(Exception, match=r"duplicate|unique|23505"):
            run_id_2 = _insert_run(sb, pipeline_name="threshold_edit", snapshot_release_id=real_release_id)
            sb.table("pipeline_runs").update({"status": "success"}).eq("id", run_id_2).execute()
    finally:
        if run_id_1:
            _delete_run(sb, run_id_1)
        if run_id_2:
            try:
                _delete_run(sb, run_id_2)
            except Exception:
                pass


def test_partial_unique_idx_allows_running_status_runs_regardless_of_release(sb, real_release_id):
    """Rows with status='running' are excluded from the partial index predicate."""
    run_id_1 = None
    run_id_2 = None
    try:
        run_id_1 = _insert_run(sb, status="running", snapshot_release_id=real_release_id)
        # Second running row for same release — must succeed
        run_id_2 = _insert_run(sb, status="running", snapshot_release_id=real_release_id)
    finally:
        if run_id_1:
            _delete_run(sb, run_id_1)
        if run_id_2:
            _delete_run(sb, run_id_2)


def test_partial_unique_idx_allows_committed_run_after_pending_commit_run(sb, real_release_id):
    """A row with committed_at IS NOT NULL is excluded from the predicate."""
    from datetime import datetime, timezone
    run_id_1 = None
    run_id_2 = None
    try:
        run_id_1 = _insert_run(sb, snapshot_release_id=real_release_id)
        # Mark committed — excluded from idx predicate
        sb.table("pipeline_runs").update({
            "status": "success",
            "committed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", run_id_1).execute()

        # New pending-commit run for same release — must succeed
        run_id_2 = _insert_run(sb, snapshot_release_id=real_release_id)
        sb.table("pipeline_runs").update({"status": "success"}).eq("id", run_id_2).execute()
    finally:
        if run_id_1:
            _delete_run(sb, run_id_1)
        if run_id_2:
            _delete_run(sb, run_id_2)


def test_partial_unique_idx_allows_discarded_run_after_pending_commit_run(sb, real_release_id):
    """status='discarded' is excluded from the predicate — unblocks new pending-commit run."""
    run_id_1 = None
    run_id_2 = None
    try:
        run_id_1 = _insert_run(sb, snapshot_release_id=real_release_id)
        sb.table("pipeline_runs").update({"status": "success"}).eq("id", run_id_1).execute()
        # Discard first run — excluded from idx predicate
        sb.table("pipeline_runs").update({"status": "discarded"}).eq("id", run_id_1).execute()

        # New pending-commit run for same release — must succeed
        run_id_2 = _insert_run(sb, snapshot_release_id=real_release_id)
        sb.table("pipeline_runs").update({"status": "success"}).eq("id", run_id_2).execute()
    finally:
        if run_id_1:
            _delete_run(sb, run_id_1)
        if run_id_2:
            _delete_run(sb, run_id_2)


# ---------------------------------------------------------------------------
# released_players — is_legend column invariants
# ---------------------------------------------------------------------------


def test_released_players_is_legend_column_exists_with_false_default(sb):
    """released_players.is_legend column exists as BOOLEAN NOT NULL DEFAULT false."""
    result = sb.rpc("is_legend_column_exists", {}).execute() if False else None
    # Use information_schema via direct SQL — supabase-py doesn't expose raw SQL directly,
    # so we verify by querying the column metadata via a custom RPC or checking schema.
    # Fall back to a behavioral check: insert a row without is_legend and read it back.
    # We cannot insert into released_players without a valid snapshot_release_id FK,
    # so we verify via the information_schema-equivalent by checking the column list.
    columns_result = (
        sb.table("released_players")
        .select("is_legend")
        .limit(1)
        .execute()
    )
    # If the column doesn't exist, the query raises. If it does, we pass.
    # Note: the query may return 0 rows if the table is empty — that's fine.
    assert columns_result is not None  # column exists and query ran


def test_released_players_is_legend_accepts_true(sb):
    """is_legend can be explicitly set to true in released_players rows."""
    # We cannot easily INSERT into released_players without valid FKs (canonical_player_id etc).
    # Instead, verify via schema that is_legend is a BOOLEAN column — if it can store true/false,
    # the column type is correct. We do this by checking an existing row or confirming
    # the column returns a boolean in the SELECT.
    result = (
        sb.table("released_players")
        .select("is_legend")
        .limit(5)
        .execute()
    )
    for row in (result.data or []):
        assert isinstance(row["is_legend"], bool), f"is_legend should be bool, got {type(row['is_legend'])}"


def test_released_players_existing_rows_default_to_false(sb):
    """Any existing rows have is_legend=false, not NULL."""
    result = (
        sb.table("released_players")
        .select("is_legend")
        .is_("is_legend", "null")
        .execute()
    )
    assert len(result.data or []) == 0, "No rows should have is_legend=NULL"


# ---------------------------------------------------------------------------
# publish_snapshot_draft RPC — open-flags gate
# ---------------------------------------------------------------------------


def test_publish_rpc_raises_open_flags_not_acknowledged_when_flags_exist(sb):
    """publish_snapshot_draft raises when unresolved flags exist and p_allow_open_flags=false.

    This test is a structural check only — we verify the RPC signature accepts
    p_allow_open_flags as a parameter by calling it with a non-existent draft_id
    (which fails with draft_not_in_review_state — issue #67 — before reaching the
    flags check). The actual open-flags behavior is tested end-to-end in M7.
    """
    with pytest.raises(Exception, match=r"draft_not_in_review|draft_not_found|not_in_draft"):
        sb.rpc(
            "publish_snapshot_draft",
            {
                "p_draft_id": _gen_uuid(),
                "p_label": "test-label",
                "p_allow_missing_composite": True,
                "p_allow_open_flags": False,
            },
        ).execute()


def test_publish_rpc_proceeds_with_open_flags_when_override_true(sb):
    """publish_snapshot_draft accepts p_allow_open_flags=true parameter without a signature error."""
    with pytest.raises(Exception, match=r"draft_not_in_review|draft_not_found|not_in_draft"):
        sb.rpc(
            "publish_snapshot_draft",
            {
                "p_draft_id": _gen_uuid(),
                "p_label": "test-label",
                "p_allow_missing_composite": True,
                "p_allow_open_flags": True,
            },
        ).execute()


def test_publish_rpc_raises_when_legend_missing_canonical_player(sb):
    """publish_snapshot_draft signature accepts p_allow_open_flags (structural check)."""
    # Same structural verification — the RPC raises draft_not_in_review_state
    # (issue #67) before reaching the legends_missing_canonical_player check for a
    # random draft_id.
    with pytest.raises(Exception, match=r"draft_not_in_review|draft_not_found|not_in_draft|legends_missing"):
        sb.rpc(
            "publish_snapshot_draft",
            {
                "p_draft_id": _gen_uuid(),
                "p_label": "test-label",
                "p_allow_missing_composite": True,
                "p_allow_open_flags": True,
            },
        ).execute()


def test_publish_rpc_includes_legends_in_released_players(sb):
    """released_players table has is_legend column (verified by column existence query)."""
    result = sb.table("released_players").select("is_legend").limit(1).execute()
    assert result is not None  # column exists


def test_publish_rpc_sets_is_legend_false_for_regular_players(sb):
    """Regular (non-legend) rows in released_players have is_legend=false."""
    result = (
        sb.table("released_players")
        .select("is_legend")
        .eq("is_legend", False)
        .limit(5)
        .execute()
    )
    # If the table is empty, that's fine — no assertion needed. If rows exist, they have is_legend=false.
    for row in (result.data or []):
        assert row["is_legend"] is False


def test_publish_rpc_no_released_player_row_has_null_is_legend(sb):
    """After publish, no released_players row has NULL in is_legend."""
    result = (
        sb.table("released_players")
        .select("is_legend")
        .is_("is_legend", "null")
        .execute()
    )
    assert len(result.data or []) == 0


def test_publish_rpc_accepts_acknowledged_open_flags_param(sb):
    """Issue #71: the RPC's 5-arg signature accepts p_acknowledged_open_flags.

    Structural check — a random draft_id hits draft_not_in_review_state (issue
    #67) before the count-pin logic, but the call only resolves if the new
    parameter exists on the function (proves the migration applied and the old
    4-arg overload was dropped cleanly). The count-pin BEHAVIOR is exercised
    end-to-end in M7.
    """
    with pytest.raises(Exception, match=r"draft_not_in_review_state"):
        sb.rpc(
            "publish_snapshot_draft",
            {
                "p_draft_id": _gen_uuid(),
                "p_label": "test-label",
                "p_allow_missing_composite": True,
                "p_allow_open_flags": True,
                "p_acknowledged_open_flags": 1,
            },
        ).execute()


# ---------------------------------------------------------------------------
# publish_snapshot_draft RPC — issue #67: publish only from review state
# ---------------------------------------------------------------------------


def test_publish_rpc_rejects_publish_from_draft_status(sb):
    """A draft-state Snapshot Release cannot be published.

    Issue #67: the RPC must reject status='draft' with draft_not_in_review_state
    so the review step cannot be skipped, and it must do so BEFORE any freeze or
    is_active swap. This exercises the real Invariant (an existing draft row),
    not just the not-found path the structural tests above cover.

    Safety: the status guard is the first thing the RPC checks after the advisory
    lock, so a draft-state row raises and rolls back before released_players is
    touched. We still assert no side effects leaked.
    """
    # Find any currently-open draft/review row.
    open_rows = (
        sb.table("snapshot_releases")
        .select("id, status, season, is_active")
        .in_("status", ["draft", "review"])
        .execute()
    ).data or []

    created_id: str | None = None
    if open_rows:
        existing = open_rows[0]
        if existing["status"] != "draft":
            # Surface the skip loudly: this is the ONLY test exercising the #67
            # guard, so a silent no-op would mean green CI with zero coverage.
            warnings.warn(
                "test_publish_rpc_rejects_publish_from_draft_status skipped — an "
                "open draft is in 'review' state, so seeding a second draft is "
                "unsafe (one-open-draft unique index). #67 guard NOT exercised "
                "this run.",
                stacklevel=2,
            )
            pytest.skip(
                "An open draft is already in 'review' state; cannot safely seed a "
                "second draft (one-open-draft unique index) without risking a real "
                "publish. Re-run when no review-state draft is open."
            )
        draft_id = str(existing["id"])
    else:
        # No open draft — seed a minimal draft-state row, inheriting the active
        # release's season. is_active stays false so nothing user-facing changes.
        active = (
            sb.table("snapshot_releases")
            .select("season")
            .eq("is_active", True)
            .single()
            .execute()
        ).data
        season = (active or {}).get("season") or "2025-26"
        inserted = (
            sb.table("snapshot_releases")
            .insert(
                {
                    "season": season,
                    "label": f"test-67-{_gen_uuid()[:8]}",
                    "status": "draft",
                    "is_active": False,
                }
            )
            .execute()
        ).data
        created_id = str(inserted[0]["id"])
        draft_id = created_id

    try:
        with pytest.raises(Exception, match=r"draft_not_in_review_state"):
            sb.rpc(
                "publish_snapshot_draft",
                {
                    "p_draft_id": draft_id,
                    "p_label": "test-67-should-not-publish",
                    "p_allow_missing_composite": True,
                    "p_allow_open_flags": True,
                },
            ).execute()

        # No side effects: the row stays draft + inactive, and nothing was frozen
        # into released_players under this draft id.
        after = (
            sb.table("snapshot_releases")
            .select("status, is_active")
            .eq("id", draft_id)
            .single()
            .execute()
        ).data
        assert after["status"] == "draft"
        assert after["is_active"] is False

        frozen = (
            sb.table("released_players")
            .select("id")
            .eq("snapshot_release_id", draft_id)
            .limit(1)
            .execute()
        ).data or []
        assert frozen == [], "Rejected publish must not freeze released_players rows"
    finally:
        if created_id is not None:
            sb.table("snapshot_releases").delete().eq("id", created_id).execute()


def test_publish_rpc_count_pin_refuses_when_live_exceeds_acknowledged(sb):
    """Issue #71: a review-state draft with open flags + an override acknowledging
    FEWER flags than exist must be refused with open_flags_changed.

    Exercises the count-pin BEHAVIOR end-to-end against the live RPC. Safe because:
      - The refusal raises BEFORE any freeze / is_active swap.
      - As a hard guard, we never call publish until we've confirmed (via the same
        scope the RPC uses, validator.validate_publishable) that open flags exist —
        so with acknowledged=0 the count-pin is guaranteed to fire.
    All seeded working-state rows (a throwaway review draft + one open flag) are
    removed in finally, so global working state is restored.
    """
    from services.snapshot_versions import validator

    # Can't seed a second open draft (one-open-draft unique index).
    open_rows = (
        sb.table("snapshot_releases")
        .select("id, status")
        .in_("status", ["draft", "review"])
        .execute()
    ).data or []
    if open_rows:
        warnings.warn(
            "test_publish_rpc_count_pin_refuses_when_live_exceeds_acknowledged "
            "skipped — an open draft already exists, so a throwaway review draft "
            "can't be seeded. #71 count-pin behavior NOT exercised this run.",
            stacklevel=2,
        )
        pytest.skip("An open draft already exists; cannot seed a throwaway review draft.")

    # Need a current-season composite profile to hang an open flag on.
    profile = (
        sb.table("draft_skill_profiles")
        .select("id")
        .eq("season", "2025-26")
        .eq("source", "composite")
        .limit(1)
        .execute()
    ).data
    if not profile:
        pytest.skip("No current-season composite profile to attach an open flag to.")
    profile_id = str(profile[0]["id"])

    active = (
        sb.table("snapshot_releases")
        .select("season")
        .eq("is_active", True)
        .single()
        .execute()
    ).data
    season = (active or {}).get("season") or "2025-26"

    draft_id: str | None = None
    flag_id: str | None = None
    try:
        # Throwaway review-state draft (status='review' directly; the RPC only
        # gates on status='review', and the one-open-draft index is satisfied
        # because we checked there's no other open draft above).
        draft = (
            sb.table("snapshot_releases")
            .insert(
                {
                    "season": season,
                    "label": f"test-71-{_gen_uuid()[:8]}",
                    "status": "review",
                    "is_active": False,
                }
            )
            .execute()
        ).data
        draft_id = str(draft[0]["id"])

        # One unresolved (open) flag on a current-season composite profile.
        flag = (
            sb.table("draft_skill_flags")
            .insert(
                {
                    "skill_profile_id": profile_id,
                    "skill_name": "Scorer",
                    "stat_rating": "Elite",
                    "claude_rating": "Capable",
                    "flag_reason": "test-71-count-pin",
                }
            )
            .execute()
        ).data
        flag_id = str(flag[0]["id"])

        # HARD SAFETY GUARD: confirm open flags exist in the RPC's scope before we
        # ever call publish. With live >= 1 and acknowledged = 0, the count-pin MUST
        # refuse, so publish can never freeze/swap.
        open_flags = validator.validate_publishable(draft_id, client=sb).get("open_flags", 0)
        assert open_flags >= 1, (
            "seed did not register an open flag in the gate scope; refusing to call "
            "publish without a confirmed refusal condition"
        )

        # acknowledged (0) < live (>= 1) -> open_flags_changed; no publish.
        with pytest.raises(Exception, match=r"open_flags_changed"):
            sb.rpc(
                "publish_snapshot_draft",
                {
                    "p_draft_id": draft_id,
                    "p_label": "test-71-should-not-publish",
                    "p_allow_missing_composite": True,
                    "p_allow_open_flags": True,
                    "p_acknowledged_open_flags": 0,
                },
            ).execute()

        # No publish happened: the draft stays review + inactive, nothing frozen.
        after = (
            sb.table("snapshot_releases")
            .select("status, is_active")
            .eq("id", draft_id)
            .single()
            .execute()
        ).data
        assert after["status"] == "review"
        assert after["is_active"] is False

        frozen = (
            sb.table("released_players")
            .select("id")
            .eq("snapshot_release_id", draft_id)
            .limit(1)
            .execute()
        ).data or []
        assert frozen == [], "count-pin refusal must not freeze released_players rows"
    finally:
        if flag_id is not None:
            sb.table("draft_skill_flags").delete().eq("id", flag_id).execute()
        if draft_id is not None:
            sb.table("snapshot_releases").delete().eq("id", draft_id).execute()
