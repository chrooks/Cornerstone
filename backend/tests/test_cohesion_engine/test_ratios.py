"""
Unit tests for Phase 3 ratio mechanics.
"""

from __future__ import annotations

from backend.services.cohesion_engine.ratios import (
    ratio_score,
    rebounding_spacing_deficit_ratio,
    spacing_paint_touch_ratio,
)


def test_ratio_score_returns_zero_for_missing_sides():
    assert ratio_score(0, 0) == 0.0
    assert ratio_score(5, 0) == 0.0
    assert ratio_score(0, 5) == 0.0


def test_ratio_score_rewards_near_balance():
    assert ratio_score(8, 8) == 10.0
    assert ratio_score(8, 7) == 9.3


def test_ratio_score_penalizes_lopsided_values_beyond_dead_zone():
    assert ratio_score(8, 2) == 1.2


def test_spacing_paint_touch_asymmetry_penalizes_paint_heavy_lineups_more():
    paint_heavy = spacing_paint_touch_ratio(3, 8)
    spacing_heavy = spacing_paint_touch_ratio(8, 3)

    assert paint_heavy < spacing_heavy


def test_rebounding_spacing_deficit_only_fires_when_spacing_is_low():
    assert rebounding_spacing_deficit_ratio(6, 6) == 0.0
    assert rebounding_spacing_deficit_ratio(4, 3) > 0.0
