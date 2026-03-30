-- =============================================================================
-- 20260326000000_add_player_physical_attributes.sql
-- Adds height, weight to players table.
-- Both come from nba_api PlayerIndex (bulk fetch, no extra API calls needed).
-- height stored as text to preserve the "6-7" format; weight as integer (lbs).
-- =============================================================================

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS height text,          -- e.g. "6-7"
  ADD COLUMN IF NOT EXISTS weight integer;        -- lbs, e.g. 210
