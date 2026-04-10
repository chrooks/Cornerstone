-- Migration: update_crafty_finisher
-- Redesigns the crafty_finisher skill thresholds:
--   1. Removes drives_per_game from tier conditions (volume gate is sufficient)
--   2. Adds a Proficient tier between Elite and Capable
--   3. Adds floating jump shot (floater) as an OR alternative to paint non-RA
--      finishing at each tier — a player qualifies via either paint area efficiency
--      or floater efficiency, capturing both physical finishers and touch finishers
--   4. Adds shot_detail.floating_jump_shot_fg_pct to the stabilization block

UPDATE skill_thresholds
SET
  thresholds = '{
    "skill_name": "crafty_finisher",
    "skill_category": "threshold",
    "stat_confidence": "moderate",
    "always_flag_for_review": false,
    "stabilization": [
      {
        "stat": "tracking_drives.drive_fg_pct",
        "K": 50,
        "league_avg_key": "tracking_drives.drive_fg_pct"
      },
      {
        "stat": "shot_zones.paint_non_ra_fg_pct",
        "K": 60,
        "league_avg_key": "shot_zones.paint_non_ra_fg_pct"
      },
      {
        "stat": "shot_detail.floating_jump_shot_fg_pct",
        "K": 50,
        "league_avg_key": "shot_detail.floating_jump_shot_fg_pct"
      }
    ],
    "volume_gate": {
      "conditions": [
        {
          "stat": "tracking_drives.drives_per_game",
          "operator": ">=",
          "value": 4.0,
          "per": "game"
        }
      ],
      "fail_tier": "None",
      "logic": "AND"
    },
    "tiers": {
      "elite": {
        "conditions": [
          {
            "stat": "tracking_drives.drive_fg_pct",
            "operator": ">=",
            "value": 0.50,
            "stabilized": true
          },
          {
            "stat": "advanced.free_throw_rate",
            "operator": ">=",
            "value": 0.30
          },
          {
            "logic": "OR",
            "conditions": [
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_zones.paint_non_ra_fg_pct",
                    "operator": ">=",
                    "value": 0.46,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_zones.paint_non_ra_fga",
                    "operator": ">=",
                    "value": 1.5
                  }
                ]
              },
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_detail.floating_jump_shot_fg_pct",
                    "operator": ">=",
                    "value": 0.45,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_detail.floating_jump_shot_fga",
                    "operator": ">=",
                    "value": 1.2
                  }
                ]
              }
            ]
          }
        ],
        "logic": "AND"
      },
      "proficient": {
        "conditions": [
          {
            "stat": "tracking_drives.drive_fg_pct",
            "operator": ">=",
            "value": 0.47,
            "stabilized": true
          },
          {
            "stat": "advanced.free_throw_rate",
            "operator": ">=",
            "value": 0.25
          },
          {
            "logic": "OR",
            "conditions": [
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_zones.paint_non_ra_fg_pct",
                    "operator": ">=",
                    "value": 0.42,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_zones.paint_non_ra_fga",
                    "operator": ">=",
                    "value": 1.0
                  }
                ]
              },
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_detail.floating_jump_shot_fg_pct",
                    "operator": ">=",
                    "value": 0.42,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_detail.floating_jump_shot_fga",
                    "operator": ">=",
                    "value": 0.8
                  }
                ]
              }
            ]
          }
        ],
        "logic": "AND"
      },
      "capable": {
        "conditions": [
          {
            "stat": "tracking_drives.drive_fg_pct",
            "operator": ">=",
            "value": 0.44,
            "stabilized": true
          },
          {
            "stat": "advanced.free_throw_rate",
            "operator": ">=",
            "value": 0.20
          },
          {
            "logic": "OR",
            "conditions": [
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_zones.paint_non_ra_fg_pct",
                    "operator": ">=",
                    "value": 0.37,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_zones.paint_non_ra_fga",
                    "operator": ">=",
                    "value": 0.6
                  }
                ]
              },
              {
                "logic": "AND",
                "conditions": [
                  {
                    "stat": "shot_detail.floating_jump_shot_fg_pct",
                    "operator": ">=",
                    "value": 0.40,
                    "stabilized": true
                  },
                  {
                    "stat": "shot_detail.floating_jump_shot_fga",
                    "operator": ">=",
                    "value": 0.5
                  }
                ]
              }
            ]
          }
        ],
        "logic": "AND"
      }
    }
  }',
  updated_at = NOW()
WHERE skill_name = 'crafty_finisher';
