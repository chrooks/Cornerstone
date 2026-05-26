-- =============================================================================
-- M1 — Update publish_snapshot_draft RPC.
--
-- Changes from the version applied in 20260527000000_rename_working_tables.sql:
--
--   8a. Add p_allow_open_flags BOOLEAN DEFAULT false parameter.
--   8b. Add open-flags count check; raise 'open_flags_not_acknowledged' if
--       unresolved flags exist and override is not set.
--   8c. Include legends in the INSERT INTO released_players:
--       - Add a second UNION ALL branch for legend rows.
--       - Populate the new is_legend column on each inserted row.
--
-- Base body: copied from 20260527000000_rename_working_tables.sql and
-- extended in place. CREATE OR REPLACE is safe to re-apply.
--
-- NOTE on legend identity in draft_skill_profiles:
--   Legend profiles are stored with player_id = NULL and legend_id = <legends.id>.
--   The regular-player branch filters WHERE is_legend = false (player_id IS NOT NULL).
--   The legend branch filters WHERE is_legend = true, joining on legend_id = l.id.
--
-- NOTE on legends.salary:
--   The legends table has no salary column (salary is a Lab/RuleSet concern, not
--   a biographical fact for all-time greats). released_players.salary is NOT NULL
--   DEFAULT 0, so we insert 0 for all legend rows. The Lab's RuleSet salary config
--   for legends is handled separately (outside this publish path).
--
-- NOTE on missing-composite check:
--   The count LEFT JOINs against public.players (is_legend = false path), so
--   legends (which have no row in public.players) are correctly excluded.
-- =============================================================================

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
  -- publish or reactivate. The partial unique index `idx_snapshot_releases_one_active`
  -- enforces the at-most-one-active invariant as a backstop, but two concurrent
  -- sessions could both pass their per-row FOR UPDATE on different targets and
  -- then race on the deactivate -> activate swap. A transaction-scoped advisory
  -- lock collapses that window. Mirrors the lock in reactivate_snapshot_release.
  PERFORM pg_advisory_xact_lock(hashtext('snapshot_releases.active_swap'));

  -- Lock the draft row to prevent concurrent publishes.
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status IN ('draft', 'review')
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found_or_not_in_draft_state';
  END IF;

  -- -------------------------------------------------------------------------
  -- Missing-composite check (regular players only — legends excluded by the
  -- LEFT JOIN against public.players; see NOTE above).
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- -------------------------------------------------------------------------
  -- Open-flags check.
  -- A flag is "open" when resolution IS NULL. The Python backend only writes
  -- NULL (unresolved) or a concrete resolution value ('trust_stats',
  -- 'trust_claude', 'manual_override'); the string literal 'unresolved' is
  -- never written, so it is intentionally not checked here.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags
  WHERE resolution IS NULL;

  IF v_open_flags > 0 AND NOT p_allow_open_flags THEN
    RAISE EXCEPTION 'open_flags_not_acknowledged: % flags', v_open_flags;
  END IF;

  -- -------------------------------------------------------------------------
  -- Legend canonical-link check.
  -- released_players.canonical_player_id is NOT NULL. Legends with
  -- legends.nba_api_id IS NULL (or unmatched in canonical_players) would
  -- violate the constraint mid-INSERT and abort the publish transaction.
  -- Preflight here so the failure is named and actionable rather than a raw
  -- constraint violation surfaced from the INSERT.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*) INTO v_legends_no_canonical
  FROM public.legends l
  LEFT JOIN public.canonical_players cp ON cp.nba_api_id = l.nba_api_id
  WHERE cp.id IS NULL;

  IF v_legends_no_canonical > 0 THEN
    RAISE EXCEPTION 'legends_missing_canonical_player: % legends', v_legends_no_canonical;
  END IF;

  -- -------------------------------------------------------------------------
  -- Freeze into released_players: regular players UNION ALL legends.
  --
  -- Branch 1 — regular players (is_legend = false, joins public.players).
  -- Branch 2 — legends (is_legend = true, joins public.legends via legend_id).
  --
  -- DISTINCT ON (player_id) / DISTINCT ON (legend_id) picks the most recent
  -- composite profile per entity when duplicates exist.
  -- -------------------------------------------------------------------------
  WITH regular_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  ),
  legend_profiles AS (
    SELECT DISTINCT ON (legend_id) id, legend_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = true
    ORDER BY legend_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
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

  -- Branch 2: legends (salary = 0; see NOTE above)
  SELECT
    p_draft_id,
    cp.id,
    NULL,                    -- source_player_id: no row in public.players
    lp.id,
    '2025-26',               -- stat_season: pinned to active season at publish time
    l.name,
    l.team,
    l.position,
    0,                       -- salary: legends have no salary column
    COALESCE(lp.profile, '{}'::jsonb),
    true
  FROM public.legends l
  JOIN public.canonical_players cp ON cp.nba_api_id = l.nba_api_id
  LEFT JOIN legend_profiles lp ON lp.legend_id = l.id;

  -- Deactivate the current active release.
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

-- =============================================================================
-- Verification queries (run after apply to confirm invariants):
--
-- 1. RPC signature includes new parameter:
--      SELECT pg_get_function_arguments('public.publish_snapshot_draft'::regproc);
--      -- Expect: 'p_draft_id uuid, p_label text,
--      --          p_allow_missing_composite boolean, p_allow_open_flags boolean'
--
-- 2. Open-flags gate fires when flags exist and override not set:
--      -- Insert an unresolved row into draft_skill_flags, then call:
--      SELECT public.publish_snapshot_draft('<draft-id>', 'test', false, false);
--      -- Expect: ERROR: open_flags_not_acknowledged: N flags
--
-- 3. Override bypasses the open-flags gate:
--      SELECT public.publish_snapshot_draft('<draft-id>', 'test', false, true);
--      -- Expect: proceeds past the flags check (may hit other guards)
--
-- 4. After a successful publish, legends appear in released_players:
--      SELECT COUNT(*) FROM released_players
--      WHERE snapshot_release_id = '<published-id>' AND is_legend = true;
--      -- Expect: equals the count of legends with a composite draft_skill_profiles row
--
-- 5. Regular players retain is_legend = false:
--      SELECT COUNT(*) FROM released_players
--      WHERE snapshot_release_id = '<published-id>' AND is_legend = false;
--      -- Expect: equals the count of 2025-26 players with canonical_players rows
--
-- 6. No released_players row has is_legend = NULL:
--      SELECT COUNT(*) FROM released_players WHERE is_legend IS NULL;
--      -- Expect: 0 (column is NOT NULL)
-- =============================================================================
