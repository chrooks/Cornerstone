-- Rename switchable_defender → versatile_defender
-- and poa_defender → perimeter_disruptor in skill_thresholds.
-- After applying this migration, re-run Step 1 (Stat Skill Mapping) in the
-- pipeline to regenerate skill_profiles with the new key names.

UPDATE skill_thresholds
SET
  skill_name  = 'versatile_defender',
  -- Also patch the skill_name field embedded in the JSONB rule itself
  thresholds  = thresholds || '{"skill_name": "versatile_defender"}'
WHERE skill_name = 'switchable_defender';

UPDATE skill_thresholds
SET
  skill_name  = 'perimeter_disruptor',
  thresholds  = thresholds || '{"skill_name": "perimeter_disruptor"}'
WHERE skill_name = 'poa_defender';

-- Rename the keys in any existing composite skill_profiles JSONB so that the
-- review queue and player profile pages don't show stale data while the
-- pipeline re-run is in progress.
-- (skill_profiles.profile is keyed by skill_name)
UPDATE skill_profiles
SET profile = (profile - 'switchable_defender')
           || jsonb_build_object('versatile_defender', profile->'switchable_defender')
WHERE profile ? 'switchable_defender';

UPDATE skill_profiles
SET profile = (profile - 'poa_defender')
           || jsonb_build_object('perimeter_disruptor', profile->'poa_defender')
WHERE profile ? 'poa_defender';
