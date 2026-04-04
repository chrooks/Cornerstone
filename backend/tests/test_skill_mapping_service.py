"""
tests/test_skill_mapping_service.py — Unit tests for the skill mapping rule engine.

All tests operate on in-memory stats blobs and rule dicts — no Supabase connection required.

Coverage:
  1. resolve_stat          — dot-path resolution, missing keys, computed namespace
  2. evaluate_condition    — all operators, per="season" scaling, null → None
  3. evaluate_conditions_block — AND/OR logic, one level of nesting, None propagation
  4. apply_stabilization   — Bayesian formula, pct and ppp types, spot-checks
  5. apply_pre_adjustments — conditional stat addition (screen setter)
  6. compute_derived_stats — sum formula, weighted_average, ratio, expression (POA composite)
  7. evaluate_skill        — full pipeline: volume gate, tier cascade, tier bump, null data
  8. apply_auto_promotions — promotes target skill, never demotes, processes after all skills
  9. _blend_blobs / get_weighted_stats — historical weighting, weight redistribution
 10. Acceptance criteria spot-checks from prompt4_final.md
"""

import pytest

# ---------------------------------------------------------------------------
# Service functions under test
# ---------------------------------------------------------------------------
from services.skill_mapping_service import (
    resolve_stat,
    evaluate_condition,
    evaluate_conditions_block,
    apply_stabilization,
    apply_pre_adjustments,
    compute_derived_stats,
    evaluate_skill,
    evaluate_all_skills,
    apply_auto_promotions,
    _blend_blobs,
)


# ===========================================================================
# Fixtures — reusable stats blobs and rule fragments
# ===========================================================================


def _make_stats_blob(**overrides) -> dict:
    """
    Build a minimal stats blob that satisfies the structure expected by the engine.
    Pass section.key overrides as keyword args using double-underscore as separator,
    e.g., tracking_shooting__catch_shoot_fg3_pct=0.41.
    """
    blob: dict = {
        "box_score": {"fga": 12.0, "fg_pct": 0.48},
        "advanced": {
            "usage_rate": 20.0,
            "ast_pct": 0.15,
            "stl_pct": 1.5,
            "oreb_pct": 5.0,
            "dreb_pct": 12.0,
            "reb_pct": 8.5,
            "blk_pct": 1.0,
            "free_throw_rate": 0.25,
        },
        "tracking_shooting": {
            "catch_shoot_fg3_pct": 0.37,
            "catch_shoot_fg3a": 3.0,
            "pullup_fg3_pct": 0.33,
            "pullup_fg3a": 2.5,
        },
        "tracking_drives": {"drives_per_game": 5.0, "drive_fg_pct": 0.47},
        "tracking_passing": {"potential_assists": 6.0, "secondary_assists": 1.5},
        "tracking_defense": {
            "contested_shots_3pt": 1.5,
            "contested_shots_2pt": 3.0,
            "deflections": 2.0,
            "defended_at_rim_fga": 3.0,
            "defended_at_rim_fg_pct": 0.58,
        },
        "tracking_possessions": {
            "touches": 60.0,
            "time_of_possession": 4.0,
            "avg_sec_per_touch": 3.5,
        },
        "tracking_rebounding": {
            "oreb_chances": 2.0,
            "dreb_chances": 6.0,
            "dreb_contest_pct": 55.0,
        },
        "tracking_paint_touch": {"paint_touch_fg_pct": 0.48},
        "tracking_post_touch": {
            "post_touches": 4.0,
            "post_touch_fg_pct": 0.46,
        },
        "tracking_elbow_touch": {"elbow_touches": 1.5},
        "shot_zones": {
            "dunk_fga": 1.8,
            "restricted_area_fga": 4.0,
            "restricted_area_fg_pct": 0.62,
            "paint_non_ra_fga": 1.5,
            "paint_non_ra_fg_pct": 0.42,
            "mid_range_fga": 2.0,
            "mid_range_fg_pct": 0.43,
        },
        "shot_detail": {
            "alley_oop_fgm": 0.5,
            "driving_dunk_fgm": 1.0,
            "floating_jump_shot_fga": 0.8,
            "floating_jump_shot_fg_pct": 0.44,
        },
        "play_type": {
            "spotup_freq": 0.15,
            "spotup_ppp": 1.02,
            "spotup_poss": 120,       # season total
            "offscreen_freq": 0.08,
            "offscreen_ppp": 0.96,
            "offscreen_poss": 60,     # season total
            "handoff_freq": 0.05,
            "handoff_ppp": 0.92,
            "handoff_poss": 40,       # season total
            "cut_freq": 0.07,
            "cut_ppp": 1.15,
            "cut_poss": 70,           # season total
            "transition_freq": 0.04,
            "transition_ppp": 1.05,
            "transition_poss": 80,    # season total
            "pr_ball_handler_freq": 0.10,
            "pr_ball_handler_ppp": 0.88,
            "pr_ball_handler_poss": 110,  # season total
            "pr_roll_man_freq": 0.06,
            "pr_roll_man_ppp": 0.97,
            "pr_roll_man_poss": 80,   # season total
            "postup_freq": 0.05,
            "postup_ppp": 0.92,
            "postup_poss": 60,        # season total
        },
        "hustle": {
            "screen_assists": 3.0,
            "screen_assist_pts": 7.0,
            "box_outs_off": 1.5,
        },
        "matchup_defense": {
            "positional_groups_guarded": 3,
            "cross_group_fg_pct_diff": 0.02,
            "total_matchup_poss": 250,
        },
        "metadata": {
            "season": "2025-26",
            "games_played": 65,
            "minutes_per_game": 28.0,
        },
    }

    # Apply dot-separated overrides (double-underscore → dot in section.key)
    for key, value in overrides.items():
        section, stat = key.split("__", 1)
        if section not in blob:
            blob[section] = {}
        blob[section][stat] = value

    return blob


