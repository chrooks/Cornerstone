"""
tests/test_roster_evaluator_player_scores.py — Unit tests for Phase 0 + Phase 1
of the roster rule engine.

All tests operate on in-memory player dicts — no Supabase connection required.

Coverage:
  Phase 0:
    1. ScoreTrace / Note / RosterEvaluation dataclasses — field presence, defaults
    2. TIER_WEIGHTS — all tiers present, correct ordering

  Phase 1 (player_scores.py):
    3. parse_height       — valid formats, malformed, None
    4. size_modifier      — tall/short/mid players, high_flyer bonus, missing height
    5. tier_weight        — known tiers, missing skill, None tier
    6. on_ball_scoring_threat — scoring combinations, zero case, transition_threat, ScoreTrace shape
    7. gravity            — derived from scoring threat, 0→0, high→approaches 1
    8. off_ball_gravity   — shooting/cutting combos, transition_threat, ScoreTrace shape
    9. effective_on_ball_threat — gravity gates passing; scorer+passer > scorer; pure passer discounted
   10. is_exclusively_onball   — on-ball only, on+off-ball, defense only
   11. is_twoway               — offense+defense, offense only, defense only
   12. is_offensive_blackhole  — no offense, has shooting, has creation
"""

import pytest
from services.roster_evaluator.types import ScoreTrace, Note, RosterEvaluation
from services.roster_evaluator.weights import TIER_WEIGHTS
from services.roster_evaluator.player_scores import (
    parse_height,
    size_modifier,
    tier_weight,
    on_ball_scoring_threat,
    gravity,
    off_ball_gravity,
    effective_on_ball_threat,
    is_exclusively_onball,
    is_twoway,
    is_offensive_blackhole,
)


# ===========================================================================
# Fixtures
# ===========================================================================

ALL_SKILLS = [
    "spot_up_shooter", "off_dribble_shooter", "offensive_rebounder",
    "rebounder", "rim_protector", "isolation_scorer", "movement_shooter",
    "cutter", "transition_threat", "pnr_ball_handler", "pnr_finisher",
    "crafty_finisher", "driver", "vertical_spacer", "screen_setter",
    "passer", "mid_post_player", "low_post_player", "versatile_defender",
    "perimeter_disruptor", "high_flyer",
]


def make_player(name="Test Player", height="6-6", **skills) -> dict:
    """Build a player dict with all skills defaulting to 'None'."""
    base_skills = {s: "None" for s in ALL_SKILLS}
    base_skills.update(skills)
    return {"name": name, "height": height, "skills": base_skills}


# ===========================================================================
# Phase 0: Types
# ===========================================================================

class TestScoreTrace:
    def test_has_required_fields(self):
        trace = ScoreTrace(
            score=7.5,
            components={"iso": 4.0, "off_dribble": 3.0},
            multipliers={"gravity": 0.8},
            label="Test trace",
        )
        assert trace.score == 7.5
        assert trace.components["iso"] == 4.0
        assert trace.multipliers["gravity"] == 0.8
        assert trace.label == "Test trace"

    def test_empty_components_and_multipliers_allowed(self):
        trace = ScoreTrace(score=0.0, components={}, multipliers={}, label="empty")
        assert trace.score == 0.0
        assert trace.components == {}
        assert trace.multipliers == {}


class TestNote:
    def test_has_required_fields(self):
        note = Note(
            severity="critical",
            category="offense",
            text="No spacing threats on this roster.",
            trace_key="spacing_score",
        )
        assert note.severity == "critical"
        assert note.category == "offense"
        assert note.text == "No spacing threats on this roster."
        assert note.trace_key == "spacing_score"


class TestRosterEvaluation:
    def test_notes_required_traces_optional(self):
        eval_ = RosterEvaluation(notes=[])
        assert eval_.notes == []
        assert eval_.player_traces is None
        assert eval_.aggregate_traces is None

    def test_accepts_debug_traces(self):
        trace = ScoreTrace(score=1.0, components={}, multipliers={}, label="x")
        eval_ = RosterEvaluation(
            notes=[],
            player_traces={"Luka": {"on_ball": trace}},
            aggregate_traces={"spacing": trace},
        )
        assert eval_.player_traces is not None
        assert eval_.aggregate_traces is not None


# ===========================================================================
# Phase 0: Weights
# ===========================================================================

