"""Tests for the Evaluation Version publish gate validator."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.evaluation_versions.validator import validate


def _load_v1_payload() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        return json.load(f)["payload"]


class TestValidatorHappyPath:
    def test_v1_payload_is_valid(self):
        payload = _load_v1_payload()
        violations = validate(payload, "test changelog note")
        assert violations == []


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
        l3 = [v for v in violations if v.layer == "L3"]
        assert any(v.code == "subscore_orphan" and "ghost_composite" in v.message for v in l3)

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
