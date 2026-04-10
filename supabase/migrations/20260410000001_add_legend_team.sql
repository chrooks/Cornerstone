-- =============================================================================
-- add_legend_team.sql
-- Adds a team column to legends for their primary historical franchise.
-- =============================================================================

ALTER TABLE legends
  ADD COLUMN IF NOT EXISTS team text;
