-- Rename ball_dominator → isolation_scorer
UPDATE skill_thresholds
SET
  skill_name = 'isolation_scorer',
  thresholds = thresholds || '{"skill_name": "isolation_scorer"}'
WHERE skill_name = 'ball_dominator';

-- Rename vertical_spacer_lob_threat → vertical_spacer
UPDATE skill_thresholds
SET
  skill_name = 'vertical_spacer',
  thresholds = thresholds || '{"skill_name": "vertical_spacer"}'
WHERE skill_name = 'vertical_spacer_lob_threat';
