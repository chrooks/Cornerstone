"""
skill_engine/__init__.py — Public API for the skill evaluation sub-package.

Re-exports everything that external code (skill_mapping_service, tests, api/)
imported directly from the old monolithic skill_mapping_service.py so that
existing import paths continue to work unchanged.
"""

from services.skill_engine.cache import (
    compute_and_store_league_averages,
    get_league_averages,
    get_thresholds,
)
from services.skill_engine.conditions import (
    evaluate_condition,
    evaluate_conditions_block,
    resolve_stat,
)
from services.skill_engine.evaluator import (
    _collect_driving_stats,
    apply_auto_promotions,
    evaluate_all_skills,
    evaluate_skill,
)
from services.skill_engine.history import (
    _blend_blobs,
    _HISTORY_WEIGHTS,
    _PREV_SEASON,
    _TWO_AGO_SEASON,
    _prev_season,
    get_weighted_stats,
)
from services.skill_engine.transforms import (
    apply_pre_adjustments,
    apply_stabilization,
    compute_derived_stats,
)

__all__ = [
    # cache
    "get_thresholds",
    "get_league_averages",
    "compute_and_store_league_averages",
    # conditions
    "resolve_stat",
    "evaluate_condition",
    "evaluate_conditions_block",
    # transforms
    "apply_pre_adjustments",
    "compute_derived_stats",
    "apply_stabilization",
    # evaluator
    "evaluate_skill",
    "_collect_driving_stats",
    "evaluate_all_skills",
    "apply_auto_promotions",
    # history
    "get_weighted_stats",
    "_blend_blobs",
    "_prev_season",
    "_PREV_SEASON",
    "_TWO_AGO_SEASON",
    "_HISTORY_WEIGHTS",
]
