"""publish_perimeter_split_ev.py builds the EV v10 patch (#152, M3.14).

Parity is the point. The published Evaluation Version carries the composite
coefficients and the declarative perimeter_defense formula; if either drifts
from the engine's own numbers, the Lab scores one way and the Version claims
another. These tests read the expected values out of the engine, not out of a
literal, so the script cannot diverge from it.
"""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "publish_perimeter_split_ev.py"


def _load():
    spec = importlib.util.spec_from_file_location("publish_perimeter_split_ev", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def script():
    return _load()


def _payload(with_formulas: bool = True) -> dict:
    """A payload shaped like a published EV: pre-split taxonomy, live weights."""
    from services.cohesion_engine.formula_export import export_formulas
    from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS

    values = {"composite_coefficients": dict(COMPOSITE_COEFFICIENTS)}
    if with_formulas:
        values["composite_formulas"] = export_formulas(COMPOSITE_COEFFICIENTS)
    return {
        "taxonomy": {
            "skills": [
                {"key": "passer", "label": "Creates shots.", "order": 0},
                {"key": "perimeter_disruptor", "label": "Disrupts handlers.", "order": 1},
                {"key": "versatile_defender", "label": "Guards multiple groups.", "order": 2},
            ]
        },
        "values": values,
    }


def _op(ops: list[dict], path: str) -> dict:
    matches = [o for o in ops if o["path"] == path]
    assert len(matches) == 1, f"expected exactly one op at {path}, got {len(matches)}"
    return matches[0]


class TestTaxonomyPatch:
    def test_old_key_replaced_in_place_and_off_ball_appended(self, script):
        ops = script.build_patch_ops(_payload())
        skills = _op(ops, "/taxonomy/skills")["value"]

        keys = [s["key"] for s in skills]
        assert "perimeter_disruptor" not in keys
        assert keys == ["passer", "point_of_attack_defender", "versatile_defender", "off_ball_disruptor"]

    def test_orders_are_renumbered(self, script):
        skills = _op(script.build_patch_ops(_payload()), "/taxonomy/skills")["value"]
        assert [s["order"] for s in skills] == [0, 1, 2, 3]

    def test_new_entries_carry_their_backend_definitions(self, script):
        from services.skills import SKILL_DEFINITIONS

        skills = _op(script.build_patch_ops(_payload()), "/taxonomy/skills")["value"]
        by_key = {s["key"]: s for s in skills}
        assert by_key["point_of_attack_defender"]["label"] == SKILL_DEFINITIONS["point_of_attack_defender"]
        assert by_key["off_ball_disruptor"]["label"] == SKILL_DEFINITIONS["off_ball_disruptor"]


class TestCoefficientParity:
    def test_coefficients_come_from_the_engine(self, script):
        from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS

        ops = script.build_patch_ops(_payload())
        poa = _op(ops, "/values/composite_coefficients/perimeter_defense_poa")["value"]
        obd = _op(ops, "/values/composite_coefficients/perimeter_defense_off_ball")["value"]

        assert poa == COMPOSITE_COEFFICIENTS["perimeter_defense_poa"]
        assert obd == COMPOSITE_COEFFICIENTS["perimeter_defense_off_ball"]

    def test_coefficients_are_the_approved_split(self, script):
        ops = script.build_patch_ops(_payload())
        assert _op(ops, "/values/composite_coefficients/perimeter_defense_poa")["value"] == 0.6
        assert _op(ops, "/values/composite_coefficients/perimeter_defense_off_ball")["value"] == 0.4


class TestPerimeterDefenseFormula:
    def test_factors_match_the_engine_formula(self, script):
        from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS

        ops = script.build_patch_ops(_payload())
        formula = _op(ops, "/values/composite_formulas/perimeter_defense")["value"]

        assert [(f["key"], f["coefficient"]) for f in formula["factors"]] == [
            ("point_of_attack_defender", 0.6),
            ("off_ball_disruptor", 0.4),
            ("versatile_defender", COMPOSITE_COEFFICIENTS["perimeter_defense_versatile_defender"]),
        ]

    def test_off_ball_absent_fallback_is_the_pre_split_math(self, script):
        from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS

        ops = script.build_patch_ops(_payload())
        fallback = _op(ops, "/values/composite_formulas/perimeter_defense")["value"]["fallback"]

        assert fallback["when_missing"] == ["off_ball_disruptor"]
        assert [(f["key"], f["coefficient"]) for f in fallback["factors"]] == [
            ("point_of_attack_defender", 1.0),
            ("versatile_defender", COMPOSITE_COEFFICIENTS["perimeter_defense_versatile_defender"]),
        ]


class TestPayloadWithoutFormulas:
    def test_whole_map_is_patched_when_the_payload_has_none(self, script):
        ops = script.build_patch_ops(_payload(with_formulas=False))
        formulas = _op(ops, "/values/composite_formulas")["value"]
        assert "perimeter_defense" in formulas
        assert not any(o["path"].startswith("/values/composite_formulas/") for o in ops)


class TestGuards:
    def test_refuses_a_payload_that_never_had_the_old_skill(self, script):
        payload = _payload()
        payload["taxonomy"]["skills"] = [{"key": "passer", "label": "Creates shots.", "order": 0}]
        with pytest.raises(ValueError, match="perimeter_disruptor"):
            script.build_patch_ops(payload)
