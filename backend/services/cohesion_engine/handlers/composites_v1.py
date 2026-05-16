"""
v1 Formula Handler registrations for composite subscore computation.

Each handler wraps the existing computation in composites.py, registering it
under a stable name (e.g., "spacing_v1"). The CohesionEngine dispatches
subscore computation through these names at evaluation time.

In v1, handlers delegate to the existing composites.py functions which still
read from weights.py directly. A future refactor will route values through
engine.version.values instead.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from services.cohesion_engine.engine import CohesionEngine
from services.cohesion_engine.composites import compute_raw_composites

if TYPE_CHECKING:
    pass


@CohesionEngine.handler("spacing_v1")
def spacing(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw spacing composite for one player."""
    return compute_raw_composites(skills)["spacing"]


@CohesionEngine.handler("finishing_v1")
def finishing(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw finishing composite for one player."""
    return compute_raw_composites(skills)["finishing"]


@CohesionEngine.handler("paint_touch_v1")
def paint_touch(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw paint touch composite for one player."""
    return compute_raw_composites(skills)["paint_touch"]


@CohesionEngine.handler("anchor_v1")
def anchor(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw anchor composite for one player."""
    return compute_raw_composites(skills)["anchor"]


@CohesionEngine.handler("post_game_v1")
def post_game(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw post game composite for one player."""
    return compute_raw_composites(skills)["post_game"]


@CohesionEngine.handler("pnr_screener_v1")
def pnr_screener(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw PnR screener composite for one player."""
    return compute_raw_composites(skills)["pnr_screener"]


@CohesionEngine.handler("off_ball_impact_v1")
def off_ball_impact(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw off-ball impact composite for one player."""
    return compute_raw_composites(skills)["off_ball_impact"]


@CohesionEngine.handler("shot_creation_v1")
def shot_creation(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw shot creation composite for one player."""
    return compute_raw_composites(skills)["shot_creation"]


@CohesionEngine.handler("rebounding_v1")
def rebounding(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw rebounding composite for one player."""
    return compute_raw_composites(skills)["rebounding"]


@CohesionEngine.handler("transition_v1")
def transition(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw transition composite for one player."""
    return compute_raw_composites(skills)["transition"]


@CohesionEngine.handler("perimeter_defense_v1")
def perimeter_defense(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw perimeter defense composite for one player."""
    return compute_raw_composites(skills)["perimeter_defense"]


@CohesionEngine.handler("interior_defense_v1")
def interior_defense(engine: CohesionEngine, skills: dict[str, str | float]) -> float:
    """Compute raw interior defense composite for one player."""
    return compute_raw_composites(skills)["interior_defense"]
