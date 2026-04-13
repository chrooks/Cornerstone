-- Backfill Haliburton's composite skill profile with all skills set to "None".
-- His profile was created with only one skill because the blank-profile
-- initialization bug created an empty {} before the fix.
-- Player UUID: 54908042-861b-440e-9f7f-399a0e917ebb, season 2025-26

DO $$
DECLARE
  _player_id uuid := '54908042-861b-440e-9f7f-399a0e917ebb';
  _season    text := '2025-26';
  _profile_id uuid;
  _empty_skill jsonb := '{"final_tier": "None", "stat_tier": null, "claude_tier": null, "source": "manual_override", "flagged": false}'::jsonb;
  _all_skills text[] := ARRAY[
    'spot_up_shooter', 'off_dribble_shooter', 'offensive_rebounder',
    'rebounder', 'rim_protector', 'isolation_scorer',
    'movement_shooter', 'cutter', 'transition_threat', 'pnr_ball_handler',
    'pnr_finisher', 'crafty_finisher', 'driver', 'vertical_spacer',
    'screen_setter', 'passer', 'mid_post_player', 'low_post_player',
    'versatile_defender', 'perimeter_disruptor', 'high_flyer'
  ];
  _full_profile jsonb := '{}'::jsonb;
  _skill text;
  _existing_profile jsonb;
BEGIN
  -- Build the full profile with all skills defaulted to "None"
  FOREACH _skill IN ARRAY _all_skills LOOP
    _full_profile := _full_profile || jsonb_build_object(_skill, _empty_skill);
  END LOOP;

  -- Find the existing composite profile row
  SELECT id, profile INTO _profile_id, _existing_profile
  FROM skill_profiles
  WHERE player_id = _player_id
    AND season = _season
    AND source = 'composite'
  LIMIT 1;

  IF _profile_id IS NOT NULL THEN
    -- Merge: existing skills (already saved overrides) win over the defaults
    UPDATE skill_profiles
    SET profile = _full_profile || _existing_profile
    WHERE id = _profile_id;
    RAISE NOTICE 'Updated profile % — merged % skills with existing data', _profile_id, array_length(_all_skills, 1);
  ELSE
    -- No profile at all — insert fresh
    INSERT INTO skill_profiles (player_id, season, source, profile)
    VALUES (_player_id, _season, 'composite', _full_profile);
    RAISE NOTICE 'Inserted new composite profile for player %', _player_id;
  END IF;
END $$;
