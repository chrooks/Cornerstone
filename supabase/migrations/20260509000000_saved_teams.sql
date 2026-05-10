-- Saved Team persistence and Snapshot Release anchor.

CREATE TABLE public.snapshot_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season       TEXT NOT NULL,
  label        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_snapshot_releases_status
    CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX idx_snapshot_releases_status_published
  ON public.snapshot_releases (status, published_at DESC);

INSERT INTO public.snapshot_releases (season, label, status, published_at)
VALUES ('2025-26', '2025-26 Current', 'published', NOW());

CREATE TABLE public.saved_teams (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ruleset_slug          TEXT NOT NULL,
  snapshot_release_id   UUID NOT NULL REFERENCES public.snapshot_releases(id),
  name                  TEXT NOT NULL,
  visibility            TEXT NOT NULL DEFAULT 'private',
  cornerstone_legend_id UUID NOT NULL REFERENCES public.legends(id),
  total_salary          INTEGER NOT NULL,
  star_rating           NUMERIC,
  starting_lineup_score NUMERIC,
  team_description      TEXT,
  evaluation_version    TEXT NOT NULL DEFAULT 'cohesion-v1',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_saved_teams_visibility
    CHECK (visibility IN ('private', 'unlisted', 'public')),
  CONSTRAINT chk_saved_teams_total_salary
    CHECK (total_salary >= 0)
);

CREATE INDEX idx_saved_teams_user_created
  ON public.saved_teams (user_id, created_at DESC);

CREATE INDEX idx_saved_teams_ruleset_snapshot
  ON public.saved_teams (ruleset_slug, snapshot_release_id);

CREATE TRIGGER trg_saved_teams_updated_at
  BEFORE UPDATE ON public.saved_teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.saved_team_players (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_team_id          UUID NOT NULL REFERENCES public.saved_teams(id) ON DELETE CASCADE,
  player_id              UUID REFERENCES public.players(id) ON DELETE SET NULL,
  legend_id              UUID REFERENCES public.legends(id) ON DELETE SET NULL,
  slot                   INTEGER NOT NULL,
  is_cornerstone         BOOLEAN NOT NULL DEFAULT FALSE,
  salary_snapshot        INTEGER NOT NULL DEFAULT 0,
  player_name_snapshot   TEXT NOT NULL,
  team_snapshot          TEXT,
  position_snapshot      TEXT,
  skill_profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_saved_team_players_slot UNIQUE (saved_team_id, slot),
  CONSTRAINT chk_saved_team_players_identity
    CHECK (player_id IS NOT NULL OR legend_id IS NOT NULL),
  CONSTRAINT chk_saved_team_players_salary
    CHECK (salary_snapshot >= 0),
  CONSTRAINT chk_saved_team_players_slot
    CHECK (slot >= 1 AND slot <= 20)
);

CREATE INDEX idx_saved_team_players_saved_team_id
  ON public.saved_team_players (saved_team_id, slot);

ALTER TABLE public.snapshot_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_team_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published snapshot releases"
  ON public.snapshot_releases
  FOR SELECT
  USING (status = 'published' OR auth.role() = 'service_role');

CREATE POLICY "Service role manages snapshot releases"
  ON public.snapshot_releases
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can read own saved teams"
  ON public.saved_teams
  FOR SELECT
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

CREATE POLICY "Service role manages saved teams"
  ON public.saved_teams
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can read own saved team players"
  ON public.saved_team_players
  FOR SELECT
  USING (
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.saved_teams st
      WHERE st.id = saved_team_id
        AND st.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role manages saved team players"
  ON public.saved_team_players
  FOR ALL
  USING (auth.role() = 'service_role');
