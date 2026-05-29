-- =============================================================================
-- M6 follow-up: scope the open-flags publish gate to current-season composite
-- Skill Profiles.
--
-- Defect (caught by review fan-out on the M6 publish-gate change):
--   publish_snapshot_draft counted open flags as
--     SELECT COUNT(*) FROM draft_skill_flags WHERE resolution IS NULL
--   with NO season/source filter. The Review queue (backend/api/review.py),
--   however, only surfaces unresolved flags hanging off CURRENT-SEASON composite
--   Skill Profiles. So a stale prior-season (or non-composite) unresolved flag
--   inflated the publish gate count to N>0 while the Review queue showed zero —
--   an admin who resolved everything visible was still blocked, with no row to
--   act on, and the "Blocked: N open flags" banner pointed at flags they could
--   not see. The only escape was the override, training admins to bypass the
--   gate (an Honest Signifier failure).
--
-- Fix: scope the v_open_flags count to draft_skill_flags joined to
--   draft_skill_profiles WHERE season = '2025-26' AND source = 'composite'.
--   This matches review.py exactly and the preflight count in
--   backend/services/snapshot_versions/validator.py, so the UI count, the Review
--   queue, and the hard gate now agree. Prior-season / non-composite flags no
--   longer block publish.
--
-- Everything else (legend source='manual' join from 20260527000012, the
-- canonical-link preflight, missing-composite check, freeze CTEs, and
-- advisory-lock semantics) is preserved verbatim via CREATE OR REPLACE.
--
-- Known, deliberately-deferred follow-up: allow_open_flags is still a blanket
-- (not count-pinned) bypass and the preflight count can race flag writes before
-- the RPC runs. Count-pinning the override is tracked separately.
--
-- ACL: CREATE OR REPLACE preserves the existing grants (REVOKE from
-- anon/authenticated/PUBLIC; GRANT to service_role) established in
-- 20260527000010_secdef_rpc_lockdown.sql. The secdef-lint allow-public comment
-- below mirrors the upstream copies and remains valid because the function is
-- still locked down by that migration.
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

  -- Open-flags check (M6 follow-up): scope to current-season composite Skill
  -- Profiles so the gate count matches the Review queue (review.py) and the
  -- validator preflight. A flag is "open" when resolution IS NULL; the Python
  -- backend only writes NULL (unresolved) or a concrete resolution value.
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags f
  JOIN public.draft_skill_profiles sp ON sp.id = f.skill_profile_id
  WHERE f.resolution IS NULL
    AND sp.season = '2025-26'
    AND sp.source = 'composite';

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
  -- Legend rows are written with source = 'manual' by the /admin/legends editor
  -- (see 20260527000012) — never 'composite'.
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
--   1. Seed an unresolved flag on a PRIOR-season (or non-composite) profile,
--      resolve all current-season composite flags, then publish:
--        -- Expect: success (prior-season flag does NOT block).
--   2. Seed an unresolved flag on a CURRENT-season composite profile, then
--      publish without p_allow_open_flags:
--        -- Expect: ERROR open_flags_not_acknowledged: 1 flags
--   3. GET /api/snapshots/drafts/<id>/validation open_flags must equal the
--      Review queue's unresolved count for the same draft.
-- =============================================================================
