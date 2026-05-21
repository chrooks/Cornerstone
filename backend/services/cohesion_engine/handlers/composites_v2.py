"""
v2 Formula Handler registrations for lineup-level subscore computation.

v2 handlers add lineup-composition awareness: they count how many players
meet a raw composite threshold (gate) and apply a per-count multiplier
to the continuous score. This penalizes lineups that lack enough shooters
(spacing) or creators (shot_creation) while rewarding proper construction.
"""

from __future__ import annotations

from services.cohesion_engine.composites import tier_value
from services.cohesion_engine.engine import CohesionEngine, LineupContext
from services.cohesion_engine.handlers.composites_v1 import _average


@CohesionEngine.handler("spacing_v2")
def spacing_v2(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Count-gated average: penalizes lineups with fewer than 3 capable shooters.

    Gate: raw spacing composite >= threshold (default 1.0). Off-dribble-only
    players contribute to the continuous score but do not count as spacers.
    Multiplier curve stored in Evaluation Version values.
    """
    v = engine.version.values
    tv = v["tier_values"]
    c = v["composite_coefficients"]
    gate = v["spacing_raw_gate"]
    multipliers = v["spacing_multipliers"]

    if not multipliers:
        raise ValueError("spacing_multipliers must be a non-empty list")

    spacer_count = 0
    for player in ctx.lineup:
        skills = player.get("skills", {})
        raw = (
            tier_value(skills, "spot_up_shooter", tv)
            + tier_value(skills, "movement_shooter", tv)
            + c["spacing_off_dribble"] * tier_value(skills, "off_dribble_shooter", tv)
        )
        if raw >= gate:
            spacer_count += 1

    avg = _average(ctx.composites, "spacing")
    multiplier = multipliers[min(spacer_count, len(multipliers) - 1)]
    return avg * multiplier


@CohesionEngine.handler("shot_creation_v2")
def shot_creation_v2(engine: CohesionEngine, ctx: LineupContext) -> float:
    """Count-gated top-two-plus-depth: rewards concentrated creation.

    Gate: raw shot_creation composite >= threshold (default 2.0).
    Scoring uses top-two-plus-depth with creator-heavy weights (0.6/0.25/0.15).
    Multiplier curve penalizes lineups with zero creators catastrophically.
    """
    v = engine.version.values
    tv = v["tier_values"]
    c = v["composite_coefficients"]
    gate = v["shot_creation_raw_gate"]
    multipliers = v["shot_creation_multipliers"]
    primary_w = v["shot_creation_primary_weight"]
    secondary_w = v["shot_creation_secondary_weight"]
    depth_w = v["shot_creation_depth_weight"]

    if not multipliers:
        raise ValueError("shot_creation_multipliers must be a non-empty list")

    creator_count = 0
    for player in ctx.lineup:
        skills = player.get("skills", {})

        # Compute raw spacing and paint_touch per player for the gate formula
        raw_spacing = (
            tier_value(skills, "movement_shooter", tv)
            + tier_value(skills, "spot_up_shooter", tv)
            + c["spacing_off_dribble"] * tier_value(skills, "off_dribble_shooter", tv)
        )
        raw_finishing = (
            tier_value(skills, "high_flyer", tv)
            + tier_value(skills, "crafty_finisher", tv)
        )
        finishing_mult = max(1.0, 1.0 + c["paint_touch_finishing_scale"] * raw_finishing)
        raw_paint_touch = finishing_mult * (
            tier_value(skills, "driver", tv)
            + c["paint_touch_vertical_spacer"] * tier_value(skills, "vertical_spacer", tv)
            + tier_value(skills, "low_post_player", tv)
            + c["paint_touch_mid_post"] * tier_value(skills, "mid_post_player", tv)
        )
        raw_pnr_orchestration = (
            tier_value(skills, "pnr_ball_handler", tv)
            + c["pnr_ball_handler_passer"] * tier_value(skills, "passer", tv)
            + c["pnr_ball_handler_driver"] * tier_value(skills, "driver", tv)
            + c["pnr_ball_handler_off_dribble"] * tier_value(skills, "off_dribble_shooter", tv)
        )
        raw_shot_creation = (
            c["shot_creation_pnr_orchestration"] * raw_pnr_orchestration
            + c["shot_creation_passer"] * tier_value(skills, "passer", tv)
            + c["shot_creation_off_dribble"] * tier_value(skills, "off_dribble_shooter", tv)
            + tier_value(skills, "isolation_scorer", tv)
            + c["shot_creation_spacing"] * raw_spacing
            + c["shot_creation_paint_touch"] * raw_paint_touch
        )
        if raw_shot_creation >= gate:
            creator_count += 1

    # Top-two-plus-depth on normalized composites
    sorted_values = sorted(
        (float(getattr(p, "shot_creation")) for p in ctx.composites), reverse=True
    )
    primary = sorted_values[0] if sorted_values else 0.0
    secondary = sorted_values[1] if len(sorted_values) > 1 else 0.0
    depth = sum(sorted_values) / len(sorted_values) if sorted_values else 0.0
    t2pd = primary * primary_w + secondary * secondary_w + depth * depth_w

    multiplier = multipliers[min(creator_count, len(multipliers) - 1)]
    return t2pd * multiplier
