-- =============================================================================
-- M1 — Staging tables + pipeline_runs extensions for draft-aware data flow.
--
-- Adds:
--   1. pipeline_run_results   — staged profile rows pre-commit
--   2. pipeline_run_flag_results — staged flag rows pre-commit
--   3. pipeline_runs.committed_at TIMESTAMPTZ column
--   4. pipeline_name CHECK extended: + 'skill_evaluation', 'threshold_edit'
--   5. status CHECK extended:        + 'discarded'
--   6. Partial unique idx:  at most one pending-commit run per draft
--
-- All structural changes are additive and guard-wrapped for idempotence.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4. Extend pipeline_name CHECK to include 'skill_evaluation', 'threshold_edit'
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Drop old constraint if it still uses the narrow value set.
  -- Postgres does not support ADD CONSTRAINT IF NOT EXISTS for CHECK constraints,
  -- so we drop by name and re-add unconditionally.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_runs_pipeline_name_check'
      AND conrelid = 'public.pipeline_runs'::regclass
  ) THEN
    ALTER TABLE public.pipeline_runs
      DROP CONSTRAINT pipeline_runs_pipeline_name_check;
  END IF;
END $$;

ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_pipeline_name_check
    CHECK (pipeline_name IN (
      'stat_fetch',
      'salary_scrape',
      'bio_team_sync',
      'skill_evaluation',
      'threshold_edit'
    ));

-- ---------------------------------------------------------------------------
-- 5. Extend status CHECK to include 'discarded'
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_runs_status_check'
      AND conrelid = 'public.pipeline_runs'::regclass
  ) THEN
    ALTER TABLE public.pipeline_runs
      DROP CONSTRAINT pipeline_runs_status_check;
  END IF;
END $$;

ALTER TABLE public.pipeline_runs
  ADD CONSTRAINT pipeline_runs_status_check
    CHECK (status IN ('running', 'success', 'error', 'discarded'));

-- ---------------------------------------------------------------------------
-- 3. Add committed_at column (NULL = not yet committed / not a staging run)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_runs
  ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 6. Partial unique index: at most one pending-commit run per draft release.
--    A run is "pending commit" when status='success' AND committed_at IS NULL.
--    Discarded, error, and committed runs are excluded from the predicate.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_one_pending_commit
  ON public.pipeline_runs (snapshot_release_id)
  WHERE status = 'success' AND committed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 1. Staging table for profile rows (mirrors draft_skill_profiles row shape)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_run_results (
  run_id     UUID NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  player_id  UUID NOT NULL,
  season     TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('stats', 'claude', 'composite', 'manual')),
  profile    JSONB NOT NULL,
  PRIMARY KEY (run_id, player_id, source)
);

-- Index to support per-player diff lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_run_results_player
  ON public.pipeline_run_results (player_id);

-- ---------------------------------------------------------------------------
-- 2. Staging table for flag rows (mirrors draft_skill_flags row shape)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pipeline_run_flag_results (
  run_id      UUID NOT NULL REFERENCES public.pipeline_runs(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL,
  skill_name  TEXT NOT NULL,
  flag_reason TEXT NOT NULL,
  claude_tier TEXT,
  stats_tier  TEXT,
  PRIMARY KEY (run_id, player_id, skill_name)
);

-- Index to support per-player diff lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_run_flag_results_player
  ON public.pipeline_run_flag_results (player_id);

-- ---------------------------------------------------------------------------
-- RLS for staging tables — service role only (mirrors pipeline_runs policy)
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_run_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pipeline_run_results'
      AND policyname = 'Service role manages pipeline_run_results'
  ) THEN
    CREATE POLICY "Service role manages pipeline_run_results"
      ON public.pipeline_run_results
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE public.pipeline_run_flag_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'pipeline_run_flag_results'
      AND policyname = 'Service role manages pipeline_run_flag_results'
  ) THEN
    CREATE POLICY "Service role manages pipeline_run_flag_results"
      ON public.pipeline_run_flag_results
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- =============================================================================
-- Verification queries (run after apply to confirm invariants):
--
-- 1. Partial unique idx — one pending-commit run per draft:
--      INSERT INTO pipeline_runs (snapshot_release_id, pipeline_name, scope, status)
--        VALUES ('some-release-uuid', 'skill_evaluation', 'bulk', 'success');
--      -- committed_at defaults to NULL, so this counts as "pending commit."
--      -- Inserting a second row with the same snapshot_release_id, status='success',
--      -- committed_at=NULL should raise a unique_violation.
--      -- Inserting with status='running' should succeed (excluded from predicate).
--      -- Inserting with committed_at=now() should succeed (excluded from predicate).
--
-- 2. pipeline_name CHECK:
--      INSERT INTO pipeline_runs (..., pipeline_name='skill_evaluation', ...) -- ok
--      INSERT INTO pipeline_runs (..., pipeline_name='threshold_edit', ...) -- ok
--      INSERT INTO pipeline_runs (..., pipeline_name='unknown', ...) -- must fail
--
-- 3. status CHECK:
--      UPDATE pipeline_runs SET status='discarded' WHERE id=... -- ok
--      UPDATE pipeline_runs SET status='bad_value' WHERE id=... -- must fail
--
-- 4. Staging table source CHECK:
--      INSERT INTO pipeline_run_results (run_id, player_id, season, source, profile)
--        VALUES (..., ..., '2025-26', 'composite', '{}') -- ok
--      INSERT INTO pipeline_run_results (run_id, player_id, season, source, profile)
--        VALUES (..., ..., '2025-26', 'unknown', '{}') -- must fail
--
-- 5. ON DELETE CASCADE from pipeline_runs -> pipeline_run_results:
--      DELETE FROM pipeline_runs WHERE id=... -- also deletes staging rows
-- =============================================================================
