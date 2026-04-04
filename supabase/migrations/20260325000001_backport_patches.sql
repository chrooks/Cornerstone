-- =============================================================================
-- 002_backport_patches.sql
-- Backport patches applied before implementation begins:
--   1. Add salary column to players
--   2. Add league_averages table
--   3. Replace placeholder skill_thresholds seed with full 19-skill JSONB rules
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Add salary column to players
-- -----------------------------------------------------------------------------
ALTER TABLE players ADD COLUMN IF NOT EXISTS salary integer;


-- -----------------------------------------------------------------------------
-- 2. league_averages
-- Stores per-season league-wide average values for stats used in stabilization.
-- Populated by the stats service (Prompt 3) and read by the rule engine (Prompt 4).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS league_averages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season      text NOT NULL,
  stat_key    text NOT NULL,
  value       numeric NOT NULL,
  sample_size integer,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (season, stat_key)
);

CREATE INDEX IF NOT EXISTS idx_league_averages_season ON league_averages (season);


-- -----------------------------------------------------------------------------
-- 3. Replace placeholder skill_thresholds seed with full 19-skill JSONB rules
--
-- Schema reference: prompt4_final.md Rule Schema section
-- Stat key reference: skill_stat_mapping.md and prompt3_final.md Stats JSON Schema
--
-- JSONB top-level fields:
--   skill_name, skill_category, stat_confidence, always_flag_for_review,
--   stabilization[], volume_gate{}, tiers{elite, capable},
--   tier_bumps[]?, pre_adjustments[]?, computed_stats[]?, auto_promotions[]?
-- -----------------------------------------------------------------------------

-- Remove old placeholder rows (wrong taxonomy)
DELETE FROM skill_thresholds;

INSERT INTO skill_thresholds (skill_name, thresholds) VALUES

-- ---------------------------------------------------------------------------
-- ADDITIVE SKILLS
-- ---------------------------------------------------------------------------

('spot_up_shooter', '{
  "skill_name": "spot_up_shooter",
  "skill_category": "additive",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "tracking_shooting.catch_shoot_fg3_pct", "K": 100, "league_avg_key": "tracking_shooting.catch_shoot_fg3_pct"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0, "per": "game"},
      {"stat": "play_type.spotup_poss", "operator": ">=", "value": 50, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.40, "stabilized": true},
        {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 3.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.36, "stabilized": true},
        {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {"condition": {"stat": "play_type.spotup_ppp", "operator": ">=", "value": 1.05}, "effect": "bump_up_one_tier", "max_tier": "Elite"}
  ]
}'),

('movement_shooter', '{
  "skill_name": "movement_shooter",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.offscreen_ppp", "K": 30, "league_avg_key": "play_type.offscreen_ppp"},
    {"stat": "play_type.handoff_ppp", "K": 30, "league_avg_key": "play_type.handoff_ppp"},
    {"stat": "tracking_shooting.catch_shoot_fg3_pct", "K": 100, "league_avg_key": "tracking_shooting.catch_shoot_fg3_pct"}
  ],
  "computed_stats": [
    {
      "name": "movement_shooter_combined_freq",
      "formula": "sum",
      "components": [
        {"stat": "play_type.offscreen_freq", "weight": 1.0},
        {"stat": "play_type.handoff_freq", "weight": 1.0}
      ]
    },
    {
      "name": "movement_shooter_weighted_ppp",
      "formula": "weighted_average",
      "components": [
        {"stat": "play_type.offscreen_ppp", "weight_stat": "play_type.offscreen_poss"},
        {"stat": "play_type.handoff_ppp", "weight_stat": "play_type.handoff_poss"}
      ]
    }
  ],
  "volume_gate": {
    "conditions": [
      {
        "logic": "OR",
        "conditions": [
          {"stat": "play_type.offscreen_poss", "operator": ">=", "value": 75, "per": "season"},
          {"stat": "play_type.handoff_poss", "operator": ">=", "value": 75, "per": "season"}
        ]
      },
      {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.34, "stabilized": true}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "computed.movement_shooter_weighted_ppp", "operator": ">=", "value": 1.02, "stabilized": true},
        {"stat": "computed.movement_shooter_combined_freq", "operator": ">=", "value": 0.18},
        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.38, "stabilized": true}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "computed.movement_shooter_weighted_ppp", "operator": ">=", "value": 0.90, "stabilized": true},
        {"stat": "computed.movement_shooter_combined_freq", "operator": ">=", "value": 0.10},
        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.34, "stabilized": true}
      ],
      "logic": "AND"
    }
  },
  "auto_promotions": [
    {"if_tier_gte": "Capable", "then_set_skill": "spot_up_shooter", "to_minimum_tier": "Capable"}
  ]
}'),

