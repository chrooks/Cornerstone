"""
roster_evaluator/player_scores.py — Per-player score functions (Phase 1).

Each function takes a unified player dict:
  {
    "name": str,
    "height": str | None,   # "6-7" format
    "skills": dict[str, str]  # skill_name → tier string
  }

All scoring functions return ScoreTrace so every calculation is auditable.
Boolean classifiers return plain bool.

Public API:
  parse_height(height_str)         → int | None
  tier_weight(player, skill)       → float
  size_modifier(player)            → ScoreTrace
  on_ball_scoring_threat(player)   → ScoreTrace
  gravity(player)                  → float
  off_ball_gravity(player)         → ScoreTrace
  effective_on_ball_threat(player) → ScoreTrace
  is_exclusively_onball(player)    → bool
  is_twoway(player)                → bool
  is_offensive_blackhole(player)   → bool
"""

from __future__ import annotations
from .types import ScoreTrace
from .weights import (
    TIER_WEIGHTS,
    ON_BALL_SCORING_WEIGHTS,
    OFF_BALL_GRAVITY_WEIGHTS,
    SIZE_MODIFIER as SIZE_CFG,
    GRAVITY_SCALE,
    OFF_BALL_GRAVITY_SCALE,
)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _scale(value: float, min_out: float, max_out: float, max_input: float) -> float:
    """
    Linear map from [0, max_input] → [min_out, max_out], clamped.
    Used to normalise raw scores to a bounded range.
    """
    if max_input <= 0:
        return min_out
    ratio = max(0.0, min(1.0, value / max_input))
    return min_out + ratio * (max_out - min_out)


# ---------------------------------------------------------------------------
# Utility: parse player height string
# ---------------------------------------------------------------------------

def parse_height(height_str: str | None) -> int | None:
    """
    Convert height string ("6-3") to total inches (75).
    Returns None for missing or malformed input — callers handle gracefully.
    """
    if not height_str:
        return None
    parts = height_str.split("-")
    if len(parts) != 2:
        return None
    try:
        feet, inches = int(parts[0]), int(parts[1])
        return feet * 12 + inches
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Utility: tier weight for one skill on one player
# ---------------------------------------------------------------------------

def tier_weight(player: dict, skill: str) -> float:
    """Return the numeric weight for a player's tier in a given skill."""
    tier = (player.get("skills") or {}).get(skill) or "None"
    return float(TIER_WEIGHTS.get(tier, 0))


# ---------------------------------------------------------------------------
# Per-player scores
# ---------------------------------------------------------------------------

def size_modifier(player: dict) -> ScoreTrace:
    """
    Scales a player's defensive impact by height.
    Taller players have more defensive presence at the same skill tier.
    High Flyer bonus partially restores this for smaller athletes.

    Range: 0.6 (6-0) → 1.0 (7-0). High flyer adds up to +0.2, capped at 1.0.
    """
    height_inches = parse_height(player.get("height"))
    components: dict[str, float] = {}

    if height_inches is None:
        base = SIZE_CFG["default_modifier"]
        components["height (default)"] = round(base, 3)
        label_part = "height unavailable, using default"
    else:
        # Map [min_height, max_height] → [min_modifier, max_modifier]
        offset = height_inches - SIZE_CFG["min_height_inches"]
        height_range = SIZE_CFG["max_height_inches"] - SIZE_CFG["min_height_inches"]
        base = _scale(offset, SIZE_CFG["min_modifier"], SIZE_CFG["max_modifier"], height_range)
        components["height"] = round(base, 3)
        label_part = f"height={height_inches}in"

    flyer_bonus = tier_weight(player, "high_flyer") * SIZE_CFG["high_flyer_bonus_per_tier"]
    if flyer_bonus > 0:
        components["high_flyer_bonus"] = round(flyer_bonus, 3)

    final = round(min(base + flyer_bonus, SIZE_CFG["max_modifier"]), 3)

    label = f"Size modifier {final:.2f} ({label_part}"
    if flyer_bonus > 0:
        label += f", flyer bonus={flyer_bonus:.2f}"
    label += ")"

    return ScoreTrace(
        score=final,
        components=components,
        multipliers={},
        label=label,
    )


