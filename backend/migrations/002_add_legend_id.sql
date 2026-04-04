-- =============================================================================
-- 002_add_legend_id.sql
-- Adds legend_id FK column to skill_profiles so legend skill profiles can be
-- linked back to their legend row without overloading the player_id column.
-- =============================================================================

-- Add legend_id column (nullable FK → legends.id, CASCADE on delete)
ALTER TABLE skill_profiles
  ADD COLUMN IF NOT EXISTS legend_id uuid REFERENCES legends (id) ON DELETE CASCADE;

-- Index for fast lookups by legend
CREATE INDEX IF NOT EXISTS idx_skill_profiles_legend_id ON skill_profiles (legend_id);

-- Unique partial index: one manual profile per legend
-- Allows upsert logic to reliably find the existing row for a given legend
CREATE UNIQUE INDEX IF NOT EXISTS uidx_skill_profiles_legend_manual
  ON skill_profiles (legend_id)
  WHERE (legend_id IS NOT NULL AND source = 'manual');
