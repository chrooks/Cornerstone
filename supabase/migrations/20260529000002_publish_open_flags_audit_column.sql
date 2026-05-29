-- =============================================================================
-- Issue #71 follow-up (review fan-out): make the bypassed open-flags count a
-- durable, queryable audit record.
--
-- Problem: 20260529000001 recorded the authoritative count only via RAISE LOG
--   (Postgres server log — ephemeral, not queryable, not joined to the Release).
--   The app-layer audit logged the *acknowledged* count, not the authoritative
--   one. So "the audit records the RPC's own authoritative count" was not met in
--   any durable form.
--
-- Fix: add snapshot_releases.published_with_open_flags and stamp the RPC's
--   authoritative v_open_flags onto the published row. The count is then frozen
--   on the immutable Release it describes — permanently answerable ("how many
--   open flags did release X freeze with?"). The RPC RETURNS the row, so the
--   Python layer logs the authoritative count post-success too.
--
-- NULL = legacy releases published before this column existed (unknown count).
-- 0    = published with no open flags bypassed.
-- N>0  = published via override, bypassing N current-season composite flags.
--
-- The RPC body is otherwise identical to 20260529000001 (CREATE OR REPLACE on
-- the same 5-arg signature preserves that migration's REVOKE/GRANT lockdown).
-- NOTE: this is the 5th verbatim copy of the freeze body across migrations — the
-- duplication is a real drift smell; consolidating into per-kind plpgsql helpers
-- is tracked in issue #58.
-- =============================================================================

ALTER TABLE public.snapshot_releases
  ADD COLUMN IF NOT EXISTS published_with_open_flags INTEGER;

COMMENT ON COLUMN public.snapshot_releases.published_with_open_flags IS
  'Authoritative count of current-season composite open flags this Release froze with (issue #71). NULL = published before the column existed.';

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

  -- Missing-composite check (regular players only — legends excluded).
  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite' AND sp.is_legend = false
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  -- Open-flags count (authoritative, under the advisory lock): current-season
  -- composite profiles, matching the Review queue + validator preflight.
  SELECT COUNT(*) INTO v_open_flags
  FROM public.draft_skill_flags f
  JOIN public.draft_skill_profiles sp ON sp.id = f.skill_profile_id
  WHERE f.resolution IS NULL
    AND sp.season = '2025-26'
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
--   1. A published Release row has published_with_open_flags set to the count it
--      froze with (0 when no override; N when overridden).
--   2. The RPC return row carries published_with_open_flags so the API can log
--      the authoritative count post-success.
-- =============================================================================
