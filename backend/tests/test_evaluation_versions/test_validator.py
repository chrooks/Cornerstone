"""Tests for the Evaluation Version publish gate validator."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS
from services.evaluation_versions.validator import validate


def _load_v1_payload() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        return json.load(f)["payload"]


class TestValidatorHappyPath:
    def test_v1_payload_has_no_blocking_errors(self):
        """Seed payload must publish cleanly. Warnings are tolerated (see L6)."""
        payload = _load_v1_payload()
        violations = validate(payload, "test changelog note")
        blocking = [v for v in violations if v.severity == "error"]
        assert blocking == [], f"Unexpected blocking violations: {blocking}"


class TestL1HandlerExistence:
    def test_unregistered_handler_fails(self):
        payload = _load_v1_payload()
        payload["formula_refs"]["spacing"] = "spacing_v99_does_not_exist"
        violations = validate(payload, "note")
        l1 = [v for v in violations if v.layer == "L1"]
        assert len(l1) == 1
        assert l1[0].code == "handler_not_registered"
        assert "spacing_v99_does_not_exist" in l1[0].message


class TestL2RequiredValueKeys:
    def test_missing_tier_values(self):
        payload = _load_v1_payload()
        del payload["values"]["tier_values"]
        violations = validate(payload, "note")
        l2 = [v for v in violations if v.layer == "L2"]
        assert any(v.code == "value_key_missing" and "tier_values" in v.target for v in l2)

    def test_missing_engine_required_key_caught(self):
        """Every key the engine reads via values['key'] must be validated at publish time."""
        payload = _load_v1_payload()
        # Remove a key that the engine accesses but the old gate didn't check
        del payload["values"]["amplitude_map"]
        violations = validate(payload, "note")
        l2 = [v for v in violations if v.layer == "L2"]
        assert any(v.code == "value_key_missing" and "amplitude_map" in v.target for v in l2)

    def test_all_seed_keys_are_required(self):
        """The publish gate must require every key present in the v1 seed blob."""
        payload = _load_v1_payload()
        seed_keys = set(payload["values"].keys())
        # Remove each key one at a time and verify the validator catches it
        for key in seed_keys:
            stripped = _load_v1_payload()
            del stripped["values"][key]
            violations = validate(stripped, "note")
            l2 = [v for v in violations if v.layer == "L2" and key in v.target]
            assert l2, f"Validator did not catch missing key: {key}"


class TestL3SubscoreTreeConsistency:
    def test_orphan_impact_trait(self):
        payload = _load_v1_payload()
        payload["taxonomy"]["impact_traits"].append(
            {"key": "ghost_composite", "label": "Ghost", "order": 99}
        )
        violations = validate(payload, "note")
        l5 = [v for v in violations if v.layer == "L5"]
        assert any(v.code == "orphan_impact_trait" and "ghost_composite" in v.message for v in l5)

    def test_orphan_formula_ref(self):
        payload = _load_v1_payload()
        payload["formula_refs"]["nonexistent_trait"] = "spacing_v1"
        violations = validate(payload, "note")
        l3 = [v for v in violations if v.layer == "L3"]
        assert any(v.code == "subscore_orphan" and "nonexistent_trait" in v.message for v in l3)


class TestL4SkillExistence:
    def test_empty_skills_fails(self):
        payload = _load_v1_payload()
        payload["taxonomy"]["skills"] = []
        violations = validate(payload, "note")
        l4 = [v for v in violations if v.layer == "L4"]
        assert len(l4) == 1
        assert l4[0].code == "skill_missing"


class TestL7ChangelogNote:
    def test_empty_changelog_fails(self):
        payload = _load_v1_payload()
        violations = validate(payload, "")
        l7 = [v for v in violations if v.layer == "L7"]
        assert len(l7) == 1
        assert l7[0].code == "changelog_empty"

    def test_none_changelog_fails(self):
        payload = _load_v1_payload()
        violations = validate(payload, None)
        l7 = [v for v in violations if v.layer == "L7"]
        assert len(l7) == 1

    def test_whitespace_only_changelog_fails(self):
        payload = _load_v1_payload()
        violations = validate(payload, "   ")
        l7 = [v for v in violations if v.layer == "L7"]
        assert len(l7) == 1


class TestL6CompositeCoefficientsAllowlist:
    """Issue #46 — composite_coefficients keys must be in the allowlist."""

    def test_unknown_key_emits_warning(self):
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["ghost_coefficient"] = 0.5
        violations = validate(payload, "note")
        l6 = [v for v in violations if v.layer == "L6" and "ghost_coefficient" in v.target]
        assert len(l6) == 1
        assert l6[0].code == "coefficient_key_unknown"
        assert l6[0].severity == "warning"
        assert "ghost_coefficient" in l6[0].message
        assert l6[0].target == "values.composite_coefficients.ghost_coefficient"

    def test_unknown_key_does_not_block_publish(self):
        """Severity must be 'warning' so staged migrations still ship."""
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["future_key"] = 0.1
        violations = validate(payload, "note")
        blocking = [v for v in violations if v.severity == "error"]
        assert blocking == []

    def test_multiple_unknown_keys_each_flagged(self):
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["orphan_a"] = 0.1
        payload["values"]["composite_coefficients"]["orphan_b"] = 0.2
        violations = validate(payload, "note")
        l6 = [v for v in violations if v.layer == "L6"]
        targets = {v.target for v in l6}
        assert "values.composite_coefficients.orphan_a" in targets
        assert "values.composite_coefficients.orphan_b" in targets

    def test_empty_dict_passes_silently(self):
        """Zero coefficients should produce no L6 or L9 violations — empty is a valid state."""
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"] = {}
        violations = validate(payload, "note")
        related = [v for v in violations if v.layer in ("L6", "L9")]
        assert related == []

    def test_seed_drift_is_surfaced_as_warning(self):
        """Document and lock in the orphan-drift case L6 was built to catch.

        The v1 seed contains transition_passer_scale (a coefficient that the
        formula engine stopped consuming during the #43 audit). It still lives
        in the seed JSON, so L6 must surface it as a warning. This test exists
        so a future seed cleanup deliberately removes both sides instead of
        silently regressing the safety net.
        """
        payload = _load_v1_payload()
        seed_keys = set(payload["values"]["composite_coefficients"].keys())
        drift = seed_keys - set(COMPOSITE_COEFFICIENTS.keys())
        if not drift:
            pytest.skip("Seed and allowlist now match — happy day. Update this test.")
        violations = validate(payload, "note")
        l6_targets = {v.target for v in violations if v.layer == "L6"}
        for orphan in drift:
            assert f"values.composite_coefficients.{orphan}" in l6_targets


