"""
skill_engine/ — Skill evaluation package.

Public API:
  - get_player_skills:      evaluate all skills for one player (fetch → evaluate → return)
  - batch_evaluate_skills:  evaluate + persist for a list of players
  - evaluate_all_skills:    pure evaluation given stats blob + thresholds + league averages
  - evaluate_skill:         evaluate a single skill
  - apply_auto_promotions:  cross-skill tier promotion pass
  - get_thresholds:         cached threshold rules from Supabase
  - get_league_averages:    cached league averages from Supabase
  - compute_and_store_league_averages: recompute and persist league averages
"""

from services.skill_engine.cache import (
    compute_and_store_league_averages,
    get_league_averages,
    get_thresholds,
)
from services.skill_engine.evaluator import (
    apply_auto_promotions,
    evaluate_all_skills,
    evaluate_skill,
)
from services.skill_engine.pipeline import (
    batch_evaluate_skills,
    get_player_skills,
)

__all__ = [
    # pipeline orchestration
    "get_player_skills",
    "batch_evaluate_skills",
    # evaluation
    "evaluate_skill",
    "evaluate_all_skills",
    "apply_auto_promotions",
    # cache
    "get_thresholds",
    "get_league_averages",
    "compute_and_store_league_averages",
]
