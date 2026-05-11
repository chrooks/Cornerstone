-- Real RuleSets, Snapshot Releases, Saved Teams, and User Profiles.
--
-- Forward migration because 20260509000000_saved_teams.sql has already been
-- applied to the linked Supabase project. This migration expands the old Saved
-- Team shape instead of editing the applied migration.

-- -----------------------------------------------------------------------------
-- RuleSets, Rules, and immutable RuleSet Versions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rulesets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'active',
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_rulesets_status
    CHECK (status IN ('active', 'coming_soon', 'archived'))
);

DROP TRIGGER IF EXISTS trg_rulesets_updated_at ON public.rulesets;
CREATE TRIGGER trg_rulesets_updated_at
  BEFORE UPDATE ON public.rulesets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id uuid NOT NULL REFERENCES public.rulesets(id) ON DELETE CASCADE,
  rule_key   text NOT NULL,
  rule_type  text NOT NULL,
  rule_json  jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_rules_ruleset_key UNIQUE (ruleset_id, rule_key)
);

DROP TRIGGER IF EXISTS trg_rules_updated_at ON public.rules;
CREATE TRIGGER trg_rules_updated_at
  BEFORE UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.ruleset_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id    uuid NOT NULL REFERENCES public.rulesets(id) ON DELETE RESTRICT,
  version_label text NOT NULL,
  rules_hash    text NOT NULL,
  rules_json    jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'published',
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_ruleset_versions_status
    CHECK (status IN ('draft', 'published', 'retired')),
  CONSTRAINT uq_ruleset_versions_label UNIQUE (ruleset_id, version_label),
  CONSTRAINT uq_ruleset_versions_hash UNIQUE (ruleset_id, rules_hash)
);

CREATE INDEX IF NOT EXISTS idx_rulesets_status_display
  ON public.rulesets (status, display_order);

CREATE INDEX IF NOT EXISTS idx_ruleset_versions_published
  ON public.ruleset_versions (ruleset_id, status, published_at DESC);

-- -----------------------------------------------------------------------------
-- Canonical Players, Snapshot Releases, and Snapshot Players
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.canonical_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nba_api_id  integer UNIQUE NOT NULL,
  display_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_canonical_players_updated_at ON public.canonical_players;
CREATE TRIGGER trg_canonical_players_updated_at
  BEFORE UPDATE ON public.canonical_players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.snapshot_releases
  ADD COLUMN IF NOT EXISTS data_cutoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_snapshot_releases_updated_at ON public.snapshot_releases;
CREATE TRIGGER trg_snapshot_releases_updated_at
  BEFORE UPDATE ON public.snapshot_releases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_releases_label_unique
  ON public.snapshot_releases (label);

