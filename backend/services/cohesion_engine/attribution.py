"""
Attribution Ledgers (#93, ADR 0006).

A ledger explains one subscore as per-player input lines plus labeled
adjustment lines that reconcile to the total by construction. The line
builders here ARE the formula: composites_v1's aggregation helpers sum these
lines to produce the score, so ledger and score cannot drift apart.

Line kinds:
  - "player":     a player's input to the subscore (sums into the total)
  - "adjustment": an engine adjustment — gate, boost, clamp (sums into the total)
  - "context":    informational only, excluded from the reconciliation sum
"""

from __future__ import annotations

from typing import Any

from .composites import tier_value
from .types import PlayerComposites

# Skills that feed each composite, for naming the driving skill on a player
# line. Mirrors the formula inputs in composites.compute_raw_composites; a
# label-only lookup (argmax by tier value), never a number source.
COMPOSITE_DRIVING_SKILLS: dict[str, list[str]] = {
    "spacing": ["movement_shooter", "spot_up_shooter", "off_dribble_shooter"],
    "paint_touch": ["driver", "vertical_spacer", "low_post_player", "mid_post_player", "offensive_rebounder"],
    "post_game": ["low_post_player", "mid_post_player"],
    "off_ball_impact": ["cutter", "movement_shooter", "spot_up_shooter", "screen_setter", "passer", "off_dribble_shooter"],
    "shot_creation": ["isolation_scorer", "pnr_ball_handler", "off_dribble_shooter", "passer", "driver"],
    "ball_security": ["steady_hand", "passer", "pnr_ball_handler", "driver"],
    "transition": ["transition_threat", "high_flyer", "driver", "spot_up_shooter", "off_dribble_shooter", "passer"],
    "perimeter_defense": ["perimeter_disruptor", "versatile_defender"],
    "interior_defense": ["rim_protector", "versatile_defender", "rebounder"],
    "defensive_rebounding": ["rebounder"],
    "offensive_rebounding": ["offensive_rebounder"],
    "pnr_orchestration": ["pnr_ball_handler", "passer", "driver", "off_dribble_shooter"],
    "pnr_screener": ["pnr_finisher", "screen_setter", "vertical_spacer", "spot_up_shooter"],
    "collective_passing": ["passer"],
}


# #105: labels only, never amounts — percentile normalization makes per-skill
# splits of a normalized composite a non-quantity (ADR 0006 / ADR 0007 dec. 2).
_DRIVING_SKILL_LIMIT = 3


def _driving_skills(player: dict[str, Any], composite: str, values: dict[str, Any]) -> list[str]:
    """The player's top contributing skills among the composite's formula
    inputs, ordered by input size (formula order breaks ties). Zero-input
    skills never appear."""
    skills = player.get("skills", {})
    tv = values["tier_values"]
    candidates = COMPOSITE_DRIVING_SKILLS.get(composite, [])
    scored = [
        (skill, tier_value(skills, skill, tv))
        for skill in candidates
    ]
    ranked = sorted(
        (entry for entry in scored if entry[1] > 0),
        key=lambda entry: -entry[1],
    )
    return [skill for skill, _value in ranked[:_DRIVING_SKILL_LIMIT]]


def _tier_name(raw: Any, tier_values: dict[str, float]) -> str | None:
    """Tier name behind a skill input. Skills reach attribution either as tier
    strings or as (possibly boosted) numerics — for numerics, name the highest
    tier the value reaches, which is what actually fed the composite."""
    if isinstance(raw, str):
        return raw
    if not isinstance(raw, int | float):
        return None
    reached = [(value, tier) for tier, value in tier_values.items() if value <= float(raw) + 1e-9]
    return max(reached)[1] if reached else None


def _player_line(
    player: dict[str, Any],
    composite: str,
    values: dict[str, Any],
    *,
    role: str,
    weight: float,
    value: float,
    index: int,
) -> dict[str, Any]:
    player_id = str(player.get("id") or player.get("player_id") or f"lineup-player-{index}")
    name = str(player.get("name") or player_id)
    driving = _driving_skills(player, composite, values)
    player_skills = player.get("skills", {})
    return {
        "kind": "player",
        "player_id": player_id,
        "player_name": name,
        "skill": driving[0] if driving else None,
        "skills": driving,
        # Tier behind each label — engine truth so the UI can color labels
        # without a roster lookup. Still labels, never amounts.
        "skill_tiers": {
            skill: _tier_name(player_skills.get(skill), values["tier_values"])
            for skill in driving
        },
        "role": role,
        "weight": round(weight, 4),
        "label": name,
        "value": value,
    }


def _adjustment(label: str, value: float) -> dict[str, Any]:
    return {"kind": "adjustment", "label": label, "value": value}


