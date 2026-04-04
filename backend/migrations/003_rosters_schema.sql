-- =============================================================================
-- 003_rosters_schema.sql
-- Roster persistence schema for the Cornerstone team builder.
-- Tables: rosters, roster_players
-- Includes: indexes, partial unique index, check constraints, updated_at trigger
-- =============================================================================


-- -----------------------------------------------------------------------------
-- rosters
-- One row per saved team configuration. Each roster belongs to a legend and
-- carries the cap ceiling that was active when the roster was created.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rosters (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  legend_id    uuid        NOT NULL REFERENCES legends (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  total_budget integer     NOT NULL,   -- total cap ceiling in dollars at time of creation
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of all rosters for a given legend, newest first
CREATE INDEX IF NOT EXISTS idx_rosters_legend_id ON rosters (legend_id);

-- Auto-update updated_at whenever any column changes on a roster row
CREATE TRIGGER trg_rosters_updated_at
  BEFORE UPDATE ON rosters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- roster_players
-- One row per slot in a roster.
--   Slot 1  → always the cornerstone (is_cornerstone = true, player_id = null)
--   Slots 2-8 → supporting players (is_cornerstone = false, player_id required)
--
-- Salary values are snapshots frozen at the time the player was added so
-- historical rosters stay intact even if real-world salaries change.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roster_players (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id        uuid        NOT NULL REFERENCES rosters (id) ON DELETE CASCADE,
  -- player_id is NULL for the cornerstone row; the legend is referenced via
  -- rosters.legend_id instead of duplicating it here
  player_id        uuid                 REFERENCES players (id) ON DELETE SET NULL,
  is_cornerstone   boolean     NOT NULL DEFAULT false,
  slot             integer     NOT NULL,   -- 1 through 8
  salary_snapshot  integer     NOT NULL,   -- cap hit in dollars at time of addition
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- No two players may occupy the same slot on the same roster
  CONSTRAINT uq_roster_players_slot UNIQUE (roster_id, slot),

  -- Supporting players must have a player_id; only the cornerstone may have null
  CONSTRAINT chk_non_cornerstone_has_player
    CHECK (is_cornerstone = true OR player_id IS NOT NULL)
);

-- Fast lookup of all slots for a given roster (used heavily in read paths)
CREATE INDEX IF NOT EXISTS idx_roster_players_roster_id ON roster_players (roster_id);

-- Partial unique index: the same player cannot appear twice on the same roster.
-- WHERE clause excludes cornerstone rows (player_id IS NULL) which are
-- not deduplicated by player identity — standard UNIQUE constraint does not
-- support a WHERE predicate, so we use CREATE UNIQUE INDEX instead.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_roster_players_no_duplicates
  ON roster_players (roster_id, player_id)
  WHERE player_id IS NOT NULL;
