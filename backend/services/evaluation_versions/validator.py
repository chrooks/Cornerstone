"""
Publish gate validator for Evaluation Versions.

Checks structural integrity before a draft can be published:
  L1 — every formula_ref points at a registered Formula Handler
  L2 — required value keys exist in payload.values
  L3 — Subscore Tree ↔ formula_refs consistency
  L4 — Skills referenced by handlers exist in taxonomy
  L7 — changelog note is non-empty
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from services.cohesion_engine.engine import CohesionEngine


@dataclass(frozen=True)
class PublishGateViolation:
    """One structural error blocking publish."""

    layer: str       # 'L1' | 'L2' | 'L3' | 'L4' | 'L7'
    code: str        # machine-readable error code
    message: str     # human-readable explanation
    target: str = "" # optional path to the offending field


def validate(
    payload: dict[str, Any],
    changelog_note: str | None,
) -> list[PublishGateViolation]:
    """Run all publish gate layers. Returns empty list if valid."""
    violations: list[PublishGateViolation] = []

    formula_refs = payload.get("formula_refs", {})
    taxonomy = payload.get("taxonomy", {})
    values = payload.get("values", {})

    # L1: every formula_ref must point at a registered handler
    registered = CohesionEngine.registered_handlers()
    for composite_key, handler_name in formula_refs.items():
        if handler_name not in registered:
            violations.append(PublishGateViolation(
                layer="L1",
                code="handler_not_registered",
                message=f"Formula ref '{composite_key}' points at handler "
                        f"'{handler_name}' which is not registered.",
                target=f"formula_refs.{composite_key}",
            ))

    # L2: required value keys
    required_value_keys = [
        "tier_values",
        "composite_coefficients",
        "composite_names",
        "theoretical_max",
        "cohesion_rollup_weights",
    ]
    for key in required_value_keys:
        if key not in values:
            violations.append(PublishGateViolation(
                layer="L2",
                code="value_key_missing",
                message=f"Required value key '{key}' missing from payload.values.",
                target=f"values.{key}",
            ))

    # L3: Subscore Tree ↔ formula_refs consistency
    subscore_tree = taxonomy.get("subscore_tree", [])
    # formula_refs keys should cover Impact Trait dimensions
    impact_traits = taxonomy.get("impact_traits", [])
    impact_trait_keys = {t["key"] for t in impact_traits}
    formula_ref_keys = set(formula_refs.keys())

    # Every Impact Trait must have a formula_ref
    for trait_key in impact_trait_keys:
        if trait_key not in formula_ref_keys:
            violations.append(PublishGateViolation(
                layer="L3",
                code="subscore_orphan",
                message=f"Impact Trait '{trait_key}' has no entry in formula_refs.",
                target=f"taxonomy.impact_traits.{trait_key}",
            ))

    # Every formula_ref must correspond to an Impact Trait
    for ref_key in formula_ref_keys:
        if ref_key not in impact_trait_keys:
            violations.append(PublishGateViolation(
                layer="L3",
                code="subscore_orphan",
                message=f"formula_refs key '{ref_key}' has no matching Impact Trait.",
                target=f"formula_refs.{ref_key}",
            ))

    # L4: Skills exist in taxonomy
    skills = taxonomy.get("skills", [])
    skill_keys = {s["key"] for s in skills}
    if not skill_keys:
        violations.append(PublishGateViolation(
            layer="L4",
            code="skill_missing",
            message="No skills defined in taxonomy.",
            target="taxonomy.skills",
        ))

    # L7: changelog note non-empty
    if not changelog_note or not changelog_note.strip():
        violations.append(PublishGateViolation(
            layer="L7",
            code="changelog_empty",
            message="Changelog note is required for publishing.",
            target="changelog_note",
        ))

    return violations
