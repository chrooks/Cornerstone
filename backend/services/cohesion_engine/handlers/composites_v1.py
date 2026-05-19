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


@CohesionEngine.handler("defensive_rebounding_v1")
def defensive_rebounding(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend top defensive rebounders with team rebounding depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "defensive_rebounding",
        v["defensive_rebounding_primary_weight"],
        v["defensive_rebounding_secondary_weight"],
        v["defensive_rebounding_depth_weight"],
    )


@CohesionEngine.handler("offensive_rebounding_v1")
def offensive_rebounding(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend top offensive rebounders with team offensive rebounding depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "offensive_rebounding",
        v["offensive_rebounding_primary_weight"],
        v["offensive_rebounding_secondary_weight"],
        v["offensive_rebounding_depth_weight"],
    )


@CohesionEngine.handler("ball_security_v1")
def ball_security(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Average ball security across the lineup. Proxy from passer until dedicated Skill."""
    return _average(ctx.composites, "ball_security")


@CohesionEngine.handler("perimeter_defense_v1")
def perimeter_defense(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary perimeter defender with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "perimeter_defense",
        v["perimeter_defense_primary_weight"],
        v["perimeter_defense_secondary_weight"],
        v["perimeter_defense_depth_weight"],
    )


@CohesionEngine.handler("interior_defense_v1")
def interior_defense(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Blend primary interior defender with secondary support and depth."""
    v = engine.version.values
    return _top_two_plus_depth(
        ctx.composites, "interior_defense",
        v["interior_defense_primary_weight"],
        v["interior_defense_secondary_weight"],
        v["interior_defense_depth_weight"],
    )


@CohesionEngine.handler("switchability_v1")
def switchability(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Defensive switchability from bell curve overlap density and floor compression.

    Measures how well a lineup can switch defensive assignments across heights.
    Overlap density: how many defenders cover each height (more = more switchable).
    Floor compression: evenness of coverage (tight min/max ratio = fewer exploitable gaps).
    """
    from services.cohesion_engine.bell_curve import compute_lineup_switchability

    v = engine.version.values
    overlap_density, floor_compression = compute_lineup_switchability(ctx.lineup, v)
    blend = v.get("switchability_overlap_weight", 0.6)
    return overlap_density * blend + floor_compression * (1.0 - blend)
