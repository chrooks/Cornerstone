-- =============================================================================
-- add_legend_physical_fields.sql
-- Adds physical attribute columns to the legends table so legends can be
-- displayed on the /players page with sortable bio stats.
-- =============================================================================

ALTER TABLE legends
  ADD COLUMN IF NOT EXISTS age        integer,
  ADD COLUMN IF NOT EXISTS height     text,
  ADD COLUMN IF NOT EXISTS weight     integer,
  ADD COLUMN IF NOT EXISTS peak_year  integer;
