"""
Unit tests for Phase 2 player composite computation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.cohesion_engine import composites
from backend.services.cohesion_engine.types import PlayerComposites


def _bootstrap_values() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


VALUES = _bootstrap_values()


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
        "perimeter_disruptor": "Proficient",
        "versatile_defender": "Capable",
        "screen_setter": "Capable",
        "pnr_finisher": "Proficient",
        "passer": "All-Time Great",
        "cutter": "Proficient",
        "transition_threat": "Elite",
        "pnr_ball_handler": "Capable",
        "isolation_scorer": "Proficient",
    }


def test_compute_raw_composites_matches_validated_formula_order():
    raw = composites.compute_raw_composites(sample_skills(), VALUES)

    assert raw["spacing"] == pytest.approx(12.5)
    assert raw["finishing"] == pytest.approx(9.0)
    assert raw["defensive_rebounding"] == pytest.approx(4.0)
    assert raw["offensive_rebounding"] == pytest.approx(1.0)
    # paint_touch: floor changed 1.0→0.9, offensive_rebounder term added
    assert raw["paint_touch"] == pytest.approx(27.54)
    assert raw["post_game"] == pytest.approx(6.6)
    assert raw["pnr_screener"] == pytest.approx(9.8)
    # transition: passer_mult dropped; flat additive transition_passer + transition_off_dribble added
    assert raw["transition"] == pytest.approx(11.9)
    assert raw["perimeter_defense"] == pytest.approx(4.7)
    assert raw["interior_defense"] == pytest.approx(9.45)
    assert raw["off_ball_impact"] == pytest.approx(24.18)
    # shot_creation: iso now explicit, paint_touch changed
    assert raw["shot_creation"] == pytest.approx(35.26)
    # ball_security: expanded to 3 skills (passer=ATG gives same value since no pnr/driver)
    assert raw["ball_security"] == pytest.approx(16.0)


def test_compute_raw_composites_accepts_numeric_synergy_values():
    raw = composites.compute_raw_composites(
        {
            "movement_shooter": 7.0,
            "spot_up_shooter": "Proficient",
            "off_dribble_shooter": "None",
        },
        VALUES,
    )

    assert raw["spacing"] == pytest.approx(11.0)


def test_normalize_composites_uses_theoretical_max_when_cache_empty():
    normalized = composites.normalize_composites(
        {
            "spacing": 12.5,
            "finishing": 10.0,
            "paint_touch": 42.9,
            "post_game": 8.5,
            "pnr_screener": 25.0,
            "off_ball_impact": 30.5,
            "shot_creation": 30.0,
            "ball_security": 5.0,
            "defensive_rebounding": 5.0,
            "offensive_rebounding": 5.0,
            "transition": 21.0,
            "perimeter_defense": 8.5,
            "interior_defense": 9.0,
        },
        VALUES,
    )

    assert normalized == {
        "spacing": 3.1,
        "finishing": 3.1,
        "paint_touch": 2.3,
        "post_game": 3.1,
        "pnr_screener": 2.3,
        "off_ball_impact": 3.0,
        "shot_creation": 1.9,
        "ball_security": 3.1,
        "defensive_rebounding": 3.1,
        "offensive_rebounding": 3.1,
        "transition": 2.4,
        "perimeter_defense": 3.1,
        "interior_defense": 3.6,
    }


def test_percentile_normalize_uses_sixtieth_percentile_breakpoint():
    distribution = [float(value) for value in range(20)]

    assert composites._percentile_normalize(6.0, distribution, 0.6, 6.0) == 3.3
    assert composites._percentile_normalize(12.0, distribution, 0.6, 6.0) == 6.0
    assert composites._percentile_normalize(19.0, distribution, 0.6, 6.0) == 10.0


def test_normalize_composites_uses_cached_distribution_when_large_enough():
    distributions = {name: [float(value) for value in range(20)] for name in composites.COMPOSITE_NAMES}
    composites.set_distributions(distributions)

    normalized = composites.normalize_composites({name: 12.0 for name in composites.COMPOSITE_NAMES}, VALUES)

    assert all(value == 6.0 for value in normalized.values())


def test_compute_player_composites_returns_dataclass_with_bell_params():
    player = composites.compute_player_composites(
        sample_skills(),
        player_id="p1",
        name="Example",
        values=VALUES,
        height_inches=80,
    )

    assert isinstance(player, PlayerComposites)
    assert player.player_id == "p1"
    assert player.name == "Example"
    assert player.spacing == 3.1
    assert player.perimeter_defense == 1.7
    assert player.interior_defense == 3.8
    assert player.ball_security == 10.0
    assert player.defensive_rebounding == 2.5
    assert player.offensive_rebounding == 0.6
    assert player.bell_amplitude == 3.5
    assert player.bell_peak == 80
    assert player.bell_range_down == 7
    assert player.bell_range_up == 8


def test_compute_player_composites_populates_all_composite_names():
    player = composites.compute_player_composites(
        sample_skills(),
        player_id="p1",
        name="Example",
        values=VALUES,
        height_inches=80,
    )

    for composite_name in composites.COMPOSITE_NAMES:
        assert getattr(player, composite_name) >= 0


def test_normalize_composites_guards_zero_theoretical_max():
    """A zero theoretical_max for a composite must not crash with ZeroDivisionError."""
    import copy

    broken_values = copy.deepcopy(VALUES)
    broken_values["theoretical_max"]["spacing"] = 0

    normalized = composites.normalize_composites(
        {"spacing": 5.0, "finishing": 10.0, **{name: 1.0 for name in composites.COMPOSITE_NAMES if name not in ("spacing", "finishing")}},
        broken_values,
    )

    assert normalized["spacing"] == 0.0  # graceful fallback, not crash
    assert normalized["finishing"] > 0.0  # other composites still compute


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

    distributions = composites.build_distributions("2025-26", VALUES)

    assert distributions["spacing"] == [1.0, 8.0]
    assert distributions["finishing"] == [0.0, 0.0]
    assert distributions["perimeter_defense"] == [0.0, 0.0]
    assert distributions["interior_defense"] == [0.0, 0.0]
    assert composites.COMPOSITE_DISTRIBUTIONS["spacing"] == [1.0, 8.0]
