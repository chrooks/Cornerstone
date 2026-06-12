-- Persist staged review flags on commit + set review_required.
--
-- Previously commit_pipeline_run upserted staged profiles with review_required
-- hardcoded false and DELETED pipeline_run_flag_results without ever writing them
-- to draft_skill_flags — so threshold_edit / skill_evaluation runs could never
-- surface a review item. This replaces the function (body from 20260527000009)
-- with two additions:
--
--   * review_required is computed per upserted row from whether the run staged a
--     flag for that (player_id, season).
--   * Staged flags are inserted into draft_skill_flags, linked to the upserted
--     composite profile (resolution NULL = open → counts against the publish gate),
--     replacing any prior flag for the same (skill_profile_id, skill_name).
--
-- NOTE: this means committing a run that produces Claude-disagreement flags will
-- block publish until those flags are resolved — the intended review-before-publish
-- behavior. High-confidence skills (e.g. Defensive Rebounding) never flag.
--
-- Return type unchanged (TIMESTAMPTZ) so CREATE OR REPLACE is valid. Grants are
-- re-applied explicitly (SECURITY DEFINER lockdown — service_role only).

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
  IF v_run.status <> 'success' THEN
    RAISE EXCEPTION 'run_not_in_success_state: run % has status=%', p_run_id, v_run.status;
  END IF;

  IF v_run.committed_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_committed: run % was committed at %', p_run_id, v_run.committed_at;
  END IF;

  -- 1. Upsert staged profile rows into draft_skill_profiles.
  --    review_required is true when this run staged a flag for the same
  --    (player_id, season) — flags are only ever staged for composite profiles.
  INSERT INTO public.draft_skill_profiles (player_id, season, source, profile, reviewed, review_required)
  SELECT
    prr.player_id,
    prr.season,
    prr.source,
    prr.profile,
    false,
    (prr.source = 'composite' AND EXISTS (
      SELECT 1 FROM public.pipeline_run_flag_results f
      WHERE f.run_id = p_run_id
        AND f.player_id = prr.player_id
        AND f.season = prr.season
    ))
  FROM public.pipeline_run_results prr
  WHERE prr.run_id = p_run_id
  ON CONFLICT (player_id, season, source)
  DO UPDATE SET
    profile         = EXCLUDED.profile,
    reviewed        = false,
    review_required = EXCLUDED.review_required,
    updated_at      = now();

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

  -- 3. Persist staged review flags into draft_skill_flags, linked to the
  --    just-upserted composite profile. Replace any prior flag for the same
  --    (skill_profile_id, skill_name) so re-commits don't accumulate duplicates.
  DELETE FROM public.draft_skill_flags df
  USING public.pipeline_run_flag_results f
  JOIN public.draft_skill_profiles dp
    ON dp.player_id = f.player_id
   AND dp.season    = f.season
   AND dp.source    = 'composite'
  WHERE f.run_id = p_run_id
    AND df.skill_profile_id = dp.id
    AND df.skill_name = f.skill_name;

  INSERT INTO public.draft_skill_flags
    (skill_profile_id, skill_name, stat_rating, claude_rating, flag_reason)
  SELECT
    dp.id,
    f.skill_name,
    COALESCE(f.stats_tier, 'None'),
    COALESCE(f.claude_tier, 'None'),
    f.flag_reason
  FROM public.pipeline_run_flag_results f
  JOIN public.draft_skill_profiles dp
    ON dp.player_id = f.player_id
   AND dp.season    = f.season
   AND dp.source    = 'composite'
  WHERE f.run_id = p_run_id;

  -- 4. Mark the run committed and capture the canonical timestamp
  UPDATE public.pipeline_runs
    SET committed_at = now()
    WHERE id = p_run_id
    RETURNING committed_at INTO v_committed_at;

  -- 5. Delete staged rows (cleanup)
  DELETE FROM public.pipeline_run_results WHERE run_id = p_run_id;
  DELETE FROM public.pipeline_run_flag_results WHERE run_id = p_run_id;

  RETURN v_committed_at;
END;
$$;

COMMENT ON FUNCTION public.commit_pipeline_run(UUID) IS
  'Atomically commit staged pipeline_run_results into draft_skill_profiles '
  '(review_required from staged flags), write draft_skill_thresholds for '
  'threshold_edit runs, persist staged flags into draft_skill_flags, then mark '
  'the run committed. Guards: run exists, status=''success'', committed_at NULL. '
  'SECURITY DEFINER; executable only by service_role.';

-- Re-apply the SECURITY DEFINER lockdown (service_role only).
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.commit_pipeline_run(UUID) TO service_role;
