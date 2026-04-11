-- Enforce uniqueness on legends.nba_api_id where set.
-- Partial index allows multiple NULL rows (unmatched legends) while preventing
-- two legends from sharing the same NBA.com player ID.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legends_nba_api_id
  ON legends (nba_api_id)
  WHERE nba_api_id IS NOT NULL;