# ===========================================================================
# 1. resolve_stat
# ===========================================================================


class TestResolveStat:

    def test_resolves_nested_path(self):
        """Standard section.key path resolves correctly."""
        blob = _make_stats_blob()
        assert resolve_stat(blob, "tracking_shooting.catch_shoot_fg3_pct") == pytest.approx(0.37)

    def test_returns_none_for_missing_section(self):
        blob = _make_stats_blob()
        assert resolve_stat(blob, "nonexistent_section.some_key") is None

    def test_returns_none_for_missing_key(self):
        blob = _make_stats_blob()
        assert resolve_stat(blob, "tracking_shooting.nonexistent_key") is None

    def test_returns_none_for_null_value(self):
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        assert resolve_stat(blob, "tracking_shooting.catch_shoot_fg3_pct") is None

    def test_coerces_int_to_float(self):
        blob = _make_stats_blob()
        blob["play_type"]["cut_poss"] = 70  # integer
        result = resolve_stat(blob, "play_type.cut_poss")
        assert isinstance(result, float)
        assert result == 70.0

    def test_resolves_computed_namespace(self):
        """Values in the "computed" sub-dict are reachable via computed.X paths."""
        blob = _make_stats_blob()
        blob["computed"] = {"passer_composite": 11.25}
        assert resolve_stat(blob, "computed.passer_composite") == pytest.approx(11.25)

    def test_top_level_key_without_dot(self):
        """Single-part paths look in the top-level dict."""
        blob = {"my_key": 42.0}
        assert resolve_stat(blob, "my_key") == 42.0


# ===========================================================================
# 2. evaluate_condition
# ===========================================================================


class TestEvaluateCondition:

    def _make_cond(self, stat, op, value, per=None):
        c = {"stat": stat, "operator": op, "value": value}
        if per:
            c["per"] = per
        return c

    def test_gte_passes(self):
        blob = _make_stats_blob()
        cond = self._make_cond("tracking_shooting.catch_shoot_fg3_pct", ">=", 0.37)
        assert evaluate_condition(cond, blob, 65) is True

    def test_gte_fails(self):
        blob = _make_stats_blob()
        cond = self._make_cond("tracking_shooting.catch_shoot_fg3_pct", ">=", 0.40)
        assert evaluate_condition(cond, blob, 65) is False

    def test_lte_passes(self):
        blob = _make_stats_blob()
        cond = self._make_cond("matchup_defense.cross_group_fg_pct_diff", "<=", 0.03)
        assert evaluate_condition(cond, blob, 65) is True

    def test_lte_fails(self):
        blob = _make_stats_blob()
        cond = self._make_cond("matchup_defense.cross_group_fg_pct_diff", "<=", 0.01)
        assert evaluate_condition(cond, blob, 65) is False

    def test_gt_passes(self):
        blob = _make_stats_blob()
        cond = self._make_cond("advanced.usage_rate", ">", 19.0)
        assert evaluate_condition(cond, blob, 65) is True

    def test_lt_passes(self):
        blob = _make_stats_blob()
        cond = self._make_cond("advanced.usage_rate", "<", 21.0)
        assert evaluate_condition(cond, blob, 65) is True

    def test_eq_passes(self):
        blob = _make_stats_blob()
        cond = self._make_cond("metadata.games_played", "==", 65)
        assert evaluate_condition(cond, blob, 65) is True

    def test_null_stat_returns_none(self):
        """A missing stat makes the condition indeterminate — returns None."""
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        cond = self._make_cond("tracking_shooting.catch_shoot_fg3_pct", ">=", 0.37)
        assert evaluate_condition(cond, blob, 65) is None

    def test_missing_stat_path_returns_none(self):
        blob = _make_stats_blob()
        cond = self._make_cond("tracking_shooting.no_such_stat", ">=", 0.37)
        assert evaluate_condition(cond, blob, 65) is None

    def test_per_season_scales_per_game_stat(self):
        """per='season' multiplies the per-game value by games_played before comparing."""
        blob = _make_stats_blob(shot_detail__alley_oop_fgm=0.5)
        # 0.5 * 65 = 32.5, which is >= 30
        cond = self._make_cond("shot_detail.alley_oop_fgm", ">=", 30, per="season")
        assert evaluate_condition(cond, blob, 65) is True

    def test_per_season_fails_when_scaled_below_threshold(self):
        blob = _make_stats_blob(shot_detail__alley_oop_fgm=0.3)
        # 0.3 * 65 = 19.5, which is < 30
        cond = self._make_cond("shot_detail.alley_oop_fgm", ">=", 30, per="season")
        assert evaluate_condition(cond, blob, 65) is False

    def test_per_season_play_type_poss_not_scaled(self):
        """play_type._poss stats are already season totals — must NOT be multiplied."""
        blob = _make_stats_blob(play_type__cut_poss=70)  # already season total
        # Should compare 70 (raw) >= 50, not 70 * 65 >= 50
        cond = self._make_cond("play_type.cut_poss", ">=", 50, per="season")
        assert evaluate_condition(cond, blob, 65) is True

        # Would be obviously True either way for cut_poss=70, so test the tight case
        cond_fail = self._make_cond("play_type.cut_poss", ">=", 80, per="season")
        assert evaluate_condition(cond_fail, blob, 65) is False