def on_ball_scoring_threat(player: dict) -> ScoreTrace:
    """
    Raw scoring ability — what commands defensive attention with the ball.

    Includes all skills that force the defense to guard the player directly:
    off_dribble shooting, iso scoring, post play, driving, crafty finishing,
    and transition threat (dual on/off-ball skill).

    Higher score → defense must commit more resources → gravity increases.
    """
    components: dict[str, float] = {}
    for skill, weight in ON_BALL_SCORING_WEIGHTS.items():
        contribution = tier_weight(player, skill) * weight
        if contribution > 0:
            components[skill] = round(contribution, 3)

    score = round(sum(components.values()), 3)

    if components:
        top_skill = max(components, key=lambda k: components[k])
        label = (
            f"Scoring threat {score:.1f} — led by {top_skill} ({components[top_skill]:.1f})"
        )
    else:
        label = "Scoring threat 0.0 — no on-ball skills"

    return ScoreTrace(
        score=score,
        components=components,
        multipliers={},
        label=label,
    )


def gravity(player: dict) -> float:
    """
    Proportion of defensive attention a player commands with the ball.
    Derived from on_ball_scoring_threat, normalised to [0.0, 1.0].

    A player with no scoring threat has near-zero gravity — their passing
    from on-ball positions is discounted accordingly.
    """
    threat = on_ball_scoring_threat(player).score
    return round(_scale(threat, 0.0, 1.0, GRAVITY_SCALE["max_input"]), 4)


def off_ball_gravity(player: dict) -> ScoreTrace:
    """
    Defensive attention commanded without the ball.

    Shooters force defenders to stay attached.
    Cutters and lob threats force defenders to track movement.
    Together they open spacing and driving lanes for the on-ball player.

    Normalised to [0.0, 1.0].
    """
    components: dict[str, float] = {}
    for skill, weight in OFF_BALL_GRAVITY_WEIGHTS.items():
        contribution = tier_weight(player, skill) * weight
        if contribution > 0:
            components[skill] = round(contribution, 3)

    raw = sum(components.values())
    score = round(_scale(raw, 0.0, 1.0, OFF_BALL_GRAVITY_SCALE["max_input"]), 4)

    # components store raw per-skill contributions (not normalised);
    # score is normalised to [0, 1]. They won't sum to score — this is by design.
    if components:
        top_skill = max(components, key=lambda k: components[k])
        label = (
            f"Off-ball gravity {score:.2f} (raw={raw:.2f}) — "
            f"led by {top_skill} ({components[top_skill]:.2f})"
        )
    else:
        label = "Off-ball gravity 0.00 — no off-ball threat"

    return ScoreTrace(
        score=score,
        components=components,
        multipliers={},
        label=label,
    )


def effective_on_ball_threat(player: dict) -> ScoreTrace:
    """
    Combined on-ball value, accounting for the gravity–passing interaction.

    Passing is only dangerous from on-ball positions when the defense must
    first account for the player's scoring threat. A pure passer with no
    scoring ability commands little defensive attention, so their passing
    from on-ball positions is heavily discounted.

    Formula:
        effective = scoring_threat + (passer_weight × gravity)

    This means:
      - Jokic-type (high scoring + ATG passing) → maximum value
      - Cam Thomas type (high scoring + limited passing) → high value from scoring alone
      - Pure facilitator (no scoring + elite passing) → heavily discounted
    """
    scoring_trace = on_ball_scoring_threat(player)
    g = gravity(player)

    passer_raw = tier_weight(player, "passer")
    passing_contribution = round(passer_raw * g, 3)

    components: dict[str, float] = dict(scoring_trace.components)
    if passing_contribution > 0:
        components["passer (gravity-gated)"] = passing_contribution

    score = round(scoring_trace.score + passing_contribution, 3)

    label = (
        f"On-ball threat {score:.1f} "
        f"(scoring={scoring_trace.score:.1f}, "
        f"gravity={g:.2f}, "
        f"passing contribution={passing_contribution:.2f})"
    )

    return ScoreTrace(
        score=score,
        components=components,
        multipliers={"gravity": g},
        label=label,
    )