CREATE TABLE IF NOT EXISTS public.snapshot_players (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_release_id     uuid NOT NULL REFERENCES public.snapshot_releases(id) ON DELETE CASCADE,
  canonical_player_id     uuid NOT NULL REFERENCES public.canonical_players(id) ON DELETE RESTRICT,
  source_player_id        uuid REFERENCES public.players(id) ON DELETE SET NULL,
  source_skill_profile_id uuid REFERENCES public.skill_profiles(id) ON DELETE SET NULL,
  stat_season             text NOT NULL,
  name                    text NOT NULL,
  team                    text,
  position                text,
  salary                  integer NOT NULL DEFAULT 0,
  skill_profile_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_snapshot_players_source_player
    UNIQUE (snapshot_release_id, source_player_id),
  CONSTRAINT chk_snapshot_players_salary
    CHECK (salary >= 0)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_players_release_name
  ON public.snapshot_players (snapshot_release_id, name);

CREATE INDEX IF NOT EXISTS idx_snapshot_players_canonical
  ON public.snapshot_players (canonical_player_id);

-- -----------------------------------------------------------------------------
-- Saved Teams and saved evaluations
-- -----------------------------------------------------------------------------
ALTER TABLE public.saved_teams
  ADD COLUMN IF NOT EXISTS ruleset_id uuid REFERENCES public.rulesets(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ruleset_version_id uuid REFERENCES public.ruleset_versions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ruleset_version_hash text,
  ADD COLUMN IF NOT EXISTS ruleset_name_snapshot text,
  ADD COLUMN IF NOT EXISTS snapshot_release_label_snapshot text;

CREATE INDEX IF NOT EXISTS idx_saved_teams_ruleset_version
  ON public.saved_teams (ruleset_version_id);

ALTER TABLE public.saved_team_players
  ADD COLUMN IF NOT EXISTS snapshot_player_id uuid REFERENCES public.snapshot_players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS canonical_player_id uuid REFERENCES public.canonical_players(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL;

UPDATE public.saved_team_players
SET source_player_id = player_id
WHERE source_player_id IS NULL
  AND player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_saved_team_players_snapshot_player
  ON public.saved_team_players (snapshot_player_id);

CREATE TABLE IF NOT EXISTS public.saved_team_evaluations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_team_id          uuid NOT NULL REFERENCES public.saved_teams(id) ON DELETE CASCADE,
  evaluation_version     text NOT NULL,
  star_rating            numeric,
  starting_lineup_score  numeric,
  team_description       text,
  evaluation_payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_team_evaluations_team_created
  ON public.saved_team_evaluations (saved_team_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- User Profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name          text,
  favorite_player_name  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Seed initial RuleSets and the Standard RuleSet Version
-- -----------------------------------------------------------------------------
INSERT INTO public.rulesets (slug, name, description, status, display_order)
VALUES
  ('standard', 'Standard', 'The classic format. Salary-capped Rotation around a Legend.', 'active', 1),
  ('free-for-all', 'Free For All', 'No SalaryCap. No Cornerstone requirement. Pure best-of.', 'coming_soon', 2),
  ('budget', 'Budget Build', 'Tight SalaryCap, no Legends. Prove you can scout.', 'coming_soon', 3)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    display_order = EXCLUDED.display_order,
    updated_at = now();

WITH standard_ruleset AS (
  SELECT id FROM public.rulesets WHERE slug = 'standard'
)
INSERT INTO public.rules (ruleset_id, rule_key, rule_type, rule_json)
SELECT id, rule_key, rule_type, rule_json
FROM standard_ruleset
CROSS JOIN (
  VALUES
    ('team_size', 'integer', '{"value": 9, "team_label": "Rotation"}'::jsonb),
    ('salary_cap', 'money', '{"value": 195000000, "display": "$195M"}'::jsonb),
    ('cornerstone', 'player_requirement', '{"required": true, "player_source": "legend", "slot": 1, "salary": 54000000, "display": "1 Legend required ($54M)"}'::jsonb),
    ('player_pool', 'source', '{"snapshot_players": true, "legends": true, "display": "2025-26 Snapshot + Legends"}'::jsonb),
    ('rookie_deal_limit', 'integer', '{"value": 2}'::jsonb)
) AS seed(rule_key, rule_type, rule_json)
ON CONFLICT (ruleset_id, rule_key) DO UPDATE
SET rule_type = EXCLUDED.rule_type,
    rule_json = EXCLUDED.rule_json,
    updated_at = now();

WITH standard_ruleset AS (
  SELECT id FROM public.rulesets WHERE slug = 'standard'
),
standard_doc AS (
  SELECT jsonb_build_object(
    'team_size', 9,
    'team_label', 'Rotation',
    'salary_cap', 195000000,
    'salary_cap_display', '$195M',
    'cornerstone_rule', '1 Legend required ($54M)',
    'cornerstone_salary', 54000000,
    'player_pool', '2025-26 Snapshot + Legends',
    'rookie_deal_limit', 2
  ) AS rules_json
)
INSERT INTO public.ruleset_versions (
  ruleset_id,
  version_label,
  rules_hash,
  rules_json,
  status,
  published_at
)
SELECT
  standard_ruleset.id,
  'v1',
  md5(standard_doc.rules_json::text),
  standard_doc.rules_json,
  'published',
  now()
FROM standard_ruleset, standard_doc
ON CONFLICT (ruleset_id, version_label) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Seed the current Snapshot Release and Snapshot Players from current data
-- -----------------------------------------------------------------------------
INSERT INTO public.snapshot_releases (season, label, status, published_at)
VALUES ('2025-26', '2025-26 Current', 'published', now())
ON CONFLICT (label) DO UPDATE
SET season = EXCLUDED.season,
    status = EXCLUDED.status,
    published_at = COALESCE(public.snapshot_releases.published_at, EXCLUDED.published_at),
    updated_at = now();

INSERT INTO public.canonical_players (nba_api_id, display_name)
SELECT DISTINCT ON (p.nba_api_id)
  p.nba_api_id,
  p.name
FROM public.players p
WHERE p.nba_api_id IS NOT NULL
ORDER BY p.nba_api_id, p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST
ON CONFLICT (nba_api_id) DO UPDATE
SET display_name = EXCLUDED.display_name,
    updated_at = now();

WITH current_release AS (
  SELECT id
  FROM public.snapshot_releases
  WHERE label = '2025-26 Current'
  LIMIT 1
),
composite_profiles AS (
  SELECT DISTINCT ON (player_id)
    id,
    player_id,
    profile
  FROM public.skill_profiles
  WHERE source = 'composite'
    AND is_legend = false
  ORDER BY player_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
)
INSERT INTO public.snapshot_players (
  snapshot_release_id,
  canonical_player_id,
  source_player_id,
  source_skill_profile_id,
  stat_season,
  name,
  team,
  position,
  salary,
  skill_profile_snapshot
)
SELECT
  current_release.id,
  cp.id,
  p.id,
  sp.id,
  p.season,
  p.name,
  p.team,
  p.position,
  COALESCE(p.salary, 0),
  COALESCE(sp.profile, '{}'::jsonb)
FROM current_release
JOIN public.players p ON p.season = '2025-26'
JOIN public.canonical_players cp ON cp.nba_api_id = p.nba_api_id
LEFT JOIN composite_profiles sp ON sp.player_id = p.id
ON CONFLICT (snapshot_release_id, source_player_id) DO UPDATE
SET canonical_player_id = EXCLUDED.canonical_player_id,
    source_skill_profile_id = EXCLUDED.source_skill_profile_id,
    stat_season = EXCLUDED.stat_season,
    name = EXCLUDED.name,
    team = EXCLUDED.team,
    position = EXCLUDED.position,
    salary = EXCLUDED.salary,
    skill_profile_snapshot = EXCLUDED.skill_profile_snapshot;

-- -----------------------------------------------------------------------------
-- Backfill new Saved Team references where possible
-- -----------------------------------------------------------------------------
WITH standard_ruleset AS (
  SELECT id FROM public.rulesets WHERE slug = 'standard'
),
standard_version AS (
  SELECT rv.id, rv.rules_hash
  FROM public.ruleset_versions rv
  JOIN standard_ruleset rs ON rs.id = rv.ruleset_id
  WHERE rv.status = 'published'
  ORDER BY rv.published_at DESC NULLS LAST, rv.created_at DESC
  LIMIT 1
)
UPDATE public.saved_teams st
SET ruleset_id = standard_ruleset.id,
    ruleset_version_id = standard_version.id,
    ruleset_version_hash = standard_version.rules_hash,
    ruleset_name_snapshot = 'Standard'
FROM standard_ruleset, standard_version
WHERE st.ruleset_slug = 'standard'
  AND st.ruleset_version_id IS NULL;

UPDATE public.saved_team_players stp
SET snapshot_player_id = sp.id,
    canonical_player_id = sp.canonical_player_id
FROM public.saved_teams st
JOIN public.snapshot_players sp ON sp.snapshot_release_id = st.snapshot_release_id
WHERE st.id = stp.saved_team_id
  AND stp.source_player_id = sp.source_player_id
  AND stp.snapshot_player_id IS NULL;

INSERT INTO public.saved_team_evaluations (
  saved_team_id,
  evaluation_version,
  star_rating,
  starting_lineup_score,
  team_description,
  evaluation_payload,
  created_at
)
SELECT
  st.id,
  COALESCE(st.evaluation_version, 'cohesion-v1'),
  st.star_rating,
  st.starting_lineup_score,
  st.team_description,
  jsonb_build_object(
    'star_rating', st.star_rating,
    'starting_lineup_score', st.starting_lineup_score,
    'team_description', st.team_description
  ),
  st.created_at
FROM public.saved_teams st
WHERE NOT EXISTS (
  SELECT 1
  FROM public.saved_team_evaluations ste
  WHERE ste.saved_team_id = st.id
);

-- -----------------------------------------------------------------------------
-- RLS and policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.rulesets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruleset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canonical_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snapshot_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_team_evaluations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rulesets' AND policyname = 'Anyone can read rulesets') THEN
    CREATE POLICY "Anyone can read rulesets" ON public.rulesets FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'rules' AND policyname = 'Anyone can read rules') THEN
    CREATE POLICY "Anyone can read rules" ON public.rules FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ruleset_versions' AND policyname = 'Anyone can read published ruleset versions') THEN
    CREATE POLICY "Anyone can read published ruleset versions" ON public.ruleset_versions FOR SELECT USING (status = 'published' OR auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'canonical_players' AND policyname = 'Anyone can read canonical players') THEN
    CREATE POLICY "Anyone can read canonical players" ON public.canonical_players FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'snapshot_players' AND policyname = 'Anyone can read snapshot players') THEN
    CREATE POLICY "Anyone can read snapshot players" ON public.snapshot_players FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'Users can read own user profile') THEN
    CREATE POLICY "Users can read own user profile" ON public.user_profiles FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_profiles' AND policyname = 'Service role manages user profiles') THEN
    CREATE POLICY "Service role manages user profiles" ON public.user_profiles FOR ALL USING (auth.role() = 'service_role');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_team_evaluations' AND policyname = 'Users can read own saved team evaluations') THEN
    CREATE POLICY "Users can read own saved team evaluations"
      ON public.saved_team_evaluations
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
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_team_evaluations' AND policyname = 'Service role manages saved team evaluations') THEN
    CREATE POLICY "Service role manages saved team evaluations" ON public.saved_team_evaluations FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;
