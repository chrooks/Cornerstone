"""
Public entry point for the cohesion engine.

Re-exports the core evaluation functions and the CohesionEngine class.
Eagerly imports handler modules so @CohesionEngine.handler decorators
run at import time.
"""

from __future__ import annotations

from .engine import CohesionEngine, EvaluationVersion
from .roster import evaluate_roster
from .types import RosterEvaluation

# Eager-load handler modules so decorators populate the registry
from . import handlers  # noqa: F401


__all__ = [
    "CohesionEngine",
    "EvaluationVersion",
    "evaluate_roster",
    "RosterEvaluation",
]
