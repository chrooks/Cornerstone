"""
Unit tests for Phase 2 player composite computation.
"""

from __future__ import annotations

import pytest

from backend.services.cohesion_engine import composites
from backend.services.cohesion_engine.types import PlayerComposites


@pytest.fixture(autouse=True)
def clear_distribution_cache():
    """Each test starts in theoretical-max fallback mode unless it opts in."""
    composites.clear_distributions()
    yield
    composites.clear_distributions()


def sample_skills() -> dict[str, str]:
    return {
        "movement_shooter": "Elite",
        "spot_up_shooter": "Proficient",
        "off_dribble_shooter": "Capable",
        "high_flyer": "Capable",
        "crafty_finisher": "Elite",
        "rebounder": "Proficient",
        "offensive_rebounder": "Capable",
        "driver": "Elite",
        "vertical_spacer": "Proficient",
        "low_post_player": "Capable",
        "mid_post_player": "Elite",
        "rim_protector": "Elite",
        "screen_setter": "Capable",
        "pnr_finisher": "Proficient",
        "passer": "All-Time Great",
        "cutter": "Proficient",
        "transition_threat": "Elite",
        "pnr_ball_handler": "Capable",
        "isolation_scorer": "Proficient",
    }


def test_compute_raw_composites_matches_validated_formula_order():
    raw = composites.compute_raw_composites(sample_skills())

    assert raw["spacing"] == pytest.approx(9.75)
    assert raw["finishing"] == pytest.approx(7.5)
    assert raw["rebounding"] == pytest.approx(4.5)
    assert raw["paint_touch"] == pytest.approx(21.6)
    assert raw["anchor"] == pytest.approx(12.45)
    assert raw["post_game"] == pytest.approx(5.7)
    assert raw["pnr_screener"] == pytest.approx(7.2)
    assert raw["transition"] == pytest.approx(21.45)
    assert raw["off_ball_impact"] == pytest.approx(17.55)
    assert raw["shot_creation"] == pytest.approx(40.525)


def test_compute_raw_composites_accepts_numeric_synergy_values():
    raw = composites.compute_raw_composites(
        {
            "movement_shooter": 7.0,
            "spot_up_shooter": "Proficient",
            "off_dribble_shooter": "None",
        }
    )

    assert raw["spacing"] == pytest.approx(10.0)


def test_normalize_composites_uses_theoretical_max_when_cache_empty():
    normalized = composites.normalize_composites(
        {
            "spacing": 12.5,
            "finishing": 10.0,
            "paint_touch": 42.9,
            "anchor": 16.5,
            "post_game": 8.5,
            "pnr_screener": 25.0,
            "off_ball_impact": 30.5,
            "shot_creation": 30.0,
            "rebounding": 10.0,
            "transition": 21.0,
        }
    )

    assert normalized == {
        "spacing": 5.0,
        "finishing": 5.0,
        "paint_touch": 5.0,
        "anchor": 5.0,
        "post_game": 5.0,
        "pnr_screener": 5.0,
        "off_ball_impact": 5.0,
        "shot_creation": 5.0,
        "rebounding": 5.0,
        "transition": 5.0,
    }


def test_percentile_normalize_uses_sixtieth_percentile_breakpoint():
    distribution = [float(value) for value in range(20)]

    assert composites._percentile_normalize(6.0, distribution) == 3.3
    assert composites._percentile_normalize(12.0, distribution) == 6.0
    assert composites._percentile_normalize(19.0, distribution) == 10.0


def test_normalize_composites_uses_cached_distribution_when_large_enough():
    distributions = {name: [float(value) for value in range(20)] for name in composites.COMPOSITE_NAMES}
    composites.set_distributions(distributions)

    normalized = composites.normalize_composites({name: 12.0 for name in composites.COMPOSITE_NAMES})

    assert all(value == 6.0 for value in normalized.values())


def test_compute_player_composites_returns_dataclass_with_bell_params():
    player = composites.compute_player_composites(
        sample_skills(),
        player_id="p1",
        name="Example",
        height_inches=80,
    )

    assert isinstance(player, PlayerComposites)
    assert player.player_id == "p1"
    assert player.name == "Example"
    assert player.spacing == 3.9
    assert player.bell_amplitude == 3.5
    assert player.bell_peak == 82
    assert player.bell_range_down == 1
    assert player.bell_range_up == 4


def test_build_distributions_reads_current_and_legend_profiles(monkeypatch):
    class FakeResult:
        def __init__(self, data):
            self.data = data

    class FakeQuery:
        def __init__(self):
            self.filters = {}

        def select(self, _columns):
            return self

        def eq(self, key, value):
            self.filters[key] = value
            return self

        def execute(self):
            if self.filters.get("is_legend") is True:
                return FakeResult(
                    [{"profile": {"movement_shooter": {"final_tier": "Capable"}}}]
                )
            return FakeResult(
                [{"profile": {"spot_up_shooter": {"final_tier": "Elite"}}}]
            )

    class FakeClient:
        def table(self, _name):
            return FakeQuery()

    monkeypatch.setattr(composites, "_get_supabase_client", lambda: FakeClient())
    monkeypatch.setattr(composites, "_run_query", lambda query: query())

    distributions = composites.build_distributions("2025-26")

    assert distributions["spacing"] == [1.5, 6.0]
    assert distributions["finishing"] == [0.0, 0.0]
    assert composites.COMPOSITE_DISTRIBUTIONS["spacing"] == [1.5, 6.0]