# ===========================================================================
# 3. evaluate_conditions_block
# ===========================================================================


class TestEvaluateConditionsBlock:

    def _stat(self, val: float) -> dict:
        return {"tracking_shooting": {"catch_shoot_fg3_pct": val}}

    def test_and_all_pass(self):
        blob = _make_stats_blob()
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is True

    def test_and_one_fails(self):
        blob = _make_stats_blob()
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 10.0},  # fails
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is False

    def test_or_at_least_one_passes(self):
        blob = _make_stats_blob()
        block = {
            "logic": "OR",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.50},  # fails
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},    # passes
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is True

    def test_or_all_fail(self):
        blob = _make_stats_blob()
        block = {
            "logic": "OR",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.50},
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 10.0},
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is False

    def test_nested_and_containing_or(self):
        """AND block with an OR sub-block: a >= 0.35 AND (b >= 1.0 OR c >= 2.0)."""
        blob = _make_stats_blob()
        # tracking_shooting.catch_shoot_fg3_pct = 0.37 ✓
        # tracking_defense.deflections = 2.0, contested_shots_3pt = 1.5
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},
                {
                    "logic": "OR",
                    "conditions": [
                        {"stat": "tracking_defense.deflections", "operator": ">=", "value": 5.0},  # fails
                        {"stat": "tracking_defense.contested_shots_3pt", "operator": ">=", "value": 1.0},  # passes
                    ],
                },
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is True

    def test_nested_and_containing_or_where_or_fails(self):
        blob = _make_stats_blob()
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},
                {
                    "logic": "OR",
                    "conditions": [
                        {"stat": "tracking_defense.deflections", "operator": ">=", "value": 5.0},   # fails
                        {"stat": "tracking_defense.contested_shots_3pt", "operator": ">=", "value": 5.0},  # fails
                    ],
                },
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is False

    def test_and_with_null_returns_none(self):
        """AND logic with a missing stat is indeterminate (None) unless a False already exists."""
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},  # None
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},      # True
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is None

    def test_and_false_beats_none(self):
        """AND short-circuits to False even when another condition returns None."""
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},  # None
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 100.0},    # False
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is False

    def test_or_true_beats_none(self):
        """OR short-circuits to True even when another condition returns None."""
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        block = {
            "logic": "OR",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},  # None
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},      # True
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is True

    def test_depth_two_nesting(self):
        """Recursion handles AND → OR → AND (depth-2) correctly."""
        blob = _make_stats_blob()
        # Outer AND: fg3_pct >= 0.35 AND (inner OR: deflections >= 5 OR (inner AND: dunk_fga >= 1 AND contested_3pt >= 1))
        # Only the innermost AND branch passes.
        block = {
            "logic": "AND",
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.35},  # True
                {
                    "logic": "OR",
                    "conditions": [
                        {"stat": "tracking_defense.deflections", "operator": ">=", "value": 5.0},  # False
                        {
                            "logic": "AND",
                            "conditions": [
                                {"stat": "shot_zones.dunk_fga", "operator": ">=", "value": 1.0},   # True (1.8)
                                {"stat": "tracking_defense.contested_shots_3pt", "operator": ">=", "value": 1.0},  # True (1.5)
                            ],
                        },
                    ],
                },
            ],
        }
        assert evaluate_conditions_block(block, blob, 65) is True

    def test_empty_block_always_passes(self):
        assert evaluate_conditions_block({"logic": "AND", "conditions": []}, {}, 0) is True


# ===========================================================================
# 4. apply_stabilization
# ===========================================================================


# League averages used in stabilization tests
_TEST_LEAGUE_AVGS = {
    "tracking_shooting.catch_shoot_fg3_pct": 0.37,
    "tracking_shooting.pullup_fg3_pct": 0.32,
    "play_type.cut_ppp": 1.10,
    "play_type.spotup_ppp": 1.00,
}


def _stab_rule(stat: str, K: int) -> dict:
    """Minimal rule dict with a single stabilization entry."""
    return {
        "stabilization": [
            {"stat": stat, "K": K, "league_avg_key": stat}
        ]
    }


