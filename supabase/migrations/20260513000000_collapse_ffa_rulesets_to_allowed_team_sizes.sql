-- =============================================================================
-- Collapse Free For All RuleSets into one multi-size RuleSet.
-- =============================================================================

ALTER TABLE public.saved_teams
  ADD COLUMN IF NOT EXISTS team_size integer;

UPDATE public.saved_teams st
SET team_size = CASE
  WHEN st.ruleset_slug = 'free-for-all-lineup' THEN 5
  WHEN st.ruleset_slug = 'free-for-all-rotation' THEN 9
  WHEN st.ruleset_slug = 'free-for-all-roster' THEN 12
  ELSE COALESCE((
    SELECT COUNT(*)::integer
    FROM public.saved_team_players stp
    WHERE stp.saved_team_id = st.id
  ), 9)
END
WHERE st.team_size IS NULL;

ALTER TABLE public.saved_teams
  DROP CONSTRAINT IF EXISTS chk_saved_teams_team_size;

ALTER TABLE public.saved_teams
  ADD CONSTRAINT chk_saved_teams_team_size
    CHECK (team_size IS NULL OR team_size IN (5, 9, 12));

INSERT INTO public.rulesets (slug, name, description, status, display_order)
VALUES (
  'free-for-all',
  'Free For All',
  'No cap. Any player. Choose Lineup, Rotation, or Roster size.',
  'active',
  2
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    display_order = EXCLUDED.display_order,
    updated_at = now();

UPDATE public.rulesets
SET display_order = CASE
  WHEN slug = 'budget' THEN 3
  ELSE display_order
END
WHERE slug IN ('budget');

WITH ffa AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all'
)
INSERT INTO public.rules (ruleset_id, rule_key, rule_type, rule_json)
SELECT id, rule_key, rule_type, rule_json
FROM ffa
CROSS JOIN (
  VALUES
    ('team_size', 'integer', '{"value": 9, "allowed_team_sizes": [5, 9, 12], "team_label": "Rotation"}'::jsonb),
    ('cornerstone', 'player_requirement', '{"required": true, "player_source": "all", "slot": 1, "display": "Any player"}'::jsonb),
    ('player_pool', 'source', '{"snapshot_players": true, "legends": true, "display": "2025-26 Snapshot + Legends"}'::jsonb)
) AS seed(rule_key, rule_type, rule_json)
ON CONFLICT (ruleset_id, rule_key) DO UPDATE
SET rule_type = EXCLUDED.rule_type,
    rule_json = EXCLUDED.rule_json,
    updated_at = now();

WITH ffa AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all'
),
doc AS (
  SELECT jsonb_build_object(
    'team_size', 9,
    'team_label', 'Rotation',
    'allowed_team_sizes', jsonb_build_array(5, 9, 12),
    'cornerstone_source', 'all',
    'cornerstone_rule', 'Any player',
    'player_pool', '2025-26 Snapshot + Legends'
  ) AS rules_json
)
INSERT INTO public.ruleset_versions (
  ruleset_id, version_label, rules_hash, rules_json, status, published_at
)
SELECT ffa.id, 'v1', md5(doc.rules_json::text), doc.rules_json, 'published', now()
FROM ffa, doc
ON CONFLICT (ruleset_id, version_label) DO UPDATE
SET rules_hash = EXCLUDED.rules_hash,
    rules_json = EXCLUDED.rules_json,
    status = 'published',
    published_at = COALESCE(public.ruleset_versions.published_at, now());

WITH unified AS (
  SELECT
    rs.id AS ruleset_id,
    rv.id AS version_id,
    rv.rules_hash
  FROM public.rulesets rs
  JOIN public.ruleset_versions rv ON rv.ruleset_id = rs.id
  WHERE rs.slug = 'free-for-all'
    AND rv.version_label = 'v1'
  LIMIT 1
)
UPDATE public.saved_teams st
SET ruleset_slug = 'free-for-all',
    ruleset_id = unified.ruleset_id,
    ruleset_version_id = unified.version_id,
    ruleset_version_hash = unified.rules_hash,
    ruleset_name_snapshot = 'Free For All'
FROM unified
WHERE st.ruleset_slug IN ('free-for-all-lineup', 'free-for-all-rotation', 'free-for-all-roster');

DELETE FROM public.ruleset_versions
WHERE ruleset_id IN (
  SELECT id
  FROM public.rulesets
  WHERE slug IN ('free-for-all-lineup', 'free-for-all-rotation', 'free-for-all-roster')
);

DELETE FROM public.rulesets
WHERE slug IN ('free-for-all-lineup', 'free-for-all-rotation', 'free-for-all-roster');
