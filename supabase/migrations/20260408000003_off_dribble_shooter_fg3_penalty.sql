-- Add a bump_down_one_tier penalty to off_dribble_shooter:
-- A player who qualifies for Elite via mid-range pull-ups but shoots below 32%
-- on 3pt pull-ups (with meaningful 3pt volume) is demoted one tier to Proficient.
-- This handles cases like Dejounte Murray (elite mid-range, poor 3pt pull-up shooter).

UPDATE skill_thresholds
SET thresholds = jsonb_set(
  thresholds,
  '{tier_bumps}',
  (thresholds->'tier_bumps') || jsonb_build_array(
    jsonb_build_object(
      'effect',    'bump_down_one_tier',
      'min_tier',  'Proficient',
      'condition', jsonb_build_object(
        'logic', 'AND',
        'conditions', jsonb_build_array(
          -- Only penalize when the player is taking enough 3pt pull-ups for it to matter
          jsonb_build_object(
            'stat', 'tracking_shooting.pullup_fg3a',
            'operator', '>=',
            'value', 2.0
          ),
          -- Below the threshold that would qualify for even Capable 3pt pull-up shooting
          jsonb_build_object(
            'stat', 'tracking_shooting.pullup_fg3_pct',
            'operator', '<',
            'value', 0.32,
            'stabilized', true
          )
        )
      )
    )
  ),
  true
),
updated_at = now()
WHERE skill_name = 'off_dribble_shooter';