class TestTierWeights:
    def test_all_tiers_present(self):
        for tier in ["None", "Capable", "Proficient", "Elite", "All-Time Great"]:
            assert tier in TIER_WEIGHTS

    def test_ordering(self):
        assert TIER_WEIGHTS["None"] < TIER_WEIGHTS["Capable"]
        assert TIER_WEIGHTS["Capable"] < TIER_WEIGHTS["Proficient"]
        assert TIER_WEIGHTS["Proficient"] < TIER_WEIGHTS["Elite"]
        assert TIER_WEIGHTS["Elite"] < TIER_WEIGHTS["All-Time Great"]

    def test_none_is_zero(self):
        assert TIER_WEIGHTS["None"] == 0

    def test_atg_is_four(self):
        assert TIER_WEIGHTS["All-Time Great"] == 4


# ===========================================================================
# Phase 1: parse_height
# ===========================================================================

class TestParseHeight:
    def test_standard_format(self):
        assert parse_height("6-3") == 75

    def test_seven_footer(self):
        assert parse_height("7-0") == 84

    def test_six_zero(self):
        assert parse_height("6-0") == 72

    def test_under_six_feet(self):
        assert parse_height("5-11") == 71

    def test_none_returns_none(self):
        assert parse_height(None) is None

    def test_empty_string_returns_none(self):
        assert parse_height("") is None

    def test_no_dash_returns_none(self):
        assert parse_height("6") is None

    def test_non_numeric_returns_none(self):
        assert parse_height("six-three") is None

    def test_too_many_dashes_returns_none(self):
        assert parse_height("6-3-2") is None


# ===========================================================================
# Phase 1: tier_weight
# ===========================================================================

class TestTierWeight:
    def test_elite_skill(self):
        player = make_player(isolation_scorer="Elite")
        assert tier_weight(player, "isolation_scorer") == 3.0

    def test_atg_skill(self):
        player = make_player(passer="All-Time Great")
        assert tier_weight(player, "passer") == 4.0

    def test_none_tier(self):
        player = make_player()
        assert tier_weight(player, "isolation_scorer") == 0.0

    def test_missing_skill_key(self):
        player = {"name": "Test", "height": "6-6", "skills": {}}
        assert tier_weight(player, "isolation_scorer") == 0.0

    def test_capable_is_one(self):
        player = make_player(spot_up_shooter="Capable")
        assert tier_weight(player, "spot_up_shooter") == 1.0

    def test_proficient_is_two(self):
        player = make_player(driver="Proficient")
        assert tier_weight(player, "driver") == 2.0


# ===========================================================================
# Phase 1: size_modifier
# ===========================================================================

class TestSizeModifier:
    def test_returns_score_trace(self):
        player = make_player(height="6-6")
        result = size_modifier(player)
        assert isinstance(result, ScoreTrace)

    def test_tall_player_near_one(self):
        player = make_player(height="7-0")
        result = size_modifier(player)
        assert result.score == pytest.approx(1.0)

    def test_short_player_near_point_six(self):
        player = make_player(height="6-0")
        result = size_modifier(player)
        assert result.score == pytest.approx(0.6)

    def test_mid_height_between_bounds(self):
        player = make_player(height="6-6")
        result = size_modifier(player)
        assert 0.6 < result.score < 1.0

    def test_high_flyer_bonus_increases_modifier(self):
        short_base = make_player(height="6-0")
        short_flyer = make_player(height="6-0", high_flyer="Elite")
        base_score = size_modifier(short_base).score
        flyer_score = size_modifier(short_flyer).score
        assert flyer_score > base_score

    def test_high_flyer_bonus_capped_at_one(self):
        tall_flyer = make_player(height="7-0", high_flyer="All-Time Great")
        result = size_modifier(tall_flyer)
        assert result.score <= 1.0

    def test_missing_height_returns_default(self):
        player = make_player(height=None)
        result = size_modifier(player)
        assert 0.6 <= result.score <= 1.0  # within valid range

    def test_score_in_components(self):
        player = make_player(height="6-6")
        result = size_modifier(player)
        assert len(result.components) >= 1

    def test_label_is_string(self):
        player = make_player(height="6-6")
        result = size_modifier(player)
        assert isinstance(result.label, str)
        assert len(result.label) > 0


# ===========================================================================
# Phase 1: on_ball_scoring_threat
# ===========================================================================

