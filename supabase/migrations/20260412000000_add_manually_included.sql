-- Add manually_included flag to players table.
-- When true, the player bypasses the min_mpg filter in the bulk endpoint
-- so injured/inactive players can be manually added to the player pool.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS manually_included boolean NOT NULL DEFAULT false;
