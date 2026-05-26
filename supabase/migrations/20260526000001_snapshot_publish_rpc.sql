-- Snapshot publish and reset RPCs.

-- publish_snapshot_draft: atomically freezes the draft into snapshot_players,
-- flips is_active, and returns the new published row.
CREATE OR REPLACE FUNCTION public.publish_snapshot_draft(
  p_draft_id UUID,
  p_label TEXT,
  p_allow_missing_composite BOOLEAN DEFAULT false
)
RETURNS public.snapshot_releases
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_release public.snapshot_releases;
  v_missing_composite INTEGER;
BEGIN
  -- Lock the draft row to prevent concurrent publishes
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status IN ('draft', 'review')
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found_or_not_in_draft_state';
  END IF;

  -- Count players in the current active season missing a composite profile
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite'
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Freeze live state into snapshot_players for this draft
  -- Mirrors the seed SQL in 20260511000000_real_rulesets_saved_teams_domain.sql
  WITH composite_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  )
  INSERT INTO public.snapshot_players (
    snapshot_release_id,
    canonical_player_id,
    source_player_id,
    source_skill_profile_id,
    stat_season,
    name,
    team,
    position,
    salary,
    skill_profile_snapshot
  )
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
    COALESCE(sp.profile, '{}'::jsonb)
  FROM public.players p
  JOIN public.canonical_players cp ON cp.nba_api_id = p.nba_api_id
  LEFT JOIN composite_profiles sp ON sp.player_id = p.id
  WHERE p.season = '2025-26';

  -- Deactivate the current active release
  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

  -- Publish the draft: flip status, set is_active, assign label, record timestamps
  -- A-8: set data_cutoff_at = now() alongside published_at = now()
  UPDATE public.snapshot_releases
    SET
      status = 'published',
      is_active = true,
      label = p_label,
      published_at = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;

-- reset_working_state_from_active: rewrites live composite skill_profiles
-- and players salary/team/position from the active-published snapshot_players.
CREATE OR REPLACE FUNCTION public.reset_working_state_from_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_id UUID;
BEGIN
  -- Find the active snapshot release
  SELECT id INTO v_active_id
    FROM public.snapshot_releases
    WHERE is_active = true
    LIMIT 1;

  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'no_active_snapshot_release';
  END IF;

  -- Delete composite and stats skill_profiles for the active season
  -- (leaves 'claude' and 'manual' intact)
  DELETE FROM public.skill_profiles
    WHERE source IN ('composite', 'stats')
      AND season = '2025-26'
      AND is_legend = false;

  -- Re-insert composite skill_profiles from snapshot_players
  INSERT INTO public.skill_profiles (player_id, season, source, profile, is_legend, created_at)
  SELECT
    sp.source_player_id,
    sp.stat_season,
    'composite',
    sp.skill_profile_snapshot,
    false,
    now()
  FROM public.snapshot_players sp
  WHERE sp.snapshot_release_id = v_active_id
    AND sp.source_player_id IS NOT NULL;

  -- Update players salary/team/position from snapshot_players
  UPDATE public.players p
  SET
    salary   = sp.salary,
    team     = sp.team,
    position = sp.position
  FROM public.snapshot_players sp
  WHERE sp.snapshot_release_id = v_active_id
    AND sp.source_player_id = p.id;
END;
$$;
