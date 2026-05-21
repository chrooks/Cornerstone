"""
Tests for v2 Formula Handlers (spacing_v2 and shot_creation_v2).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest

from services.cohesion_engine.engine import (
    CohesionEngine,
    EvaluationVersion,
    LineupContext,
)
from services.cohesion_engine.types import PlayerComposites

import services.cohesion_engine.handlers.composites_v1  # noqa: F401
import services.cohesion_engine.handlers.composites_v2  # noqa: F401


def _bootstrap_values() -> dict:
    seed_path = (
        Path(__file__).resolve().parents[3]
        / "supabase"
        / "migrations"
        / "data"
        / "evaluation_version_v1_seed.json"
    )
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


BASE_VALUES = _bootstrap_values()

# v2 handler keys not in the base seed yet — inject for tests
V2_VALUES = {
    **BASE_VALUES,
    "spacing_raw_gate": 1.0,
    "spacing_multipliers": [0.3, 0.5, 0.75, 1.0, 1.0, 0.95],
    "shot_creation_raw_gate": 2.0,
    "shot_creation_multipliers": [0.2, 1.0, 1.0, 1.0, 0.95, 0.90],
    "shot_creation_primary_weight": 0.6,
    "shot_creation_secondary_weight": 0.25,
    "shot_creation_depth_weight": 0.15,
}


def _make_version(values: dict | None = None) -> EvaluationVersion:
    """Build a minimal EvaluationVersion with v2 values."""
    v = values or V2_VALUES
    return EvaluationVersion(
        id="test-v2",
        slug="test-v2",
        status="active",
        payload={
            "values": v,
            "taxonomy": {"skills": [], "impact_traits": [], "subscore_tree": []},
            "formula_refs": {
                "spacing": "spacing_v2",
                "shot_creation": "shot_creation_v2",
            },
        },
    )


def _make_player_composites(
    spacing: float = 0.0,
    shot_creation: float = 0.0,
    **kwargs,
) -> PlayerComposites:
    """Build a PlayerComposites with specified values, rest default to 0."""
    defaults = {name: 0.0 for name in [
        "spacing", "finishing", "paint_touch", "post_game", "pnr_screener",
        "off_ball_impact", "shot_creation", "pnr_orchestration", "ball_security",
        "defensive_rebounding", "offensive_rebounding", "transition",
        "perimeter_defense", "interior_defense",
    ]}
    defaults.update(spacing=spacing, shot_creation=shot_creation, **kwargs)
    return PlayerComposites(
        player_id="test",
        name="Test",
        bell_amplitude=1.0,
        bell_peak=78,
        bell_range_down=3,
        bell_range_up=3,
        bell_flat_down=1,
        bell_flat_up=1,
        **defaults,
    )


def _make_skills(**overrides) -> dict:
    """Build a skills dict with everything at None, then apply overrides."""
    from services.skills import ALL_SKILLS

    skills = {skill: "None" for skill in ALL_SKILLS}
    skills.update(overrides)
    return skills


# ============================================================================
# spacing_v2 tests
# ============================================================================


class TestSpacingV2:
    def test_five_non_shooters_get_cliff_penalty(self):
        """5 players with no shooting Skills → spacer_count=0, multiplier=0.3."""
        engine = CohesionEngine(version=_make_version())
        ctx = LineupContext(
            composites=[_make_player_composites(spacing=3.0) for _ in range(5)],
            lineup=[{"skills": _make_skills()} for _ in range(5)],
        )
        result = engine.dispatch("spacing_v2", ctx)
        expected = 3.0 * 0.3  # avg=3.0, multiplier for 0 spacers = 0.3
        assert result == pytest.approx(expected)

    def test_three_shooters_reach_baseline(self):
        """3 Proficient spot-up shooters + 2 non-shooters → multiplier=1.0."""
        engine = CohesionEngine(version=_make_version())
        shooter_skills = _make_skills(spot_up_shooter="Proficient")
        non_shooter_skills = _make_skills()
        ctx = LineupContext(
            composites=[_make_player_composites(spacing=6.0) for _ in range(5)],
            lineup=[
                {"skills": shooter_skills},
                {"skills": shooter_skills},
                {"skills": shooter_skills},
                {"skills": non_shooter_skills},
                {"skills": non_shooter_skills},
            ],
        )
        result = engine.dispatch("spacing_v2", ctx)
        expected = 6.0 * 1.0  # 3 spacers → multiplier 1.0
        assert result == pytest.approx(expected)

    def test_off_dribble_only_does_not_count_as_spacer(self):
        """Off-dribble at Capable (raw=0.5) < gate 1.0 → not a spacer."""
        engine = CohesionEngine(version=_make_version())
        shooter_skills = _make_skills(spot_up_shooter="Capable")  # raw = 1.0, passes gate
        od_only_skills = _make_skills(off_dribble_shooter="Capable")  # raw = 0.5, fails gate
        non_shooter_skills = _make_skills()
        ctx = LineupContext(
            composites=[_make_player_composites(spacing=5.0) for _ in range(5)],
            lineup=[
                {"skills": shooter_skills},
                {"skills": shooter_skills},
                {"skills": od_only_skills},
                {"skills": non_shooter_skills},
                {"skills": non_shooter_skills},
            ],
        )
        result = engine.dispatch("spacing_v2", ctx)
        # spacer_count = 2 (not 3), multiplier = 0.75
        expected = 5.0 * 0.75
        assert result == pytest.approx(expected)

    def test_v2_differs_from_v1_with_two_shooters(self):
        """spacing_v2 produces different output from v1 for 2-shooter lineup."""
        version = _make_version()
        engine = CohesionEngine(version=version)
        shooter_skills = _make_skills(spot_up_shooter="Elite")
        non_shooter_skills = _make_skills()
        ctx = LineupContext(
            composites=[_make_player_composites(spacing=5.0) for _ in range(5)],
            lineup=[
                {"skills": shooter_skills},
                {"skills": shooter_skills},
                {"skills": non_shooter_skills},
                {"skills": non_shooter_skills},
                {"skills": non_shooter_skills},
            ],
        )
        v2_result = engine.dispatch("spacing_v2", ctx)
        v1_result = engine.dispatch("spacing_v1", ctx)
        # v1 = simple average = 5.0, v2 = 5.0 * 0.75 = 3.75
        assert v1_result == pytest.approx(5.0)
        assert v2_result == pytest.approx(3.75)
        assert v2_result != v1_result


# ============================================================================
# shot_creation_v2 tests
# ============================================================================


class TestShotCreationV2:
    def test_zero_creators_get_catastrophic_penalty(self):
        """5 players with no creation Skills → multiplier=0.2."""
        engine = CohesionEngine(version=_make_version())
        ctx = LineupContext(
            composites=[_make_player_composites(shot_creation=1.0) for _ in range(5)],
            lineup=[{"skills": _make_skills()} for _ in range(5)],
        )
        result = engine.dispatch("shot_creation_v2", ctx)
        # t2pd: primary=1.0*0.6 + secondary=1.0*0.25 + depth=1.0*0.15 = 1.0
        # multiplied by 0.2
        assert result == pytest.approx(1.0 * 0.2)

    def test_one_elite_creator_reaches_baseline(self):
        """1 player with Elite isolation + Elite off-dribble → at least 1 creator."""
        engine = CohesionEngine(version=_make_version())
        creator_skills = _make_skills(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
        )
        non_creator_skills = _make_skills()
        ctx = LineupContext(
            composites=[
                _make_player_composites(shot_creation=8.0),
                _make_player_composites(shot_creation=1.0),
                _make_player_composites(shot_creation=1.0),
                _make_player_composites(shot_creation=1.0),
                _make_player_composites(shot_creation=1.0),
            ],
            lineup=[
                {"skills": creator_skills},
                {"skills": non_creator_skills},
                {"skills": non_creator_skills},
                {"skills": non_creator_skills},
                {"skills": non_creator_skills},
            ],
        )
        result = engine.dispatch("shot_creation_v2", ctx)
        # creator_count=1, multiplier=1.0
        # t2pd: primary=8.0*0.6 + secondary=1.0*0.25 + depth=2.4*0.15
        t2pd = 8.0 * 0.6 + 1.0 * 0.25 + (12.0 / 5) * 0.15
        assert result == pytest.approx(t2pd * 1.0)

    def test_concentrated_creation_scores_higher_than_distributed(self):
        """1 elite + 4 zeros should score higher than 5 moderate on v2."""
        engine = CohesionEngine(version=_make_version())

        # Concentrated: 1 elite creator
        creator_skills = _make_skills(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
            pnr_ball_handler="Proficient",
        )
        non_creator = _make_skills()
        concentrated_ctx = LineupContext(
            composites=[
                _make_player_composites(shot_creation=9.0),
                _make_player_composites(shot_creation=0.5),
                _make_player_composites(shot_creation=0.5),
                _make_player_composites(shot_creation=0.5),
                _make_player_composites(shot_creation=0.5),
            ],
            lineup=[
                {"skills": creator_skills},
                {"skills": non_creator},
                {"skills": non_creator},
                {"skills": non_creator},
                {"skills": non_creator},
            ],
        )

        # Distributed: 5 moderate creators (all pass gate)
        moderate_creator = _make_skills(
            isolation_scorer="Proficient",
            off_dribble_shooter="Capable",
        )
        distributed_ctx = LineupContext(
            composites=[_make_player_composites(shot_creation=4.0) for _ in range(5)],
            lineup=[{"skills": moderate_creator} for _ in range(5)],
        )

        concentrated = engine.dispatch("shot_creation_v2", concentrated_ctx)
        distributed = engine.dispatch("shot_creation_v2", distributed_ctx)

        # v2 rewards concentration via t2pd weighting
        assert concentrated > distributed

    def test_v2_differs_from_v1(self):
        """shot_creation_v2 produces different output from v1 for non-trivial lineup."""
        engine = CohesionEngine(version=_make_version())
        creator_skills = _make_skills(
            isolation_scorer="Elite",
            off_dribble_shooter="Elite",
        )
        non_creator = _make_skills()
        ctx = LineupContext(
            composites=[
                _make_player_composites(shot_creation=8.0),
                _make_player_composites(shot_creation=2.0),
                _make_player_composites(shot_creation=1.0),
                _make_player_composites(shot_creation=1.0),
                _make_player_composites(shot_creation=0.5),
            ],
            lineup=[
                {"skills": creator_skills},
                {"skills": non_creator},
                {"skills": non_creator},
                {"skills": non_creator},
                {"skills": non_creator},
            ],
        )
        v2_result = engine.dispatch("shot_creation_v2", ctx)
        v1_result = engine.dispatch("shot_creation_v1", ctx)
        assert v2_result != v1_result