('switchable_defender', '{
  "skill_name": "switchable_defender",
  "skill_category": "additive",
  "stat_confidence": "low",
  "always_flag_for_review": true,
  "volume_gate": {
    "conditions": [
      {"stat": "matchup_defense.total_matchup_poss", "operator": ">=", "value": 200, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "matchup_defense.positional_groups_guarded", "operator": ">=", "value": 4},
        {"stat": "matchup_defense.cross_group_fg_pct_diff", "operator": "<=", "value": 0.00},
        {"stat": "tracking_defense.contested_shots_3pt", "operator": ">=", "value": 1.0},
        {
          "logic": "OR",
          "conditions": [
            {"stat": "tracking_defense.defended_at_rim_fga", "operator": ">=", "value": 2.0},
            {"stat": "tracking_defense.contested_shots_2pt", "operator": ">=", "value": 4.0}
          ]
        }
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "matchup_defense.positional_groups_guarded", "operator": ">=", "value": 3},
        {"stat": "matchup_defense.cross_group_fg_pct_diff", "operator": "<=", "value": 0.03},
        {"stat": "tracking_defense.contested_shots_3pt", "operator": ">=", "value": 1.0},
        {
          "logic": "OR",
          "conditions": [
            {"stat": "tracking_defense.defended_at_rim_fga", "operator": ">=", "value": 2.0},
            {"stat": "tracking_defense.contested_shots_2pt", "operator": ">=", "value": 4.0}
          ]
        }
      ],
      "logic": "AND"
    }
  }
}'),

('cutter', '{
  "skill_name": "cutter",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.cut_ppp", "K": 30, "league_avg_key": "play_type.cut_ppp"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "play_type.cut_poss", "operator": ">=", "value": 50, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "play_type.cut_freq", "operator": ">=", "value": 0.10},
        {"stat": "play_type.cut_ppp", "operator": ">=", "value": 1.25, "stabilized": true},
        {"stat": "play_type.cut_poss", "operator": ">=", "value": 100, "per": "season"}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "play_type.cut_freq", "operator": ">=", "value": 0.05},
        {"stat": "play_type.cut_ppp", "operator": ">=", "value": 1.10, "stabilized": true},
        {"stat": "play_type.cut_poss", "operator": ">=", "value": 50, "per": "season"}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {"condition": {"stat": "tracking_paint_touch.paint_touch_fg_pct", "operator": ">=", "value": 0.50}, "effect": "bump_up_one_tier", "max_tier": "Elite"}
  ]
}'),

('screen_setter', '{
  "skill_name": "screen_setter",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "pre_adjustments": [
    {
      "if": {"stat": "hustle.box_outs_off", "operator": ">=", "value": 2.0},
      "then_add": 0.5,
      "to_stat": "hustle.screen_assists"
    }
  ],
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "hustle.screen_assists", "operator": ">=", "value": 4.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "hustle.screen_assists", "operator": ">=", "value": 1.5}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {
      "condition": {"stat": "hustle.screen_assist_pts_per_screen_assist", "operator": ">=", "value": 2.3},
      "effect": "bump_up_one_tier",
      "max_tier": "Elite"
    }
  ]
}'),

