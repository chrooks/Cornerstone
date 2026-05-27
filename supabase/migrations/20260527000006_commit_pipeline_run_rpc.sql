-- M2: commit_pipeline_run(p_run_id UUID) RPC.
-- Atomically:
--   1. UPSERTs pipeline_run_results rows into draft_skill_profiles
--   2. UPSERTs pipeline_run_flag_results rows into draft_skill_flags
--   3. For threshold_edit runs: writes proposed thresholds from params into
--      draft_skill_thresholds for the affected skill(s)
--   4. Sets pipeline_runs.committed_at = now()
--   5. Deletes staged rows from both staging tables

-- secdef-lint: allow-public reason=hardened-in-20260527000007_commit_pipeline_run_rpc_hardening
CREATE OR REPLACE FUNCTION public.commit_pipeline_run(p_run_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run          public.pipeline_runs%ROWTYPE;
  v_skill_name   TEXT;
  v_thresholds   JSONB;
BEGIN
  -- Lock the run row to prevent concurrent commits
  SELECT * INTO v_run
    FROM public.pipeline_runs
    WHERE id = p_run_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'run_not_found: %', p_run_id;
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

  -- 3. Mark the run committed
  UPDATE public.pipeline_runs
    SET committed_at = now()
    WHERE id = p_run_id;

  -- 4. Delete staged rows (cleanup)
  DELETE FROM public.pipeline_run_results WHERE run_id = p_run_id;
  DELETE FROM public.pipeline_run_flag_results WHERE run_id = p_run_id;

END;
$$;

COMMENT ON FUNCTION public.commit_pipeline_run(UUID) IS
  'Atomically commit staged pipeline_run_results into draft_skill_profiles (and '
  'draft_skill_thresholds for threshold_edit runs), then mark the run committed.';
