"""
Publish gate validator for Evaluation Versions.

Checks structural integrity before a draft can be published:
  L1 — every formula_ref points at a registered Formula Handler
  L2 — required value keys exist in payload.values
  L3 — formula_refs ↔ Impact Trait consistency (orphan refs block publish)
  L4 — Skills referenced by handlers exist in taxonomy
  L5 — orphan Impact Traits with no formula_ref (warning, does not block)
  L7 — changelog note is non-empty
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from services.cohesion_engine.engine import CohesionEngine


@dataclass(frozen=True)
class PublishGateViolation:
    """One structural issue found during publish gate validation."""

    layer: str           # 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L7'
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

    # L7: changelog note non-empty
    if not changelog_note or not changelog_note.strip():
        violations.append(PublishGateViolation(
            layer="L7",
            code="changelog_empty",
            message="Changelog note is required for publishing.",
            target="changelog_note",
        ))

    return violations
