"""
tests/test_roster_evaluator_aggregates.py — Unit tests for Phase 2 of the roster
rule engine: cross-roster aggregate functions.

All tests operate on in-memory player dicts — no Supabase connection required.

Coverage:
  Utilities:
    1. skill_score           — sum of tier weights across roster
    2. team_best             — highest tier any player has
    3. count_at_or_above     — how many players meet a tier threshold

  Scored aggregates (return ScoreTrace):
    4. spacing_score         — movement/spot-up weighted, screen amplification
    5. passer_compound_score — non-linear stacking (raw^1.2)
    6. perimeter_compound_score — non-linear, versatile defenders contribute 0.7x
    7. defense_score         — rim anchor amplification, size-weighted contributions
    8. cutter_score          — 4-gate suppression model
    9. paint_touch_score     — paint opportunity sources, tier-weighted
   10. rebounding_covered    — elite vs committee paths

  Boolean checks:
   11. lob_threat_active     — vertical spacer + lob thrower required
   12. pnr_synergy           — both sides of PnR must be Proficient+
   13. transition_active     — threats + passer required
   14. movement_orphaned     — movement shooters without screen setters

  Integration:
   15. compute_aggregates    — returns all named aggregates, correct types
"""

import pytest
from services.roster_evaluator.types import ScoreTrace
from services.roster_evaluator.aggregates import (
    skill_score,
    team_best,
    count_at_or_above,
    spacing_score,
    passer_compound_score,
    perimeter_compound_score,
    defense_score,
    cutter_score,
    paint_touch_score,
    rebounding_covered,
    lob_threat_active,
    pnr_synergy,
    transition_active,
    movement_orphaned,
    compute_aggregates,
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


def make_player(name="Player", height="6-6", **skills) -> dict:
    base = {s: "None" for s in ALL_SKILLS}
    base.update(skills)
    return {"name": name, "height": height, "skills": base}


def make_roster(*players) -> list[dict]:
    return list(players)


# ===========================================================================
# 1. skill_score
# ===========================================================================

class TestSkillScore:
    def test_empty_roster_zero(self):
        assert skill_score([], "spot_up_shooter") == 0.0

    def test_single_elite_player(self):
        roster = make_roster(make_player(spot_up_shooter="Elite"))
        assert skill_score(roster, "spot_up_shooter") == pytest.approx(3.0)

    def test_sums_across_multiple_players(self):
        roster = make_roster(
            make_player(spot_up_shooter="Elite"),
            make_player(spot_up_shooter="Proficient"),
            make_player(spot_up_shooter="Capable"),
        )
        # 3 + 2 + 1 = 6
        assert skill_score(roster, "spot_up_shooter") == pytest.approx(6.0)

    def test_none_tier_contributes_zero(self):
        roster = make_roster(make_player())
        assert skill_score(roster, "spot_up_shooter") == 0.0

    def test_atg_contributes_four(self):
        roster = make_roster(make_player(passer="All-Time Great"))
        assert skill_score(roster, "passer") == pytest.approx(4.0)

    def test_missing_skill_not_error(self):
        player = {"name": "Test", "height": "6-6", "skills": {}}
        assert skill_score([player], "spot_up_shooter") == 0.0


# ===========================================================================
# 2. team_best
# ===========================================================================

class TestTeamBest:
    def test_empty_roster_returns_none(self):
        assert team_best([], "rim_protector") == "None"

    def test_single_player_returns_their_tier(self):
        roster = make_roster(make_player(rim_protector="Elite"))
        assert team_best(roster, "rim_protector") == "Elite"

    def test_returns_highest_tier(self):
        roster = make_roster(
            make_player(rim_protector="Capable"),
            make_player(rim_protector="All-Time Great"),
            make_player(rim_protector="Proficient"),
        )
        assert team_best(roster, "rim_protector") == "All-Time Great"

    def test_all_none_returns_none(self):
        roster = make_roster(make_player(), make_player())
        assert team_best(roster, "rim_protector") == "None"

    def test_returns_string_not_number(self):
        roster = make_roster(make_player(passer="Elite"))
        result = team_best(roster, "passer")
        assert isinstance(result, str)


# ===========================================================================
# 3. count_at_or_above
# ===========================================================================

class TestCountAtOrAbove:
    def test_empty_roster_zero(self):
        assert count_at_or_above([], "rim_protector", "Capable") == 0

    def test_exact_threshold_counts(self):
        roster = make_roster(make_player(rim_protector="Capable"))
        assert count_at_or_above(roster, "rim_protector", "Capable") == 1

    def test_above_threshold_counts(self):
        roster = make_roster(make_player(rim_protector="Elite"))
        assert count_at_or_above(roster, "rim_protector", "Capable") == 1

    def test_below_threshold_not_counted(self):
        roster = make_roster(make_player(rim_protector="Capable"))
        assert count_at_or_above(roster, "rim_protector", "Proficient") == 0

    def test_counts_correctly_across_roster(self):
        roster = make_roster(
            make_player(rim_protector="Capable"),
            make_player(rim_protector="Elite"),
            make_player(rim_protector="None"),
            make_player(rim_protector="All-Time Great"),
        )
        assert count_at_or_above(roster, "rim_protector", "Proficient") == 2

    def test_none_tier_never_counts(self):
        roster = make_roster(make_player())
        assert count_at_or_above(roster, "rim_protector", "None") == 0


# ===========================================================================
# 4. spacing_score
# ===========================================================================

class TestSpacingScore:
    def test_returns_score_trace(self):
        result = spacing_score([])
        assert isinstance(result, ScoreTrace)

    def test_empty_roster_zero(self):
        result = spacing_score([])
        assert result.score == pytest.approx(0.0)

    def test_movement_shooter_with_screens_beats_spot_up(self):
        """
        Movement shooters fully unlocked by screens outperform spot-up at same tier.
        Without screens (min multiplier 0.5), movement raw (2.0×) is suppressed
        enough that they tie spot-up. With screens, movement pulls ahead.
        """
        movement_with_screens = make_roster(
            make_player(movement_shooter="Elite"),
            make_player(screen_setter="Elite"),
        )
        spot_up_with_screens = make_roster(
            make_player(spot_up_shooter="Elite"),
            make_player(screen_setter="Elite"),
        )
        assert spacing_score(movement_with_screens).score > spacing_score(spot_up_with_screens).score

    def test_movement_shooter_raw_weight_double_spot_up(self):
        """Raw movement contribution before screen gate is 2× spot-up per heuristics."""
        movement_only = make_roster(make_player(movement_shooter="Proficient"))
        spot_up_only = make_roster(make_player(spot_up_shooter="Proficient"))
        # raw movement = 2*2 = 4, raw spot-up = 2*1 = 2 — check via components
        movement_components = spacing_score(movement_only).components
        spot_components = spacing_score(spot_up_only).components
        assert movement_components["movement_shooter_raw"] > spot_components["spot_up_shooter_raw"]

    def test_no_screens_suppresses_movement_shooters(self):
        """Without screen setters, movement shooters run at ~50% value."""
        with_screens = make_roster(
            make_player(movement_shooter="Elite"),
            make_player(screen_setter="All-Time Great"),
        )
        without_screens = make_roster(
            make_player(movement_shooter="Elite"),
        )
        assert spacing_score(with_screens).score > spacing_score(without_screens).score

    def test_screens_do_not_affect_spot_up_component(self):
        """Screen multiplier applies only to movement_raw, not spot_up_raw."""
        spot_up_with_screens = make_roster(
            make_player(spot_up_shooter="Elite"),
            make_player(screen_setter="All-Time Great"),
        )
        spot_up_no_screens = make_roster(
            make_player(spot_up_shooter="Elite"),
        )
        # Compare the spot_up_shooter_raw component directly — must be equal
        assert (
            spacing_score(spot_up_with_screens).components["spot_up_shooter_raw"]
            == pytest.approx(spacing_score(spot_up_no_screens).components["spot_up_shooter_raw"])
        )

    def test_components_present(self):
        roster = make_roster(make_player(movement_shooter="Elite"))
        result = spacing_score(roster)
        assert len(result.components) > 0

    def test_screen_multiplier_in_multipliers(self):
        roster = make_roster(make_player(movement_shooter="Elite"))
        result = spacing_score(roster)
        assert "screen_to_movement" in result.multipliers

    def test_more_shooters_higher_score(self):
        one_shooter = make_roster(make_player(spot_up_shooter="Elite"))
        two_shooters = make_roster(
            make_player(spot_up_shooter="Elite"),
            make_player(spot_up_shooter="Elite"),
        )
        assert spacing_score(two_shooters).score > spacing_score(one_shooter).score

    def test_atg_shooter_higher_than_capable(self):
        capable = make_roster(make_player(spot_up_shooter="Capable"))
        atg = make_roster(make_player(spot_up_shooter="All-Time Great"))
        assert spacing_score(atg).score > spacing_score(capable).score


# ===========================================================================
# 5. passer_compound_score
# ===========================================================================

class TestPasserCompoundScore:
    def test_returns_score_trace(self):
        assert isinstance(passer_compound_score([]), ScoreTrace)

    def test_no_passers_zero(self):
        result = passer_compound_score(make_roster(make_player()))
        assert result.score == pytest.approx(0.0)

    def test_single_elite_passer(self):
        """3^1.2 ≈ 3.74"""
        roster = make_roster(make_player(passer="Elite"))
        result = passer_compound_score(roster)
        assert result.score == pytest.approx(3 ** 1.2, rel=0.01)

    def test_two_elite_passers_non_linear(self):
        """Two Elite passers should compound non-linearly (6^1.2 > 2 * 3^1.2)."""
        one_passer = make_roster(make_player(passer="Elite"))
        two_passers = make_roster(
            make_player(passer="Elite"),
            make_player(passer="Elite"),
        )
        one_score = passer_compound_score(one_passer).score
        two_score = passer_compound_score(two_passers).score
        # Non-linear: two score should exceed 2× one score
        assert two_score > 2 * one_score

    def test_raw_in_components(self):
        roster = make_roster(make_player(passer="Elite"))
        result = passer_compound_score(roster)
        assert any("raw" in k for k in result.components)

    def test_exponent_in_multipliers_or_components(self):
        roster = make_roster(make_player(passer="Elite"))
        result = passer_compound_score(roster)
        all_keys = list(result.components.keys()) + list(result.multipliers.keys())
        assert any("exponent" in k or "1.2" in k for k in all_keys)

    def test_higher_tier_higher_score(self):
        capable = make_roster(make_player(passer="Capable"))
        elite = make_roster(make_player(passer="Elite"))
        assert passer_compound_score(elite).score > passer_compound_score(capable).score


# ===========================================================================
# 6. perimeter_compound_score
# ===========================================================================

class TestPerimeterCompoundScore:
    def test_returns_score_trace(self):
        assert isinstance(perimeter_compound_score([]), ScoreTrace)

    def test_no_defenders_zero(self):
        result = perimeter_compound_score(make_roster(make_player()))
        assert result.score == pytest.approx(0.0)

    def test_five_proficient_disruptors_compounds_strongly(self):
        """5 Proficient perimeter disruptors should be much more than 5× one."""
        one = make_roster(make_player(perimeter_disruptor="Proficient"))
        five = make_roster(*[make_player(perimeter_disruptor="Proficient")] * 5)
        one_score = perimeter_compound_score(one).score
        five_score = perimeter_compound_score(five).score
        assert five_score > 5 * one_score

    def test_versatile_defenders_contribute_less_than_perimeter(self):
        """Versatile defenders add to raw at 0.7×, so same tier = less contribution."""
        pure_perimeter = make_roster(make_player(perimeter_disruptor="Elite"))
        pure_versatile = make_roster(make_player(versatile_defender="Elite"))
        assert perimeter_compound_score(pure_perimeter).score > perimeter_compound_score(pure_versatile).score

    def test_versatile_defenders_still_contribute(self):
        perimeter_only = make_roster(make_player(perimeter_disruptor="Elite"))
        perimeter_plus_versatile = make_roster(
            make_player(perimeter_disruptor="Elite"),
            make_player(versatile_defender="Elite"),
        )
        assert perimeter_compound_score(perimeter_plus_versatile).score > perimeter_compound_score(perimeter_only).score

    def test_higher_exponent_than_passers(self):
        """Perimeter compounds more strongly (1.3) than passers (1.2)."""
        # With same raw score, perimeter should compound higher
        # raw=6: perimeter → 6^1.3, passers → 6^1.2; perimeter > passers
        roster = make_roster(
            make_player(perimeter_disruptor="Elite"),
            make_player(perimeter_disruptor="Elite"),
        )
        raw = 6.0  # 2 Elite = 3+3
        perimeter_score = perimeter_compound_score(roster).score
        # Only perimeter disruptors here, so: raw=6, compounded=6^1.3
        assert perimeter_score == pytest.approx(6 ** 1.3, rel=0.01)


# ===========================================================================
# 7. defense_score
# ===========================================================================

class TestDefenseScore:
    def test_returns_score_trace(self):
        assert isinstance(defense_score([]), ScoreTrace)

    def test_empty_roster_zero(self):
        result = defense_score([])
        assert result.score == pytest.approx(0.0)

    def test_rim_anchor_amplifies_perimeter(self):
        """Same perimeter talent should score higher when paired with a rim anchor."""
        perimeter_only = make_roster(
            make_player(perimeter_disruptor="Elite"),
            make_player(perimeter_disruptor="Elite"),
        )
        with_rim = make_roster(
            make_player(rim_protector="Elite", height="7-0"),
            make_player(perimeter_disruptor="Elite"),
            make_player(perimeter_disruptor="Elite"),
        )
        assert defense_score(with_rim).score > defense_score(perimeter_only).score

    def test_tall_player_contributes_more_defense(self):
        """A 7-footer with Elite rim protection should score more than a 6-0 guard."""
        tall = make_roster(make_player(rim_protector="Elite", height="7-0"))
        short = make_roster(make_player(rim_protector="Elite", height="6-0"))
        assert defense_score(tall).score > defense_score(short).score

    def test_high_flyer_partially_compensates_for_height(self):
        """A 6-0 High Flyer should score higher than a non-flying 6-0 defender."""
        short_flyer = make_roster(make_player(rim_protector="Elite", high_flyer="Elite", height="6-0"))
        short_no_fly = make_roster(make_player(rim_protector="Elite", height="6-0"))
        assert defense_score(short_flyer).score > defense_score(short_no_fly).score

    def test_versatile_defenders_contribute(self):
        no_defense = make_roster(make_player())
        with_vd = make_roster(make_player(versatile_defender="Elite"))
        assert defense_score(with_vd).score > defense_score(no_defense).score

    def test_components_present(self):
        roster = make_roster(make_player(rim_protector="Elite", height="7-0"))
        result = defense_score(roster)
        assert len(result.components) > 0


# ===========================================================================
# 8. cutter_score
# ===========================================================================

class TestCutterScore:
    def test_returns_score_trace(self):
        assert isinstance(cutter_score([]), ScoreTrace)

    def test_cutters_without_enablers_heavily_suppressed(self):
        """Cutters need passers + spacing + screens + on-ball gravity to be effective."""
        roster = make_roster(make_player(cutter="Elite"))
        result = cutter_score(roster)
        # Should be heavily suppressed — all four gates near minimum
        assert result.score < 1.5

    def test_passers_unlock_cutters(self):
        """Adding a good passer should significantly increase cutter score."""
        no_passer = make_roster(make_player(cutter="Elite"))
        with_passer = make_roster(
            make_player(cutter="Elite"),
            make_player(passer="All-Time Great"),
        )
        assert cutter_score(with_passer).score > cutter_score(no_passer).score

    def test_spacing_unlocks_cutters(self):
        """Spacing creates room to cut into."""
        no_spacing = make_roster(make_player(cutter="Elite", passer="Elite"))
        with_spacing = make_roster(
            make_player(cutter="Elite", passer="Elite"),
            make_player(spot_up_shooter="Elite"),
            make_player(spot_up_shooter="Elite"),
        )
        assert cutter_score(with_spacing).score > cutter_score(no_spacing).score

    def test_screen_setters_amplify_cutters(self):
        """Screens create back-cut opportunities."""
        no_screens = make_roster(
            make_player(cutter="Elite"),
            make_player(passer="Elite"),
        )
        with_screens = make_roster(
            make_player(cutter="Elite"),
            make_player(passer="Elite"),
            make_player(screen_setter="Elite"),
        )
        assert cutter_score(with_screens).score > cutter_score(no_screens).score

    def test_on_ball_gravity_amplifies_cutters(self):
        """A dominant on-ball threat occupies defense, opening cutting lanes."""
        no_threat = make_roster(
            make_player(cutter="Elite"),
            make_player(passer="Elite"),
        )
        with_threat = make_roster(
            make_player(cutter="Elite"),
            make_player(passer="Elite"),
            make_player(isolation_scorer="All-Time Great", off_dribble_shooter="All-Time Great"),
        )
        assert cutter_score(with_threat).score > cutter_score(no_threat).score

    def test_multipliers_in_trace(self):
        roster = make_roster(make_player(cutter="Elite"))
        result = cutter_score(roster)
        assert len(result.multipliers) > 0

    def test_no_cutters_zero_score(self):
        roster = make_roster(make_player(passer="All-Time Great"))
        result = cutter_score(roster)
        assert result.score == pytest.approx(0.0)


# ===========================================================================
# 9. paint_touch_score
# ===========================================================================

class TestPaintTouchScore:
    def test_returns_score_trace(self):
        assert isinstance(paint_touch_score([]), ScoreTrace)

    def test_empty_roster_zero(self):
        result = paint_touch_score([])
        assert result.score == pytest.approx(0.0)

    def test_no_paint_skills_zero(self):
        roster = make_roster(make_player(spot_up_shooter="Elite"))
        result = paint_touch_score(roster)
        assert result.score == pytest.approx(0.0)

    def test_driver_contributes(self):
        roster = make_roster(make_player(driver="Elite"))
        result = paint_touch_score(roster)
        assert result.score > 0.0

    def test_post_player_contributes(self):
        roster = make_roster(make_player(mid_post_player="Elite"))
        result = paint_touch_score(roster)
        assert result.score > 0.0

    def test_vertical_spacer_contributes(self):
        roster = make_roster(make_player(vertical_spacer="Proficient"))
        result = paint_touch_score(roster)
        assert result.score > 0.0

    def test_higher_tier_higher_score(self):
        capable = make_roster(make_player(driver="Capable"))
        elite = make_roster(make_player(driver="Elite"))
        assert paint_touch_score(elite).score > paint_touch_score(capable).score

    def test_multiple_sources_higher_than_one(self):
        one_source = make_roster(make_player(driver="Elite"))
        two_sources = make_roster(
            make_player(driver="Elite"),
            make_player(vertical_spacer="Elite"),
        )
        assert paint_touch_score(two_sources).score > paint_touch_score(one_source).score

    def test_duplicate_player_names_both_contribute_to_score(self):
        """
        Two players with identical names must both contribute to score.
        The index-prefixed key prevents name collision in components.
        """
        roster = make_roster(
            make_player(name="Player", driver="Elite"),
            make_player(name="Player", driver="Elite"),
        )
        result = paint_touch_score(roster)
        # Both contribute: 3 * 1.0 + 3 * 1.0 = 6.0
        assert result.score == pytest.approx(6.0)
        # Components must have 2 separate entries (index-prefixed keys)
        assert len(result.components) == 2


# ===========================================================================
# 10. rebounding_covered
# ===========================================================================

class TestReboundingCovered:
    def test_returns_score_trace(self):
        assert isinstance(rebounding_covered([]), ScoreTrace)

    def test_empty_roster_not_covered(self):
        result = rebounding_covered([])
        assert result.score == pytest.approx(0.0)

    def test_one_elite_rebounder_covered(self):
        """One elite rebounder is sufficient."""
        roster = make_roster(make_player(rebounder="Elite"))
        result = rebounding_covered(roster)
        assert result.score == pytest.approx(1.0)

    def test_atg_rebounder_covered(self):
        roster = make_roster(make_player(rebounder="All-Time Great"))
        result = rebounding_covered(roster)
        assert result.score == pytest.approx(1.0)

    def test_three_capable_rebounders_covered(self):
        """Committee of 3 capable rebounders qualifies."""
        roster = make_roster(
            make_player(rebounder="Capable"),
            make_player(rebounder="Capable"),
            make_player(rebounder="Capable"),
        )
        result = rebounding_covered(roster)
        assert result.score == pytest.approx(1.0)

    def test_two_capable_rebounders_not_covered(self):
        """Only 2 capable rebounders is insufficient (need 3 for committee)."""
        roster = make_roster(
            make_player(rebounder="Capable"),
            make_player(rebounder="Capable"),
        )
        result = rebounding_covered(roster)
        assert result.score == pytest.approx(0.0)

    def test_proficient_rebounder_not_elite(self):
        """Proficient alone doesn't meet the elite threshold."""
        roster = make_roster(make_player(rebounder="Proficient"))
        result = rebounding_covered(roster)
        assert result.score == pytest.approx(0.0)

    def test_counts_in_components(self):
        roster = make_roster(make_player(rebounder="Elite"))
        result = rebounding_covered(roster)
        assert len(result.components) > 0


# ===========================================================================
# 11. lob_threat_active
# ===========================================================================

class TestLobThreatActive:
    def test_vertical_spacer_plus_passer_active(self):
        roster = make_roster(
            make_player(vertical_spacer="Capable"),
            make_player(passer="Proficient"),
        )
        assert lob_threat_active(roster) is True

    def test_vertical_spacer_plus_driver_active(self):
        """Driver capable of throwing lob also activates vertical spacer."""
        roster = make_roster(
            make_player(vertical_spacer="Capable"),
            make_player(driver="Proficient"),
        )
        assert lob_threat_active(roster) is True

    def test_vertical_spacer_no_lob_thrower_inactive(self):
        roster = make_roster(make_player(vertical_spacer="Capable"))
        assert lob_threat_active(roster) is False

    def test_great_passer_no_spacer_inactive(self):
        roster = make_roster(make_player(passer="All-Time Great"))
        assert lob_threat_active(roster) is False

    def test_empty_roster_inactive(self):
        assert lob_threat_active([]) is False

    def test_passer_below_proficient_insufficient(self):
        """Capable passer cannot reliably throw lobs."""
        roster = make_roster(
            make_player(vertical_spacer="Capable"),
            make_player(passer="Capable"),
        )
        assert lob_threat_active(roster) is False


# ===========================================================================
# 12. pnr_synergy
# ===========================================================================

class TestPnrSynergy:
    def test_both_proficient_is_synergy(self):
        roster = make_roster(
            make_player(pnr_ball_handler="Proficient"),
            make_player(pnr_finisher="Proficient"),
        )
        assert pnr_synergy(roster) is True

    def test_both_elite_is_synergy(self):
        roster = make_roster(
            make_player(pnr_ball_handler="Elite"),
            make_player(pnr_finisher="Elite"),
        )
        assert pnr_synergy(roster) is True

    def test_handler_only_no_synergy(self):
        roster = make_roster(make_player(pnr_ball_handler="Elite"))
        assert pnr_synergy(roster) is False

    def test_finisher_only_no_synergy(self):
        roster = make_roster(make_player(pnr_finisher="Elite"))
        assert pnr_synergy(roster) is False

    def test_capable_handler_no_synergy(self):
        """Capable ball handler not strong enough for PnR synergy."""
        roster = make_roster(
            make_player(pnr_ball_handler="Capable"),
            make_player(pnr_finisher="Elite"),
        )
        assert pnr_synergy(roster) is False

    def test_capable_finisher_no_synergy(self):
        roster = make_roster(
            make_player(pnr_ball_handler="Elite"),
            make_player(pnr_finisher="Capable"),
        )
        assert pnr_synergy(roster) is False

    def test_empty_roster_no_synergy(self):
        assert pnr_synergy([]) is False

    def test_same_player_both_roles(self):
        """One player can have both PnR skills."""
        roster = make_roster(make_player(pnr_ball_handler="Elite", pnr_finisher="Proficient"))
        assert pnr_synergy(roster) is True


# ===========================================================================
# 13. transition_active
# ===========================================================================

class TestTransitionActive:
    def test_threats_plus_passer_active(self):
        roster = make_roster(
            make_player(transition_threat="Capable"),
            make_player(passer="Proficient"),
        )
        assert transition_active(roster) is True

    def test_threats_without_passer_inactive(self):
        roster = make_roster(make_player(transition_threat="All-Time Great"))
        assert transition_active(roster) is False

    def test_passer_without_threats_inactive(self):
        roster = make_roster(make_player(passer="All-Time Great"))
        assert transition_active(roster) is False

    def test_empty_roster_inactive(self):
        assert transition_active([]) is False

    def test_capable_passer_insufficient(self):
        """Need at least Proficient passer to run transition."""
        roster = make_roster(
            make_player(transition_threat="Elite"),
            make_player(passer="Capable"),
        )
        assert transition_active(roster) is False

    def test_elite_threats_plus_elite_passer_active(self):
        roster = make_roster(
            make_player(transition_threat="Elite"),
            make_player(transition_threat="Elite"),
            make_player(passer="Elite"),
        )
        assert transition_active(roster) is True


# ===========================================================================
# 14. movement_orphaned
# ===========================================================================

class TestMovementOrphaned:
    def test_movement_shooters_no_screens_orphaned(self):
        roster = make_roster(
            make_player(movement_shooter="Elite"),
            make_player(movement_shooter="Proficient"),
        )
        assert movement_orphaned(roster) is True

    def test_movement_shooters_with_screens_not_orphaned(self):
        roster = make_roster(
            make_player(movement_shooter="Elite"),
            make_player(screen_setter="Capable"),
        )
        assert movement_orphaned(roster) is False

    def test_no_movement_shooters_not_orphaned(self):
        """Can't be orphaned if there's nothing to orphan."""
        roster = make_roster(make_player(spot_up_shooter="Elite"))
        assert movement_orphaned(roster) is False

    def test_empty_roster_not_orphaned(self):
        assert movement_orphaned([]) is False

    def test_spot_up_only_not_orphaned(self):
        """Spot-up shooters don't need screens — only movement shooters are affected."""
        roster = make_roster(make_player(spot_up_shooter="All-Time Great"))
        assert movement_orphaned(roster) is False


# ===========================================================================
# 15. compute_aggregates (integration)
# ===========================================================================

class TestComputeAggregates:
    def test_returns_dict(self):
        result = compute_aggregates([])
        assert isinstance(result, dict)

    def test_all_keys_present(self):
        result = compute_aggregates([])
        expected_keys = {
            "spacing_score",
            "passer_compound_score",
            "perimeter_compound_score",
            "defense_score",
            "cutter_score",
            "paint_touch_score",
            "rebounding_covered",
            "lob_threat_active",
            "pnr_synergy",
            "transition_active",
            "movement_orphaned",
        }
        assert expected_keys.issubset(result.keys())

    def test_score_traces_are_score_trace_instances(self):
        result = compute_aggregates([])
        trace_keys = [
            "spacing_score", "passer_compound_score", "perimeter_compound_score",
            "defense_score", "cutter_score", "paint_touch_score", "rebounding_covered",
        ]
        for key in trace_keys:
            assert isinstance(result[key], ScoreTrace), f"{key} should be ScoreTrace"

    def test_boolean_checks_are_bool(self):
        result = compute_aggregates([])
        bool_keys = ["lob_threat_active", "pnr_synergy", "transition_active", "movement_orphaned"]
        for key in bool_keys:
            assert isinstance(result[key], bool), f"{key} should be bool"

    def test_empty_roster_produces_zero_scores(self):
        result = compute_aggregates([])
        trace_keys = [
            "spacing_score", "passer_compound_score", "perimeter_compound_score",
            "defense_score", "cutter_score", "paint_touch_score", "rebounding_covered",
        ]
        for key in trace_keys:
            assert result[key].score == pytest.approx(0.0), f"{key} should be 0.0 for empty roster"

    def test_empty_roster_booleans_all_false(self):
        result = compute_aggregates([])
        bool_keys = ["lob_threat_active", "pnr_synergy", "transition_active", "movement_orphaned"]
        for key in bool_keys:
            assert result[key] is False, f"{key} should be False for empty roster"

    def test_realistic_roster_produces_nonzero_scores(self):
        """A realistic mixed-skill roster should produce nonzero scores across the board."""
        roster = make_roster(
            make_player(
                name="Star",
                isolation_scorer="Elite",
                off_dribble_shooter="Elite",
                passer="Proficient",
                height="6-6",
            ),
            make_player(
                name="Shooter",
                spot_up_shooter="Elite",
                movement_shooter="Proficient",
                height="6-4",
            ),
            make_player(
                name="Big",
                rim_protector="Elite",
                rebounder="Elite",
                screen_setter="Proficient",
                driver="Capable",
                height="7-0",
            ),
            make_player(
                name="Wing",
                versatile_defender="Elite",
                cutter="Proficient",
                transition_threat="Capable",
                height="6-7",
            ),
        )
        result = compute_aggregates(roster)
        assert result["spacing_score"].score > 0.0
        assert result["defense_score"].score > 0.0
        assert result["cutter_score"].score > 0.0
        assert result["paint_touch_score"].score > 0.0
