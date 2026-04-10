-- =============================================================================
-- add_legend_position.sql
-- Adds position column to the legends table.
-- =============================================================================

ALTER TABLE legends
  ADD COLUMN IF NOT EXISTS position text;
