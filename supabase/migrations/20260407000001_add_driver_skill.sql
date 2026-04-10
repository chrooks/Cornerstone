-- Migration: add_driver_skill
-- Adds the "driver" threshold skill rule and anchor players.
--
-- The driver skill captures a player's ability to consistently attack the paint
-- from the perimeter off the dribble. It fills the gap between perimeter ball
-- handlers who drive but don't finish efficiently (would not qualify as crafty_finisher)
-- and primary post players whose paint presence is not drive-initiated.
--
-- Auto-promotions flow outward: Elite Driver → Crafty Finisher Capable,
-- All-Time Great Driver → Crafty Finisher Proficient.

INSERT INTO skill_thresholds (skill_name, thresholds) VALUES (
'driver',
'{
  "skill_name": "driver",
  "skill_category": "threshold",
  "stat_confidence": "moderate",
  "always_flag_for_review": true,
  "stabilization": [
    {
      "stat": "tracking_drives.drive_fg_pct",
      "K": 50,
      "league_avg_key": "tracking_drives.drive_fg_pct"
    }
  ],
  "volume_gate": {
    "conditions": [
      {
        "stat": "tracking_drives.drives_per_game",
        "operator": ">=",
        "value": 4.0
      }
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "All-Time Great": {
      "conditions": [
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 12.0},
        {"stat": "tracking_paint_touch.paint_touches", "operator": ">=", "value": 15.0}
      ],
      "logic": "AND"
    },
    "Elite": {
      "conditions": [
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 9.0},
        {"stat": "tracking_paint_touch.paint_touches", "operator": ">=", "value": 12.0}
      ],
      "logic": "AND"
    },
    "Proficient": {
      "conditions": [
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 7.0},
        {"stat": "tracking_paint_touch.paint_touches", "operator": ">=", "value": 9.0}
      ],
      "logic": "AND"
    },
    "Capable": {
      "conditions": [
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 5.0},
        {"stat": "tracking_paint_touch.paint_touches", "operator": ">=", "value": 6.0}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {
      "condition": {
        "stat": "tracking_drives.drive_fg_pct",
        "operator": ">=",
        "value": 0.53,
        "stabilized": true
      },
      "effect": "bump_up_one_tier",
      "max_tier": "Elite"
    }
  ],
  "auto_promotions": [
    {
      "if_tier_gte": "All-Time Great",
      "then_set_skill": "crafty_finisher",
      "to_minimum_tier": "Proficient"
    },
    {
      "if_tier_gte": "Elite",
      "then_set_skill": "crafty_finisher",
      "to_minimum_tier": "Capable"
    }
  ]
}'
) ON CONFLICT (skill_name) DO NOTHING;

-- Insert anchor players (requires player records to exist).
-- Each INSERT uses SELECT ... WHERE ... LIMIT 1 so that if the player does not
-- yet exist in the players table the INSERT is a safe no-op (0 rows inserted).

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Elite', 'High-volume perimeter driver, high paint touch rate'
FROM players p WHERE p.name = 'Shai Gilgeous-Alexander' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Elite', 'Physical wing driver, attacks the paint off the dribble'
FROM players p WHERE p.name = 'Jaylen Brown' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Proficient', 'Consistent perimeter driver with good paint penetration'
FROM players p WHERE p.name = 'Franz Wagner' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Proficient', 'Good driving volume but not elite penetration'
FROM players p WHERE p.name = 'LaMelo Ball' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Capable', 'Paint-first game, moderate drives per game'
FROM players p WHERE p.name = 'Josh Hart' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'Capable', 'PnR driver, stretch-5; lower drive volume expected'
FROM players p WHERE p.name = 'Chet Holmgren' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'None', 'Corner shooter, minimal drives'
FROM players p WHERE p.name = 'Max Strus' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'None', 'ISO defender, not a primary perimeter driver'
FROM players p WHERE p.name = 'Lu Dort' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'driver', 'None', 'Post center, drives do not originate from perimeter'
FROM players p WHERE p.name = 'Nikola Vucevic' LIMIT 1;
