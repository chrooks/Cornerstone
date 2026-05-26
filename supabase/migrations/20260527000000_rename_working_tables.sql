-- =============================================================================
-- Rename working tables for draft/released clarity (prep for issue #7).
--
-- Under Model Y, the "live" calibration tables ARE the active draft's working
-- area, and the snapshot_players table is the frozen released read source.
-- The current names misled the design process. This migration renames:
--
--   skill_profiles    -> draft_skill_profiles
--   skill_flags       -> draft_skill_flags
--   skill_thresholds  -> draft_skill_thresholds
--   snapshot_players  -> released_players
--
-- Indexes and triggers are renamed for clarity. Functions that text-reference
-- the old table names are recreated against the new names (Postgres function
-- bodies are stored as text and do not auto-resolve to the new table).
--
-- Guarded with DO blocks so a partially-applied state will not error.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table renames
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'skill_profiles') THEN
    ALTER TABLE public.skill_profiles RENAME TO draft_skill_profiles;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'skill_flags') THEN
    ALTER TABLE public.skill_flags RENAME TO draft_skill_flags;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'skill_thresholds') THEN
    ALTER TABLE public.skill_thresholds RENAME TO draft_skill_thresholds;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'snapshot_players') THEN
    ALTER TABLE public.snapshot_players RENAME TO released_players;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Index renames (clarity; not required for correctness)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_profiles_player_id') THEN
    ALTER INDEX public.idx_skill_profiles_player_id RENAME TO idx_draft_skill_profiles_player_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_profiles_is_legend') THEN
    ALTER INDEX public.idx_skill_profiles_is_legend RENAME TO idx_draft_skill_profiles_is_legend;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_profiles_review') THEN
    ALTER INDEX public.idx_skill_profiles_review RENAME TO idx_draft_skill_profiles_review;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_profiles_legend_id') THEN
    ALTER INDEX public.idx_skill_profiles_legend_id RENAME TO idx_draft_skill_profiles_legend_id;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_flags_profile_id') THEN
    ALTER INDEX public.idx_skill_flags_profile_id RENAME TO idx_draft_skill_flags_profile_id;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_skill_flags_unresolved') THEN
    ALTER INDEX public.idx_skill_flags_unresolved RENAME TO idx_draft_skill_flags_unresolved;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_snapshot_players_release_name') THEN
    ALTER INDEX public.idx_snapshot_players_release_name RENAME TO idx_released_players_release_name;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_snapshot_players_canonical') THEN
    ALTER INDEX public.idx_snapshot_players_canonical RENAME TO idx_released_players_canonical;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Constraint renames (uq_/chk_)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_snapshot_players_source_player') THEN
    ALTER TABLE public.released_players RENAME CONSTRAINT uq_snapshot_players_source_player TO uq_released_players_source_player;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_snapshot_players_salary') THEN
    ALTER TABLE public.released_players RENAME CONSTRAINT chk_snapshot_players_salary TO chk_released_players_salary;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Trigger renames
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_skill_profiles_updated_at' AND NOT tgisinternal) THEN
    ALTER TRIGGER trg_skill_profiles_updated_at ON public.draft_skill_profiles RENAME TO trg_draft_skill_profiles_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_skill_thresholds_updated_at' AND NOT tgisinternal) THEN
    ALTER TRIGGER trg_skill_thresholds_updated_at ON public.draft_skill_thresholds RENAME TO trg_draft_skill_thresholds_updated_at;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RLS policy renames (policy bodies don't reference table names by string,
-- but the policy name on snapshot_players reads as "snapshot players").
-- Recreate with new name for clarity.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'released_players'
      AND policyname = 'Anyone can read snapshot players'
  ) THEN
    ALTER POLICY "Anyone can read snapshot players" ON public.released_players RENAME TO "Anyone can read released players";
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Recreate functions that text-reference the old table names.
-- Bodies copied from 20260526000002_snapshot_publish_rpc_fix.sql with table
-- references swapped to the new names. No behavior change.
-- ---------------------------------------------------------------------------
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
  SELECT * INTO v_release
    FROM public.snapshot_releases
    WHERE id = p_draft_id AND status IN ('draft', 'review')
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found_or_not_in_draft_state';
  END IF;

  SELECT COUNT(*) INTO v_missing_composite
  FROM public.players p
  LEFT JOIN public.draft_skill_profiles sp
    ON sp.player_id = p.id AND sp.source = 'composite'
  WHERE p.season = '2025-26' AND sp.id IS NULL;

  IF v_missing_composite > 0 AND NOT p_allow_missing_composite THEN
    RAISE EXCEPTION 'missing_composite_not_acknowledged: % players', v_missing_composite;
  END IF;

  WITH composite_profiles AS (
    SELECT DISTINCT ON (player_id) id, player_id, profile
    FROM public.draft_skill_profiles
    WHERE source = 'composite' AND is_legend = false
    ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
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

  UPDATE public.snapshot_releases
    SET is_active = false
    WHERE is_active = true;

  UPDATE public.snapshot_releases
    SET
      status = 'published',
      is_active = true,
      label = p_label,
      published_at = now(),
      data_cutoff_at = now()
    WHERE id = p_draft_id
    RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_working_state_from_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_active_id UUID;
BEGIN
  SELECT id INTO v_active_id
    FROM public.snapshot_releases
    WHERE is_active = true
    LIMIT 1;

  IF v_active_id IS NULL THEN
    RAISE EXCEPTION 'no_active_snapshot_release';
  END IF;

  DELETE FROM public.draft_skill_profiles
    WHERE source = 'composite'
      AND season = '2025-26'
      AND is_legend = false;

  INSERT INTO public.draft_skill_profiles (player_id, season, source, profile, is_legend, created_at)
  SELECT
    sp.source_player_id,
    sp.stat_season,
    'composite',
    sp.skill_profile_snapshot,
    false,
    now()
  FROM public.released_players sp
  WHERE sp.snapshot_release_id = v_active_id
    AND sp.source_player_id IS NOT NULL;

  UPDATE public.players p
  SET
    salary   = sp.salary,
    team     = sp.team,
    position = sp.position
  FROM public.released_players sp
  WHERE sp.snapshot_release_id = v_active_id
    AND sp.source_player_id = p.id;
END;
$$;