class TestOnBallScoringThreat:
    def test_returns_score_trace(self):
        player = make_player()
        result = on_ball_scoring_threat(player)
        assert isinstance(result, ScoreTrace)

    def test_no_skills_zero_score(self):
        player = make_player()
        result = on_ball_scoring_threat(player)
        assert result.score == 0.0

    def test_atg_iso_and_atg_off_dribble(self):
        player = make_player(
            isolation_scorer="All-Time Great",
            off_dribble_shooter="All-Time Great",
        )
        result = on_ball_scoring_threat(player)
        # 4*1.0 + 4*1.0 = 8.0
        assert result.score == pytest.approx(8.0)

    def test_transition_threat_contributes(self):
        base = make_player()
        with_transition = make_player(transition_threat="Proficient")
        base_score = on_ball_scoring_threat(base).score
        trans_score = on_ball_scoring_threat(with_transition).score
        assert trans_score > base_score

    def test_driver_contributes(self):
        player = make_player(driver="Elite")
        result = on_ball_scoring_threat(player)
        assert result.score > 0.0

    def test_components_only_nonzero_skills(self):
        player = make_player(isolation_scorer="Elite")
        result = on_ball_scoring_threat(player)
        assert "isolation_scorer" in result.components
        # zero-contribution skills should not appear
        assert all(v > 0 for v in result.components.values())

    def test_higher_tier_scores_higher(self):
        capable = make_player(isolation_scorer="Capable")
        elite = make_player(isolation_scorer="Elite")
        assert on_ball_scoring_threat(elite).score > on_ball_scoring_threat(capable).score

    def test_label_is_string(self):
        player = make_player(isolation_scorer="Elite")
        result = on_ball_scoring_threat(player)
        assert isinstance(result.label, str)

    def test_full_scorer_profile(self):
        """Elite scorer across multiple dimensions should have high score."""
        player = make_player(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
            driver="Proficient",
            mid_post_player="Proficient",
        )
        result = on_ball_scoring_threat(player)
        assert result.score >= 8.0


# ===========================================================================
# Phase 1: gravity
# ===========================================================================

class TestGravity:
    def test_no_scoring_threat_is_zero(self):
        player = make_player()
        assert gravity(player) == pytest.approx(0.0)

    def test_high_scorer_has_high_gravity(self):
        player = make_player(
            isolation_scorer="All-Time Great",
            off_dribble_shooter="All-Time Great",
        )
        g = gravity(player)
        assert g > 0.5

    def test_gravity_between_zero_and_one(self):
        for tier in ["None", "Capable", "Proficient", "Elite", "All-Time Great"]:
            player = make_player(isolation_scorer=tier)
            g = gravity(player)
            assert 0.0 <= g <= 1.0

    def test_higher_scorer_higher_gravity(self):
        capable = make_player(isolation_scorer="Capable")
        elite = make_player(isolation_scorer="Elite")
        assert gravity(elite) > gravity(capable)


# ===========================================================================
# Phase 1: off_ball_gravity
# ===========================================================================

class TestOffBallGravity:
    def test_returns_score_trace(self):
        player = make_player()
        result = off_ball_gravity(player)
        assert isinstance(result, ScoreTrace)

    def test_no_skills_near_zero(self):
        player = make_player()
        result = off_ball_gravity(player)
        assert result.score == pytest.approx(0.0)

    def test_atg_spot_up_and_movement(self):
        player = make_player(
            spot_up_shooter="All-Time Great",
            movement_shooter="All-Time Great",
        )
        result = off_ball_gravity(player)
        assert result.score > 0.7  # should be very high

    def test_movement_shooter_weighted_more_than_spot_up(self):
        spot_up_only = make_player(spot_up_shooter="Elite")
        movement_only = make_player(movement_shooter="Elite")
        assert off_ball_gravity(movement_only).score > off_ball_gravity(spot_up_only).score

    def test_transition_threat_contributes(self):
        base = make_player()
        with_transition = make_player(transition_threat="Proficient")
        assert off_ball_gravity(with_transition).score > off_ball_gravity(base).score

    def test_cutter_contributes(self):
        player = make_player(cutter="Elite")
        result = off_ball_gravity(player)
        assert result.score > 0.0

    def test_vertical_spacer_contributes(self):
        player = make_player(vertical_spacer="Proficient")
        result = off_ball_gravity(player)
        assert result.score > 0.0

    def test_score_between_zero_and_one(self):
        player = make_player(
            spot_up_shooter="All-Time Great",
            movement_shooter="All-Time Great",
            cutter="All-Time Great",
            vertical_spacer="All-Time Great",
            high_flyer="All-Time Great",
            transition_threat="All-Time Great",
        )
        result = off_ball_gravity(player)
        assert 0.0 <= result.score <= 1.0


# ===========================================================================
# Phase 1: effective_on_ball_threat
# ===========================================================================

