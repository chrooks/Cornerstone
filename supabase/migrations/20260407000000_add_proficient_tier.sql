-- Migration: add Proficient skill tier (between Capable and Elite)
-- No structural changes needed — tier columns are TEXT without CHECK constraints.
-- Validation happens in application code (_VALID_TIERS sets).
-- Part 1: Update column comments to reflect all 5 valid tier values.
-- Part 2: Queue existing Capable/Elite composite ratings for human re-evaluation.

COMMENT ON COLUMN skill_flags.stat_rating    IS 'Tier from the stat engine: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.claude_rating  IS 'Tier from Claude: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.resolved_value IS 'Manually resolved tier: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN anchor_players.expected_tier IS 'Expected tier: None | Capable | Proficient | Elite | All-Time Great';

-- Insert pending review flags for every composite-profile skill currently rated
-- Capable or Elite. Both stat_rating and claude_rating are set to the current
-- final_tier (they already agreed or a human resolved it to that value).
-- flag_reason = 'proficient_tier_review' distinguishes these from disagreement flags.
INSERT INTO skill_flags (skill_profile_id, skill_name, stat_rating, claude_rating, flag_reason, notes)
SELECT
  sp.id,
  skill_entry.key                       AS skill_name,
  skill_entry.value->>'final_tier'      AS stat_rating,
  skill_entry.value->>'final_tier'      AS claude_rating,
  'proficient_tier_review'              AS flag_reason,
  'Proficient tier added — re-evaluate whether this skill should be Proficient' AS notes
FROM skill_profiles sp,
  jsonb_each(sp.profile) AS skill_entry(key, value)
WHERE
  sp.source = 'composite'
  AND skill_entry.value->>'final_tier' IN ('Capable', 'Elite')
  AND NOT EXISTS (
    SELECT 1 FROM skill_flags sf
    WHERE sf.skill_profile_id = sp.id
      AND sf.skill_name       = skill_entry.key
      AND sf.resolution IS NULL
      AND sf.flag_reason      = 'proficient_tier_review'
  );
