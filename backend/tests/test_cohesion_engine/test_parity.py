"""
Parity test: handler dispatch matches legacy inline aggregation.

Proves the lineup-level handler refactor is purely structural — dispatching
through registered handlers produces identical results to the legacy inline
_average / _top_two_plus_depth calls.

Also proves that modified values in the Evaluation Version blob produce
measurably different scores (values are consumed at runtime, not ignored).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from services.cohesion_engine.composites import (
    compute_player_composites,
    compute_raw_composites,
)
from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion, LineupContext
from services.cohesion_engine.types import PlayerComposites

# Ensure handlers are registered
import services.cohesion_engine.handlers.composites_v1  # noqa: F401
from services.cohesion_engine.handlers.composites_v1 import _average, _top_two_plus_depth


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
    """Load bootstrap blob but change Elite tier value from 8.0 to 10.0."""
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    payload = copy.deepcopy(data["payload"])
    payload["values"]["tier_values"]["Elite"] = 10.0
    return EvaluationVersion(
        id="modified-test",
        slug="cohesion-v1",
        status="published",
        payload=payload,
    )


def _make_lineup() -> list[dict]:
    """Five-player lineup with varied skills for parity testing."""
    return [
        {"id": "handler", "name": "Handler", "height": "6-3", "skills": {
            "pnr_ball_handler": "Elite", "passer": "Elite", "perimeter_disruptor": "Elite",
        }},
        {"id": "shooter", "name": "Shooter", "height": "6-5", "skills": {
            "spot_up_shooter": "Elite", "movement_shooter": "Elite", "off_dribble_shooter": "Proficient",
        }},
        {"id": "wing", "name": "Wing", "height": "6-8", "skills": {
            "versatile_defender": "Elite", "transition_threat": "Elite", "driver": "Proficient",
        }},
        {"id": "big", "name": "Big", "height": "7-0", "skills": {
            "rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite",
        }},
        {"id": "forward", "name": "Forward", "height": "6-9", "skills": {
            "cutter": "Elite", "high_flyer": "Proficient", "offensive_rebounder": "Proficient",
        }},
    ]


def _compute_composites(lineup: list[dict], values: dict) -> list[PlayerComposites]:
    """Compute PlayerComposites for a lineup using the same path as evaluate_lineup."""
    from services.cohesion_engine.bell_curve import parse_height_inches
    computed = []
    for i, player in enumerate(lineup):
        height_inches = parse_height_inches(player.get("height"))
        computed.append(compute_player_composites(
            player.get("skills", {}),
            player_id=str(player.get("id", f"p-{i}")),
            name=str(player.get("name", f"p-{i}")),
            values=values,
            height_inches=height_inches,
        ))
    return computed


class TestHandlerParity:
    """Dispatched handlers produce same results as legacy inline aggregation."""

    @pytest.fixture()
    def engine(self) -> CohesionEngine:
        return CohesionEngine(_load_bootstrap_version())

    @pytest.fixture()
    def ctx(self, engine: CohesionEngine) -> LineupContext:
        lineup = _make_lineup()
        composites = _compute_composites(lineup, engine.version.values)
        return LineupContext(composites=composites, lineup=lineup)

    def test_average_handlers_match(self, engine: CohesionEngine, ctx: LineupContext):
        """Handlers using _average match direct computation."""
        for field in ("spacing", "finishing", "paint_touch", "off_ball_impact", "shot_creation", "transition"):
            handler_name = f"{field}_v1"
            dispatched = engine.dispatch(handler_name, ctx)
            expected = _average(ctx.composites, field)
            assert dispatched == pytest.approx(expected, abs=1e-9), (
                f"Handler {handler_name}: dispatched={dispatched}, expected={expected}"
            )

    def test_collective_handlers_match(self, engine: CohesionEngine, ctx: LineupContext):
        """Handlers using _top_two_plus_depth match direct computation."""
        v = engine.version.values
        cases = [
            ("post_game_v1", "post_game", v["post_game_primary_weight"], v["post_game_secondary_weight"], v["post_game_depth_weight"]),
            ("defensive_rebounding_v1", "defensive_rebounding", v["defensive_rebounding_primary_weight"], v["defensive_rebounding_secondary_weight"], v["defensive_rebounding_depth_weight"]),
            ("offensive_rebounding_v1", "offensive_rebounding", v["offensive_rebounding_primary_weight"], v["offensive_rebounding_secondary_weight"], v["offensive_rebounding_depth_weight"]),
            ("pnr_screener_v1", "pnr_screener", v["pnr_screener_primary_weight"], v["pnr_screener_secondary_weight"], v["pnr_screener_depth_weight"]),
            ("perimeter_defense_v1", "perimeter_defense", v["perimeter_defense_primary_weight"], v["perimeter_defense_secondary_weight"], v["perimeter_defense_depth_weight"]),
            ("interior_defense_v1", "interior_defense", v["interior_defense_primary_weight"], v["interior_defense_secondary_weight"], v["interior_defense_depth_weight"]),
        ]
        for handler_name, field, pw, sw, dw in cases:
            dispatched = engine.dispatch(handler_name, ctx)
            expected = _top_two_plus_depth(ctx.composites, field, pw, sw, dw)
            assert dispatched == pytest.approx(expected, abs=1e-9), (
                f"Handler {handler_name}: dispatched={dispatched}, expected={expected}"
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

    def test_modified_tier_values_change_output(
        self,
        bootstrap_engine: CohesionEngine,
        modified_engine: CohesionEngine,
    ):
        """Changing Elite from 8.0 to 10.0 must produce different lineup subscores."""
        lineup = _make_lineup()

        bootstrap_composites = _compute_composites(lineup, bootstrap_engine.version.values)
        modified_composites = _compute_composites(lineup, modified_engine.version.values)

        bootstrap_ctx = LineupContext(composites=bootstrap_composites, lineup=lineup)
        modified_ctx = LineupContext(composites=modified_composites, lineup=lineup)

        handler_names = [
            "spacing_v1", "finishing_v1", "paint_touch_v1",
            "post_game_v1", "pnr_screener_v1", "off_ball_impact_v1",
            "shot_creation_v1", "ball_security_v1",
            "defensive_rebounding_v1", "offensive_rebounding_v1",
            "transition_v1", "perimeter_defense_v1", "interior_defense_v1",
        ]

        differences = set()
        for name in handler_names:
            b = bootstrap_engine.dispatch(name, bootstrap_ctx)
            m = modified_engine.dispatch(name, modified_ctx)
            if b != pytest.approx(m, abs=1e-9):
                differences.add(name)

        assert differences, (
            "Modified tier values produced identical output — "
            "handlers are not reading from engine.version.values"
        )


class TestBallSecurityFallbackParity:
    """Hardcoded and declarative paths agree on all three steady_hand cases."""

    @pytest.mark.parametrize(
        "steady_hand_tier",
        ["Elite", "None", None],  # rated-Elite / rated-None / key-absent
        ids=["rated_elite", "rated_none", "key_absent"],
    )
    def test_hardcoded_and_declarative_agree(self, steady_hand_tier):
        from services.cohesion_engine.formula_export import export_formulas

        skills = {"passer": "Elite", "pnr_ball_handler": "Proficient", "driver": "Capable"}
        if steady_hand_tier is not None:
            skills["steady_hand"] = steady_hand_tier

        values = _load_bootstrap_version().payload["values"]
        hardcoded = compute_raw_composites(skills, values)

        values_declarative = copy.deepcopy(values)
        values_declarative["composite_formulas"] = export_formulas(
            values["composite_coefficients"]
        )
        declarative = compute_raw_composites(skills, values_declarative)

        assert hardcoded["ball_security"] == pytest.approx(
            declarative["ball_security"], abs=1e-9
        )

        tier_values = values["tier_values"]
        if steady_hand_tier is None:
            # Legend: legacy proxy fires — nonzero because passer is Elite.
            assert hardcoded["ball_security"] > 0.0
        else:
            # Rated player: trait is exactly the skill's tier value.
            assert hardcoded["ball_security"] == pytest.approx(
                tier_values.get(steady_hand_tier, 0.0)
            )