class TestApplyStabilization:

    def test_pct_stat_stabilized_toward_league_avg(self):
        """A player with few attempts should be pulled toward the league average."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.50,  # raw = 50%
            tracking_shooting__catch_shoot_fg3a=1.0,       # 1 attempt/game
        )
        blob["metadata"]["games_played"] = 50  # 50 attempts total
        rule = _stab_rule("tracking_shooting.catch_shoot_fg3_pct", K=100)

        result = apply_stabilization(rule, blob, 50, _TEST_LEAGUE_AVGS)
        stab_val = result.get("stabilized.tracking_shooting.catch_shoot_fg3_pct")

        # Stabilized = (50*0.50 + 100*0.37) / (50 + 100) = (25 + 37) / 150 ≈ 0.413
        assert stab_val is not None
        assert 0.37 < stab_val < 0.50, f"Expected pull toward 0.37, got {stab_val}"

    def test_high_volume_barely_moves(self):
        """A player with many attempts should barely move toward league average."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.40,
            tracking_shooting__catch_shoot_fg3a=5.0,   # 5 attempts/game
        )
        blob["metadata"]["games_played"] = 60  # 300 attempts total
        rule = _stab_rule("tracking_shooting.catch_shoot_fg3_pct", K=100)

        result = apply_stabilization(rule, blob, 60, _TEST_LEAGUE_AVGS)
        stab_val = result.get("stabilized.tracking_shooting.catch_shoot_fg3_pct")

        # Stabilized = (300*0.40 + 100*0.37) / (300 + 100) = (120 + 37) / 400 = 0.3925
        # The move is small: 0.400 → 0.3925 (< 1% shift), confirming high-volume stability.
        assert stab_val is not None
        assert 0.390 <= stab_val <= 0.400, (
            f"High volume should barely move: expected ~0.3925, got {stab_val}"
        )

    def test_acceptance_criteria_spot_check_50_attempts(self):
        """AC: player with 0.500 C&S 3P% on 50 total attempts → pulled significantly toward 0.37."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.500,
            tracking_shooting__catch_shoot_fg3a=1.0,  # 1/game × 50 games = 50 attempts
        )
        blob["metadata"]["games_played"] = 50
        rule = _stab_rule("tracking_shooting.catch_shoot_fg3_pct", K=100)

        result = apply_stabilization(rule, blob, 50, _TEST_LEAGUE_AVGS)
        stab_val = result["stabilized.tracking_shooting.catch_shoot_fg3_pct"]

        assert 0.37 < stab_val < 0.50, f"AC spot-check failed: got {stab_val}"

    def test_acceptance_criteria_spot_check_300_attempts(self):
        """AC: player with 0.400 C&S 3P% on 300 attempts → barely moves (< 1% shift)."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.400,
            tracking_shooting__catch_shoot_fg3a=5.0,  # 5/game × 60 games = 300 attempts
        )
        blob["metadata"]["games_played"] = 60
        rule = _stab_rule("tracking_shooting.catch_shoot_fg3_pct", K=100)

        result = apply_stabilization(rule, blob, 60, _TEST_LEAGUE_AVGS)
        stab_val = result["stabilized.tracking_shooting.catch_shoot_fg3_pct"]

        # With 300 attempts and K=100: stabilized = (120 + 37) / 400 = 0.3925
        # Only a ~0.75% shift from raw 0.400 — confirming "barely moves" with high volume.
        raw_val = 0.400
        assert abs(stab_val - raw_val) < 0.01, (
            f"High-volume player should barely move: raw={raw_val}, stabilized={stab_val:.4f}"
        )

    def test_ppp_stat_uses_poss_as_attempts(self):
        """PPP stats use the corresponding _poss stat as the attempt count."""
        blob = _make_stats_blob(
            play_type__cut_ppp=1.30,
            play_type__cut_poss=60,  # season total
        )
        rule = _stab_rule("play_type.cut_ppp", K=30)

        result = apply_stabilization(rule, {"play_type": blob["play_type"]}, 65, _TEST_LEAGUE_AVGS)
        stab_val = result.get("stabilized.play_type.cut_ppp")

        # Stabilized = (1.30*60 + 30*1.10) / (60 + 30) = (78 + 33) / 90 = 1.233
        assert stab_val is not None
        assert 1.10 < stab_val < 1.30, f"PPP should be pulled toward 1.10, got {stab_val}"

    def test_missing_league_avg_skips_stabilization(self):
        """If no league average is available, the stat is not stabilized."""
        blob = _make_stats_blob()
        rule = {"stabilization": [{"stat": "tracking_drives.drive_fg_pct", "K": 50}]}

        result = apply_stabilization(rule, blob, 65, {})  # empty league avgs
        assert "stabilized.tracking_drives.drive_fg_pct" not in result

    def test_zero_attempts_skips_stabilization(self):
        """Zero per-game attempts → can't compute season total → skip."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.40,
            tracking_shooting__catch_shoot_fg3a=0.0,
        )
        rule = _stab_rule("tracking_shooting.catch_shoot_fg3_pct", K=100)
        result = apply_stabilization(rule, blob, 65, _TEST_LEAGUE_AVGS)
        assert "stabilized.tracking_shooting.catch_shoot_fg3_pct" not in result


# ===========================================================================
# 5. apply_pre_adjustments
# ===========================================================================


class TestApplyPreAdjustments:

    def _screen_setter_rule(self) -> dict:
        return {
            "pre_adjustments": [
                {
                    "if": {"stat": "hustle.box_outs_off", "operator": ">=", "value": 2.0},
                    "then_add": 0.5,
                    "to_stat": "hustle.screen_assists",
                }
            ]
        }

    def test_adjustment_applied_when_condition_passes(self):
        """AC: player with 3.8 screen assists and 2.5 box_outs_off → adjusted to 4.3."""
        blob = _make_stats_blob(
            hustle__screen_assists=3.8,
            hustle__box_outs_off=2.5,
        )
        result = apply_pre_adjustments(self._screen_setter_rule(), blob)
        assert result["hustle"]["screen_assists"] == pytest.approx(4.3)

    def test_adjustment_not_applied_when_condition_fails(self):
        """AC: player with 1.0 box_outs_off → no adjustment (3.8 stays 3.8)."""
        blob = _make_stats_blob(
            hustle__screen_assists=3.8,
            hustle__box_outs_off=1.0,
        )
        result = apply_pre_adjustments(self._screen_setter_rule(), blob)
        assert result["hustle"]["screen_assists"] == pytest.approx(3.8)

    def test_does_not_mutate_original(self):
        """Pre-adjustments must return a modified copy, not mutate the input."""
        blob = _make_stats_blob(hustle__screen_assists=3.8, hustle__box_outs_off=2.5)
        original_val = blob["hustle"]["screen_assists"]
        apply_pre_adjustments(self._screen_setter_rule(), blob)
        assert blob["hustle"]["screen_assists"] == original_val

    def test_no_pre_adjustments_returns_same_object(self):
        """If no pre_adjustments in rule, the same (or identical) stats_map is returned."""
        blob = _make_stats_blob()
        result = apply_pre_adjustments({}, blob)
        assert result is blob  # No copy needed — same reference is fine


# ===========================================================================
# 6. compute_derived_stats
# ===========================================================================


class TestComputeDerivedStats:

    def test_sum_formula_passer_composite(self):
        """AC: potential_assists 8.0 + secondary_assists 2.0 × 1.5 = 11.0."""
        blob = _make_stats_blob(
            tracking_passing__potential_assists=8.0,
            tracking_passing__secondary_assists=2.0,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "passer_composite",
                    "formula": "sum",
                    "components": [
                        {"stat": "tracking_passing.potential_assists", "weight": 1.0},
                        {"stat": "tracking_passing.secondary_assists", "weight": 1.5},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert result["computed"]["passer_composite"] == pytest.approx(11.0)

    def test_sum_formula_with_all_weight_one(self):
        """Sum of two equal-weight components."""
        blob = _make_stats_blob(
            play_type__offscreen_freq=0.08,
            play_type__handoff_freq=0.05,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "combined_freq",
                    "formula": "sum",
                    "components": [
                        {"stat": "play_type.offscreen_freq", "weight": 1.0},
                        {"stat": "play_type.handoff_freq", "weight": 1.0},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert result["computed"]["combined_freq"] == pytest.approx(0.13)

    def test_expression_poa_defender_composite(self):
        """AC: stl_pct 0.02 × 1000 + deflections 3.5 + contested_3pt 2.0 × 0.5 = 24.5."""
        blob = _make_stats_blob(
            advanced__stl_pct=0.02,  # stored as decimal fraction (0.02 = 2%)
            tracking_defense__deflections=3.5,
            tracking_defense__contested_shots_3pt=2.0,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "poa_defender_composite",
                    "formula": "expression",
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert result["computed"]["poa_defender_composite"] == pytest.approx(24.5)

    def test_weighted_average_formula(self):
        """Weighted average PPP by possession count."""
        blob = _make_stats_blob(
            play_type__offscreen_ppp=1.10,
            play_type__offscreen_poss=60,
            play_type__handoff_ppp=0.90,
            play_type__handoff_poss=40,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "weighted_ppp",
                    "formula": "weighted_average",
                    "components": [
                        {"stat": "play_type.offscreen_ppp", "weight_stat": "play_type.offscreen_poss"},
                        {"stat": "play_type.handoff_ppp", "weight_stat": "play_type.handoff_poss"},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        # (1.10 * 60 + 0.90 * 40) / (60 + 40) = (66 + 36) / 100 = 1.02
        assert result["computed"]["weighted_ppp"] == pytest.approx(1.02)

    def test_ratio_formula(self):
        """Ratio: driving_dunk_fgm / dunk_fga."""
        blob = _make_stats_blob(
            shot_detail__driving_dunk_fgm=1.5,
            shot_zones__dunk_fga=2.5,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "self_created_dunk_ratio",
                    "formula": "ratio",
                    "components": [
                        {"stat": "shot_detail.driving_dunk_fgm", "role": "numerator"},
                        {"stat": "shot_zones.dunk_fga", "role": "denominator"},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert result["computed"]["self_created_dunk_ratio"] == pytest.approx(0.60)

    def test_missing_component_returns_none(self):
        """If a component stat is missing, the computed result is None."""
        blob = _make_stats_blob()
        blob["tracking_passing"]["secondary_assists"] = None
        rule = {
            "computed_stats": [
                {
                    "name": "passer_composite",
                    "formula": "sum",
                    "components": [
                        {"stat": "tracking_passing.potential_assists", "weight": 1.0},
                        {"stat": "tracking_passing.secondary_assists", "weight": 1.5},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert result["computed"]["passer_composite"] is None

    def test_computed_stats_available_via_computed_namespace(self):
        """Computed stats are accessible via resolve_stat with 'computed.X' path."""
        blob = _make_stats_blob(
            tracking_passing__potential_assists=8.0,
            tracking_passing__secondary_assists=2.0,
        )
        rule = {
            "computed_stats": [
                {
                    "name": "passer_composite",
                    "formula": "sum",
                    "components": [
                        {"stat": "tracking_passing.potential_assists", "weight": 1.0},
                        {"stat": "tracking_passing.secondary_assists", "weight": 1.5},
                    ],
                }
            ]
        }
        result = compute_derived_stats(rule, blob)
        assert resolve_stat(result, "computed.passer_composite") == pytest.approx(11.0)


# ===========================================================================
# 7. evaluate_skill — full pipeline
# ===========================================================================


# A minimal "spot_up_shooter" rule matching the migration schema
_SPOT_UP_RULE = {
    "skill_name": "spot_up_shooter",
    "skill_category": "additive",
    "stat_confidence": "high",
    "always_flag_for_review": False,
    "stabilization": [
        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "K": 100, "league_avg_key": "tracking_shooting.catch_shoot_fg3_pct"}
    ],
    "volume_gate": {
        "conditions": [
            {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0, "per": "game"},
            {"stat": "play_type.spotup_poss", "operator": ">=", "value": 50, "per": "season"},
        ],
        "logic": "AND",
        "fail_tier": "None",
    },
    "tiers": {
        "Elite": {
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.40, "stabilized": True},
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 3.0},
            ],
            "logic": "AND",
        },
        "Capable": {
            "conditions": [
                {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.36, "stabilized": True},
                {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},
            ],
            "logic": "AND",
        },
    },
    "tier_bumps": [
        {
            "condition": {"stat": "play_type.spotup_ppp", "operator": ">=", "value": 1.05},
            "effect": "bump_up_one_tier",
            "max_tier": "Elite",
        }
    ],
}


class TestEvaluateSkill:

    def _league_avgs(self):
        return {"tracking_shooting.catch_shoot_fg3_pct": 0.37}

    def test_elite_shooter(self):
        """A player above Elite thresholds (even after stabilization) is Elite."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.45,
            tracking_shooting__catch_shoot_fg3a=4.0,
            play_type__spotup_poss=150,
        )
        blob["metadata"]["games_played"] = 65
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        assert result["tier"] == "Elite"
        assert result["volume_gate_passed"] is True

    def test_capable_shooter(self):
        """A player between Capable and Elite thresholds is Capable."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.38,
            tracking_shooting__catch_shoot_fg3a=2.5,
            play_type__spotup_poss=80,
        )
        blob["metadata"]["games_played"] = 65
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        assert result["tier"] == "Capable"

    def test_below_volume_gate_is_none(self):
        """AC: player with 0.450 C&S 3P% on 0.5 attempts/game is None (below volume gate)."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.45,
            tracking_shooting__catch_shoot_fg3a=0.5,  # below 2.0 volume gate
            play_type__spotup_poss=150,
        )
        blob["metadata"]["games_played"] = 65
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        assert result["tier"] == "None"
        assert result["volume_gate_passed"] is False

    def test_null_stat_triggers_data_missing(self):
        """A null stat in tier conditions sets tier=None, data_missing=True, review_recommended=True."""
        blob = _make_stats_blob()
        blob["tracking_shooting"]["catch_shoot_fg3_pct"] = None
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        assert result["data_missing"] is True
        assert result["review_recommended"] is True

    def test_stat_confidence_from_rule(self):
        """stat_confidence must come from the rule, not be derived from games_played."""
        blob = _make_stats_blob()
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        assert result["stat_confidence"] == "high"

    def test_always_flag_for_review(self):
        """Skills with always_flag_for_review=True always have review_recommended=True."""
        flagged_rule = dict(_SPOT_UP_RULE, always_flag_for_review=True)
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.45,
            tracking_shooting__catch_shoot_fg3a=4.0,
            play_type__spotup_poss=150,
        )
        result = evaluate_skill("spot_up_shooter", flagged_rule, blob, self._league_avgs())
        assert result["review_recommended"] is True

    def test_tier_bump_from_capable_to_elite(self):
        """A player at Capable with high spotup_ppp should be bumped to Elite."""
        # Set up a player just below Elite C&S pct but high spotup PPP
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.37,   # stabilizes to ~0.37 → barely Capable
            tracking_shooting__catch_shoot_fg3a=2.5,
            play_type__spotup_poss=100,
            play_type__spotup_ppp=1.10,  # above 1.05 bump threshold
        )
        blob["metadata"]["games_played"] = 65
        # Use a rule with a very low Elite threshold to guarantee Capable first
        rule = {
            **_SPOT_UP_RULE,
            "tiers": {
                "Elite": {
                    "conditions": [
                        {"stat": "tracking_shooting.catch_shoot_fg3_pct", "operator": ">=", "value": 0.99},  # impossible
                    ],
                    "logic": "AND",
                },
                "Capable": {
                    "conditions": [
                        {"stat": "tracking_shooting.catch_shoot_fg3a", "operator": ">=", "value": 2.0},
                    ],
                    "logic": "AND",
                },
            },
        }
        result = evaluate_skill("spot_up_shooter", rule, blob, self._league_avgs())
        assert result["tier"] == "Elite"
        assert result["tier_bump_applied"] is True

    def test_result_shape(self):
        """Response must include all required keys from the spec."""
        blob = _make_stats_blob()
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        required_keys = {
            "skill_name", "tier", "stat_confidence", "review_recommended",
            "data_missing", "driving_stats", "volume_gate_passed",
            "tier_bump_applied", "auto_promoted", "flags",
        }
        assert required_keys.issubset(result.keys())

    def test_driving_stats_includes_referenced_stats(self):
        """driving_stats should include values for stats referenced in tier conditions."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.42,
            tracking_shooting__catch_shoot_fg3a=3.5,
            play_type__spotup_poss=130,
        )
        blob["metadata"]["games_played"] = 65
        result = evaluate_skill("spot_up_shooter", _SPOT_UP_RULE, blob, self._league_avgs())
        # The tier conditions reference catch_shoot_fg3a and catch_shoot_fg3_pct
        assert "tracking_shooting.catch_shoot_fg3a" in result["driving_stats"]

    def test_cutter_below_volume_gate(self):
        """AC: a player with 30 total cut possessions is None for Cutter (below 50 gate)."""
        cutter_rule = {
            "skill_name": "cutter",
            "stat_confidence": "moderate",
            "always_flag_for_review": False,
            "stabilization": [{"stat": "play_type.cut_ppp", "K": 30, "league_avg_key": "play_type.cut_ppp"}],
            "volume_gate": {
                "conditions": [
                    {"stat": "play_type.cut_poss", "operator": ">=", "value": 50, "per": "season"}
                ],
                "logic": "AND",
                "fail_tier": "None",
            },
            "tiers": {
                "Elite": {
                    "conditions": [
                        {"stat": "play_type.cut_freq", "operator": ">=", "value": 0.10},
                        {"stat": "play_type.cut_ppp", "operator": ">=", "value": 1.25},
                    ],
                    "logic": "AND",
                },
                "Capable": {
                    "conditions": [
                        {"stat": "play_type.cut_freq", "operator": ">=", "value": 0.05},
                        {"stat": "play_type.cut_ppp", "operator": ">=", "value": 1.10},
                    ],
                    "logic": "AND",
                },
            },
        }
        blob = _make_stats_blob(play_type__cut_poss=30, play_type__cut_freq=0.12, play_type__cut_ppp=1.30)
        result = evaluate_skill("cutter", cutter_rule, blob, {})
        assert result["tier"] == "None"
        assert result["volume_gate_passed"] is False


# ===========================================================================
# 8. apply_auto_promotions
# ===========================================================================


class TestApplyAutoPromotions:

    def _make_skills_result(self, movement_tier: str, spotup_tier: str) -> dict[str, dict]:
        return {
            "movement_shooter": {
                "tier": movement_tier,
                "auto_promoted": False,
                "stat_confidence": "moderate",
            },
            "spot_up_shooter": {
                "tier": spotup_tier,
                "auto_promoted": False,
                "stat_confidence": "high",
            },
        }

    def _movement_thresholds(self) -> dict:
        return {
            "movement_shooter": {
                "auto_promotions": [
                    {
                        "if_tier_gte": "Capable",
                        "then_set_skill": "spot_up_shooter",
                        "to_minimum_tier": "Capable",
                    }
                ]
            },
            "spot_up_shooter": {},
        }

    def test_capable_movement_promotes_none_spotup(self):
        """AC: Movement Shooter Capable + Spot-up None → Spot-up promoted to Capable."""
        skills = self._make_skills_result("Capable", "None")
        result = apply_auto_promotions(skills, self._movement_thresholds())
        assert result["spot_up_shooter"]["tier"] == "Capable"
        assert result["spot_up_shooter"]["auto_promoted"] is True

    def test_elite_movement_promotes_none_spotup_to_capable(self):
        """AC: Movement Shooter Elite + Spot-up None → Spot-up at least Capable."""
        skills = self._make_skills_result("Elite", "None")
        result = apply_auto_promotions(skills, self._movement_thresholds())
        assert result["spot_up_shooter"]["tier"] == "Capable"
        assert result["spot_up_shooter"]["auto_promoted"] is True

    def test_auto_promotion_never_demotes(self):
        """AC: A player already Elite in Spot-up is unaffected by auto-promotion."""
        skills = self._make_skills_result("Capable", "Elite")
        result = apply_auto_promotions(skills, self._movement_thresholds())
        assert result["spot_up_shooter"]["tier"] == "Elite"
        assert result["spot_up_shooter"]["auto_promoted"] is False

    def test_none_movement_does_not_trigger_promotion(self):
        """Movement Shooter None → no promotion to Spot-up Shooter."""
        skills = self._make_skills_result("None", "None")
        result = apply_auto_promotions(skills, self._movement_thresholds())
        assert result["spot_up_shooter"]["tier"] == "None"
        assert result["spot_up_shooter"]["auto_promoted"] is False

    def test_does_not_mutate_original(self):
        """apply_auto_promotions must not mutate the input skills_result dict."""
        skills = self._make_skills_result("Capable", "None")
        apply_auto_promotions(skills, self._movement_thresholds())
        assert skills["spot_up_shooter"]["tier"] == "None"  # original unchanged


# ===========================================================================
# 9. _blend_blobs — historical weighting
# ===========================================================================


class TestBlendBlobs:

    def _make_minimal_blob(self, fg3_pct: float) -> dict:
        return {
            "tracking_shooting": {"catch_shoot_fg3_pct": fg3_pct, "catch_shoot_fg3a": 3.0},
            "metadata": {"games_played": 65, "season": "2025-26"},
        }

    def test_two_season_blend_50_50(self):
        """With equal weights, blended value is the mean."""
        blobs = {
            "2025-26": self._make_minimal_blob(0.40),
            "2024-25": self._make_minimal_blob(0.36),
        }
        weights = {"2025-26": 0.50, "2024-25": 0.50}
        result = _blend_blobs(blobs, weights, blobs["2025-26"], "2025-26")
        blended = result["tracking_shooting"]["catch_shoot_fg3_pct"]
        assert blended == pytest.approx(0.38)  # (0.40 + 0.36) / 2

    def test_three_season_blend_50_30_20(self):
        """Standard 50/30/20 historical blend."""
        blobs = {
            "2025-26": self._make_minimal_blob(0.40),
            "2024-25": self._make_minimal_blob(0.36),
            "2023-24": self._make_minimal_blob(0.34),
        }
        weights = {"2025-26": 0.50, "2024-25": 0.30, "2023-24": 0.20}
        result = _blend_blobs(blobs, weights, blobs["2025-26"], "2025-26")
        blended = result["tracking_shooting"]["catch_shoot_fg3_pct"]
        # 0.40*0.50 + 0.36*0.30 + 0.34*0.20 = 0.20 + 0.108 + 0.068 = 0.376
        assert blended == pytest.approx(0.376)

    def test_redistribution_when_one_season_missing(self):
        """AC: current(50%) + prev(30%) only → redistribute: current=62.5%, prev=37.5%."""
        blobs = {
            "2025-26": self._make_minimal_blob(0.40),
            "2024-25": self._make_minimal_blob(0.36),
            # "2023-24" is missing
        }
        # Simulate the redistribution logic: total=0.80, normalized: 0.50/0.80 ≈ 0.625, 0.30/0.80 = 0.375
        total_w = 0.50 + 0.30
        weights = {"2025-26": 0.50 / total_w, "2024-25": 0.30 / total_w}
        result = _blend_blobs(blobs, weights, blobs["2025-26"], "2025-26")
        blended = result["tracking_shooting"]["catch_shoot_fg3_pct"]
        # 0.40 * 0.625 + 0.36 * 0.375 = 0.25 + 0.135 = 0.385
        assert blended == pytest.approx(0.385)

    def test_non_numeric_values_use_most_recent(self):
        """Non-numeric values (strings, lists) fall through to the most-recent season."""
        blobs = {
            "2025-26": {"metadata": {"season": "2025-26", "games_played": 65}},
            "2024-25": {"metadata": {"season": "2024-25", "games_played": 60}},
        }
        weights = {"2025-26": 0.625, "2024-25": 0.375}
        result = _blend_blobs(blobs, weights, blobs["2025-26"], "2025-26")
        # "season" is a string — should come from most-recent
        assert result["metadata"]["season"] == "2025-26"
        # games_played is numeric — should be blended
        assert result["metadata"]["games_played"] == pytest.approx(65 * 0.625 + 60 * 0.375)

    def test_none_values_excluded_from_blend(self):
        """Missing values in one season are excluded; weight redistributed to non-null seasons."""
        blobs = {
            "2025-26": {"tracking_shooting": {"catch_shoot_fg3_pct": 0.40}},
            "2024-25": {"tracking_shooting": {"catch_shoot_fg3_pct": None}},  # missing
        }
        weights = {"2025-26": 0.625, "2024-25": 0.375}
        result = _blend_blobs(blobs, weights, blobs["2025-26"], "2025-26")
        # Only current season contributes — weight_sum = 0.625, so result = 0.40
        assert result["tracking_shooting"]["catch_shoot_fg3_pct"] == pytest.approx(0.40)


# ===========================================================================
# 10. evaluate_all_skills + apply_auto_promotions integration
# ===========================================================================


class TestEvaluateAllSkills:

    def test_all_skills_evaluated_returns_dict_for_each(self):
        """evaluate_all_skills returns one entry per skill in the thresholds dict."""
        blob = _make_stats_blob()
        thresholds = {
            "spot_up_shooter": _SPOT_UP_RULE,
        }
        result = evaluate_all_skills(blob, thresholds, {"tracking_shooting.catch_shoot_fg3_pct": 0.37})
        assert "spot_up_shooter" in result
        assert "tier" in result["spot_up_shooter"]

    def test_exception_in_one_skill_does_not_crash_others(self):
        """An error in one skill evaluation produces a safe fallback, not a crash."""
        blob = _make_stats_blob()
        bad_rule = {"skill_name": "broken_skill", "tiers": None}  # tiers=None will cause AttributeError
        thresholds = {
            "broken_skill": bad_rule,
            "spot_up_shooter": _SPOT_UP_RULE,
        }
        result = evaluate_all_skills(blob, thresholds, {})
        assert result["broken_skill"]["data_missing"] is True
        assert "evaluation_error" in result["broken_skill"]["flags"]
        assert "spot_up_shooter" in result  # Other skills still evaluated

    def test_auto_promotion_processed_after_all_skills(self):
        """Movement Shooter Capable triggers Spot-up Shooter promotion in second pass."""
        blob = _make_stats_blob(
            tracking_shooting__catch_shoot_fg3_pct=0.20,   # very low — will be None spot-up
            tracking_shooting__catch_shoot_fg3a=0.3,       # below volume gate
            play_type__spotup_poss=10,
        )
        blob["metadata"]["games_played"] = 65

        movement_rule = {
            "skill_name": "movement_shooter",
            "stat_confidence": "moderate",
            "always_flag_for_review": False,
            "tiers": {
                "Capable": {
                    "conditions": [
                        {"stat": "metadata.games_played", "operator": ">=", "value": 1}  # always true
                    ],
                    "logic": "AND",
                }
            },
            "auto_promotions": [
                {
                    "if_tier_gte": "Capable",
                    "then_set_skill": "spot_up_shooter",
                    "to_minimum_tier": "Capable",
                }
            ],
        }

        thresholds = {
            "movement_shooter": movement_rule,
            "spot_up_shooter": _SPOT_UP_RULE,
        }

        # First evaluate all skills
        skills_result = evaluate_all_skills(
            blob, thresholds, {"tracking_shooting.catch_shoot_fg3_pct": 0.37}
        )
        # Spot-up should be None (volume gate fails)
        assert skills_result["spot_up_shooter"]["tier"] == "None"

        # Then apply auto-promotions
        final = apply_auto_promotions(skills_result, thresholds)
        # Movement Shooter is Capable → promotes Spot-up from None to at least Capable
        assert final["spot_up_shooter"]["tier"] == "Capable"
        assert final["spot_up_shooter"]["auto_promoted"] is True
