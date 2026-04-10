-- Rename point_of_attack_defender → perimeter_disruptor in skill_thresholds.

UPDATE skill_thresholds
SET
  skill_name = 'perimeter_disruptor',
  thresholds = thresholds || '{"skill_name": "perimeter_disruptor"}'
WHERE skill_name = 'point_of_attack_defender';

-- Rename the key in any existing composite skill_profiles JSONB.
UPDATE skill_profiles
SET profile = (profile - 'point_of_attack_defender')
           || jsonb_build_object('perimeter_disruptor', profile->'point_of_attack_defender')
WHERE profile ? 'point_of_attack_defender';
