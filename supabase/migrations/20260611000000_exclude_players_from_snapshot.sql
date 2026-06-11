-- =============================================================================
-- Exclude fringe players from Snapshot Releases.
--
-- Adds players.excluded_from_snapshot (global flag). An excluded player is:
--   1. skipped by the publish freeze — never written to released_players, so
--      never appears in a published release or the Lab pool, and
--   2. dropped from the missing-composite gate — fringe players with no
--      composite profile no longer block a publish.
--
-- Additive + reversible: the column defaults false (no behavior change until a
-- player is explicitly excluded). The RPC is replaced via CREATE OR REPLACE on
-- the existing 5-arg signature, preserving its ACL; the lockdown block is
-- re-stated explicitly per docs/agents/migration-conventions.md.
-- =============================================================================

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS excluded_from_snapshot boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.players.excluded_from_snapshot IS
  'When true, the player is skipped by the publish freeze and the missing-composite gate. Global, reversible. Set via the admin exclude controls in the draft workspace.';

-- Partial index: the publish freeze and pool reads filter on the (rare) excluded set.
CREATE INDEX IF NOT EXISTS idx_players_excluded_from_snapshot
  ON public.players (excluded_from_snapshot)
  WHERE excluded_from_snapshot = true;

CREATE OR REPLACE FUNCTION public.publish_snapshot_draft(
  p_draft_id                UUID,
  p_label                   TEXT,
  p_allow_missing_composite BOOLEAN DEFAULT false,
  p_allow_open_flags        BOOLEAN DEFAULT false,
  p_acknowledged_open_flags INTEGER DEFAULT NULL
)
RETURNS public.snapshot_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_release             public.snapshot_releases;
  v_season              TEXT;
  v_missing_composite   INTEGER;
  v_open_flags          INTEGER;
  v_legends_no_canonical INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('snapshot_releases.active_swap'));

  -- Issue #67: publish only from review.
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status = 'review'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_in_review_state';
  END IF;

  v_season := v_release.season;
  IF v_season IS NULL OR btrim(v_season) = '' THEN
    RAISE EXCEPTION 'season_missing';
  END IF;

  -- Missing-composite check (regular players only — legends excluded; excluded
  -- players dropped so fringe rows can't block a publish).
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = v_season
    AND NOT p.excluded_from_snapshot
    AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Open-flags count (authoritative, under the advisory lock).
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags f
  JOIN public.draft_skill_profiles sp ON sp.id = f.skill_profile_id
  WHERE f.resolution IS NULL
    AND sp.season = v_season
    AND sp.source = 'composite';

  IF v_open_flags > 0 AND NOT p_allow_open_flags THEN
    RAISE EXCEPTION 'open_flags_not_acknowledged: % flags', v_open_flags;
  END IF;

  -- Issue #71: count-pin the override.
  IF p_allow_open_flags
     AND p_acknowledged_open_flags IS NOT NULL
     AND v_open_flags > p_acknowledged_open_flags THEN
    RAISE EXCEPTION 'open_flags_changed: live=% acknowledged=%',
      v_open_flags, p_acknowledged_open_flags;
  END IF;

  IF p_allow_open_flags AND v_open_flags > 0 THEN
    RAISE LOG 'publish_snapshot_draft: override bypassed % open flag(s) (acknowledged=%) for draft %',
      v_open_flags, p_acknowledged_open_flags, p_draft_id;
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
  WITH regular_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  ),
  legend_profiles AS (
    SELECT DISTINCT ON (legend_id) id, legend_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'manual' AND is_legend = true
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
  WHERE p.season = v_season
    AND NOT p.excluded_from_snapshot

  UNION ALL

  SELECT
    p_draft_id,
    cp.id,
    NULL,
    lp.id,
    v_season,
    l.name,
    l.team,
    l.position,
    0,
    COALESCE(lp.profile, '{}'::jsonb),
    true
  FROM public.legends l
  JOIN public.canonical_players cp ON cp.nba_api_id = l.nba_api_id
  LEFT JOIN legend_profiles lp ON lp.legend_id = l.id;

  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

  UPDATE public.snapshot_releases
    SET
      status                    = 'published',
      is_active                 = true,
      label                     = p_label,
      published_at              = now(),
      data_cutoff_at            = now(),
      published_with_open_flags = v_open_flags
    WHERE id = p_draft_id
    RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;

-- SECURITY DEFINER lockdown (docs/agents/migration-conventions.md).
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean, integer) TO service_role;
COMMENT ON FUNCTION public.publish_snapshot_draft(uuid, text, boolean, boolean, integer) IS
  'Publish a draft Snapshot Release: validate gates, freeze released_players (skipping excluded_from_snapshot players), swap active. SECURITY DEFINER; executable only by service_role.';

-- =============================================================================
-- Verification after apply:
--   1. Excluding a player (excluded_from_snapshot=true) drops them from the
--      missing-composite count and from the frozen released_players set.
--   2. A draft that only had missing-composite fringe players, all excluded,
--      publishes without p_allow_missing_composite.
--   3. anon/authenticated still cannot EXECUTE the 5-arg signature.
-- =============================================================================
