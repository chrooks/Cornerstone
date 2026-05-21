"""
formula_export.py — Extract hardcoded composite formulas into declarative JSON.

One-time utility to translate the hardcoded math in composites.py into the
``composite_formulas`` structure stored in Evaluation Version payloads.

Each composite formula has:
- factors: weighted terms (skill tier values or other composites' raw values)
- amplifiers: multiplicative modifiers applied to the entire sum or specific factors
- depends_on: composite keys that must be computed first (from composite-type
  factors and composite-sourced amplifiers)
"""

from __future__ import annotations

from typing import Any


def _factor(type_: str, key: str, coefficient: float) -> dict[str, Any]:
    return {"type": type_, "key": key, "coefficient": coefficient}


def _skill(key: str, coefficient: float = 1.0) -> dict[str, Any]:
    return _factor("skill", key, coefficient)


def _composite(key: str, coefficient: float = 1.0) -> dict[str, Any]:
    return _factor("composite", key, coefficient)


def _amplifier(
    source: str | dict[str, Any],
    scale: float,
    floor: float = 1.0,
    applies_to: list[int] | None = None,
) -> dict[str, Any]:
    """Build an amplifier entry.

    Args:
        source: Composite key (string) or ``{"skills": [...]}`` for a skill-sum
            amplifier.
        scale: How much the source value scales the multiplier.
        floor: Minimum multiplier (typically 1.0).
        applies_to: Factor indices the multiplier applies to. ``None`` means the
            entire sum is multiplied.
    """
    amp: dict[str, Any] = {"source": source, "scale": scale, "floor": floor}
    if applies_to is not None:
        amp["applies_to"] = applies_to
    return amp


def export_formulas(coefficients: dict[str, float]) -> dict[str, dict[str, Any]]:
    """Convert hardcoded composite formulas to declarative JSON structure.

    Args:
        coefficients: The ``composite_coefficients`` dict from the active
            Evaluation Version (or from ``weights.COMPOSITE_COEFFICIENTS``
            for bootstrap).

    Returns:
        A dict mapping composite key → formula definition, suitable for storage
        in ``values["composite_formulas"]``.
    """
    c = coefficients

    return {
        # ── Step 1: independent composites ───────────────────────────
        "spacing": {
            "factors": [
                _skill("movement_shooter"),
                _skill("spot_up_shooter"),
                _skill("off_dribble_shooter", c["spacing_off_dribble"]),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "finishing": {
            "factors": [
                _skill("high_flyer"),
                _skill("crafty_finisher"),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "defensive_rebounding": {
            "factors": [
                _skill("rebounder"),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "offensive_rebounding": {
            "factors": [
                _skill("offensive_rebounder"),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "perimeter_defense": {
            "factors": [
                _skill("perimeter_disruptor"),
                _skill("versatile_defender", c["perimeter_defense_versatile_defender"]),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "interior_defense": {
            "factors": [
                _skill("rim_protector"),
                _skill("versatile_defender", c["interior_defense_versatile_defender"]),
                _skill("rebounder", c["interior_defense_rebounder"]),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        # ── Step 2: paint_touch — amplifier on entire sum ────────────
        #
        # finishing_mult = max(1.0, 1.0 + scale * raw_finishing)
        # raw_paint_touch = finishing_mult * (driver + vs + lpp + mpp)
        "paint_touch": {
            "factors": [
                _skill("driver"),
                _skill("vertical_spacer", c["paint_touch_vertical_spacer"]),
                _skill("low_post_player"),
                _skill("mid_post_player", c["paint_touch_mid_post"]),
            ],
            "amplifiers": [
                _amplifier("finishing", scale=c["paint_touch_finishing_scale"]),
            ],
            "depends_on": ["finishing"],
        },
        # ── Step 3: independent composites ───────────────────────────
        "ball_security": {
            "factors": [
                _skill("passer"),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        "post_game": {
            "factors": [
                _skill("low_post_player"),
                _skill("mid_post_player", c["post_game_mid_post"]),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        # pnr_screener:
        #   pnr_secondary_mult = max(1.0, 1.0 + 0.15 * (vs + sus))
        #   raw = pnr_finisher * pnr_secondary_mult + screen_setter
        #
        # Amplifier applies only to factor[0] (pnr_finisher) and sources
        # from a sum of skills, not a composite.
        "pnr_screener": {
            "factors": [
                _skill("pnr_finisher"),
                _skill("screen_setter"),
            ],
            "amplifiers": [
                _amplifier(
                    source={"skills": ["vertical_spacer", "spot_up_shooter"]},
                    scale=c["pnr_screener_secondary_scale"],
                    applies_to=[0],
                ),
            ],
            "depends_on": [],
        },
        # transition:
        #   passer_mult = max(1.0, 1.0 + 0.2 * passer)
        #   raw = tt * passer_mult + hf + driver + sus
        #
        # Amplifier applies only to factor[0] (transition_threat) and sources
        # from a single skill.
        "transition": {
            "factors": [
                _skill("transition_threat"),
                _skill("high_flyer", c["transition_high_flyer"]),
                _skill("driver", c["transition_driver"]),
                _skill("spot_up_shooter", c["transition_spot_up"]),
            ],
            "amplifiers": [
                _amplifier(
                    source={"skills": ["passer"]},
                    scale=c["transition_passer_scale"],
                    applies_to=[0],
                ),
            ],
            "depends_on": [],
        },
        # ── Step 4: off-ball impact ──────────────────────────────────
        # cutting_mult = max(1.0, 1.0 + 0.08 * raw_finishing)
        # raw = raw_spacing + cutter * cutting_mult + passer * 0.3
        #
        # Amplifier applies only to factor[1] (cutter) from composite finishing.
        "off_ball_impact": {
            "factors": [
                _composite("spacing"),
                _skill("cutter"),
                _skill("passer", c["off_ball_passer"]),
            ],
            "amplifiers": [
                _amplifier("finishing", scale=c["off_ball_finishing_scale"], applies_to=[1]),
            ],
            "depends_on": ["spacing", "finishing"],
        },
        # ── Step 5: PnR orchestration ────────────────────────────────
        "pnr_orchestration": {
            "factors": [
                _skill("pnr_ball_handler"),
                _skill("passer", c["pnr_ball_handler_passer"]),
                _skill("driver", c["pnr_ball_handler_driver"]),
                _skill("off_dribble_shooter", c["pnr_ball_handler_off_dribble"]),
            ],
            "amplifiers": [],
            "depends_on": [],
        },
        # ── Step 6: shot creation ────────────────────────────────────
        # raw = 0.6*pnr_orch + 0.5*passer + 0.7*ods + iso + 0.3*spacing + 0.5*pt
        "shot_creation": {
            "factors": [
                _composite("pnr_orchestration", c["shot_creation_pnr_orchestration"]),
                _skill("passer", c["shot_creation_passer"]),
                _skill("off_dribble_shooter", c["shot_creation_off_dribble"]),
                _skill("isolation_scorer"),
                _composite("spacing", c["shot_creation_spacing"]),
                _composite("paint_touch", c["shot_creation_paint_touch"]),
            ],
            "amplifiers": [],
            "depends_on": ["pnr_orchestration", "spacing", "paint_touch"],
        },
    }
