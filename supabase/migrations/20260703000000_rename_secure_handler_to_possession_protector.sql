-- Rename the secure_handler skill to possession_protector (issue #84).
--
-- Versioned rename: draft-side rows and profile JSONB keys move to the new
-- name. Published snapshot releases and evaluation versions are immutable
-- and are NOT touched — old releases stay correct under cohesion-v6 via the
-- version-binding invariant; a new Evaluation Version (cohesion-v7) and a
-- fresh Snapshot Release are published under the new key after this runs.

UPDATE draft_skill_thresholds
SET skill_name = 'possession_protector'
WHERE skill_name = 'secure_handler';

-- The seed blob also embeds its own name; keep row and blob consistent.
UPDATE draft_skill_thresholds
SET thresholds = jsonb_set(thresholds, '{skill_name}', '"possession_protector"')
WHERE skill_name = 'possession_protector'
  AND thresholds ->> 'skill_name' = 'secure_handler';

UPDATE anchor_players
SET skill_name = 'possession_protector'
WHERE skill_name = 'secure_handler';

UPDATE draft_skill_flags
SET skill_name = 'possession_protector'
WHERE skill_name = 'secure_handler';

-- Rewrite the skill key inside every draft profile JSONB (stats, claude,
-- and composite sources alike).
UPDATE draft_skill_profiles
SET profile = (profile - 'secure_handler')
    || jsonb_build_object('possession_protector', profile -> 'secure_handler')
WHERE profile ? 'secure_handler';

-- Staging tables for pending (uncommitted) pipeline runs mirror the draft
-- shapes — rewrite them too, so committing a pre-rename run cannot reintroduce
-- the old key into draft_skill_profiles.
UPDATE pipeline_run_results
SET profile = (profile - 'secure_handler')
    || jsonb_build_object('possession_protector', profile -> 'secure_handler')
WHERE profile ? 'secure_handler';

UPDATE pipeline_run_flag_results
SET skill_name = 'possession_protector'
WHERE skill_name = 'secure_handler';
