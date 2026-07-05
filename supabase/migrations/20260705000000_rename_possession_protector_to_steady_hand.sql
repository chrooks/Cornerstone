-- Rename the possession_protector skill to steady_hand.
--
-- Versioned rename: draft-side rows and profile JSONB keys move to the new
-- name. Published snapshot releases and evaluation versions are immutable
-- and are NOT touched — old releases stay correct under their bound
-- evaluation version via the version-binding invariant; a new Evaluation
-- Version and a fresh Snapshot Release are published under the new key
-- after this runs.

UPDATE draft_skill_thresholds
SET skill_name = 'steady_hand'
WHERE skill_name = 'possession_protector';

-- The seed blob also embeds its own name; keep row and blob consistent.
UPDATE draft_skill_thresholds
SET thresholds = jsonb_set(thresholds, '{skill_name}', '"steady_hand"')
WHERE skill_name = 'steady_hand'
  AND thresholds ->> 'skill_name' = 'possession_protector';

UPDATE anchor_players
SET skill_name = 'steady_hand'
WHERE skill_name = 'possession_protector';

UPDATE draft_skill_flags
SET skill_name = 'steady_hand'
WHERE skill_name = 'possession_protector';

-- Rewrite the skill key inside every draft profile JSONB (stats, claude,
-- and composite sources alike).
UPDATE draft_skill_profiles
SET profile = (profile - 'possession_protector')
    || jsonb_build_object('steady_hand', profile -> 'possession_protector')
WHERE profile ? 'possession_protector';

-- Staging tables for pending (uncommitted) pipeline runs mirror the draft
-- shapes — rewrite them too, so committing a pre-rename run cannot reintroduce
-- the old key into draft_skill_profiles.
UPDATE pipeline_run_results
SET profile = (profile - 'possession_protector')
    || jsonb_build_object('steady_hand', profile -> 'possession_protector')
WHERE profile ? 'possession_protector';

UPDATE pipeline_run_flag_results
SET skill_name = 'steady_hand'
WHERE skill_name = 'possession_protector';