('transition_threat', '{
  "skill_name": "transition_threat",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.transition_ppp", "K": 30, "league_avg_key": "play_type.transition_ppp"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "play_type.transition_poss", "operator": ">=", "value": 75, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "play_type.transition_freq", "operator": ">=", "value": 0.06},
        {"stat": "play_type.transition_ppp", "operator": ">=", "value": 1.12, "stabilized": true},
        {"stat": "play_type.transition_poss", "operator": ">=", "value": 100, "per": "season"}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "play_type.transition_freq", "operator": ">=", "value": 0.03},
        {"stat": "play_type.transition_ppp", "operator": ">=", "value": 1.00, "stabilized": true},
        {"stat": "play_type.transition_poss", "operator": ">=", "value": 75, "per": "season"}
      ],
      "logic": "AND"
    }
  }
}'),

('vertical_spacer', '{
  "skill_name": "vertical_spacer",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "volume_gate": {
    "conditions": [
      {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 1.0, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 2.5},
        {"stat": "shot_detail.alley_oop_fgm", "operator": ">=", "value": 30, "per": "season"},
        {"stat": "shot_zones.restricted_area_fg_pct", "operator": ">=", "value": 0.65}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 1.0},
        {"stat": "shot_detail.alley_oop_fgm", "operator": ">=", "value": 12, "per": "season"},
        {"stat": "shot_zones.restricted_area_fg_pct", "operator": ">=", "value": 0.60}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {
      "condition": {
        "logic": "OR",
        "conditions": [
          {"stat": "play_type.pr_roll_man_poss", "operator": ">=", "value": 75, "per": "season"},
          {"stat": "play_type.cut_poss", "operator": ">=", "value": 75, "per": "season"}
        ]
      },
      "effect": "bump_up_one_tier",
      "max_tier": "Elite"
    }
  ]
}'),

('passer', '{
  "skill_name": "passer",
  "skill_category": "additive",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "computed_stats": [
    {
      "name": "passer_composite",
      "formula": "sum",
      "components": [
        {"stat": "tracking_passing.potential_assists", "weight": 1.0},
        {"stat": "tracking_passing.secondary_assists", "weight": 1.5}
      ]
    }
  ],
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_passing.potential_assists", "operator": ">=", "value": 10.0},
        {"stat": "advanced.ast_pct", "operator": ">=", "value": 0.25},
        {"stat": "computed.passer_composite", "operator": ">=", "value": 13.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_passing.potential_assists", "operator": ">=", "value": 5.0},
        {"stat": "advanced.ast_pct", "operator": ">=", "value": 0.14},
        {"stat": "computed.passer_composite", "operator": ">=", "value": 7.0}
      ],
      "logic": "AND"
    }
  }
}'),

('high_flyer', '{
  "skill_name": "high_flyer",
  "skill_category": "additive",
  "stat_confidence": "low",
  "always_flag_for_review": true,
  "computed_stats": [
    {
      "name": "self_created_dunk_ratio",
      "formula": "ratio",
      "components": [
        {"stat": "shot_detail.driving_dunk_fgm", "role": "numerator"},
        {"stat": "shot_zones.dunk_fga", "role": "denominator"}
      ]
    }
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 1.5, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "shot_detail.driving_dunk_fgm", "operator": ">=", "value": 1.5},
        {"stat": "computed.self_created_dunk_ratio", "operator": ">=", "value": 0.50},
        {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 2.5}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "shot_detail.driving_dunk_fgm", "operator": ">=", "value": 0.7},
        {"stat": "computed.self_created_dunk_ratio", "operator": ">=", "value": 0.35},
        {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 1.5}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {
      "condition": {
        "logic": "AND",
        "conditions": [
          {"stat": "play_type.transition_freq", "operator": ">=", "value": 0.05},
          {"stat": "play_type.transition_ppp", "operator": ">=", "value": 1.10}
        ]
      },
      "effect": "bump_up_one_tier",
      "max_tier": "Elite"
    }
  ]
}'),

