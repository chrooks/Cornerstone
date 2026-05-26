-- M2: Add params JSONB column to pipeline_runs for threshold_edit run metadata.
-- threshold_edit runs store the proposed thresholds in this column so that
-- commit.py can retrieve them when committing into draft_skill_thresholds.

ALTER TABLE public.pipeline_runs
  ADD COLUMN IF NOT EXISTS params JSONB;

COMMENT ON COLUMN public.pipeline_runs.params IS
  'Optional run-specific metadata JSONB. threshold_edit runs store proposed thresholds here.';
