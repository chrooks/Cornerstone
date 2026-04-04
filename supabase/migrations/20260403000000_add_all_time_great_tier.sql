-- Migration: document the All-Time Great skill tier
-- No structural changes needed — tier columns are TEXT without CHECK constraints.
-- Validation happens in application code (_VALID_TIERS sets).
-- This migration updates column comments to reflect the new valid tier values.

COMMENT ON COLUMN skill_flags.stat_rating IS 'Tier from the stat engine: None | Capable | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.claude_rating IS 'Tier from Claude: None | Capable | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.resolved_value IS 'Manually resolved tier: None | Capable | Elite | All-Time Great';
COMMENT ON COLUMN anchor_players.expected_tier IS 'Expected tier for calibration anchor: None | Capable | Elite | All-Time Great';
