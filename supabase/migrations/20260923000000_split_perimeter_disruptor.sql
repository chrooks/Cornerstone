-- Split the perimeter_disruptor skill into point_of_attack_defender (on-ball)
-- and off_ball_disruptor (off-ball). Issue #152.
--
-- Carried tiers keep their values; the #120 guard flags a carried tier only
-- when the fresh Claude-informed on-ball tier disagrees (decision b). Carried
-- entries lose human_reviewed, so a carried None counts toward a negative only
-- after Chris re-resolves it. The off_ball_disruptor row is a starter copy of
-- the old rule so the calibration page can open the Skill; M5.4 replaces it.
--
-- Versioned rename: draft-side rows and profile JSONB keys move to the new
-- on-ball name. Published snapshot releases (released_*) and evaluation
-- versions are immutable and are NOT touched — old releases stay correct under
-- their bound evaluation version via the version-binding invariant, and the
-- engine's legacy-key alias shim keeps a pre-split release scoring identically
-- until a post-split release ships.
--
-- Every statement here is idempotent and every JSONB rewrite lets an existing
-- point_of_attack_defender entry win over the carried one, matching
-- services.skills.with_legacy_skill_keys — a key already present is never
-- overwritten.

UPDATE draft_skill_thresholds
SET skill_name = 'point_of_attack_defender'
WHERE skill_name = 'perimeter_disruptor';

-- The rule blob also embeds its own name; keep row and blob consistent.
UPDATE draft_skill_thresholds
SET thresholds = jsonb_set(thresholds, '{skill_name}', '"point_of_attack_defender"')
WHERE skill_name = 'point_of_attack_defender'
  AND thresholds ->> 'skill_name' = 'perimeter_disruptor';

-- anchor_players is UNIQUE (player_id, skill_name), and the April renames
-- (20260408000001/2) left this table alone — so a stale on-ball anchor can
-- already exist for the same player. Rename only where there is no collision,
-- then drop whatever kept the retired name: a duplicate anchor for one player
-- and one Skill, where the entry already under the current name wins.
UPDATE anchor_players a
SET skill_name = 'point_of_attack_defender'
WHERE a.skill_name = 'perimeter_disruptor'
  AND NOT EXISTS (
    SELECT 1 FROM anchor_players b
    WHERE b.player_id = a.player_id
      AND b.skill_name = 'point_of_attack_defender'
  );

DELETE FROM anchor_players WHERE skill_name = 'perimeter_disruptor';

UPDATE draft_skill_flags
SET skill_name = 'point_of_attack_defender'
WHERE skill_name = 'perimeter_disruptor';

-- Rewrite the skill key inside every draft profile JSONB, and strip
-- human_reviewed from the carried entry in the same pass (decision b).
--
-- Every source moves: stats and claude entries are objects, composite entries
-- are objects, and Legend profiles hold a bare tier string — the CASE leaves a
-- bare string alone and jsonb_build_object carries the value through whatever
-- its shape is.
--
-- The carried entry is the LEFT operand of ||, so a profile that already holds
-- a fresh point_of_attack_defender keeps it. One statement, so re-running the
-- file cannot strip human_reviewed from a decision made after the split.
UPDATE draft_skill_profiles
SET profile = jsonb_build_object(
      'point_of_attack_defender',
      CASE WHEN jsonb_typeof(profile -> 'perimeter_disruptor') = 'object'
           THEN (profile -> 'perimeter_disruptor') - 'human_reviewed'
           ELSE profile -> 'perimeter_disruptor' END
    ) || (profile - 'perimeter_disruptor')
WHERE profile ? 'perimeter_disruptor';

-- Staging tables for pending (uncommitted) pipeline runs mirror the draft
-- shapes — rewrite them the same way, so committing a pre-split run cannot
-- reintroduce the old key, or write human_reviewed back onto a carried entry.
UPDATE pipeline_run_results
SET profile = jsonb_build_object(
      'point_of_attack_defender',
      CASE WHEN jsonb_typeof(profile -> 'perimeter_disruptor') = 'object'
           THEN (profile -> 'perimeter_disruptor') - 'human_reviewed'
           ELSE profile -> 'perimeter_disruptor' END
    ) || (profile - 'perimeter_disruptor')
WHERE profile ? 'perimeter_disruptor';

UPDATE pipeline_run_flag_results
SET skill_name = 'point_of_attack_defender'
WHERE skill_name = 'perimeter_disruptor';

-- A staged, uncommitted threshold_edit run names its Skill in pipeline_runs.params,
-- and commit_pipeline_run writes a draft_skill_thresholds row from that name.
-- Without this the edit would land on a rule row for a retired Skill, which
-- evaluate_all_skills would then loop (it reads the table, not ALL_SKILLS) and
-- write the old key straight back into draft_skill_profiles.
-- committed_at IS NULL keeps run history honest.
UPDATE pipeline_runs
SET params = jsonb_set(
      jsonb_set(params, '{skill_name}', '"point_of_attack_defender"'),
      '{thresholds,skill_name}', '"point_of_attack_defender"'
    )
WHERE pipeline_name = 'threshold_edit'
  AND committed_at IS NULL
  AND params ->> 'skill_name' = 'perimeter_disruptor';

-- Starter rule for the new off-ball Skill: a copy of the renamed on-ball rule,
-- which already reads steals and deflections (off-ball activity), so it is a
-- sensible prior. Its purpose is to let the calibration page open the Skill at
-- all; M5.4 replaces the body with the rule Chris approves.
INSERT INTO draft_skill_thresholds (skill_name, thresholds)
SELECT
  'off_ball_disruptor',
  jsonb_set(
    jsonb_set(
      jsonb_set(thresholds, '{skill_name}', '"off_ball_disruptor"'),
      '{stat_confidence}', '"low"'
    ),
    '{always_flag_for_review}', 'true'
  )
FROM draft_skill_thresholds
WHERE skill_name = 'point_of_attack_defender'
ON CONFLICT (skill_name) DO NOTHING;