('rim_protector', '{
  "skill_name": "rim_protector",
  "skill_category": "additive",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_defense.defended_at_rim_fga", "operator": ">=", "value": 4.0, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_defense.defended_at_rim_fg_pct", "operator": "<=", "value": 0.54},
        {"stat": "advanced.blk_pct", "operator": ">=", "value": 0.035},
        {"stat": "tracking_defense.defended_at_rim_fga", "operator": ">=", "value": 6.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_defense.defended_at_rim_fg_pct", "operator": "<=", "value": 0.60},
        {"stat": "advanced.blk_pct", "operator": ">=", "value": 0.015},
        {"stat": "tracking_defense.defended_at_rim_fga", "operator": ">=", "value": 4.0}
      ],
      "logic": "AND"
    }
  }
}'),

('rebounder', '{
  "skill_name": "rebounder",
  "skill_category": "additive",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "advanced.reb_pct", "operator": ">=", "value": 0.15}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "advanced.reb_pct", "operator": ">=", "value": 0.10}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {"condition": {"stat": "tracking_rebounding.dreb_contest_pct", "operator": ">=", "value": 0.60}, "effect": "bump_up_one_tier", "max_tier": "Elite"}
  ]
}'),

('offensive_rebounder', '{
  "skill_name": "offensive_rebounder",
  "skill_category": "additive",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_rebounding.oreb_chances", "operator": ">=", "value": 1.5, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "advanced.oreb_pct", "operator": ">=", "value": 0.08},
        {"stat": "tracking_rebounding.oreb_chances", "operator": ">=", "value": 2.5}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "advanced.oreb_pct", "operator": ">=", "value": 0.04},
        {"stat": "tracking_rebounding.oreb_chances", "operator": ">=", "value": 1.5}
      ],
      "logic": "AND"
    }
  }
}'),

-- ---------------------------------------------------------------------------
-- THRESHOLD-BASED SKILLS
-- ---------------------------------------------------------------------------

('point_of_attack_defender', '{
  "skill_name": "point_of_attack_defender",
  "skill_category": "threshold",
  "stat_confidence": "low",
  "always_flag_for_review": true,
  "computed_stats": [
    {
      "name": "poa_defender_composite",
      "formula": "sum",
      "components": [
        {"stat": "advanced.stl_pct", "weight": 10.0},
        {"stat": "tracking_defense.deflections", "weight": 1.0},
        {"stat": "tracking_defense.contested_shots_3pt", "weight": 0.5}
      ]
    }
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_defense.deflections", "operator": ">=", "value": 1.0, "per": "game"},
      {"stat": "advanced.stl_pct", "operator": ">=", "value": 0.01}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "computed.poa_defender_composite", "operator": ">=", "value": 28},
        {"stat": "advanced.stl_pct", "operator": ">=", "value": 0.02},
        {"stat": "tracking_defense.deflections", "operator": ">=", "value": 3.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "computed.poa_defender_composite", "operator": ">=", "value": 18},
        {"stat": "advanced.stl_pct", "operator": ">=", "value": 0.012},
        {"stat": "tracking_defense.deflections", "operator": ">=", "value": 1.5}
      ],
      "logic": "AND"
    }
  }
}'),

