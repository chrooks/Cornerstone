-- Add committed_diff JSONB column to pipeline_runs.
--
-- The threshold-edit / skill-evaluation diff is recomputed live by comparing
-- staged rows against the current draft_skill_profiles. The commit RPC deletes
-- staged rows, so after a commit the live recomputation is always empty and the
-- draft Pipeline view shows "No tier changes in this run" even though the run
-- did change tiers. commit.py now snapshots the diff at commit time and stores
-- it here so committed runs can still render what they changed.
--
-- Nullable and additive: pre-existing committed runs keep committed_diff = NULL
-- and the diff endpoint falls back to the (empty) live recompute for them.

ALTER TABLE public.pipeline_runs
  ADD COLUMN IF NOT EXISTS committed_diff JSONB;

COMMENT ON COLUMN public.pipeline_runs.committed_diff IS
  'Snapshot of the staged-vs-current tier diff captured at commit time (RunDiff shape). '
  'Lets a committed run show what it changed after staged rows are deleted. NULL for '
  'legacy committed runs and for runs that have not been committed.';
