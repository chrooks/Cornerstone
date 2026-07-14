"""
Dump the current cohesion_engine constants into the v1 Evaluation Version blob.

Usage:
    cd backend && source venv/bin/activate
    python scripts/dump_v1_blob.py > ../supabase/migrations/data/evaluation_version_v1_seed.json
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

# Add backend to sys.path so imports work when run from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.cohesion_engine import weights as W
from services import skills as S


def _build_subscore_tree() -> list[dict]:
    """Build the two-level Subscore Tree for the Evaluation Version taxonomy."""
    offense_quality = [
        {"key": "spacing", "label": "Spacing", "order": 0},
        {"key": "shot_creation", "label": "Shot Creation", "order": 1},
        {"key": "paint_touch", "label": "Paint Touch", "order": 2},
        {"key": "collective_passing", "label": "Collective Passing", "order": 3},
        {"key": "off_ball_impact", "label": "Off-Ball Impact", "order": 4},
        {"key": "ball_security", "label": "Ball Security", "order": 5},
        {"key": "pnr_pairing", "label": "PnR Pairing", "order": 6},
        {"key": "post_game", "label": "Post Game", "order": 7},
    ]
    offense_balance = [
        {"key": "spacing_creation_ratio", "label": "Spacing / Creation Balance", "order": 0},
        {"key": "creation_offball_ratio", "label": "Creation / Off-Ball Balance", "order": 1},
        {"key": "spacing_paint_touch_ratio", "label": "Spacing / Paint Touch Balance", "order": 2},
    ]
    defense_subscores = [
        {"key": "interior_defense", "label": "Interior Defense", "order": 0},
        {"key": "defensive_coverage", "label": "Defensive Coverage", "order": 1},
        {"key": "defensive_gaps", "label": "Defensive Gaps", "order": 2},
        {"key": "perimeter_defense", "label": "Perimeter Defense", "order": 3},
        {"key": "switchability", "label": "Switchability", "order": 4},
    ]
    reb_trans_subscores = [
        {"key": "defensive_rebounding", "label": "Defensive Rebounding", "order": 0},
        {"key": "offensive_rebounding", "label": "Offensive Rebounding", "order": 1},
        {"key": "transition", "label": "Transition", "order": 2},
        {"key": "rebound_transition_ratio", "label": "Rebound / Transition Connection", "order": 3},
    ]

    return [
        {
            "category_key": "offense",
            "category_label": "Offense",
            "subcategories": [
                {"key": "quality", "label": "Quality", "subscores": offense_quality},
                {"key": "balance", "label": "Balance", "subscores": offense_balance},
            ],
        },
        {"category_key": "defense", "category_label": "Defense", "subscores": defense_subscores},
        {"category_key": "rebounding_transition", "category_label": "Rebounding / Transition", "subscores": reb_trans_subscores},
    ]


def build_v1_payload() -> dict:
    """Build the complete v1 Evaluation Version payload."""
    skills = [
        {"key": key, "label": S.SKILL_DEFINITIONS.get(key, key.replace("_", " ").title()), "order": i}
        for i, key in enumerate(S.ALL_SKILLS)
    ]

    # Impact Traits include player composites plus lineup-level Subscores
    # that are dispatched via Formula Handlers (e.g., switchability).
    all_trait_keys = list(W.COMPOSITE_NAMES) + ["switchability"]
    impact_traits = [
        {"key": name, "label": name.replace("_", " ").title(), "order": i}
        for i, name in enumerate(all_trait_keys)
    ]

    payload = {
        "taxonomy": {
            "skills": skills,
            "impact_traits": impact_traits,
            "subscore_tree": _build_subscore_tree(),
        },
        "values": {
            "tier_values": W.TIER_VALUES,
            "composite_coefficients": W.COMPOSITE_COEFFICIENTS,
            "composite_names": list(W.COMPOSITE_NAMES),
            "theoretical_max": W.THEORETICAL_MAX,
            "normalization_breakpoint_percentile": W.NORMALIZATION_BREAKPOINT_PERCENTILE,
            "normalization_breakpoint_score": W.NORMALIZATION_BREAKPOINT_SCORE,
            "min_distribution_size": W.MIN_DISTRIBUTION_SIZE,
            "overall_composite_weights": W.OVERALL_COMPOSITE_WEIGHTS,
            "overall_mean_peak_blend": W.OVERALL_MEAN_PEAK_BLEND,
            "amplitude_map": W.AMPLITUDE_MAP,
            "warm_body": W.WARM_BODY,
            "vd_ext": W.VD_EXT,
            "pd_down": W.PD_DOWN,
            "rp_up": W.RP_UP,
            "rp_pd_boost": W.RP_PD_BOOST,
            "peak_shift_pd_only": W.PEAK_SHIFT_PD_ONLY,
            "peak_shift_rp_only": W.PEAK_SHIFT_RP_ONLY,
            "height_min_inches": W.HEIGHT_MIN_INCHES,
            "height_max_inches": W.HEIGHT_MAX_INCHES,
            "bell": {
                "steepness_midpoint": W.BELL_STEEPNESS_MIDPOINT,
                "down_steepness_base": W.BELL_DOWN_STEEPNESS_BASE,
                "down_steepness_scale": W.BELL_DOWN_STEEPNESS_SCALE,
                "up_steepness_base": W.BELL_UP_STEEPNESS_BASE,
                "up_steepness_scale": W.BELL_UP_STEEPNESS_SCALE,
                "base_range": W.BELL_BASE_RANGE,
                "flat_top_divisor": W.BELL_FLAT_TOP_DIVISOR,
            },
            "rp_cross": {
                "height_min": W.RP_CROSS_HEIGHT_MIN,
                "scale": W.RP_CROSS_SCALE,
                "height_window": W.RP_CROSS_HEIGHT_WINDOW,
            },
            "pd_cross": {
                "height_max": W.PD_CROSS_HEIGHT_MAX,
                "scale": W.PD_CROSS_SCALE,
                "height_window": W.PD_CROSS_HEIGHT_WINDOW,
            },
            "defensive_gap_threshold": W.DEFENSIVE_GAP_THRESHOLD,
            "defensive_gap_penalty_scale": W.DEFENSIVE_GAP_PENALTY_SCALE,
            "defensive_coverage_saturation_raw": W.DEFENSIVE_COVERAGE_SATURATION_RAW,
            "defensive_rebounding_minimum": W.DEFENSIVE_REBOUNDING_MINIMUM,
            "defensive_rebounding_penalty_scale": W.DEFENSIVE_REBOUNDING_PENALTY_SCALE,
            "defensive_guard_density_height_range": list(W.DEFENSIVE_GUARD_DENSITY_HEIGHT_RANGE),
            "defensive_transition_boost_divisor": W.DEFENSIVE_TRANSITION_BOOST_DIVISOR,
            "defensive_transition_boost_cap": W.DEFENSIVE_TRANSITION_BOOST_CAP,
            "stacking_returns": list(W.STACKING_RETURNS),
            "switchability_coverage_threshold": W.SWITCHABILITY_COVERAGE_THRESHOLD,
            "switchability_overlap_weight": W.SWITCHABILITY_OVERLAP_WEIGHT,
            "passing_primary_creator_weight": W.PASSING_PRIMARY_CREATOR_WEIGHT,
            "passing_depth_weight": W.PASSING_DEPTH_WEIGHT,
            "defensive_rebounding_primary_weight": W.DEFENSIVE_REBOUNDING_PRIMARY_WEIGHT,
            "defensive_rebounding_secondary_weight": W.DEFENSIVE_REBOUNDING_SECONDARY_WEIGHT,
            "defensive_rebounding_depth_weight": W.DEFENSIVE_REBOUNDING_DEPTH_WEIGHT,
            "offensive_rebounding_primary_weight": W.OFFENSIVE_REBOUNDING_PRIMARY_WEIGHT,
            "offensive_rebounding_secondary_weight": W.OFFENSIVE_REBOUNDING_SECONDARY_WEIGHT,
            "offensive_rebounding_depth_weight": W.OFFENSIVE_REBOUNDING_DEPTH_WEIGHT,
            "perimeter_defense_primary_weight": W.PERIMETER_DEFENSE_PRIMARY_WEIGHT,
            "perimeter_defense_secondary_weight": W.PERIMETER_DEFENSE_SECONDARY_WEIGHT,
            "perimeter_defense_depth_weight": W.PERIMETER_DEFENSE_DEPTH_WEIGHT,
            "interior_defense_primary_weight": W.INTERIOR_DEFENSE_PRIMARY_WEIGHT,
            "interior_defense_secondary_weight": W.INTERIOR_DEFENSE_SECONDARY_WEIGHT,
            "interior_defense_depth_weight": W.INTERIOR_DEFENSE_DEPTH_WEIGHT,
            "post_game_primary_weight": W.POST_GAME_PRIMARY_WEIGHT,
            "post_game_secondary_weight": W.POST_GAME_SECONDARY_WEIGHT,
            "post_game_depth_weight": W.POST_GAME_DEPTH_WEIGHT,
            "pnr_handler_support_scale": W.PNR_HANDLER_SUPPORT_SCALE,
            "pnr_handler_primary_weight": W.PNR_HANDLER_PRIMARY_WEIGHT,
            "pnr_handler_secondary_weight": W.PNR_HANDLER_SECONDARY_WEIGHT,
            "pnr_handler_depth_weight": W.PNR_HANDLER_DEPTH_WEIGHT,
            "pnr_screener_primary_weight": W.PNR_SCREENER_PRIMARY_WEIGHT,
            "pnr_screener_secondary_weight": W.PNR_SCREENER_SECONDARY_WEIGHT,
            "pnr_screener_depth_weight": W.PNR_SCREENER_DEPTH_WEIGHT,
            "pnr_pairing_quality_gate_floor": W.PNR_PAIRING_QUALITY_GATE_FLOOR,
            "pnr_pairing_quality_gate_scale": W.PNR_PAIRING_QUALITY_GATE_SCALE,
            "synergy_scale_factors": W.SYNERGY_SCALE_FACTORS,
            "synergy_boosted_skills": {k: list(v) for k, v in W.SYNERGY_BOOSTED_SKILLS.items()},
            "synergy_penalty_severity": W.SYNERGY_PENALTY_SEVERITY,
            "off_13_raw_spacing_threshold": W.OFF_13_RAW_SPACING_THRESHOLD,
            "synergy_creator_threshold": W.SYNERGY_CREATOR_THRESHOLD,
            "category_weights": W.CATEGORY_WEIGHTS,
            "offense_quality_ratio": W.OFFENSE_QUALITY_RATIO,
            "offense_quality_weights": W.OFFENSE_QUALITY_WEIGHTS,
            "offense_balance_weights": W.OFFENSE_BALANCE_WEIGHTS,
            "defense_subscore_weights": W.DEFENSE_SUBSCORE_WEIGHTS,
            "rebound_transition_subscore_weights": W.REBOUND_TRANSITION_SUBSCORE_WEIGHTS,
            "accentuation_strength_cap": W.ACCENTUATION_STRENGTH_CAP,
            "accentuation_weakness_cap": W.ACCENTUATION_WEAKNESS_CAP,
            "ratio_dead_zone": W.RATIO_DEAD_ZONE,
            "ratio_asymmetric_full_penalty": W.RATIO_ASYMMETRIC_FULL_PENALTY,
            "ratio_default_penalty": W.RATIO_DEFAULT_PENALTY,
            "ratio_min_denominator": W.RATIO_MIN_DENOMINATOR,
            "accentuation_strength_threshold": W.ACCENTUATION_STRENGTH_THRESHOLD,
            "accentuation_weakness_threshold": W.ACCENTUATION_WEAKNESS_THRESHOLD,
            "accentuation_fallback_strength_threshold": W.ACCENTUATION_FALLBACK_STRENGTH_THRESHOLD,
            "accentuation_fallback_weakness_threshold": W.ACCENTUATION_FALLBACK_WEAKNESS_THRESHOLD,
            "accentuation_top_n": W.ACCENTUATION_TOP_N,
            "accentuation_min_strengths": W.ACCENTUATION_MIN_STRENGTHS,
            "accentuation_complementary_pairs": [list(pair) for pair in W.ACCENTUATION_COMPLEMENTARY_PAIRS],
            "note_limit_per_type": W.NOTE_LIMIT_PER_TYPE,
            "note_elite_composite_threshold": W.NOTE_ELITE_COMPOSITE_THRESHOLD,
            "note_stacked_composite_threshold": W.NOTE_STACKED_COMPOSITE_THRESHOLD,
            "note_stacked_player_count": W.NOTE_STACKED_PLAYER_COUNT,
            "note_missing_composite_threshold": W.NOTE_MISSING_COMPOSITE_THRESHOLD,
            "note_weak_composite_avg_threshold": W.NOTE_WEAK_COMPOSITE_AVG_THRESHOLD,
            "note_covered_composite_threshold": W.NOTE_COVERED_COMPOSITE_THRESHOLD,
            "note_min_roster_size": W.NOTE_MIN_ROSTER_SIZE,
            "note_capable_passer_threshold": W.NOTE_CAPABLE_PASSER_THRESHOLD,
            "note_elite_bell_amplitude_threshold": W.NOTE_ELITE_BELL_AMPLITUDE_THRESHOLD,
            "note_severity_min": W.NOTE_SEVERITY_MIN,
            "note_severity_max": W.NOTE_SEVERITY_MAX,
            "roster_rollup_weights": W.ROSTER_ROLLUP_WEIGHTS,
            "lineup_only_rollup_weights": W.LINEUP_ONLY_ROLLUP_WEIGHTS,
            "lineup_archetype_max": W.LINEUP_ARCHETYPE_MAX,
            "star_rating_max": W.STAR_RATING_MAX,
            "viable_lineup_threshold": W.VIABLE_LINEUP_THRESHOLD,
            "depth_viable_ratio_weight": W.DEPTH_VIABLE_RATIO_WEIGHT,
            "depth_quality_weight": W.DEPTH_QUALITY_WEIGHT,
            "total_lineups_full_roster": W.TOTAL_LINEUPS_FULL_ROSTER,
            "archetype_labels": list(W.ARCHETYPE_LABELS),
            # v2 handler configuration (spacing_v2, shot_creation_v2)
            "spacing_raw_gate": 1.0,
            "spacing_multipliers": [0.3, 0.5, 0.75, 1.0, 1.0, 0.95],
            "shot_creation_raw_gate": 2.0,
            "shot_creation_multipliers": [0.2, 1.0, 1.0, 1.0, 0.95, 0.90],
            "shot_creation_primary_weight": 0.6,
            "shot_creation_secondary_weight": 0.25,
            "shot_creation_depth_weight": 0.15,
        },
        "formula_refs": {
            **{name: f"{name}_v1" for name in W.COMPOSITE_NAMES},
            "switchability": "switchability_v1",
        },
        "meta": {
            "version_schema": 1,
            "bootstrap_source": "weights.py + skills.py",
        },
    }
    return payload


def main() -> None:
    payload = build_v1_payload()
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload_hash = hashlib.sha256(blob.encode()).hexdigest()
    output = {
        "payload": payload,
        "payload_hash": payload_hash,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
