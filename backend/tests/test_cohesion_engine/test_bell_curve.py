"""
Unit tests for Phase 2 defensive bell curve logic.
"""

from __future__ import annotations

from backend.services.cohesion_engine.bell_curve import (
    apply_rp_pd_boost,
    compute_bell_params,
    compute_lineup_coverage_by_height,
    compute_lineup_defense,
    defensive_value_at_height,
    parse_height_inches,
)


def player(name: str, height: str, skills: dict[str, str]) -> dict:
    return {"id": name, "name": name, "height": height, "skills": skills}


def test_parse_height_inches_accepts_common_formats():
    assert parse_height_inches("6-7") == 79
    assert parse_height_inches("6'7\"") == 79
    assert parse_height_inches(79) == 79
    assert parse_height_inches(None) is None


def test_compute_bell_params_for_warm_body():
    params = compute_bell_params({}, 74)

    assert params == {
        "amplitude": 0.5,
        "peak_center": 74,
        "range_down": 1,
        "range_up": 1,
        "flat_top_down": 0,
        "flat_top_up": 0,
        "player_height": 74,
    }


def test_compute_bell_params_for_elite_versatile_defender():
    params = compute_bell_params({"versatile_defender": "Elite"}, 79)

    assert params["amplitude"] == 3.5
    assert params["peak_center"] == 79
    assert params["range_down"] == 6
    assert params["range_up"] == 6
    assert params["flat_top_down"] == 2
    assert params["flat_top_up"] == 2


def test_compute_bell_params_applies_pd_and_rp_peak_shifts():
    pd_only = compute_bell_params({"perimeter_disruptor": "Elite"}, 76)
    rp_only = compute_bell_params({"rim_protector": "Elite"}, 82)

    assert pd_only["peak_center"] == 75
    assert rp_only["peak_center"] == 83


def test_compute_bell_params_clamps_peak_to_supported_height_range():
    params = compute_bell_params({"rim_protector": "All-Time Great"}, 90)

    assert params["amplitude"] == 4.0
    assert params["peak_center"] == 88


def test_defensive_value_at_height_flat_taper_and_outside():
    assert defensive_value_at_height(79, 3.5, 79, 6, 6, 2, 2) == 3.5
    assert round(defensive_value_at_height(83, 3.5, 79, 6, 6, 2, 2), 3) == 1.523
    assert defensive_value_at_height(86, 3.5, 79, 6, 6, 2, 2) == 0.0


def test_apply_rp_pd_boost_returns_copied_teammates_without_mutating_originals():
    lineup = [
        player("Anchor", "7-0", {"rim_protector": "Elite"}),
        player("Guard", "6-3", {"perimeter_disruptor": "Proficient"}),
        player("Wing", "6-7", {"perimeter_disruptor": "None"}),
    ]

    boosted = apply_rp_pd_boost(lineup)

    assert lineup[1]["skills"]["perimeter_disruptor"] == "Proficient"
    assert lineup[2]["skills"]["perimeter_disruptor"] == "None"
    assert boosted[0] is lineup[0]
    assert boosted[1] is not lineup[1]
    assert boosted[1]["skills"]["perimeter_disruptor"] == "Elite"
    assert boosted[2]["skills"]["perimeter_disruptor"] == "Capable"


def test_apply_rp_pd_boost_noops_without_elite_rim_protector():
    lineup = [
        player("Big", "6-11", {"rim_protector": "Proficient"}),
        player("Guard", "6-3", {"perimeter_disruptor": "Capable"}),
    ]

    assert apply_rp_pd_boost(lineup) is lineup


def test_compute_lineup_defense_stacks_values_and_reports_gaps():
    lineup = [
        player("Guard", "6-2", {"perimeter_disruptor": "Elite"}),
        player("Wing", "6-7", {"versatile_defender": "Elite"}),
        player("Big", "7-0", {"rim_protector": "Elite"}),
    ]

    coverage, gap_penalty, gaps = compute_lineup_defense(lineup)

    assert coverage > 1.0
    assert gap_penalty <= 0.0
    assert all(72 <= height <= 88 for height in gaps)


def test_compute_lineup_coverage_by_height_returns_supported_range():
    coverage = compute_lineup_coverage_by_height(
        [player("Wing", "6-7", {"versatile_defender": "Elite"})]
    )

    assert set(coverage) == set(range(72, 89))
    assert coverage[79] == 3.5


def test_compute_lineup_defense_empty_lineup_returns_all_gaps():
    coverage, gap_penalty, gaps = compute_lineup_defense([])

    assert coverage == 0.0
    assert gap_penalty == -38.25
    assert gaps == list(range(72, 89))
