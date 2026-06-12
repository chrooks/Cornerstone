-- =============================================================================
-- Extend pipeline_runs.pipeline_name CHECK to include 'composite_batch'.
--
-- The compositing batch (/api/composite/batch) ran synchronously and recorded
-- no pipeline_runs row, so it never surfaced in the draft Pipeline tab. We now
-- record a run row around the batch for visibility + audit trail, which needs
-- the new pipeline_name value to pass the CHECK constraint.
--
-- Additive + guard-wrapped for idempotence. No SECURITY DEFINER RPC touched.
-- =============================================================================

DO $$
BEGIN
  -- Postgres has no ADD CONSTRAINT IF NOT EXISTS for CHECK constraints, so we
  -- drop by name and re-add unconditionally (mirrors 20260527000001).
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
      'threshold_edit',
      'composite_batch'
    ));