# ---------------------------------------------------------------------------
# Boolean classifiers
# ---------------------------------------------------------------------------

# Skills that count as "on-ball" for classification purposes.
# crafty_finisher included because it contributes to on_ball_scoring_threat
# and gravity — a player whose only skill is finishing at the rim in traffic
# still commands on-ball defensive attention.
# pnr_ball_handler is on-ball but intentionally excluded from ON_BALL_SCORING_WEIGHTS:
# pure facilitators without scoring threat have near-zero gravity, which is correct.
_ON_BALL_SKILLS: frozenset[str] = frozenset({
    "off_dribble_shooter",
    "isolation_scorer",
    "pnr_ball_handler",
    "driver",
    "mid_post_player",
    "low_post_player",
    "crafty_finisher",    # contributes to scoring threat — must mirror ON_BALL_SCORING_WEIGHTS
    "transition_threat",  # dual skill
})

# Skills that count as "off-ball" for classification purposes.
# passer is a dual on/off-ball skill per heuristics. Including it here means
# any player with passing ability is never classified as exclusively on-ball,
# regardless of how scorer-dominant they are. This is intentional: a player
# with even Capable passing provides off-ball value (finds cutters, runs actions)
# and can coexist productively when someone else has the ball.
_OFF_BALL_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter",
    "movement_shooter",
    "cutter",
    "pnr_finisher",
    "vertical_spacer",
    "screen_setter",
    "transition_threat",  # dual skill
    "offensive_rebounder",
    "passer",             # dual on/off-ball skill — see comment above
})

# Shooting skills that provide spacing (break from being ignored off-ball)
_SHOOTING_SKILLS: frozenset[str] = frozenset({
    "spot_up_shooter",
    "movement_shooter",
    "off_dribble_shooter",
})

# Creation skills (can generate own shot or others)
_CREATION_SKILLS: frozenset[str] = frozenset({
    "driver",
    "isolation_scorer",
    "pnr_ball_handler",
    "mid_post_player",
    "low_post_player",
})

# Defensive skills
_DEFENSIVE_SKILLS: frozenset[str] = frozenset({
    "perimeter_disruptor",
    "versatile_defender",
    "rim_protector",
})


def is_exclusively_onball(player: dict) -> bool:
    """
    True if the player has on-ball skills but no meaningful off-ball presence.

    Exclusively on-ball players need to be Elite+ to justify a roster spot —
    they can't coexist productively with other on-ball players and provide
    no value when someone else has the ball.
    """
    has_onball = any(tier_weight(player, s) >= 1 for s in _ON_BALL_SKILLS)
    has_offball = any(tier_weight(player, s) >= 1 for s in _OFF_BALL_SKILLS)
    has_shooting = any(tier_weight(player, s) >= 1 for s in _SHOOTING_SKILLS)
    return has_onball and not has_offball and not has_shooting


def is_twoway(player: dict) -> bool:
    """
    True if the player contributes meaningfully on both ends.

    Requires ≥ Capable in at least one offensive skill AND one defensive skill.
    Two-way players are among the highest-value roster assets — they don't
    force a trade-off between offense and defense.
    """
    has_offense = any(
        tier_weight(player, s) >= 1
        for s in (_ON_BALL_SKILLS | _OFF_BALL_SKILLS | _SHOOTING_SKILLS)
    )
    has_defense = any(tier_weight(player, s) >= 1 for s in _DEFENSIVE_SKILLS)
    return has_offense and has_defense


def is_offensive_blackhole(player: dict) -> bool:
    """
    True if the player has no meaningful offensive threat.

    A player with no shooting and no creation ability gets ignored by the
    defense, enabling sagging and doubling your on-ball players. Their
    defensive value is real but partially offset by this implicit spacing penalty.
    """
    has_shooting = any(tier_weight(player, s) >= 1 for s in _SHOOTING_SKILLS)
    has_creation = any(tier_weight(player, s) >= 1 for s in _CREATION_SKILLS)
    return not has_shooting and not has_creation
