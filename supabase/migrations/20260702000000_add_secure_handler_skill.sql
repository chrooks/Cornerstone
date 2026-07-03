-- Migration: add_secure_handler_skill (issue #41, ADR 0004)
-- Adds the "secure_handler" threshold skill rule and anchor players.
--
-- Secure Handler protects possessions with a low turnover rate relative to
-- ball responsibility. Primary metric: Oliver turnover percentage
-- (tov / (fga + 0.44*fta + tov)); secondary: turnovers per touch. The
-- responsibility gate (touches >= 30 OR usage >= 18) lives inside the
-- Elite/All-Time Great tier conditions so low-volume players cap at lower
-- tiers instead of vanishing; the volume_gate floor (touches >= 15) only
-- filters end-of-bench noise.
--
-- Note: the working thresholds table is draft_skill_thresholds (renamed from
-- skill_thresholds in 20260527000000); production ratings ship via Snapshot
-- Releases, so no mirror insert exists or is needed.
--
-- always_flag_for_review is deliberately true for the first calibration
-- cycle so the review queue has material; drop to false in a later cycle.

INSERT INTO draft_skill_thresholds (skill_name, thresholds) VALUES (
'secure_handler',
'{
  "skill_name": "secure_handler",
  "skill_category": "threshold",
  "stat_confidence": "high",
  "always_flag_for_review": true,
  "computed_stats": [
    {
      "name": "oliver_denominator",
      "formula": "sum",
      "components": [
        {"stat": "box_score.fga", "weight": 1.0},
        {"stat": "box_score.fta", "weight": 0.44},
        {"stat": "box_score.tov", "weight": 1.0}
      ]
    },
    {
      "name": "tov_pct",
      "formula": "ratio",
      "components": [
        {"role": "numerator", "stat": "box_score.tov"},
        {"role": "denominator", "stat": "computed.oliver_denominator"}
      ]
    },
    {
      "name": "tov_per_touch",
      "formula": "ratio",
      "components": [
        {"role": "numerator", "stat": "box_score.tov"},
        {"role": "denominator", "stat": "tracking_possessions.touches"}
      ]
    },
    {
      "name": "ast_to_ratio",
      "formula": "ratio",
      "components": [
        {"role": "numerator", "stat": "box_score.ast"},
        {"role": "denominator", "stat": "box_score.tov"}
      ]
    }
  ],
  "volume_gate": {
    "conditions": [
      {"stat": "tracking_possessions.touches", "operator": ">=", "value": 15.0}
    ],
    "logic": "AND",
    "fail_tier": "None"
  },
  "tiers": {
    "All-Time Great": {
      "conditions": [
        {"stat": "computed.tov_pct", "operator": "<=", "value": 0.095},
        {"stat": "computed.tov_per_touch", "operator": "<=", "value": 0.025},
        {"stat": "advanced.usage_rate", "operator": ">=", "value": 24.0},
        {
          "conditions": [
            {"stat": "tracking_possessions.touches", "operator": ">=", "value": 30.0},
            {"stat": "advanced.usage_rate", "operator": ">=", "value": 18.0}
          ],
          "logic": "OR"
        }
      ],
      "logic": "AND"
    },
    "Elite": {
      "conditions": [
        {"stat": "computed.tov_pct", "operator": "<=", "value": 0.105},
        {"stat": "computed.tov_per_touch", "operator": "<=", "value": 0.025},
        {
          "conditions": [
            {"stat": "tracking_possessions.touches", "operator": ">=", "value": 30.0},
            {"stat": "advanced.usage_rate", "operator": ">=", "value": 18.0}
          ],
          "logic": "OR"
        }
      ],
      "logic": "AND"
    },
    "Proficient": {
      "conditions": [
        {"stat": "computed.tov_pct", "operator": "<=", "value": 0.125},
        {"stat": "computed.tov_per_touch", "operator": "<=", "value": 0.035}
      ],
      "logic": "AND"
    },
    "Capable": {
      "conditions": [
        {"stat": "computed.tov_pct", "operator": "<=", "value": 0.14},
        {"stat": "computed.tov_per_touch", "operator": "<=", "value": 0.045}
      ],
      "logic": "AND"
    }
  },
  "tier_bumps": [
    {
      "condition": {
        "conditions": [
          {"stat": "computed.tov_pct", "operator": "<=", "value": 0.105},
          {"stat": "advanced.usage_rate", "operator": ">=", "value": 28.0}
        ],
        "logic": "AND"
      },
      "effect": "bump_up_one_tier",
      "max_tier": "All-Time Great"
    },
    {
      "condition": {
        "conditions": [
          {"stat": "computed.ast_to_ratio", "operator": ">=", "value": 3.5},
          {"stat": "box_score.ast", "operator": ">=", "value": 4.0}
        ],
        "logic": "AND"
      },
      "effect": "bump_up_one_tier",
      "max_tier": "Elite"
    }
  ],
  "stabilization": [],
  "pre_adjustments": [],
  "auto_promotions": []
}'
) ON CONFLICT (skill_name) DO NOTHING;

-- Insert anchor players (requires player records to exist).
-- Each INSERT uses SELECT ... WHERE ... LIMIT 1 so that if the player does not
-- yet exist in the players table the INSERT is a safe no-op (0 rows inserted).

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'secure_handler', 'Elite', 'Elite turnover economy at high assist volume (~9.9% TOV at ~10 apg, 2024-25)'
FROM players p WHERE p.name = 'Tyrese Haliburton' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'secure_handler', 'Proficient', 'Careful playmaker; Oliver TOV% understates playmakers — verify the AST/TO bump lifts him'
FROM players p WHERE p.name = 'Chris Paul' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'secure_handler', 'Capable', 'High-usage star on the Capable/None boundary — turnover-prone at volume'
FROM players p WHERE p.name = 'Trae Young' LIMIT 1;

INSERT INTO anchor_players (player_id, skill_name, expected_tier, notes)
SELECT p.id, 'secure_handler', 'None', 'Low-usage wing; low raw TOV but should cap on responsibility, not rate as secure'
FROM players p WHERE p.name = 'Max Strus' LIMIT 1;
