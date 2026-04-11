-- Add nba_api_id to legends for NBA.com headshot URL construction.
-- The column is nullable because not all legends may have a matched NBA.com ID.
-- A partial unique index prevents two legends from sharing the same nba_api_id
-- while still allowing multiple NULL values (NULL is not equal to NULL in SQL).
ALTER TABLE legends ADD COLUMN IF NOT EXISTS nba_api_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legends_nba_api_id
  ON legends (nba_api_id)
  WHERE nba_api_id IS NOT NULL;
