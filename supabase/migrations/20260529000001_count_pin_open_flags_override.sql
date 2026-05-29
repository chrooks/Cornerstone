-- =============================================================================
-- Issue #71: count-pin the open-flags publish override.
--
-- Problem (surfaced by the M6 review fan-out):
--   The open-flags override is a blanket "publish anyway". The publish dialog
--   shows an open-flags count read a moment earlier; between that read and the
--   actual publish, flags can be added (by a pipeline run or another admin). The
--   publish then freezes the Release skipping however many flags exist at commit
--   time — which can differ from both what the admin saw and what the audit log
--   recorded. Three numbers (UI count, audit count, count actually bypassed) can
--   all disagree. Classic time-of-check vs time-of-use race.
--
-- Fix:
--   Add p_acknowledged_open_flags. When the override is used, the RPC re-counts
--   open flags under its row locks and REFUSES (open_flags_changed) if the live
--   count exceeds what the admin acknowledged. The RPC logs its own authoritative
--   count (RAISE LOG) so the audit record is the count actually bypassed, not a
--   separate pre-read. This collapses all three numbers into one source of truth
--   and bounds the bypass to what the admin actually reviewed.
--
-- Signature change: adding a parameter creates a NEW overload. The old 4-arg
--   form would then be ambiguous with the 5-arg form (which has a DEFAULT) when
--   called with 4 args, so we DROP the 4-arg overload first (same dance as
--   20260527000011_drop_stale_publish_snapshot_draft_overload.sql).
--
-- Everything else (advisory lock, the issue-#67 review-state guard, missing-
-- composite check, current-season open-flags scope, legend canonical preflight,
-- freeze CTEs, is_active swap) is preserved verbatim from 20260529000000.
--
-- ACL: the DROP removes the old grants with the old function; the new function
-- is locked down below with explicit REVOKE/GRANT (it is a distinct signature,
-- so it does not inherit 20260527000010's grants).
-- =============================================================================

DROP FUNCTION IF EXISTS public.publish_snapshot_draft(UUID, TEXT, BOOLEAN, BOOLEAN);

-- secdef-lint: allow-public reason=locked-down-below-in-this-migration
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

  -- Open-flags count (authoritative, under the advisory lock): scoped to
  -- current-season composite Skill Profiles so it matches the Review queue
  -- (review.py) and the validator preflight.
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags f
  JOIN public.draft_skill_profiles sp ON sp.id = f.skill_profile_id
  WHERE f.resolution IS NULL
    AND sp.season = '2025-26'
    AND sp.source = 'composite';

  -- No override: any open flag is a hard block (unchanged).
  IF v_open_flags > 0 AND NOT p_allow_open_flags THEN
    RAISE EXCEPTION 'open_flags_not_acknowledged: % flags', v_open_flags;
  END IF;

  -- Issue #71: count-pin the override. If the admin acknowledged a specific
  -- count and MORE open flags exist now than they reviewed, refuse so they must
  -- re-confirm against the current count. (acknowledged IS NULL => legacy/no
  -- pin; the override still works but is unbounded — the API always sends a
  -- count, so NULL only happens for direct callers.)
  IF p_allow_open_flags
     AND p_acknowledged_open_flags IS NOT NULL
     AND v_open_flags > p_acknowledged_open_flags THEN
    RAISE EXCEPTION 'open_flags_changed: live=% acknowledged=%',
      v_open_flags, p_acknowledged_open_flags;
  END IF;

  -- Authoritative audit: record the count actually bypassed by the override.
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

-- Lock the new (5-arg) signature down: service_role only.
REVOKE EXECUTE ON FUNCTION
  public.publish_snapshot_draft(UUID, TEXT, BOOLEAN, BOOLEAN, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.publish_snapshot_draft(UUID, TEXT, BOOLEAN, BOOLEAN, INTEGER)
  TO service_role;

-- =============================================================================
-- Verification after apply:
--   1. Override with p_acknowledged_open_flags >= live count -> publishes.
--   2. Override with p_acknowledged_open_flags < live count  -> ERROR
--        open_flags_changed: live=X acknowledged=Y
--   3. No override, open flags present -> ERROR open_flags_not_acknowledged
--      (unchanged).
--   4. anon/authenticated cannot EXECUTE the new 5-arg signature.
-- =============================================================================
