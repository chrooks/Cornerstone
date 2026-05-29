-- =============================================================================
-- Issue #67: publish_snapshot_draft must require status = 'review' (not draft).
--
-- Defect (caught by the M4 / PR #66 codex adversarial review fanout):
--   publish_snapshot_draft selected the draft row with
--     WHERE id = p_draft_id AND status IN ('draft', 'review')
--   and published unconditionally. The product Invariant is "publish only from
--   review" — the draft -> review step is the forcing function that gates a
--   release on a deliberate review pass.
--
-- Race / authorization path the loose guard allowed:
--   1. Admin A moves the draft to review and opens the PublishModal.
--   2. Admin B clicks "Back to draft" (legitimately, e.g. to fix a typo).
--   3. Admin A submits PublishModal. The RPC accepted the now-draft status and
--      published a Release that was never in review.
--   PR #66 added a frontend guard (the modal closes when status flips away from
--   review), but the backend RPC is the authoritative Boundary: any direct API
--   caller (or future Surface) could still publish a draft-state Release.
--
-- Fix: tighten the status guard to status = 'review' and raise the more precise
--   'draft_not_in_review_state' when no review-state row matches. Everything else
--   (advisory lock, missing-composite check, current-season open-flags scope from
--   20260527000013, legend canonical-link preflight, freeze CTEs, is_active swap)
--   is preserved verbatim via CREATE OR REPLACE.
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

  -- Issue #67: publish only from review. A draft-state row is rejected so the
  -- review step cannot be skipped, even by a direct RPC caller.
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status = 'review'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_in_review_state';
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
--   1. Seed a snapshot_releases row with status='draft', then publish:
--        -- Expect: ERROR draft_not_in_review_state (no freeze, no is_active swap).
--   2. Move that row to status='review', then publish (with the usual gates
--      satisfied):
--        -- Expect: success; released_players frozen, is_active flips.
--   3. Publish with a non-existent draft_id:
--        -- Expect: ERROR draft_not_in_review_state.
-- =============================================================================
