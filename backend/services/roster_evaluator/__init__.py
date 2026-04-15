"""
roster_evaluator/__init__.py — Public API for the roster rule engine.

Phases:
  0 — types.py, weights.py      (dataclasses + config)
  1 — player_scores.py          (per-player scoring functions)
  2 — aggregates.py             (cross-roster metrics)
  3 — rules.py                  (heuristic → Note)
  4 — evaluator.py              (orchestration + Flask endpoint)
"""

from .evaluator import evaluate_roster

__all__ = ["evaluate_roster"]
