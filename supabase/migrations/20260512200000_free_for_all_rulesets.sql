-- =============================================================================
-- Free For All RuleSets — three variants by team_size (5, 9, 12)
-- Replaces the single "free-for-all" coming_soon placeholder.
-- No SalaryCap. No RookieDeal limit. Any player as Cornerstone.
-- =============================================================================

-- Remove the old placeholder row (cascade deletes any orphaned rules/versions)
DELETE FROM public.rulesets WHERE slug = 'free-for-all';

-- Insert three Free For All RuleSets
INSERT INTO public.rulesets (slug, name, description, status, display_order)
VALUES
  ('free-for-all-lineup',   'Free For All — Lineup',   'No cap. Any player. Best starting five.',          'active', 2),
  ('free-for-all-rotation', 'Free For All — Rotation',  'No cap. Any player. Best nine-man rotation.',      'active', 3),
  ('free-for-all-roster',   'Free For All — Roster',    'No cap. Any player. Best twelve-man roster.',      'active', 4)
ON CONFLICT (slug) DO UPDATE
SET name          = EXCLUDED.name,
    description   = EXCLUDED.description,
    status        = EXCLUDED.status,
    display_order = EXCLUDED.display_order,
    updated_at    = now();

-- Bump Budget Build display_order so it stays last
UPDATE public.rulesets SET display_order = 5 WHERE slug = 'budget';

-- =============================================================================
-- Rules rows (individual rule entries per RuleSet)
-- =============================================================================

-- Free For All — Lineup (5)
WITH ffa_lineup AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-lineup'
)
INSERT INTO public.rules (ruleset_id, rule_key, rule_type, rule_json)
SELECT id, rule_key, rule_type, rule_json
FROM ffa_lineup
CROSS JOIN (
  VALUES
    ('team_size',    'integer',            '{"value": 5, "team_label": "Lineup"}'::jsonb),
    ('cornerstone',  'player_requirement', '{"required": true, "player_source": "all", "slot": 1, "display": "Any player"}'::jsonb),
    ('player_pool',  'source',             '{"snapshot_players": true, "legends": true, "display": "2025-26 Snapshot + Legends"}'::jsonb)
) AS seed(rule_key, rule_type, rule_json)
ON CONFLICT (ruleset_id, rule_key) DO UPDATE
SET rule_type = EXCLUDED.rule_type,
    rule_json = EXCLUDED.rule_json,
    updated_at = now();

-- Free For All — Rotation (9)
WITH ffa_rotation AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-rotation'
)
INSERT INTO public.rules (ruleset_id, rule_key, rule_type, rule_json)
SELECT id, rule_key, rule_type, rule_json
FROM ffa_rotation
CROSS JOIN (
  VALUES
    ('team_size',    'integer',            '{"value": 9, "team_label": "Rotation"}'::jsonb),
    ('cornerstone',  'player_requirement', '{"required": true, "player_source": "all", "slot": 1, "display": "Any player"}'::jsonb),
    ('player_pool',  'source',             '{"snapshot_players": true, "legends": true, "display": "2025-26 Snapshot + Legends"}'::jsonb)
) AS seed(rule_key, rule_type, rule_json)
ON CONFLICT (ruleset_id, rule_key) DO UPDATE
SET rule_type = EXCLUDED.rule_type,
    rule_json = EXCLUDED.rule_json,
    updated_at = now();

-- Free For All — Roster (12)
WITH ffa_roster AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-roster'
)
INSERT INTO public.rules (ruleset_id, rule_key, rule_type, rule_json)
SELECT id, rule_key, rule_type, rule_json
FROM ffa_roster
CROSS JOIN (
  VALUES
    ('team_size',    'integer',            '{"value": 12, "team_label": "Roster"}'::jsonb),
    ('cornerstone',  'player_requirement', '{"required": true, "player_source": "all", "slot": 1, "display": "Any player"}'::jsonb),
    ('player_pool',  'source',             '{"snapshot_players": true, "legends": true, "display": "2025-26 Snapshot + Legends"}'::jsonb)
) AS seed(rule_key, rule_type, rule_json)
ON CONFLICT (ruleset_id, rule_key) DO UPDATE
SET rule_type = EXCLUDED.rule_type,
    rule_json = EXCLUDED.rule_json,
    updated_at = now();

-- =============================================================================
-- Published versions (ruleset_versions with flattened rules_json)
-- =============================================================================

-- Lineup v1
WITH ffa_lineup AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-lineup'
),
doc AS (
  SELECT jsonb_build_object(
    'team_size', 5,
    'team_label', 'Lineup',
    'cornerstone_source', 'all',
    'cornerstone_rule', 'Any player',
    'player_pool', '2025-26 Snapshot + Legends'
  ) AS rules_json
)
INSERT INTO public.ruleset_versions (
  ruleset_id, version_label, rules_hash, rules_json, status, published_at
)
SELECT ffa_lineup.id, 'v1', md5(doc.rules_json::text), doc.rules_json, 'published', now()
FROM ffa_lineup, doc
ON CONFLICT (ruleset_id, version_label) DO NOTHING;

-- Rotation v1
WITH ffa_rotation AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-rotation'
),
doc AS (
  SELECT jsonb_build_object(
    'team_size', 9,
    'team_label', 'Rotation',
    'cornerstone_source', 'all',
    'cornerstone_rule', 'Any player',
    'player_pool', '2025-26 Snapshot + Legends'
  ) AS rules_json
)
INSERT INTO public.ruleset_versions (
  ruleset_id, version_label, rules_hash, rules_json, status, published_at
)
SELECT ffa_rotation.id, 'v1', md5(doc.rules_json::text), doc.rules_json, 'published', now()
FROM ffa_rotation, doc
ON CONFLICT (ruleset_id, version_label) DO NOTHING;

-- Roster v1
WITH ffa_roster AS (
  SELECT id FROM public.rulesets WHERE slug = 'free-for-all-roster'
),
doc AS (
  SELECT jsonb_build_object(
    'team_size', 12,
    'team_label', 'Roster',
    'cornerstone_source', 'all',
    'cornerstone_rule', 'Any player',
    'player_pool', '2025-26 Snapshot + Legends'
  ) AS rules_json
)
INSERT INTO public.ruleset_versions (
  ruleset_id, version_label, rules_hash, rules_json, status, published_at
)
SELECT ffa_roster.id, 'v1', md5(doc.rules_json::text), doc.rules_json, 'published', now()
FROM ffa_roster, doc
ON CONFLICT (ruleset_id, version_label) DO NOTHING;
