"""
Public entry point for the cohesion engine.

The real roster evaluator lands in a later phase. This stub gives callers a
stable import target while Phase 1 establishes the package, types, and weights.
"""

from __future__ import annotations

from .roster import evaluate_roster
from .types import RosterEvaluation


__all__ = ["evaluate_roster", "RosterEvaluation"]
