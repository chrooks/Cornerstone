-- =============================================================================
-- Scope the one-pending-commit invariant to STAGED pipeline runs only.
--
-- Defect (found while testing M4 threshold editing):
--   idx_pipeline_runs_one_pending_commit (from 20260527000001) treated ANY
--   status='success' AND committed_at IS NULL run as "pending commit". But the
--   direct-write ingestion pipelines (stat_fetch, salary_scrape, bio_team_sync)
--   complete as success/uncommitted and are NEVER committed (they have no
--   staged results to commit). So the first ingestion run permanently occupied
--   the single pending-commit slot for the draft, which:
--     - made every subsequent threshold_edit run fail at completion with a raw
--       23505 unique-violation (the staged run could not flip to success), and
--     - would block publish via any_pending_commit().
--
-- Fix: only runs that stage results into pipeline_run_results require a commit.
--   Today that is skill_evaluation and threshold_edit (both go through
--   services/skill_engine/evaluation_only.py). Narrow the partial-unique index
--   to those kinds. Ingestion runs no longer participate in the invariant.
--
-- If a future pipeline_name starts staging results, add it to the predicate
-- here AND to runs_repo.any_pending_commit (kept in sync deliberately).
-- =============================================================================

DROP INDEX IF EXISTS public.idx_pipeline_runs_one_pending_commit;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_runs_one_pending_commit
  ON public.pipeline_runs (snapshot_release_id)
  WHERE status = 'success'
    AND committed_at IS NULL
    AND pipeline_name IN ('skill_evaluation', 'threshold_edit');
