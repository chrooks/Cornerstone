"""
M1 schema invariant tests — draft-aware skill mapping (issue #7).

These tests codify the behavioral contracts introduced by the three M1 migrations:

  20260527000001_pipeline_run_staging.sql
  20260527000002_released_players_legends.sql
  20260527000003_publish_open_flags_gate.sql

All tests are skipped because M1 adds database-level constraints that require a
live Supabase connection to verify. Each test documents the invariant it will
enforce once the real-DB fixture is wired in M2.

Convention: use pytest.mark.skip with a reason that names the SQL invariant being
tested, so the test names form a readable contract list.

When wiring real-DB tests in M2:
  1. Replace @pytest.mark.skip with a fixture that gives a psycopg2 or supabase-py
     connection to a test schema with M1 migrations applied.
  2. Remove the `pass` body and implement the SQL assertions.
  3. Wrap DML in a transaction that rolls back after each test (SAVEPOINT pattern).
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# pipeline_run_results — staging table invariants
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_results_pk_rejects_duplicate_run_player_source():
    """PRIMARY KEY (run_id, player_id, source) — enforced by constraint
    `pipeline_run_results_pkey` — rejects a second insert for the same triple.

    SQL to verify:
        INSERT INTO pipeline_run_results (run_id, player_id, season, source, profile)
          VALUES ('<run>', '<player>', '2025-26', 'composite', '{}');
        -- second insert with identical PK must raise unique_violation
        -- (constraint name: pipeline_run_results_pkey).
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_results_source_check_rejects_unknown_value():
    """CHECK (source IN ('stats','claude','composite','manual')) — anonymous
    table-level CHECK constraint — rejects an unknown source value.

    SQL to verify:
        INSERT INTO pipeline_run_results (..., source='unknown', ...)
        -- must raise check_violation.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_results_cascade_deletes_on_run_delete():
    """ON DELETE CASCADE on the FK `pipeline_run_results.run_id ->
    pipeline_runs.id` removes all staged profile rows when the parent run row
    is deleted.

    SQL to verify:
        DELETE FROM pipeline_runs WHERE id = '<run>';
        SELECT COUNT(*) FROM pipeline_run_results WHERE run_id = '<run>';
        -- Expect: 0 rows remain.
    """
    pass


# ---------------------------------------------------------------------------
# pipeline_run_flag_results — staging table invariants
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_flag_results_pk_rejects_duplicate_run_player_skill_season():
    """PRIMARY KEY (run_id, player_id, skill_name, season) — enforced by
    constraint `pipeline_run_flag_results_pkey` — rejects a second insert for
    the same quadruple.

    Season is part of the PK so a multi-season skill_evaluation run can stage
    flags for the same (player, skill) across different seasons without
    colliding. Added in migration 20260527000004 after the original
    (run_id, player_id, skill_name) PK was identified as too narrow.

    SQL to verify:
        INSERT INTO pipeline_run_flag_results (run_id, player_id, skill_name,
          season, flag_reason)
          VALUES ('<run>', '<player>', 'Scorer', '2025-26', 'tiers differ');
        -- second insert with identical PK must raise unique_violation
        -- (constraint name: pipeline_run_flag_results_pkey).
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_flag_results_pk_allows_distinct_seasons():
    """Same (run_id, player_id, skill_name) across distinct seasons must NOT
    collide on the PK after the season add in migration 20260527000004.

    SQL to verify:
        INSERT INTO pipeline_run_flag_results VALUES ('<run>', '<player>',
          'Scorer', '2025-26', 'tiers differ');
        INSERT INTO pipeline_run_flag_results VALUES ('<run>', '<player>',
          'Scorer', '2024-25', 'tiers differ');
        -- Both inserts succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_run_flag_results_cascade_deletes_on_run_delete():
    """ON DELETE CASCADE on the FK `pipeline_run_flag_results.run_id ->
    pipeline_runs.id` removes all staged flag rows when the parent run row
    is deleted.

    SQL to verify:
        DELETE FROM pipeline_runs WHERE id = '<run>';
        SELECT COUNT(*) FROM pipeline_run_flag_results WHERE run_id = '<run>';
        -- Expect: 0 rows remain.
    """
    pass


# ---------------------------------------------------------------------------
# pipeline_runs — extended CHECK constraints
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_runs_accepts_skill_evaluation_pipeline_name():
    """pipeline_name CHECK now accepts 'skill_evaluation'.

    SQL to verify:
        INSERT INTO pipeline_runs (pipeline_name, scope, snapshot_release_id, status)
          VALUES ('skill_evaluation', 'bulk', '<release>', 'running');
        -- must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_runs_accepts_threshold_edit_pipeline_name():
    """pipeline_name CHECK now accepts 'threshold_edit'.

    SQL to verify:
        INSERT INTO pipeline_runs (pipeline_name, scope, snapshot_release_id, status)
          VALUES ('threshold_edit', 'bulk', '<release>', 'running');
        -- must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_runs_rejects_unknown_pipeline_name():
    """pipeline_name CHECK still rejects unknown values.

    SQL to verify:
        INSERT INTO pipeline_runs (..., pipeline_name='data_export', ...)
        -- must raise check_violation.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_runs_accepts_discarded_status():
    """status CHECK now accepts 'discarded'.

    SQL to verify:
        UPDATE pipeline_runs SET status = 'discarded' WHERE id = '<run>';
        -- must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_pipeline_runs_rejects_unknown_status():
    """status CHECK still rejects unknown values.

    SQL to verify:
        UPDATE pipeline_runs SET status = 'cancelled' WHERE id = '<run>';
        -- must raise check_violation.
    """
    pass


# ---------------------------------------------------------------------------
# pipeline_runs — partial unique index (one pending-commit run per draft)
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_partial_unique_idx_blocks_second_pending_commit_run_for_same_release():
    """idx_pipeline_runs_one_pending_commit allows at most one row per
    snapshot_release_id WHERE status='success' AND committed_at IS NULL.

    SQL to verify:
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='success');
        -- committed_at defaults NULL → this is the first pending-commit run. OK.
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='success');
        -- second insert must raise unique_violation.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_partial_unique_idx_allows_running_status_runs_regardless_of_release():
    """Rows with status='running' are excluded from the partial index predicate,
    so multiple running rows for the same release_id are allowed.

    SQL to verify:
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='running');
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='running');
        -- both must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_partial_unique_idx_allows_committed_run_after_pending_commit_run():
    """A row with committed_at IS NOT NULL is excluded from the predicate, so a
    committed run and a new pending-commit run can coexist for the same release.

    SQL to verify:
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='success',
          committed_at=now());
        INSERT INTO pipeline_runs (..., snapshot_release_id='<rel>', status='success');
        -- committed_at=NULL on second row. Both must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_partial_unique_idx_allows_discarded_run_after_pending_commit_run():
    """A row with status='discarded' is excluded from the predicate, so discarding
    a run unblocks creating a new pending-commit run for the same release.

    SQL to verify:
        INSERT INTO pipeline_runs (..., status='success');   -- pending commit
        UPDATE pipeline_runs SET status='discarded' WHERE id = '<first-run>';
        INSERT INTO pipeline_runs (..., status='success');   -- new pending commit
        -- second insert must succeed after the first is discarded.
    """
    pass


