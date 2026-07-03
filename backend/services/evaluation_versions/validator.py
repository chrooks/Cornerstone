"""
Publish gate validator for Evaluation Versions.

Checks structural integrity before a draft can be published:
  L1 — every formula_ref points at a registered Formula Handler
  L2 — required value keys exist in payload.values
  L3 — formula_refs ↔ Impact Trait consistency (orphan refs block publish)
  L4 — Skills referenced by handlers exist in taxonomy
  L5 — orphan Impact Traits with no formula_ref (warning, does not block)
  L6 — composite_coefficients keys must be in the COMPOSITE_COEFFICIENTS
       allowlist (warning — supports staged migrations where the key lands
       before the formula that consumes it)
  L7 — changelog note is non-empty
  L8 — composite_formulas structural integrity (when present)
  L9 — composite_coefficients values must be finite numbers (error —
       non-finite values silently propagate through the composite pipeline
       and poison every downstream rating)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from services.cohesion_engine.engine import CohesionEngine
from services.cohesion_engine.weights import COMPOSITE_COEFFICIENTS


@dataclass(frozen=True)
class PublishGateViolation:
    """One structural issue found during publish gate validation."""

    layer: str           # 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9'
    code: str            # machine-readable error code
    message: str         # human-readable explanation
    target: str = ""     # optional path to the offending field
    severity: str = "error"  # 'error' blocks publish, 'warning' does not


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

    # L2: required value keys — every key the cohesion engine reads via
    # values["key"] at runtime. A published version missing any of these
    # will cause KeyError during evaluation.
    required_value_keys = [
        "accentuation_complementary_pairs",
        "accentuation_fallback_strength_threshold",
        "accentuation_fallback_weakness_threshold",
        "accentuation_min_strengths",
        "accentuation_strength_threshold",
        "accentuation_top_n",
        "accentuation_weakness_threshold",
        "amplitude_map",
        "archetype_labels",
        "bell",
        "category_weights",
        "composite_coefficients",
        "composite_names",
        "defensive_coverage_saturation_raw",
        "defensive_gap_penalty_scale",
        "defensive_gap_threshold",
        "defensive_guard_density_height_range",
        "defensive_rebounding_minimum",
        "defensive_rebounding_penalty_scale",
        "defensive_transition_boost_cap",
        "defensive_transition_boost_divisor",
        "depth_quality_weight",
        "depth_viable_ratio_weight",
        "height_max_inches",
        "height_min_inches",
        "lineup_archetype_max",
        "lineup_only_rollup_weights",
        "min_distribution_size",
        "normalization_breakpoint_percentile",
        "normalization_breakpoint_score",
        "note_capable_passer_threshold",
        "note_covered_composite_threshold",
        "note_elite_bell_amplitude_threshold",
        "note_elite_composite_threshold",
        "note_limit_per_type",
        "note_min_roster_size",
        "note_missing_composite_threshold",
        "note_severity_max",
        "note_severity_min",
        "note_stacked_composite_threshold",
        "note_stacked_player_count",
        "note_weak_composite_avg_threshold",
        "off_13_raw_spacing_threshold",
        "passing_depth_weight",
        "passing_primary_creator_weight",
        "pd_cross",
        "pd_down",
        "peak_shift_pd_only",
        "peak_shift_rp_only",
        "pnr_handler_depth_weight",
        "pnr_handler_primary_weight",
        "pnr_handler_secondary_weight",
        "pnr_handler_support_scale",
        "pnr_pairing_quality_gate_floor",
        "pnr_pairing_quality_gate_scale",
        "pnr_screener_depth_weight",
        "pnr_screener_primary_weight",
        "pnr_screener_secondary_weight",
        "post_game_depth_weight",
        "post_game_primary_weight",
        "post_game_secondary_weight",
        "ratio_asymmetric_full_penalty",
        "ratio_dead_zone",
        "ratio_default_penalty",
        "ratio_min_denominator",
        "defensive_rebounding_depth_weight",
        "defensive_rebounding_primary_weight",
        "defensive_rebounding_secondary_weight",
        "defense_subscore_weights",
        "interior_defense_depth_weight",
        "interior_defense_primary_weight",
        "interior_defense_secondary_weight",
        "offense_balance_weights",
        "offense_quality_ratio",
        "offense_quality_weights",
        "offensive_rebounding_depth_weight",
        "offensive_rebounding_primary_weight",
        "offensive_rebounding_secondary_weight",
        "perimeter_defense_depth_weight",
        "perimeter_defense_primary_weight",
        "perimeter_defense_secondary_weight",
        "rebound_transition_subscore_weights",
        "roster_rollup_weights",
        "accentuation_strength_cap",
        "accentuation_weakness_cap",
        "switchability_coverage_threshold",
        "switchability_overlap_weight",
        "rp_cross",
        "rp_pd_boost",
        "rp_up",
        "stacking_returns",
        "star_rating_max",
        "synergy_boosted_skills",
        "synergy_creator_threshold",
        "synergy_penalty_severity",
        "synergy_scale_factors",
        "theoretical_max",
        "tier_values",
        "total_lineups_full_roster",
        "vd_ext",
        "viable_lineup_threshold",
        "warm_body",
        "spacing_raw_gate",
        "spacing_multipliers",
        "shot_creation_raw_gate",
        "shot_creation_multipliers",
        "shot_creation_primary_weight",
        "shot_creation_secondary_weight",
        "shot_creation_depth_weight",
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

    # Every formula_ref must correspond to an Impact Trait (error — blocks publish)
    for ref_key in formula_ref_keys:
        if ref_key not in impact_trait_keys:
            violations.append(PublishGateViolation(
                layer="L3",
                code="subscore_orphan",
                message=f"formula_refs key '{ref_key}' has no matching Impact Trait.",
                target=f"formula_refs.{ref_key}",
            ))

    # L5: orphan Impact Trait — trait exists but no formula_ref wired (warning only)
    for trait_key in impact_trait_keys:
        if trait_key not in formula_ref_keys:
            violations.append(PublishGateViolation(
                layer="L5",
                code="orphan_impact_trait",
                message=f"Impact Trait '{trait_key}' has no entry in formula_refs.",
                target=f"taxonomy.impact_traits.{trait_key}",
                severity="warning",
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

    # L6 + L9: composite_coefficients allowlist + non-finite checks
    violations.extend(_validate_composite_coefficients(values))

    # L7: changelog note non-empty
    if not changelog_note or not changelog_note.strip():
        violations.append(PublishGateViolation(
            layer="L7",
            code="changelog_empty",
            message="Changelog note is required for publishing.",
            target="changelog_note",
        ))

    # L8: composite_formulas structural integrity (when present)
    composite_formulas = values.get("composite_formulas")
    if composite_formulas and isinstance(composite_formulas, dict):
        violations.extend(_validate_composite_formulas(composite_formulas))

    return violations


def _validate_composite_coefficients(
    values: dict[str, Any],
) -> list[PublishGateViolation]:
    """Validate the ``composite_coefficients`` block.

    L6 (warning): every key must be in the ``COMPOSITE_COEFFICIENTS`` allowlist
    from ``services.cohesion_engine.weights``. Unknown keys persist invisibly
    and create silent-drift risk (see #46).

    L9 (error): every value must be a finite number (``math.isfinite``).
    Non-finite values (``inf``, ``-inf``, ``NaN``) propagate silently through
    the composite pipeline, poisoning every downstream rating (see #45). Bool
    values are rejected as non-numeric because ``bool`` is an ``int`` subclass
    in Python and would otherwise slip past the type check.
    """
    violations: list[PublishGateViolation] = []

    coefficients = values.get("composite_coefficients")
    if not isinstance(coefficients, dict):
        # Absence/shape is enforced by L2; nothing to scan without a mapping.
        return violations

    allowlist = set(COMPOSITE_COEFFICIENTS.keys())

    for key, value in coefficients.items():
        # L6 — unknown key (warning, does not block publish)
        if key not in allowlist:
            violations.append(PublishGateViolation(
                layer="L6",
                code="coefficient_key_unknown",
                message=(
                    f"composite_coefficients key '{key}' is not in the "
                    f"COMPOSITE_COEFFICIENTS allowlist. Remove the orphan "
                    f"key or add it to services/cohesion_engine/weights.py."
                ),
                target=f"values.composite_coefficients.{key}",
                severity="warning",
            ))

        # L9 — non-numeric or non-finite value (error, blocks publish)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            violations.append(PublishGateViolation(
                layer="L9",
                code="coefficient_value_non_numeric",
                message=(
                    f"composite_coefficients['{key}'] must be a finite "
                    f"number, got {type(value).__name__} ({value!r})."
                ),
                target=f"values.composite_coefficients.{key}",
                severity="error",
            ))
        elif not math.isfinite(value):
            violations.append(PublishGateViolation(
                layer="L9",
                code="coefficient_value_non_finite",
                message=(
                    f"composite_coefficients['{key}'] must be finite, "
                    f"got {value!r}. Non-finite coefficients silently "
                    f"corrupt every downstream composite."
                ),
                target=f"values.composite_coefficients.{key}",
                severity="error",
            ))

    return violations


def _validate_composite_formulas(
    formulas: dict[str, Any],
) -> list[PublishGateViolation]:
    """L8 validation for composite_formulas structure."""
    from services.skills import ALL_SKILLS
    from services.cohesion_engine.weights import COMPOSITE_NAMES

    violations: list[PublishGateViolation] = []
    valid_skills = set(ALL_SKILLS)
    formula_keys = set(formulas.keys())
    expected_keys = set(COMPOSITE_NAMES)

    # Every canonical composite must have an entry.
    for missing in expected_keys - formula_keys:
        violations.append(PublishGateViolation(
            layer="L8",
            code="formula_missing_composite",
            message=f"Composite '{missing}' has no entry in composite_formulas.",
            target=f"values.composite_formulas.{missing}",
        ))

    for comp_key, formula in formulas.items():
        if not isinstance(formula, dict):
            violations.append(PublishGateViolation(
                layer="L8",
                code="formula_invalid_shape",
                message=f"composite_formulas.{comp_key} must be a dict.",
                target=f"values.composite_formulas.{comp_key}",
            ))
            continue

        # Validate factors.
        composite_deps: set[str] = set()
        for i, factor in enumerate(formula.get("factors", [])):
            f_type = factor.get("type")
            f_key = factor.get("key", "")
            if f_type == "skill" and f_key not in valid_skills:
                violations.append(PublishGateViolation(
                    layer="L8",
                    code="formula_invalid_skill",
                    message=f"Factor {i} of '{comp_key}' references unknown skill '{f_key}'.",
                    target=f"values.composite_formulas.{comp_key}.factors[{i}]",
                ))
            elif f_type == "composite":
                if f_key not in formula_keys:
                    violations.append(PublishGateViolation(
                        layer="L8",
                        code="formula_invalid_composite_ref",
                        message=f"Factor {i} of '{comp_key}' references unknown composite '{f_key}'.",
                        target=f"values.composite_formulas.{comp_key}.factors[{i}]",
                    ))
                if f_key == comp_key:
                    violations.append(PublishGateViolation(
                        layer="L8",
                        code="formula_self_reference",
                        message=f"Factor {i} of '{comp_key}' references itself.",
                        target=f"values.composite_formulas.{comp_key}.factors[{i}]",
                    ))
                composite_deps.add(f_key)

        # Validate the optional fallback block (when_missing + factor skills).
        fallback = formula.get("fallback")
        if isinstance(fallback, dict):
            for skill_key in fallback.get("when_missing", []):
                if skill_key not in valid_skills:
                    violations.append(PublishGateViolation(
                        layer="L8",
                        code="formula_invalid_fallback_trigger",
                        message=f"Fallback of '{comp_key}' has unknown when_missing skill '{skill_key}'.",
                        target=f"values.composite_formulas.{comp_key}.fallback.when_missing",
                    ))
            for i, factor in enumerate(fallback.get("factors", [])):
                if factor.get("type") == "skill" and factor.get("key", "") not in valid_skills:
                    violations.append(PublishGateViolation(
                        layer="L8",
                        code="formula_invalid_fallback_skill",
                        message=f"Fallback factor {i} of '{comp_key}' references unknown skill '{factor.get('key', '')}'.",
                        target=f"values.composite_formulas.{comp_key}.fallback.factors[{i}]",
                    ))

        # Validate amplifier sources and applies_to bounds.
        num_factors = len(formula.get("factors", []))
        for i, amp in enumerate(formula.get("amplifiers", [])):
            source = amp.get("source")
            if isinstance(source, str):
                # Composite source.
                if source not in formula_keys:
                    violations.append(PublishGateViolation(
                        layer="L8",
                        code="formula_invalid_amplifier_source",
                        message=f"Amplifier {i} of '{comp_key}' references unknown composite '{source}'.",
                        target=f"values.composite_formulas.{comp_key}.amplifiers[{i}]",
                    ))
                composite_deps.add(source)
            elif isinstance(source, dict):
                # Skill-sum source.
                for skill_key in source.get("skills", []):
                    if skill_key not in valid_skills:
                        violations.append(PublishGateViolation(
                            layer="L8",
                            code="formula_invalid_amplifier_skill",
                            message=f"Amplifier {i} of '{comp_key}' references unknown skill '{skill_key}'.",
                            target=f"values.composite_formulas.{comp_key}.amplifiers[{i}]",
                        ))

            # Bounds-check applies_to indices.
            applies_to = amp.get("applies_to")
            if applies_to is not None:
                for idx in applies_to:
                    if not isinstance(idx, int) or idx < 0 or idx >= num_factors:
                        violations.append(PublishGateViolation(
                            layer="L8",
                            code="formula_amplifier_index_out_of_bounds",
                            message=f"Amplifier {i} of '{comp_key}' applies_to index {idx} out of range (0..{num_factors - 1}).",
                            target=f"values.composite_formulas.{comp_key}.amplifiers[{i}].applies_to",
                        ))

        # Validate depends_on matches actual composite references.
        declared_deps = set(formula.get("depends_on", []))
        if declared_deps != composite_deps:
            missing_deps = composite_deps - declared_deps
            extra_deps = declared_deps - composite_deps
            if missing_deps:
                violations.append(PublishGateViolation(
                    layer="L8",
                    code="formula_depends_on_incomplete",
                    message=f"'{comp_key}' references composites {missing_deps} but depends_on is missing them.",
                    target=f"values.composite_formulas.{comp_key}.depends_on",
                ))
            if extra_deps:
                violations.append(PublishGateViolation(
                    layer="L8",
                    code="formula_depends_on_extra",
                    message=f"'{comp_key}' depends_on lists {extra_deps} which are not referenced by factors or amplifiers.",
                    target=f"values.composite_formulas.{comp_key}.depends_on",
                    severity="warning",
                ))

    # Circular dependency check via topological sort.
    if formula_keys:
        from services.cohesion_engine.formula_engine import topological_sort
        try:
            topological_sort(formulas)
        except ValueError as exc:
            violations.append(PublishGateViolation(
                layer="L8",
                code="formula_circular_dependency",
                message=f"Circular dependency in composite_formulas: {exc}",
                target="values.composite_formulas",
            ))

    return violations
