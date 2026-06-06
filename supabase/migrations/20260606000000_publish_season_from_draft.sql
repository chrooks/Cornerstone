-- =============================================================================
-- Issue #72: publish_snapshot_draft must freeze and gate against the draft's own
-- season, not a hardcoded '2025-26'.
--
-- Defect: every season-scoped clause in publish_snapshot_draft hardcoded the
--   literal '2025-26' — the regular-player freeze WHERE, the Legend freeze
--   stat_season, the missing-composite gate, and the open-flags gate. When the
--   2025-26 season ends and we publish a 2026-27 Release, the publish path would
--   still freeze and gate against last season. The whole point of a per-Release
--   season is that the freeze scope and the gate scope derive from one fact.
--
-- Fix: read the draft's own season into a single local, v_season, from the
--   snapshot_releases row being published, and use v_season in all four scopes.
--   A season_missing guard raises before any freeze when the season is NULL or
--   blank, so we never freeze an empty set. Binding scope to the row being frozen
--   makes it impossible for a caller to pass a season that disagrees with the
--   freeze — the format gate runs at the API boundary (backend/services/season.py)
--   before the draft season is ever set, so the RPC can trust the column.
--
-- Everything else is preserved verbatim from 20260529000002 (CREATE OR REPLACE on
-- the same 5-arg signature preserves that migration's REVOKE/GRANT lockdown):
--   the advisory lock, the issue-#67 review-state guard, the issue-#71 count-pin
--   override + RAISE LOG audit, the issue-#74 legend canonical preflight, the
--   freeze CTEs, the is_active swap, and the published_with_open_flags stamp.
--
-- Also corrects the stale "one row per Player per season" comment on
-- players.nba_api_id (recorded in docs/adr/0003): live identity is one row per
-- Player; season history lives in frozen Snapshot Releases, not stacked rows.
-- Migrations are immutable history, so the correction is applied here as a fresh
-- COMMENT ON COLUMN rather than by editing 20260325000000.
--
-- ACL: CREATE OR REPLACE on the existing 5-arg signature preserves the grants
-- (REVOKE from anon/authenticated/PUBLIC; GRANT to service_role) established in
-- 20260529000001_count_pin_open_flags_override.sql.
--
-- NOTE: this is the 6th verbatim copy of the freeze body across migrations — the
-- duplication is a real drift smell; consolidating into per-kind plpgsql helpers
-- is tracked in issue #58.
-- =============================================================================

COMMENT ON COLUMN public.players.nba_api_id IS
  'Globally unique NBA.com player id; one row per Player. Season history lives in Snapshot Releases (released_players), not in stacked per-season rows here.';

-- secdef-lint: allow-public reason=locked-down-in-20260529000001_count_pin_open_flags_override
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

  -- Issue #72: bind the freeze + gate scope to the draft's own season. One local
  -- replaces four hardcoded '2025-26' literals. The format gate runs at the API
  -- boundary before the season is ever set, so the column is trusted here; we
  -- still refuse a NULL/blank season rather than freeze an empty set.
  v_season := v_release.season;
  IF v_season IS NULL OR btrim(v_season) = '' THEN
    RAISE EXCEPTION 'season_missing';
  END IF;

  -- Missing-composite check (regular players only — legends excluded).
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = v_season AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Open-flags count (authoritative, under the advisory lock): current-season
  -- composite profiles, matching the Review queue + validator preflight.
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags f
  JOIN public.draft_skill_profiles sp ON sp.id = f.skill_profile_id
  WHERE f.resolution IS NULL
    AND sp.season = v_season
    AND sp.source = 'composite';

  IF v_open_flags > 0 AND NOT p_allow_open_flags THEN
    RAISE EXCEPTION 'open_flags_not_acknowledged: % flags', v_open_flags;
  END IF;

  -- Issue #71: count-pin the override — refuse if more flags exist now than the
  -- admin acknowledged.
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

-- =============================================================================
-- Verification after apply:
--   1. A draft in review with a valid season publishes; released_players rows all
--      carry stat_season = the draft's season (regular players from p.season,
--      legends from v_season).
--   2. A draft whose season is NULL or '' -> ERROR season_missing (no freeze,
--      no is_active swap).
--   3. The missing-composite and open-flags gates count only players/profiles in
--      the draft's season; a prior-season row neither blocks nor freezes.
--   4. anon/authenticated still cannot EXECUTE the 5-arg signature.
-- =============================================================================
