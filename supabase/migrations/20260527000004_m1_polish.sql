-- =============================================================================
-- M1 polish — review-fanout follow-ups for PR #56.
--
-- Three concerns from the parallel review:
--
--   A. pipeline_run_flag_results was missing a `season` column. Profile staging
--      has season; flag staging silently dropped it. A multi-season
--      skill_evaluation run could collide on (run_id, player_id, skill_name)
--      and lose one season's flag. Fix while the table is empty.
--
--   B. The legends/staging Boundary was implicit. Add COMMENT ON TABLE on both
--      staging tables documenting that legend profile rows do NOT pass through
--      the pipeline_run_results path — legend ratings write directly to
--      draft_skill_profiles via the Legend editor.
--
--   C. publish_snapshot_draft's DISTINCT ON CTEs used
--      `ORDER BY player_id, updated_at DESC, created_at DESC` with no final
--      stable tiebreaker. If both timestamps are NULL on duplicate composite
--      rows, the pick is non-deterministic. Add `, id DESC` to both CTEs.
--
-- All changes are safe on a live linked project:
--   - pipeline_run_flag_results is empty (M2 hasn't shipped yet) so the
--     ADD COLUMN NOT NULL + PK swap is non-destructive.
--   - CREATE OR REPLACE on the function is replay-safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Add `season` to pipeline_run_flag_results and re-key the PK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.pipeline_run_flag_results
  ADD COLUMN IF NOT EXISTS season TEXT NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_run_flag_results_pkey'
      AND conrelid = 'public.pipeline_run_flag_results'::regclass
  ) THEN
    ALTER TABLE public.pipeline_run_flag_results
      DROP CONSTRAINT pipeline_run_flag_results_pkey;
  END IF;
END $$;

ALTER TABLE public.pipeline_run_flag_results
  ADD CONSTRAINT pipeline_run_flag_results_pkey
    PRIMARY KEY (run_id, player_id, skill_name, season);

-- ---------------------------------------------------------------------------
-- B. Document the staging Boundary on both staging tables.
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.pipeline_run_results IS
  'Staged profile rows for a pipeline_runs row, pre-commit. Boundary: only regular-player profile rows pass through staging. Legend profile rows (is_legend=true) write directly to draft_skill_profiles via the Legend editor (/admin/legends) and bypass this table. season NOT NULL reflects that constraint.';

COMMENT ON TABLE public.pipeline_run_flag_results IS
  'Staged flag rows for a pipeline_runs row, pre-commit. Boundary: legends do not produce flags, so no legend rows ever appear here. PK is (run_id, player_id, skill_name, season) so a multi-season skill_evaluation run does not collide.';

-- ---------------------------------------------------------------------------
-- C. publish_snapshot_draft: add stable id DESC tiebreaker to DISTINCT ON.
--    Full function body copied from 20260527000003 with the two ORDER BY
--    clauses extended. No other change.
-- ---------------------------------------------------------------------------
-- secdef-lint: allow-public reason=hardened-in-20260527000010_secdef_rpc_lockdown
CREATE OR REPLACE FUNCTION public.publish_snapshot_draft(
  p_draft_id                UUID,
  p_label                   TEXT,
  p_allow_missing_composite BOOLEAN DEFAULT false,
  p_allow_open_flags        BOOLEAN DEFAULT false
)
RETURNS public.snapshot_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_release             public.snapshot_releases;
  v_missing_composite   INTEGER;
  v_open_flags          INTEGER;
  v_legends_no_canonical INTEGER;
BEGIN
  -- Serialize the deactivate -> activate is_active flip against any concurrent
  -- publish or reactivate. Mirrors reactivate_snapshot_release.
  PERFORM pg_advisory_xact_lock(hashtext('snapshot_releases.active_swap'));

  -- Lock the draft row to prevent concurrent publishes.
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status IN ('draft', 'review')
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found_or_not_in_draft_state';
  END IF;

  -- Missing-composite check (regular players only).
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Open-flags check. resolution IS NULL means unresolved; the literal string
  -- 'unresolved' is never written by the backend and is intentionally not
  -- checked.
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags
  WHERE resolution IS NULL;

  IF v_open_flags > 0 AND NOT p_allow_open_flags THEN
    RAISE EXCEPTION 'open_flags_not_acknowledged: % flags', v_open_flags;
  END IF;

  -- Legend canonical-link preflight.
  SELECT COUNT(*) INTO v_legends_no_canonical
  FROM public.legends l
  LEFT JOIN public.canonical_players cp ON cp.nba_api_id = l.nba_api_id
  WHERE cp.id IS NULL;

  IF v_legends_no_canonical > 0 THEN
    RAISE EXCEPTION 'legends_missing_canonical_player: % legends', v_legends_no_canonical;
  END IF;

  -- Freeze into released_players: regular players UNION ALL legends.
  -- DISTINCT ON ordering: prefer most recent (updated_at, created_at), with
  -- `id DESC` as a final stable tiebreaker so duplicate composite rows with
  -- both timestamps NULL pick deterministically.
  WITH regular_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ),
  legend_profiles AS (
    SELECT DISTINCT ON (legend_id) id, legend_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = true
    ORDER BY legend_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  )
  INSERT INTO public.released_players (
    snapshot_release_id,
    canonical_player_id,
    source_player_id,
    source_skill_profile_id,
    stat_season,
    name,
    team,
    position,
    salary,
    skill_profile_snapshot,
    is_legend
  )
  -- Branch 1: regular players
  SELECT
    p_draft_id,
    cp.id,
    p.id,
    sp.id,
    p.season,
    p.name,
    p.team,
    p.position,
    COALESCE(p.salary, 0),
    COALESCE(sp.profile, '{}'::jsonb),
    false
  FROM public.players p
  JOIN public.canonical_players cp ON cp.nba_api_id = p.nba_api_id
  LEFT JOIN regular_profiles sp ON sp.player_id = p.id
  WHERE p.season = '2025-26'

  UNION ALL

  -- Branch 2: legends
  SELECT
    p_draft_id,
    cp.id,
    NULL,
    lp.id,
    '2025-26',
    l.name,
    l.team,
    l.position,
    0,
    COALESCE(lp.profile, '{}'::jsonb),
    true
  FROM public.legends l
  JOIN public.canonical_players cp ON cp.nba_api_id = l.nba_api_id
  LEFT JOIN legend_profiles lp ON lp.legend_id = l.id;

  -- Deactivate current active release.
  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

  -- Publish: flip status, assign label, record timestamps.
  UPDATE public.snapshot_releases
    SET
      status         = 'published',
      is_active      = true,
      label          = p_label,
      published_at   = now(),
      data_cutoff_at = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;
