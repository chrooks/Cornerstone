-- M2 fix-forward 2: add status='success' guard to commit_pipeline_run.
--
-- The original CREATE in 20260527000007 omitted the status check. Without it,
-- any service-role caller can commit a running, error, or discarded pipeline run
-- as long as committed_at IS NULL. The architect blueprint specified the guard;
-- it was dropped during initial implementation.
--
-- This migration replaces the function body verbatim from 20260527000007, adding
-- only the status='success' guard block after the NOT FOUND check. The grant
-- statements are re-applied explicitly to ensure they survive the replacement.

CREATE OR REPLACE FUNCTION public.commit_pipeline_run(p_run_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run          public.pipeline_runs%ROWTYPE;
  v_skill_name   TEXT;
  v_thresholds   JSONB;
  v_committed_at TIMESTAMPTZ;
BEGIN
  -- Lock the run row to prevent concurrent commits
  SELECT * INTO v_run
    FROM public.pipeline_runs
    WHERE id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_found: %', p_run_id;
  END IF;

  -- Guard: only success runs may be committed.
  -- A running, error, or discarded run must not be committed — callers must
  -- wait for the run to finish (or discard it) before committing.
  IF v_run.status <> 'success' THEN
    RAISE EXCEPTION 'run_not_in_success_state: run % has status=%', p_run_id, v_run.status;
  END IF;

  IF v_run.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_committed: run % was committed at %', p_run_id, v_run.committed_at;
  END IF;

  -- 1. Upsert staged profile rows into draft_skill_profiles
  INSERT INTO public.draft_skill_profiles (player_id, season, source, profile, reviewed, review_required)
  SELECT
    prr.player_id,
    prr.season,
    prr.source,
    prr.profile,
    false,
    false
  FROM public.pipeline_run_results prr
  WHERE prr.run_id = p_run_id
  ON CONFLICT (player_id, season, source)
  DO UPDATE SET
    profile        = EXCLUDED.profile,
    reviewed       = false,
    review_required = false,
    updated_at     = now();

  -- 2. For threshold_edit runs: write proposed thresholds into draft_skill_thresholds
  IF v_run.pipeline_name = 'threshold_edit' THEN
    v_skill_name  := v_run.params->>'skill_name';
    v_thresholds  := v_run.params->'thresholds';

    IF v_skill_name IS NOT NULL AND v_thresholds IS NOT NULL THEN
      INSERT INTO public.draft_skill_thresholds (skill_name, thresholds)
      VALUES (v_skill_name, v_thresholds)
      ON CONFLICT (skill_name)
      DO UPDATE SET
        thresholds = EXCLUDED.thresholds,
        updated_at = now();
    END IF;
  END IF;

  -- 3. Mark the run committed and capture the canonical timestamp
  UPDATE public.pipeline_runs
    SET committed_at = now()
    WHERE id = p_run_id
    RETURNING committed_at INTO v_committed_at;

  -- 4. Delete staged rows (cleanup)
  DELETE FROM public.pipeline_run_results WHERE run_id = p_run_id;
  DELETE FROM public.pipeline_run_flag_results WHERE run_id = p_run_id;

  RETURN v_committed_at;
END;
$$;

COMMENT ON FUNCTION public.commit_pipeline_run(UUID) IS
  'Atomically commit staged pipeline_run_results into draft_skill_profiles (and '
  'draft_skill_thresholds for threshold_edit runs), then mark the run committed. '
  'Guards: run must exist, status must be ''success'', and committed_at must be NULL. '
  'Returns the canonical committed_at timestamp written to pipeline_runs.';

-- Re-apply the permission grants. CREATE OR REPLACE preserves existing grants
-- on Postgres, but Supabase may auto-grant anon/authenticated on function
-- replacement. Revoke explicitly (belt-and-suspenders with migration 20260527000008).
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) TO service_role;