('crafty_finisher', '{
  "skill_name": "crafty_finisher",
  "skill_category": "threshold",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "tracking_drives.drive_fg_pct", "K": 50, "league_avg_key": "tracking_drives.drive_fg_pct"},
    {"stat": "shot_zones.paint_non_ra_fg_pct", "K": 60, "league_avg_key": "shot_zones.paint_non_ra_fg_pct"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 4.0, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_drives.drive_fg_pct", "operator": ">=", "value": 0.50, "stabilized": true},
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 8.0},
        {"stat": "advanced.free_throw_rate", "operator": ">=", "value": 0.30},
        {"stat": "shot_zones.paint_non_ra_fg_pct", "operator": ">=", "value": 0.46, "stabilized": true},
        {"stat": "shot_zones.paint_non_ra_fga", "operator": ">=", "value": 1.5}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_drives.drive_fg_pct", "operator": ">=", "value": 0.46, "stabilized": true},
        {"stat": "tracking_drives.drives_per_game", "operator": ">=", "value": 4.0},
        {"stat": "advanced.free_throw_rate", "operator": ">=", "value": 0.22},
        {"stat": "shot_zones.paint_non_ra_fg_pct", "operator": ">=", "value": 0.40, "stabilized": true},
        {"stat": "shot_zones.paint_non_ra_fga", "operator": ">=", "value": 0.8}
      ],
      "logic": "AND"
    }
  }
}'),

('mid_post_player', '{
  "skill_name": "mid_post_player",
  "skill_category": "threshold",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.postup_ppp", "K": 30, "league_avg_key": "play_type.postup_ppp"},
    {"stat": "shot_zones.mid_range_fg_pct", "K": 60, "league_avg_key": "shot_zones.mid_range_fg_pct"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "shot_zones.mid_range_fga", "operator": ">=", "value": 1.5, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "shot_zones.mid_range_fg_pct", "operator": ">=", "value": 0.47, "stabilized": true},
        {"stat": "shot_zones.mid_range_fga", "operator": ">=", "value": 3.0},
        {"stat": "play_type.postup_freq", "operator": ">=", "value": 0.08},
        {
          "logic": "OR",
          "conditions": [
            {"stat": "tracking_elbow_touch.elbow_touches", "operator": ">=", "value": 2.0},
            {"stat": "shot_zones.mid_range_fga_gt_restricted_area", "operator": "==", "value": 1}
          ]
        }
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "shot_zones.mid_range_fg_pct", "operator": ">=", "value": 0.42, "stabilized": true},
        {"stat": "shot_zones.mid_range_fga", "operator": ">=", "value": 1.5},
        {"stat": "play_type.postup_freq", "operator": ">=", "value": 0.04}
      ],
      "logic": "AND"
    }
  }
}'),

('low_post_player', '{
  "skill_name": "low_post_player",
  "skill_category": "threshold",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.postup_ppp", "K": 30, "league_avg_key": "play_type.postup_ppp"},
    {"stat": "tracking_post_touch.post_touch_fg_pct", "K": 50, "league_avg_key": "tracking_post_touch.post_touch_fg_pct"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_post_touch.post_touches", "operator": ">=", "value": 3.0, "per": "game"},
      {"stat": "play_type.postup_poss", "operator": ">=", "value": 75, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_post_touch.post_touch_fg_pct", "operator": ">=", "value": 0.50, "stabilized": true},
        {"stat": "tracking_post_touch.post_touches", "operator": ">=", "value": 5.0},
        {"stat": "play_type.postup_ppp", "operator": ">=", "value": 0.98, "stabilized": true}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_post_touch.post_touch_fg_pct", "operator": ">=", "value": 0.44, "stabilized": true},
        {"stat": "tracking_post_touch.post_touches", "operator": ">=", "value": 3.0},
        {"stat": "play_type.postup_ppp", "operator": ">=", "value": 0.88, "stabilized": true}
      ],
      "logic": "AND"
    }
  }
}'),