# ---------------------------------------------------------------------------
# released_players — is_legend column invariants
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_released_players_is_legend_column_exists_with_false_default():
    """released_players.is_legend column exists as BOOLEAN NOT NULL DEFAULT false.

    SQL to verify:
        SELECT column_default, is_nullable
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='released_players'
          AND column_name='is_legend';
        -- Expect: column_default='false', is_nullable='NO'
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_released_players_is_legend_accepts_true():
    """is_legend can be explicitly set to true.

    SQL to verify:
        INSERT INTO released_players (..., is_legend=true);
        -- must succeed.
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_released_players_existing_rows_default_to_false():
    """Any existing rows (inserted before this migration) have is_legend=false,
    not NULL.

    SQL to verify:
        SELECT COUNT(*) FROM released_players WHERE is_legend IS NULL;
        -- Expect: 0
    """
    pass


# ---------------------------------------------------------------------------
# publish_snapshot_draft RPC — open-flags gate
# ---------------------------------------------------------------------------


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_raises_open_flags_not_acknowledged_when_flags_exist():
    """publish_snapshot_draft raises 'open_flags_not_acknowledged' when
    draft_skill_flags has unresolved rows and p_allow_open_flags=false.

    SQL to verify:
        -- Insert an unresolved flag row into draft_skill_flags.
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', false, false);
        -- Expect: ERROR containing 'open_flags_not_acknowledged'
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_proceeds_with_open_flags_when_override_true():
    """publish_snapshot_draft proceeds past the flags check when
    p_allow_open_flags=true, even if unresolved flags exist.

    SQL to verify:
        -- Insert an unresolved flag row into draft_skill_flags.
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', false, true);
        -- Expect: proceeds (may raise a different guard; must NOT raise open_flags)
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_raises_when_legend_missing_canonical_player():
    """publish_snapshot_draft raises 'legends_missing_canonical_player' if any
    row in public.legends has nba_api_id IS NULL or no matching row in
    public.canonical_players. Preflight prevents the INSERT from hitting a raw
    NOT NULL constraint violation on released_players.canonical_player_id.

    SQL to verify:
        -- Insert a legend with nba_api_id=NULL, then call:
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', true, true);
        -- Expect: ERROR containing 'legends_missing_canonical_player'
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_includes_legends_in_released_players():
    """After a successful publish, legends with composite draft_skill_profiles
    rows appear in released_players with is_legend=true.

    SQL to verify:
        -- Ensure at least one legend has a composite draft_skill_profiles row.
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', true, true);
        SELECT COUNT(*) FROM released_players
          WHERE snapshot_release_id='<draft-id>' AND is_legend=true;
        -- Expect: > 0
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_sets_is_legend_false_for_regular_players():
    """Regular players (non-legends) appear in released_players with
    is_legend=false after publish.

    SQL to verify:
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', true, true);
        SELECT COUNT(*) FROM released_players
          WHERE snapshot_release_id='<draft-id>' AND is_legend=false;
        -- Expect: equals count of 2025-26 players with canonical_players rows
    """
    pass


@pytest.mark.skip(reason="Requires live DB with M1 migrations applied (wire in M2)")
def test_publish_rpc_no_released_player_row_has_null_is_legend():
    """After publish, no released_players row has NULL in is_legend (column
    is NOT NULL, so this is a schema-level guarantee, but verify end-to-end).

    SQL to verify:
        SELECT public.publish_snapshot_draft('<draft-id>', 'label', true, true);
        SELECT COUNT(*) FROM released_players
          WHERE snapshot_release_id='<draft-id>' AND is_legend IS NULL;
        -- Expect: 0
    """
    pass
