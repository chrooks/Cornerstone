-- =============================================================================
-- Add unique constraint on anchor_players (player_id, skill_name).
-- This ensures one anchor entry per player per skill, enabling safe upserts
-- from the calibration UI without creating duplicate anchor records.
-- =============================================================================

ALTER TABLE anchor_players
  ADD CONSTRAINT anchor_players_player_skill_unique
  UNIQUE (player_id, skill_name);
