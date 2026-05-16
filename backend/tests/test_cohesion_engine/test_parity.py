"""
Parity test: handler dispatch matches direct function calls.

Proves the M3 refactor is purely structural — CohesionEngine dispatching
through registered handlers produces identical results to calling the
existing composites.py functions directly.
"""

from __future__ import annotations

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
        direct = compute_raw_composites(skill_set)

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
