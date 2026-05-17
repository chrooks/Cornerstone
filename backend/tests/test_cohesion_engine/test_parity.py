"""
Parity test: handler dispatch matches direct function calls.

Proves the M3 refactor is purely structural — CohesionEngine dispatching
through registered handlers produces identical results to calling the
existing composites.py functions directly.

Also proves that modified values in the Evaluation Version blob produce
measurably different scores (values are consumed at runtime, not ignored).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from services.cohesion_engine.composites import compute_raw_composites
from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion


def _load_bootstrap_version() -> EvaluationVersion:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    return EvaluationVersion(
        id="parity-test",
        slug="cohesion-v1",
        status="published",
        payload=data["payload"],
    )


def _load_modified_version() -> EvaluationVersion:
    """Load bootstrap blob but change Elite tier value from 6.0 to 8.0."""
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    payload = copy.deepcopy(data["payload"])
    payload["values"]["tier_values"]["Elite"] = 8.0
    return EvaluationVersion(
        id="modified-test",
        slug="cohesion-v1",
        status="published",
        payload=payload,
    )


# Canned player skills for parity comparison
CANNED_SKILLS: list[dict[str, str]] = [
    {
        "spot_up_shooter": "Elite",
        "off_dribble_shooter": "Proficient",
        "movement_shooter": "Capable",
        "isolation_scorer": "None",
        "driver": "Proficient",
        "crafty_finisher": "Capable",
        "passer": "Proficient",
        "pnr_ball_handler": "Capable",
        "pnr_finisher": "None",
        "cutter": "None",
        "vertical_spacer": "None",
        "high_flyer": "None",
        "rebounder": "Capable",
        "offensive_rebounder": "None",
        "screen_setter": "None",
        "rim_protector": "None",
        "versatile_defender": "Capable",
        "perimeter_disruptor": "Proficient",
        "low_post_player": "None",
        "mid_post_player": "None",
        "transition_threat": "Proficient",
    },
    {
        "spot_up_shooter": "None",
        "off_dribble_shooter": "None",
        "movement_shooter": "None",
        "isolation_scorer": "None",
        "driver": "Capable",
        "crafty_finisher": "Proficient",
        "passer": "Capable",
        "pnr_ball_handler": "None",
        "pnr_finisher": "Elite",
        "cutter": "Proficient",
        "vertical_spacer": "All-Time Great",
        "high_flyer": "Elite",
        "rebounder": "Elite",
        "offensive_rebounder": "Proficient",
        "screen_setter": "Elite",
        "rim_protector": "All-Time Great",
        "versatile_defender": "Proficient",
        "perimeter_disruptor": "None",
        "low_post_player": "Proficient",
        "mid_post_player": "Capable",
        "transition_threat": "Proficient",
    },
]


class TestHandlerParity:
    @pytest.fixture()
    def engine(self) -> CohesionEngine:
        return CohesionEngine(_load_bootstrap_version())

    @pytest.mark.parametrize("skill_set", CANNED_SKILLS, ids=["shooter", "big"])
    def test_each_composite_matches(self, engine: CohesionEngine, skill_set: dict[str, str]):
        values = engine.version.values
        direct = compute_raw_composites(skill_set, values)

        for composite_name in direct:
            handler_name = f"{composite_name}_v1"
            dispatched = engine.dispatch(handler_name, skill_set)
            assert dispatched == pytest.approx(direct[composite_name], abs=1e-9), (
                f"Handler {handler_name} returned {dispatched}, "
                f"direct returned {direct[composite_name]}"
            )

    def test_all_formula_refs_registered(self, engine: CohesionEngine):
        """Every formula_ref in the bootstrap payload has a registered handler."""
        for composite_key, handler_name in engine.version.formula_refs.items():
            assert handler_name in CohesionEngine.registered_handlers(), (
                f"formula_refs[{composite_key!r}] = {handler_name!r} not registered"
            )


class TestModifiedValuesProduceDifferentOutput:
    """Proves that changing values in the Evaluation Version blob produces
    different scores — the engine actually reads from the blob at runtime."""

    @pytest.fixture()
    def bootstrap_engine(self) -> CohesionEngine:
        return CohesionEngine(_load_bootstrap_version())

    @pytest.fixture()
    def modified_engine(self) -> CohesionEngine:
        return CohesionEngine(_load_modified_version())

    @pytest.mark.parametrize("skill_set", CANNED_SKILLS, ids=["shooter", "big"])
    def test_modified_tier_values_change_output(
        self,
        bootstrap_engine: CohesionEngine,
        modified_engine: CohesionEngine,
        skill_set: dict[str, str],
    ):
        """Changing Elite from 6.0 to 8.0 must produce different composite scores
        for any player with at least one Elite skill."""
        bootstrap_results = {
            name: bootstrap_engine.dispatch(f"{name}_v1", skill_set)
            for name in [
                "spacing", "finishing", "paint_touch", "anchor", "post_game",
                "pnr_screener", "off_ball_impact", "shot_creation", "rebounding",
                "transition", "perimeter_defense", "interior_defense",
            ]
        }
        modified_results = {
            name: modified_engine.dispatch(f"{name}_v1", skill_set)
            for name in bootstrap_results
        }

        # At least one composite must differ (both skill sets have Elite skills)
        differences = {
            name for name in bootstrap_results
            if bootstrap_results[name] != pytest.approx(modified_results[name], abs=1e-9)
        }
        assert differences, (
            "Modified tier values produced identical output — "
            "handlers are not reading from engine.version.values"
        )