class TestL9CompositeCoefficientsFinite:
    """Issue #45 — composite_coefficients values must be finite numbers."""

    @pytest.mark.parametrize("bad_value", [
        float("inf"),
        float("-inf"),
        float("nan"),
    ])
    def test_non_finite_value_blocks_publish(self, bad_value):
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["spacing_off_dribble"] = bad_value
        violations = validate(payload, "note")
        l9 = [v for v in violations if v.layer == "L9"]
        assert len(l9) == 1
        assert l9[0].code == "coefficient_value_non_finite"
        assert l9[0].severity == "error"
        assert l9[0].target == "values.composite_coefficients.spacing_off_dribble"
        assert "spacing_off_dribble" in l9[0].message

    @pytest.mark.parametrize("field", [
        "spacing_off_dribble",                      # plain coefficient
        "paint_touch_finishing_scale",              # amplifier scale
        "perimeter_defense_versatile_defender",     # multi-skill weight
        "pnr_screener_secondary_scale",             # another amplifier scale
    ])
    def test_non_finite_per_known_field(self, field):
        """Every known coefficient field must reject non-finite values."""
        assert field in COMPOSITE_COEFFICIENTS, (
            f"Test fixture drift: {field} no longer in COMPOSITE_COEFFICIENTS. "
            f"Pick a different real key."
        )
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"][field] = float("inf")
        violations = validate(payload, "note")
        l9 = [v for v in violations if v.layer == "L9" and field in v.target]
        assert l9, f"Validator did not catch non-finite value at {field}"

    def test_non_numeric_value_blocks_publish(self):
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["spacing_off_dribble"] = "0.5"
        violations = validate(payload, "note")
        l9 = [v for v in violations if v.layer == "L9"]
        assert len(l9) == 1
        assert l9[0].code == "coefficient_value_non_numeric"
        assert l9[0].severity == "error"

    def test_bool_value_blocks_publish(self):
        """``True`` is an ``int`` subclass; reject so callers cannot smuggle flags here."""
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["spacing_off_dribble"] = True
        violations = validate(payload, "note")
        l9 = [v for v in violations if v.layer == "L9"]
        assert len(l9) == 1
        assert l9[0].code == "coefficient_value_non_numeric"

    def test_finite_zero_value_passes(self):
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["spacing_off_dribble"] = 0.0
        violations = validate(payload, "note")
        l9 = [v for v in violations if v.layer == "L9"]
        assert l9 == []

    def test_jsonb_roundtrip_non_finite_caught_at_validator(self):
        """A non-finite value that survived a JSON serialize/deserialize cycle
        must still be caught by the validator before reaching the DB layer.

        Python's json module accepts ``Infinity``/``NaN`` literals when the
        default ``parse_constant`` is used; the validator is the last line of
        defense before Supabase JSONB persistence.
        """
        payload = _load_v1_payload()
        payload["values"]["composite_coefficients"]["spacing_off_dribble"] = float("inf")
        roundtripped = json.loads(json.dumps(payload))
        assert math.isinf(roundtripped["values"]["composite_coefficients"]["spacing_off_dribble"])
        violations = validate(roundtripped, "note")
        l9 = [v for v in violations if v.layer == "L9"]
        assert len(l9) == 1
        assert l9[0].severity == "error"
