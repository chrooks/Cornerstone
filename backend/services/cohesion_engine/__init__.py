"""
Public entry point for the cohesion engine.

The real roster evaluator lands in a later phase. This stub gives callers a
stable import target while Phase 1 establishes the package, types, and weights.
"""

from __future__ import annotations

from .types import RosterEvaluation


def evaluate_roster(players: list[dict], mode: str = "live") -> RosterEvaluation:
    """Evaluate a roster with the cohesion engine once the pipeline exists."""
    raise NotImplementedError("cohesion_engine.evaluate_roster is implemented in Phase 4")


__all__ = ["evaluate_roster", "RosterEvaluation"]