class TestEffectiveOnBallThreat:
    def test_returns_score_trace(self):
        player = make_player()
        result = effective_on_ball_threat(player)
        assert isinstance(result, ScoreTrace)

    def test_zero_player_zero_score(self):
        player = make_player()
        result = effective_on_ball_threat(player)
        assert result.score == pytest.approx(0.0)

    def test_passer_contribution_gated_by_gravity(self):
        """Same passer tier: scorer gets more from passing than non-scorer."""
        scorer_passer = make_player(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
            passer="Elite",
        )
        pure_passer = make_player(passer="Elite")
        assert effective_on_ball_threat(scorer_passer).score > effective_on_ball_threat(pure_passer).score

    def test_scorer_plus_passer_beats_pure_scorer(self):
        scorer_only = make_player(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
        )
        scorer_passer = make_player(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
            passer="All-Time Great",
        )
        assert effective_on_ball_threat(scorer_passer).score > effective_on_ball_threat(scorer_only).score

    def test_pure_passer_discounted(self):
        """A great passer with no scoring threat has limited on-ball value."""
        pure_passer = make_player(passer="All-Time Great")
        result = effective_on_ball_threat(pure_passer)
        # Gravity is near 0, so passing contribution is near 0
        assert result.score < 1.0

    def test_passing_contribution_in_components(self):
        player = make_player(
            isolation_scorer="Elite",
            passer="Elite",
        )
        result = effective_on_ball_threat(player)
        # Should have a "passer" or "passer (gravity-gated)" component
        passer_keys = [k for k in result.components if "passer" in k]
        assert len(passer_keys) > 0

    def test_gravity_in_multipliers(self):
        player = make_player(isolation_scorer="Elite")
        result = effective_on_ball_threat(player)
        assert "gravity" in result.multipliers

    def test_jokic_type_beats_cam_thomas_type(self):
        """
        Cam Thomas: elite scorer, capable passer.
        Jokic-like: elite scorer + post, ATG passer.
        Jokic-type should have higher on-ball threat.
        """
        cam_thomas_type = make_player(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
            passer="Capable",
        )
        jokic_type = make_player(
            isolation_scorer="All-Time Great",
            low_post_player="All-Time Great",
            mid_post_player="Elite",
            passer="All-Time Great",
        )
        assert (
            effective_on_ball_threat(jokic_type).score
            > effective_on_ball_threat(cam_thomas_type).score
        )


# ===========================================================================
# Phase 1: is_exclusively_onball
# ===========================================================================

class TestIsExclusivelyOnball:
    def test_pure_iso_scorer_is_exclusively_onball(self):
        player = make_player(isolation_scorer="Elite")
        assert is_exclusively_onball(player) is True

    def test_scorer_with_spot_up_is_not_exclusive(self):
        player = make_player(isolation_scorer="Elite", spot_up_shooter="Capable")
        assert is_exclusively_onball(player) is False

    def test_scorer_with_movement_shooter_is_not_exclusive(self):
        player = make_player(isolation_scorer="Elite", movement_shooter="Capable")
        assert is_exclusively_onball(player) is False

    def test_scorer_with_cutter_is_not_exclusive(self):
        """Cutter is an off-ball skill — should disqualify exclusive on-ball."""
        player = make_player(isolation_scorer="Elite", cutter="Capable")
        assert is_exclusively_onball(player) is False

    def test_defense_only_player_is_not_exclusively_onball(self):
        player = make_player(rim_protector="Elite")
        assert is_exclusively_onball(player) is False

    def test_no_skills_is_not_exclusively_onball(self):
        player = make_player()
        assert is_exclusively_onball(player) is False

    def test_pnr_ball_handler_only_is_exclusively_onball(self):
        player = make_player(pnr_ball_handler="Proficient")
        assert is_exclusively_onball(player) is True


# ===========================================================================
# Phase 1: is_twoway
# ===========================================================================

class TestIsTwoway:
    def test_offense_and_defense_is_twoway(self):
        player = make_player(driver="Capable", versatile_defender="Capable")
        assert is_twoway(player) is True

    def test_offense_only_is_not_twoway(self):
        player = make_player(isolation_scorer="Elite")
        assert is_twoway(player) is False

    def test_defense_only_is_not_twoway(self):
        player = make_player(rim_protector="Elite")
        assert is_twoway(player) is False

    def test_no_skills_is_not_twoway(self):
        player = make_player()
        assert is_twoway(player) is False

    def test_spot_up_plus_perimeter_disruptor_is_twoway(self):
        player = make_player(spot_up_shooter="Capable", perimeter_disruptor="Capable")
        assert is_twoway(player) is True

    def test_any_offense_plus_rim_protector_is_twoway(self):
        player = make_player(passer="Capable", rim_protector="Capable")
        assert is_twoway(player) is True


