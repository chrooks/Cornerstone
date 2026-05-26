-- Snapshot Draft Lifecycle
-- Extends snapshot_releases with draft/review lifecycle, is_active boolean,
-- thresholds_snapshot column, and adds pipeline_runs table.

-- 1. Extend status CHECK to include 'review'
ALTER TABLE public.snapshot_releases
  DROP CONSTRAINT chk_snapshot_releases_status;

ALTER TABLE public.snapshot_releases
  ADD CONSTRAINT chk_snapshot_releases_status
    CHECK (status IN ('draft', 'review', 'published', 'archived'));

-- 2. Add is_active and thresholds_snapshot columns
ALTER TABLE public.snapshot_releases
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN thresholds_snapshot JSONB;

-- 3. Backfill: mark the most recently published row as active
--    A-7: use created_at DESC as tiebreaker
UPDATE public.snapshot_releases
  SET is_active = true
  WHERE id = (
    SELECT id FROM public.snapshot_releases
    WHERE status = 'published'
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  );

-- 4. Partial unique index: exactly one active row at any time
CREATE UNIQUE INDEX idx_snapshot_releases_one_active
  ON public.snapshot_releases (is_active)
  WHERE is_active = true;

-- 5. Partial unique index: at most one open draft/review at a time
--    A-2: use the cleaner ((true)) form
CREATE UNIQUE INDEX idx_snapshot_releases_one_open_draft
  ON public.snapshot_releases ((true))
  WHERE status IN ('draft', 'review');

-- 6. pipeline_runs table
CREATE TABLE public.pipeline_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_name       TEXT NOT NULL
    CHECK (pipeline_name IN ('stat_fetch', 'salary_scrape', 'bio_team_sync')),
  scope               TEXT NOT NULL
    CHECK (scope IN ('bulk', 'player')),
  player_id           UUID REFERENCES public.players(id) ON DELETE SET NULL,
  snapshot_release_id UUID REFERENCES public.snapshot_releases(id) ON DELETE SET NULL,
  status              TEXT NOT NULL
    CHECK (status IN ('running', 'success', 'error')),
  rows_processed      INTEGER NOT NULL DEFAULT 0,
  error_tail          TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ
);

CREATE INDEX idx_pipeline_runs_snapshot_recent
  ON public.pipeline_runs (snapshot_release_id, started_at DESC);

CREATE INDEX idx_pipeline_runs_status_running
  ON public.pipeline_runs (status)
  WHERE status = 'running';

-- 7. RLS for pipeline_runs — service role only
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages pipeline runs"
  ON public.pipeline_runs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
