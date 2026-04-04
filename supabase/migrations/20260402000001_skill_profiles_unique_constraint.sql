-- =============================================================================
-- 20260402000001_skill_profiles_unique_constraint.sql
--
-- Adds a unique constraint on skill_profiles(player_id, season, source).
-- This constraint is required by the upsert in skill_mapping_service.py
-- (on_conflict="player_id,season,source") and compositing.py.
--
-- Step 1: Remove any duplicate rows first (keep most recently updated).
--         Duplicates can accumulate if the pipeline was run multiple times
--         without the constraint in place.
-- Step 2: Add the unique constraint.
-- =============================================================================

-- Remove duplicates — keep the row with the latest updated_at per key group.
-- Rows with player_id IS NULL (legends) are excluded from dedup since the
-- constraint is NULLS NOT DISTINCT-safe on Postgres 15+; older versions treat
-- each NULL as distinct so duplicates among legend rows are harmless.
DELETE FROM skill_profiles
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY player_id, season, source
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
            ) AS rn
        FROM skill_profiles
        WHERE player_id IS NOT NULL
    ) ranked
    WHERE rn > 1
);

-- Add the unique constraint that the upsert relies on.
ALTER TABLE skill_profiles
    ADD CONSTRAINT skill_profiles_player_id_season_source_key
    UNIQUE (player_id, season, source);