def _context(label: str, value: float) -> dict[str, Any]:
    return {"kind": "context", "label": label, "value": value}


# ---------------------------------------------------------------------------
# Line builders — the formula definitions. Aggregation helpers sum these.
# ---------------------------------------------------------------------------

def average_lines(
    composites: list[PlayerComposites],
    field: str,
    lineup: list[dict[str, Any]],
    values: dict[str, Any],
) -> list[dict[str, Any]]:
    """Equal-weight average: each player contributes value/n."""
    n = len(composites)
    if n == 0:
        return []
    return [
        _player_line(
            lineup[i], field, values,
            role="depth", weight=1.0 / n,
            value=float(getattr(comp, field)) / n,
            index=i,
        )
        for i, comp in enumerate(composites)
    ]


def top_two_plus_depth_lines(
    composites: list[PlayerComposites],
    field: str,
    lineup: list[dict[str, Any]],
    values: dict[str, Any],
    primary_weight: float,
    secondary_weight: float,
    depth_weight: float,
) -> list[dict[str, Any]]:
    """Top-two-plus-depth: primary/secondary role weights plus a depth share."""
    n = len(composites)
    if n == 0:
        return []
    ranked = sorted(
        range(n), key=lambda i: (-float(getattr(composites[i], field)), i)
    )
    roles: dict[int, tuple[str, float]] = {i: ("depth", 0.0) for i in range(n)}
    roles[ranked[0]] = ("primary", primary_weight)
    if n > 1:
        roles[ranked[1]] = ("secondary", secondary_weight)

    lines: list[dict[str, Any]] = []
    for i, comp in enumerate(composites):
        value = float(getattr(comp, field))
        role, role_weight = roles[i]
        effective_weight = role_weight + depth_weight / n
        lines.append(
            _player_line(
                lineup[i], field, values,
                role=role, weight=effective_weight,
                value=value * effective_weight,
                index=i,
            )
        )
    return lines


def collective_passing_lines(
    lineup: list[dict[str, Any]], values: dict[str, Any]
) -> list[dict[str, Any]]:
    """Primary creator plus lineup-wide passing depth, per player."""
    n = len(lineup)
    if n == 0:
        return []
    tv = values["tier_values"]
    primary_weight = values["passing_primary_creator_weight"]
    depth_weight = values["passing_depth_weight"]
    passer_values = [
        tier_value(player.get("skills", {}), "passer", tv) for player in lineup
    ]
    primary_index = max(range(n), key=lambda i: (passer_values[i], -i))

    lines: list[dict[str, Any]] = []
    for i, player in enumerate(lineup):
        role = "primary" if i == primary_index else "depth"
        effective_weight = depth_weight / n + (primary_weight if i == primary_index else 0.0)
        lines.append(
            _player_line(
                player, "collective_passing", values,
                role=role, weight=effective_weight,
                value=passer_values[i] * effective_weight,
                index=i,
            )
        )
    return lines


# ---------------------------------------------------------------------------
# Ledger assembly for one evaluated lineup
# ---------------------------------------------------------------------------

_AVERAGE_HANDLERS: dict[str, str] = {
    "spacing_v1": "spacing",
    "paint_touch_v1": "paint_touch",
    "off_ball_impact_v1": "off_ball_impact",
    "shot_creation_v1": "shot_creation",
    "ball_security_v1": "ball_security",
    "transition_v1": "transition",
}

# handler name -> (composite field, values-key prefix for the three weights)
_TTPD_HANDLERS: dict[str, tuple[str, str]] = {
    "post_game_v1": ("post_game", "post_game"),
    "defensive_rebounding_v1": ("defensive_rebounding", "defensive_rebounding"),
    "offensive_rebounding_v1": ("offensive_rebounding", "offensive_rebounding"),
    "perimeter_defense_v1": ("perimeter_defense", "perimeter_defense"),
    "interior_defense_v1": ("interior_defense", "interior_defense"),
}


def _ttpd_weights(values: dict[str, Any], prefix: str) -> tuple[float, float, float]:
    return (
        values[f"{prefix}_primary_weight"],
        values[f"{prefix}_secondary_weight"],
        values[f"{prefix}_depth_weight"],
    )


