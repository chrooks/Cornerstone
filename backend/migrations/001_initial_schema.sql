-- =============================================================================
-- 001_initial_schema.sql
-- Cornerstone initial database schema
-- Tables: players, player_stats, skill_profiles, skill_flags,
--         skill_thresholds, legends, anchor_players
-- Includes: indexes, updated_at triggers, seed data
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Shared trigger function: auto-update updated_at on row modification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- -----------------------------------------------------------------------------
-- players
-- One row per player per season. nba_api_id is the NBA.com canonical ID.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nba_api_id       integer UNIQUE NOT NULL,
  name             text NOT NULL,
  team             text,
  position         text,
  age              integer,
  games_played     integer,
  minutes_per_game numeric,
  season           text NOT NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_nba_api_id ON players (nba_api_id);
CREATE INDEX IF NOT EXISTS idx_players_season     ON players (season);

CREATE TRIGGER trg_players_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- player_stats
-- Stores the full raw stat blob fetched from nba_api for a given player/season.
-- One row per player per season fetch; multiple fetches are allowed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_stats (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid REFERENCES players (id) ON DELETE CASCADE,
  season     text NOT NULL,
  stats      jsonb NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_stats_player_id ON player_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_season    ON player_stats (season);


-- -----------------------------------------------------------------------------
-- skill_profiles
-- One row per player/season/source combination.
-- Legends have player_id = NULL and is_legend = true.
-- profile stores all 19 skill ratings as { skill_name: "None"|"Capable"|"Elite" }.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid REFERENCES players (id) ON DELETE CASCADE,
  season          text,
  is_legend       boolean DEFAULT false,
  profile         jsonb NOT NULL,
  source          text,          -- "composite" | "manual" | "claude" | "stats"
  review_required boolean DEFAULT false,
  reviewed        boolean DEFAULT false,
  reviewed_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_profiles_player_id ON skill_profiles (player_id);
CREATE INDEX IF NOT EXISTS idx_skill_profiles_is_legend ON skill_profiles (is_legend);
CREATE INDEX IF NOT EXISTS idx_skill_profiles_review    ON skill_profiles (review_required) WHERE review_required = true;

CREATE TRIGGER trg_skill_profiles_updated_at
  BEFORE UPDATE ON skill_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- skill_flags
-- One row per disagreement between the stats-based and Claude-based ratings.
-- Linked to the composite skill_profile that needs review.
-- Resolution is null until a reviewer acts on it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_flags (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_profile_id     uuid REFERENCES skill_profiles (id) ON DELETE CASCADE,
  skill_name           text NOT NULL,
  stat_rating          text NOT NULL,           -- None | Capable | Elite
  claude_rating        text NOT NULL,           -- None | Capable | Elite
  flag_reason          text NOT NULL,
  stat_values          jsonb,
  claude_justification text,
  resolution           text,                    -- trust_stats | trust_claude | manual_override
  resolved_value       text,                    -- None | Capable | Elite
  resolved_at          timestamptz,
  notes                text
);

CREATE INDEX IF NOT EXISTS idx_skill_flags_profile_id  ON skill_flags (skill_profile_id);
CREATE INDEX IF NOT EXISTS idx_skill_flags_unresolved  ON skill_flags (resolution) WHERE resolution IS NULL;


-- -----------------------------------------------------------------------------
-- skill_thresholds
-- One row per skill. Stores the Elite/Capable cutoff rules as a JSON blob
-- so they can be tuned via the calibration UI without a schema change.
-- Example thresholds shape:
-- { "Elite": { "metric": "ts_pct", "operator": ">=", "value": 0.60 },
--   "Capable": { "metric": "ts_pct", "operator": ">=", "value": 0.54 } }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skill_thresholds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name text UNIQUE NOT NULL,
  thresholds jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER trg_skill_thresholds_updated_at
  BEFORE UPDATE ON skill_thresholds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- legends
-- The 36 all-time greats who have no modern nba_api stats.
-- Skill profiles for legends are entered manually via the Legends Profile Builder.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legends (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  peak_era   text NOT NULL,
  notes      text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER trg_legends_updated_at
  BEFORE UPDATE ON legends
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- -----------------------------------------------------------------------------
-- anchor_players
-- A set of current players with known expected tier values for specific skills.
-- Used to calibrate and validate skill thresholds.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anchor_players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid REFERENCES players (id) ON DELETE CASCADE,
  skill_name    text NOT NULL,
  expected_tier text NOT NULL,   -- None | Capable | Elite
  notes         text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anchor_players_player_id  ON anchor_players (player_id);
CREATE INDEX IF NOT EXISTS idx_anchor_players_skill_name ON anchor_players (skill_name);


-- =============================================================================
-- SEED DATA
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Legends (36 all-time greats)
-- -----------------------------------------------------------------------------
INSERT INTO legends (name, peak_era) VALUES
  ('Michael Jordan',          'Early 90s'),
  ('LeBron James',            'Mid 2010s'),
  ('Kareem Abdul-Jabbar',     '70s'),
  ('Wilt Chamberlain',        'Mid 60s'),
  ('Bill Russell',            'Mid 60s'),
  ('Kobe Bryant',             'Mid 2000s'),
  ('Magic Johnson',           'Late 80s'),
  ('Larry Bird',              'Late 80s'),
  ('Tim Duncan',              'Early 2000s'),
  ('Shaquille O''Neal',       'Early 2000s'),
  ('Steph Curry',             'Mid-Late 2010s'),
  ('Kevin Durant',            'Mid-Late 2010s'),
  ('David Robinson',          'Mid 90s'),
  ('Hakeem Olajuwon',         'Mid 90s'),
  ('Kevin Garnett',           'Mid 2000s'),
  ('Allen Iverson',           'Early 2000s'),
  ('Jason Kidd',              'Early 2000s'),
  ('Steve Nash',              'Mid 2000s'),
  ('Dirk Nowitzki',           'Mid-Late 2000s'),
  ('Kawhi Leonard',           'Mid 2010s'),
  ('Scottie Pippen',          'Mid 90s'),
  ('Giannis Antetokounmpo',   'Early 2020s'),
  ('Julius Erving',           'Mid 70s'),
  ('Jerry West',              'Mid 60s'),
  ('Oscar Robertson',         'Mid 60s'),
  ('Charles Barkley',         'Peak'),
  ('Dwyane Wade',             'Peak'),
  ('Isiah Thomas',            'Peak'),
  ('Karl Malone',             'Peak'),
  ('James Harden',            'Peak'),
  ('Chris Paul',              'Peak'),
  ('Russell Westbrook',       'Peak'),
  ('Tracy McGrady',           'Peak'),
  ('Joel Embiid',             '2021'),
  ('Anthony Davis',           '2020'),
  ('Dwight Howard',           '2011')
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------------------------
-- Skill Thresholds (19 skills — placeholder values, calibrated later via UI)
--
-- Skill taxonomy covers:
--   Scoring:   scoring_volume, scoring_efficiency, shot_creation, three_point_shooting,
--              mid_range, finishing
--   Playmaking: passing, ball_handling, pick_and_roll_ball_handler
--   Defense:   perimeter_defense, interior_defense, rebounding, pick_and_roll_defender,
--              help_defense
--   Physical:  athleticism, size_and_length
--   IQ:        basketball_iq, off_ball_movement, positional_versatility
-- -----------------------------------------------------------------------------
INSERT INTO skill_thresholds (skill_name, thresholds) VALUES
  ('scoring_volume',              '{"Elite": {"metric": "pts_per_game", "operator": ">=", "value": 25.0}, "Capable": {"metric": "pts_per_game", "operator": ">=", "value": 15.0}}'),
  ('scoring_efficiency',          '{"Elite": {"metric": "ts_pct", "operator": ">=", "value": 0.600}, "Capable": {"metric": "ts_pct", "operator": ">=", "value": 0.550}}'),
  ('shot_creation',               '{"Elite": {"metric": "usg_pct", "operator": ">=", "value": 0.28}, "Capable": {"metric": "usg_pct", "operator": ">=", "value": 0.22}}'),
  ('three_point_shooting',        '{"Elite": {"metric": "fg3_pct", "operator": ">=", "value": 0.390}, "Capable": {"metric": "fg3_pct", "operator": ">=", "value": 0.360}}'),
  ('mid_range',                   '{"Elite": {"metric": "mid_range_fg_pct", "operator": ">=", "value": 0.460}, "Capable": {"metric": "mid_range_fg_pct", "operator": ">=", "value": 0.410}}'),
  ('finishing',                   '{"Elite": {"metric": "fg_pct_at_rim", "operator": ">=", "value": 0.680}, "Capable": {"metric": "fg_pct_at_rim", "operator": ">=", "value": 0.600}}'),
  ('passing',                     '{"Elite": {"metric": "ast_per_game", "operator": ">=", "value": 7.0}, "Capable": {"metric": "ast_per_game", "operator": ">=", "value": 4.0}}'),
  ('ball_handling',               '{"Elite": {"metric": "tov_ratio", "operator": "<=", "value": 0.10}, "Capable": {"metric": "tov_ratio", "operator": "<=", "value": 0.14}}'),
  ('pick_and_roll_ball_handler',  '{"Elite": {"metric": "pnr_ball_handler_ppp", "operator": ">=", "value": 0.95}, "Capable": {"metric": "pnr_ball_handler_ppp", "operator": ">=", "value": 0.82}}'),
  ('perimeter_defense',           '{"Elite": {"metric": "dfg_pct_allowed_perimeter", "operator": "<=", "value": 0.40}, "Capable": {"metric": "dfg_pct_allowed_perimeter", "operator": "<=", "value": 0.46}}'),
  ('interior_defense',            '{"Elite": {"metric": "blk_per_game", "operator": ">=", "value": 2.0}, "Capable": {"metric": "blk_per_game", "operator": ">=", "value": 0.8}}'),
  ('rebounding',                  '{"Elite": {"metric": "trb_per_game", "operator": ">=", "value": 10.0}, "Capable": {"metric": "trb_per_game", "operator": ">=", "value": 6.0}}'),
  ('pick_and_roll_defender',      '{"Elite": {"metric": "pnr_defense_ppp_allowed", "operator": "<=", "value": 0.78}, "Capable": {"metric": "pnr_defense_ppp_allowed", "operator": "<=", "value": 0.88}}'),
  ('help_defense',                '{"Elite": {"metric": "help_defense_score", "operator": ">=", "value": 0.80}, "Capable": {"metric": "help_defense_score", "operator": ">=", "value": 0.60}}'),
  ('athleticism',                 '{"Elite": {"metric": "athleticism_composite", "operator": ">=", "value": 0.80}, "Capable": {"metric": "athleticism_composite", "operator": ">=", "value": 0.55}}'),
  ('size_and_length',             '{"Elite": {"metric": "wingspan_height_ratio", "operator": ">=", "value": 1.08}, "Capable": {"metric": "wingspan_height_ratio", "operator": ">=", "value": 1.02}}'),
  ('basketball_iq',               '{"Elite": {"metric": "ast_to_tov_ratio", "operator": ">=", "value": 3.0}, "Capable": {"metric": "ast_to_tov_ratio", "operator": ">=", "value": 2.0}}'),
  ('off_ball_movement',           '{"Elite": {"metric": "off_ball_scoring_ppp", "operator": ">=", "value": 1.10}, "Capable": {"metric": "off_ball_scoring_ppp", "operator": ">=", "value": 0.90}}'),
  ('positional_versatility',      '{"Elite": {"metric": "positions_played", "operator": ">=", "value": 3}, "Capable": {"metric": "positions_played", "operator": ">=", "value": 2}}')
ON CONFLICT (skill_name) DO NOTHING;
