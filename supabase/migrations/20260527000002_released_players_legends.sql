-- =============================================================================
-- M1 — Add is_legend column to released_players.
--
-- Adds:
--   7. released_players.is_legend BOOLEAN NOT NULL DEFAULT false
--      + supporting index
--
-- The column is additive with a safe default; existing rows (regular players)
-- receive false, which is correct. The publish RPC update in the next migration
-- (20260527000003_publish_open_flags_gate.sql) will set is_legend correctly per row.
-- =============================================================================

ALTER TABLE public.released_players
  ADD COLUMN IF NOT EXISTS is_legend BOOLEAN NOT NULL DEFAULT false;

-- Index supports filtered reads: "give me only legends in this release"
-- and "give me only non-legends in this release."
CREATE INDEX IF NOT EXISTS idx_released_players_is_legend
  ON public.released_players (is_legend);

-- =============================================================================
-- Verification queries (run after apply to confirm invariants):
--
-- 1. Column exists with correct default:
--      SELECT column_name, data_type, column_default, is_nullable
--      FROM information_schema.columns
--      WHERE table_schema = 'public'
--        AND table_name = 'released_players'
--        AND column_name = 'is_legend';
--      -- Expect: boolean, default false, NOT NULL
--
-- 2. Existing rows default to false:
--      SELECT COUNT(*) FROM released_players WHERE is_legend IS NULL;
--      -- Expect: 0
--
-- 3. Index exists:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'released_players' AND indexname = 'idx_released_players_is_legend';
--      -- Expect: one row
--
-- 4. Insert with is_legend=true succeeds:
--      -- (dry verify only; do not insert garbage rows against the linked project)
-- =============================================================================