def _lines_for_handler(
    handler: str,
    composites: list[PlayerComposites],
    lineup: list[dict[str, Any]],
    values: dict[str, Any],
) -> list[dict[str, Any]] | None:
    """Build the pre-adjustment lines for one dispatched subscore, or None."""
    if handler in _AVERAGE_HANDLERS:
        return average_lines(composites, _AVERAGE_HANDLERS[handler], lineup, values)
    if handler in _TTPD_HANDLERS:
        field, prefix = _TTPD_HANDLERS[handler]
        return top_two_plus_depth_lines(
            composites, field, lineup, values, *_ttpd_weights(values, prefix)
        )
    if handler == "spacing_v2":
        from .handlers.composites_v2 import spacer_count

        lines = average_lines(composites, "spacing", lineup, values)
        subtotal = sum(line["value"] for line in lines)
        count = spacer_count(lineup, values)
        multipliers = values["spacing_multipliers"]
        multiplier = multipliers[min(count, len(multipliers) - 1)]
        if multiplier != 1.0:
            lines.append(_adjustment(
                f"Shooter-count gate ×{multiplier} ({count} spacer{'s' if count != 1 else ''})",
                subtotal * (multiplier - 1.0),
            ))
        return lines
    if handler == "shot_creation_v2":
        from .handlers.composites_v2 import creator_count

        lines = top_two_plus_depth_lines(
            composites, "shot_creation", lineup, values,
            *_ttpd_weights(values, "shot_creation"),
        )
        subtotal = sum(line["value"] for line in lines)
        count = creator_count(lineup, values)
        multipliers = values["shot_creation_multipliers"]
        multiplier = multipliers[min(count, len(multipliers) - 1)]
        if multiplier != 1.0:
            lines.append(_adjustment(
                f"Creator-count gate ×{multiplier} ({count} creator{'s' if count != 1 else ''})",
                subtotal * (multiplier - 1.0),
            ))
        return lines
    return None  # unregistered formula shape — honest omission, no ledger


def _pnr_pairing_ledger(pnr_details: dict[str, float], total: float) -> dict[str, Any]:
    """Multiplicative pairing expressed as context + adjustment lines."""
    handler_quality = pnr_details["handler_quality"]
    screener_quality = pnr_details["screener_quality"]
    balance = pnr_details["balance"]
    quality_gate = pnr_details["quality_gate"]

    lines: list[dict[str, Any]] = [
        _context("Handler quality (top-two-plus-depth)", round(handler_quality, 2)),
        _context("Screener quality (top-two-plus-depth)", round(screener_quality, 2)),
    ]
    if handler_quality <= 0 or screener_quality <= 0:
        missing = "PnR handler" if handler_quality <= 0 else "screener"
        lines.append(_adjustment(f"No rated {missing} → subscore zeroed", 0.0))
    else:
        lines.append(_adjustment("Handler/screener balance", balance))
        if quality_gate < 1.0:
            lines.append(_adjustment(
                f"Quality gate ×{round(quality_gate, 2)}",
                balance * (quality_gate - 1.0),
            ))
    return _finalize(lines, total)


def _finalize(lines: list[dict[str, Any]], total: float) -> dict[str, Any]:
    """Append a residual line so ledger lines always sum to the stored total.

    Honest labels only: "Clamped" is claimed solely when the clamp could have
    bound (total pinned at 0 or 10). Any other large residual is algebra drift
    and says so, rather than dressing a bug up as an engine step.
    """
    summed = sum(line["value"] for line in lines if line["kind"] != "context")
    residual = total - summed
    if abs(residual) >= 1e-6:
        if abs(residual) <= 0.06:
            label = "Rounding"
        elif total in (0.0, 10.0):
            label = "Clamped to 0–10 range"
        else:
            label = "Unattributed residual"
        lines = [*lines, _adjustment(label, residual)]
    return {"lines": lines, "total": total}


def build_subscore_ledgers(
    *,
    subscores: dict[str, float],
    composites: list[PlayerComposites],
    lineup: list[dict[str, Any]],
    values: dict[str, Any],
    formula_refs: dict[str, str],
    transition_boost: float,
    pnr_details: dict[str, float],
) -> dict[str, dict[str, Any]]:
    """Build Attribution Ledgers for every decomposable subscore of one lineup."""
    ledgers: dict[str, dict[str, Any]] = {}

    for key in (
        "spacing", "shot_creation", "paint_touch", "post_game",
        "off_ball_impact", "ball_security",
        "perimeter_defense", "interior_defense",
        "defensive_rebounding", "offensive_rebounding", "transition",
    ):
        handler = formula_refs.get(key, "")
        lines = _lines_for_handler(handler, composites, lineup, values)
        if lines is None:
            continue
        if key == "transition" and transition_boost > 0:
            lines.append(_adjustment("Defensive transition boost", transition_boost))
        ledgers[key] = _finalize(lines, subscores[key])

    ledgers["collective_passing"] = _finalize(
        collective_passing_lines(lineup, values), subscores["collective_passing"]
    )
    ledgers["pnr_pairing"] = _pnr_pairing_ledger(pnr_details, subscores["pnr_pairing"])

    return ledgers
