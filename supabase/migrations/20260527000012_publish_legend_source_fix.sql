-- =============================================================================
-- M3 follow-up: fix legend branch of publish_snapshot_draft RPC.
--
-- Defect (caught by codex adversarial review on PR #60):
--   The publish RPC's legend_profiles CTE filtered draft_skill_profiles by
--   source = 'composite' AND is_legend = true. Legend Skill Profiles are
--   written exclusively by the /admin/legends editor with source = 'manual'
--   (see backend/api/legends.py PUT /legends/<id>/skills, which upserts the
--   manual row). No 'composite' rows exist for legends, so every published
--   legend ended up with skill_profile_snapshot = '{}' in released_players.
--   After M3's Lab read pin (which routes Lab/legends reads at
--   backend/api/legends.py through released_players), the empty snapshots
--   would surface as "all skills unrated" for every legend.
--
-- Fix: legend CTE filter changes source = 'composite' -> source = 'manual'.
-- Regular-player branch unchanged (regular Players keep source = 'composite').
--
-- This is a CREATE OR REPLACE of the full body to keep the legend join,
-- canonical-link preflight, open-flags gate, missing-composite check, and
-- advisory-lock semantics intact.
--
-- The previously-granted ACL (REVOKE from anon/authenticated/PUBLIC; GRANT to
-- service_role) is preserved by CREATE OR REPLACE — Postgres does not reset
-- function grants when the body changes. The secdef-lint allow-public comment
-- mirrors the upstream copy in 20260527000003 and remains valid because the
-- function is still locked down via 20260527000010_secdef_rpc_lockdown.sql.
-- =============================================================================

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
  PERFORM pg_advisory_xact_lock(hashtext('snapshot_releases.active_swap'));

  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status IN ('draft', 'review')
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found_or_not_in_draft_state';
  END IF;

  -- Missing-composite check (regular players only — legends excluded).
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Open-flags check.
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
  WITH regular_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
  ),
  -- FIX (M3 follow-up): legend rows are written with source = 'manual' by the
  -- /admin/legends editor — never 'composite'. The prior 'composite' filter
  -- yielded zero rows for every legend, producing empty Skill Profile
  -- snapshots in released_players. Switch to 'manual'.
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
  WHERE p.season = '2025-26'

  UNION ALL

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

  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

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
-- Verification after apply:
--   1. Open any published Snapshot Release in production where legends exist.
--      SELECT COUNT(*) FROM released_players
--       WHERE snapshot_release_id = '<release-id>'
--         AND is_legend = true
--         AND skill_profile_snapshot != '{}'::jsonb;
--      -- Pre-fix: 0. Post-fix (after a fresh publish): matches the count of
--      -- legends with non-empty draft manual profiles.
--
--   2. Re-publish the current draft (or open a fresh one) and confirm
--      released_players legend rows now carry the manual ratings.
-- =============================================================================