# ===========================================================================
# Phase 1: is_offensive_blackhole
# ===========================================================================

class TestIsOffensiveBlackhole:
    def test_defense_only_is_blackhole(self):
        player = make_player(rim_protector="Elite")
        assert is_offensive_blackhole(player) is True

    def test_versatile_defender_only_is_blackhole(self):
        player = make_player(versatile_defender="Proficient")
        assert is_offensive_blackhole(player) is True

    def test_spot_up_shooter_not_blackhole(self):
        player = make_player(spot_up_shooter="Capable")
        assert is_offensive_blackhole(player) is False

    def test_driver_not_blackhole(self):
        player = make_player(driver="Capable")
        assert is_offensive_blackhole(player) is False

    def test_no_skills_is_blackhole(self):
        """Player with no skills offers no offensive threat."""
        player = make_player()
        assert is_offensive_blackhole(player) is True

    def test_movement_shooter_not_blackhole(self):
        player = make_player(movement_shooter="Capable")
        assert is_offensive_blackhole(player) is False

    def test_passer_only_is_blackhole(self):
        """Pure passer with no shooting or creation = can be ignored by defense."""
        player = make_player(passer="Elite")
        assert is_offensive_blackhole(player) is True


# ===========================================================================
# Additional coverage: gaps flagged by code review
# ===========================================================================

class TestTierWeightEdgeCases:
    def test_unknown_tier_string_returns_zero(self):
        """Unknown tier strings (e.g. from bad data) should return 0, not error."""
        player = {"name": "x", "height": "6-6", "skills": {"isolation_scorer": "Unknown"}}
        assert tier_weight(player, "isolation_scorer") == 0.0

    def test_empty_tier_string_returns_zero(self):
        player = {"name": "x", "height": "6-6", "skills": {"isolation_scorer": ""}}
        assert tier_weight(player, "isolation_scorer") == 0.0


class TestCraftyFinisherClassification:
    def test_crafty_finisher_only_is_exclusively_onball(self):
        """
        crafty_finisher is in ON_BALL_SCORING_WEIGHTS and _ON_BALL_SKILLS.
        A player with only this skill contributes to scoring threat and
        should be classified as exclusively on-ball.
        """
        player = make_player(crafty_finisher="Elite")
        assert is_exclusively_onball(player) is True

    def test_crafty_finisher_contributes_to_scoring_threat(self):
        player = make_player(crafty_finisher="Elite")
        result = on_ball_scoring_threat(player)
        assert result.score > 0.0

    def test_crafty_finisher_contributes_to_gravity(self):
        no_skills = make_player()
        finisher = make_player(crafty_finisher="Elite")
        assert gravity(finisher) > gravity(no_skills)


class TestPasserDesignIntent:
    def test_elite_scorer_with_capable_passer_not_exclusively_onball(self):
        """
        passer is in _OFF_BALL_SKILLS by design: even Capable passing means
        the player provides off-ball value (finds cutters, runs actions).
        They should NOT be flagged as exclusively on-ball.
        """
        player = make_player(isolation_scorer="Elite", passer="Capable")
        assert is_exclusively_onball(player) is False

    def test_elite_scorer_without_passer_is_exclusively_onball(self):
        player = make_player(isolation_scorer="Elite")
        assert is_exclusively_onball(player) is True


class TestEffectiveOnBallThreatComponents:
    def test_pure_passer_no_zero_component_in_trace(self):
        """
        A pure passer with no scoring threat has gravity ~0, so passing
        contribution rounds to 0. That zero entry should NOT appear in components.
        """
        player = make_player(passer="All-Time Great")
        result = effective_on_ball_threat(player)
        passer_keys = [k for k in result.components if "passer" in k]
        # Either no passer key, or the value is nonzero
        for k in passer_keys:
            assert result.components[k] > 0.0


class TestSizeModifierEdgeCases:
    def test_implausibly_short_height_clamps_to_min(self):
        """Heights below 6-0 (72in) should clamp to min_modifier, not error."""
        player = make_player(height="5-0")
        result = size_modifier(player)
        assert result.score == pytest.approx(0.6)

    def test_implausibly_tall_height_clamps_to_max(self):
        """Heights above 7-0 (84in) should clamp to max_modifier."""
        player = make_player(height="8-0")
        result = size_modifier(player)
        assert result.score <= 1.0