('pnr_finisher', '{
  "skill_name": "pnr_finisher",
  "skill_category": "threshold",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.pr_roll_man_ppp", "K": 30, "league_avg_key": "play_type.pr_roll_man_ppp"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "play_type.pr_roll_man_poss", "operator": ">=", "value": 75, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "play_type.pr_roll_man_ppp", "operator": ">=", "value": 1.12, "stabilized": true},
        {"stat": "play_type.pr_roll_man_freq", "operator": ">=", "value": 0.08},
        {"stat": "play_type.pr_roll_man_poss", "operator": ">=", "value": 125, "per": "season"}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "play_type.pr_roll_man_ppp", "operator": ">=", "value": 0.95, "stabilized": true},
        {"stat": "play_type.pr_roll_man_freq", "operator": ">=", "value": 0.04},
        {"stat": "play_type.pr_roll_man_poss", "operator": ">=", "value": 75, "per": "season"}
      ],
      "logic": "AND"
    }
  }
}'),

-- ---------------------------------------------------------------------------
-- ZERO-SUM SKILLS
-- ---------------------------------------------------------------------------

('isolation_scorer', '{
  "skill_name": "isolation_scorer",
  "skill_category": "zero_sum",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "advanced.usage_rate", "operator": ">=", "value": 0.28},
        {"stat": "tracking_possessions.time_of_possession", "operator": ">=", "value": 6.0},
        {"stat": "tracking_possessions.avg_sec_per_touch", "operator": ">=", "value": 4.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "advanced.usage_rate", "operator": ">=", "value": 0.22},
        {"stat": "tracking_possessions.time_of_possession", "operator": ">=", "value": 3.5},
        {"stat": "tracking_possessions.avg_sec_per_touch", "operator": ">=", "value": 3.0}
      ],
      "logic": "AND"
    }
  }
}'),

('pnr_ball_handler', '{
  "skill_name": "pnr_ball_handler",
  "skill_category": "zero_sum",
  "stat_confidence": "moderate",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "play_type.pr_ball_handler_ppp", "K": 30, "league_avg_key": "play_type.pr_ball_handler_ppp"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "play_type.pr_ball_handler_poss", "operator": ">=", "value": 100, "per": "season"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "play_type.pr_ball_handler_ppp", "operator": ">=", "value": 0.95, "stabilized": true},
        {"stat": "play_type.pr_ball_handler_freq", "operator": ">=", "value": 0.15},
        {"stat": "play_type.pr_ball_handler_poss", "operator": ">=", "value": 200, "per": "season"}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "play_type.pr_ball_handler_ppp", "operator": ">=", "value": 0.82, "stabilized": true},
        {"stat": "play_type.pr_ball_handler_freq", "operator": ">=", "value": 0.08},
        {"stat": "play_type.pr_ball_handler_poss", "operator": ">=", "value": 100, "per": "season"}
      ],
      "logic": "AND"
    }
  }
}'),

('off_dribble_shooter', '{
  "skill_name": "off_dribble_shooter",
  "skill_category": "zero_sum",
  "stat_confidence": "high",
  "always_flag_for_review": false,
  "stabilization": [
    {"stat": "tracking_shooting.pullup_fg3_pct", "K": 80, "league_avg_key": "tracking_shooting.pullup_fg3_pct"}
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_shooting.pullup_fg3a", "operator": ">=", "value": 2.0, "per": "game"}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "elite": {
      "conditions": [
        {"stat": "tracking_shooting.pullup_fg3_pct", "operator": ">=", "value": 0.37, "stabilized": true},
        {"stat": "tracking_shooting.pullup_fg3a", "operator": ">=", "value": 4.0}
      ],
      "logic": "AND"
    },
    "capable": {
      "conditions": [
        {"stat": "tracking_shooting.pullup_fg3_pct", "operator": ">=", "value": 0.33, "stabilized": true},
        {"stat": "tracking_shooting.pullup_fg3a", "operator": ">=", "value": 2.0}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {"condition": {"stat": "tracking_shooting.pullup_fg_pct", "operator": ">=", "value": 0.45}, "effect": "bump_up_one_tier", "max_tier": "Elite"}
  ]
}')

ON CONFLICT (skill_name) DO UPDATE SET thresholds = EXCLUDED.thresholds, updated_at = now();
