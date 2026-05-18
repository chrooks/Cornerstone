"""
v1 Formula Handler registrations for lineup-level subscore computation.

Each handler receives a LineupContext (player composites + raw lineup data)
and returns a single lineup-level aggregated value for one Impact Trait.

v1 handlers replicate the aggregation logic that previously lived inline in
evaluate_lineup (averages for some traits, top-two-plus-depth for others).
"""

from __future__ import annotations

from services.cohesion_engine.engine import CohesionEngine, LineupContext
from services.cohesion_engine.types import PlayerComposites


def _average(composites: list[PlayerComposites], field: str) -> float:
    """Average a normalized composite across the lineup."""
    if not composites:
        return 0.0
    return sum(float(getattr(p, field)) for p in composites) / len(composites)


def _top_two_plus_depth(
    composites: list[PlayerComposites],
    field: str,
    primary_weight: float,
    secondary_weight: float,
    depth_weight: float,
) -> float:
    """Score concentrated lineup roles by top option, helper, and depth."""
    if not composites:
        return 0.0
    sorted_values = sorted(
        (float(getattr(p, field)) for p in composites), reverse=True
    )
    primary = sorted_values[0] if sorted_values else 0.0
    secondary = sorted_values[1] if len(sorted_values) > 1 else 0.0
    depth = sum(sorted_values) / len(sorted_values)
    return primary * primary_weight + secondary * secondary_weight + depth * depth_weight


# --- Average-aggregated Impact Traits ---


@CohesionEngine.handler("spacing_v1")
def spacing(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average spacing composite across the lineup."""
    return _average(ctx.composites, "spacing")


@CohesionEngine.handler("finishing_v1")
def finishing(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average finishing composite across the lineup."""
    return _average(ctx.composites, "finishing")


@CohesionEngine.handler("paint_touch_v1")
def paint_touch(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average paint touch composite across the lineup."""
    return _average(ctx.composites, "paint_touch")


@CohesionEngine.handler("off_ball_impact_v1")
def off_ball_impact(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average off-ball impact composite across the lineup."""
    return _average(ctx.composites, "off_ball_impact")


@CohesionEngine.handler("shot_creation_v1")
def shot_creation(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average shot creation composite across the lineup."""
    return _average(ctx.composites, "shot_creation")


@CohesionEngine.handler("transition_v1")
def transition(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average transition composite across the lineup."""
    return _average(ctx.composites, "transition")


# --- Top-two-plus-depth Impact Traits ---


@CohesionEngine.handler("anchor_v1")
def anchor(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary interior anchor with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "anchor",
        v["anchor_primary_weight"], v["anchor_secondary_weight"], v["anchor_depth_weight"],
    )


@CohesionEngine.handler("post_game_v1")
def post_game(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary post player with secondary option and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "post_game",
        v["post_game_primary_weight"], v["post_game_secondary_weight"], v["post_game_depth_weight"],
    )


@CohesionEngine.handler("pnr_screener_v1")
def pnr_screener(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary PnR screener with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "pnr_screener",
        v["pnr_screener_primary_weight"], v["pnr_screener_secondary_weight"], v["pnr_screener_depth_weight"],
    )


@CohesionEngine.handler("rebounding_v1")
def rebounding(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend top two rebounders with team rebounding depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "rebounding",
        v["rebounding_primary_weight"], v["rebounding_secondary_weight"], v["rebounding_depth_weight"],
    )


@CohesionEngine.handler("perimeter_defense_v1")
def perimeter_defense(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary perimeter defender with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "perimeter_defense",
        v["anchor_primary_weight"], v["anchor_secondary_weight"], v["anchor_depth_weight"],
    )


@CohesionEngine.handler("interior_defense_v1")
def interior_defense(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary interior defender with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "interior_defense",
        v["anchor_primary_weight"], v["anchor_secondary_weight"], v["anchor_depth_weight"],
    )
