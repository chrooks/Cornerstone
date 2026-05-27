-- M2 fix-forward: harden commit_pipeline_run RPC.
--
-- Two changes:
--   1. CRITICAL: revoke EXECUTE from PUBLIC and grant only service_role.
--      The previous migration relied on Postgres' default of granting EXECUTE
--      to PUBLIC for SECURITY DEFINER functions, which exposes the RPC to any
--      Supabase anon or authenticated caller via POST /rest/v1/rpc/.
--   2. Return the canonical committed_at TIMESTAMPTZ instead of void so the
--      Python caller can read back the DB-side timestamp without a follow-up
--      SELECT (kills a per-request divergence between Python and Postgres now()).

-- DROP first because changing the return type from void → timestamptz is
-- incompatible with CREATE OR REPLACE in Postgres.
DROP FUNCTION IF EXISTS public.commit_pipeline_run(UUID);

CREATE FUNCTION public.commit_pipeline_run(p_run_id UUID)
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
  'Returns the canonical committed_at timestamp written to pipeline_runs.';

-- Restrict execution to service_role only.
-- Default Postgres grants EXECUTE to PUBLIC for SECURITY DEFINER functions —
-- which means any Supabase anon or authenticated user could call this via
-- POST /rest/v1/rpc/commit_pipeline_run. Revoke that and grant only service_role.
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) TO service_role;
