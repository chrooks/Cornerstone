-- Add draft_round and season_exp columns to players table.
-- Used to derive is_rookie_deal at query time:
--   is_rookie_deal = (draft_round = 1 AND season_exp <= 3)
--
-- draft_round: immutable biographical fact (1 = first round, 2 = second, NULL = undrafted/unknown)
-- season_exp:  years of NBA experience, refreshed each season via CommonPlayerInfo pipeline

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS draft_round  smallint,
  ADD COLUMN IF NOT EXISTS season_exp   smallint;

COMMENT ON COLUMN players.draft_round IS 'NBA draft round (1 or 2). NULL = undrafted or unknown.';
COMMENT ON COLUMN players.season_exp  IS 'Years of NBA experience from CommonPlayerInfo. Updated each season refresh.';
