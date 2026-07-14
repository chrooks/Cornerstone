"""
Player `overall` — one 0-100 score per player (#108).

This is the number the value price ladder (#109) ranks on. Sort players by
`overall`, sort the real NBA salaries descending, pair them, and the league's own
pay curve becomes the price ladder.

Boundary: pure mechanics. It takes an already-percentile-normalized composite map
and returns a number. It does not fetch, normalize, or price anything.

The composites MUST arrive league-percentile normalized (0-10) — the output of
`normalize_composites` against a warm distribution. Raw or theoretical-max-scaled
values are wrong here: the theoretical maxima assume an impossible
best-at-everything player and differ wildly per axis (paint_touch 227.6 vs
ball_security 16.0), so scaling against them crushes multi-skill axes and spikes
single-skill ones.
"""

from __future__ import annotations

from typing import Any, Mapping

from .weights import (
    COMPOSITE_NAMES,
    OVERALL_COMPOSITE_WEIGHTS,
    OVERALL_MEAN_PEAK_BLEND,
)


def overall_params_from_values(
    values: Mapping[str, Any],
) -> tuple[Mapping[str, float], float]:
    """Resolve (weights, blend) from an Evaluation Version's ``values`` blob.

    Falls back to the weights.py constants when the active version predates
    #108 and carries neither key — publishing a new version picks them up, and
    until then the engine still scores. Callers that have a version in hand
    should route through this rather than reading the constants directly, so a
    published retune actually takes effect.
    """
    weights = values.get("overall_composite_weights") or OVERALL_COMPOSITE_WEIGHTS
    blend = values.get("overall_mean_peak_blend")
    if blend is None:
        blend = OVERALL_MEAN_PEAK_BLEND
    return weights, float(blend)


def compute_overall(
    composites: Mapping[str, float],
    weights: Mapping[str, float] | None = None,
    blend: float | None = None,
) -> float:
    """Return a player's `overall`, 0-100.

        overall = 100 * (blend * weighted_mean + (1 - blend) * best_axis) / 10

    The weighted mean says how much a player does. The peak says how well he does
    the one thing he is best at. Both are load-bearing:

    - Pure mean crushes specialists. Curry — elite creation and spacing, ordinary
      elsewhere — falls to 41.6, below role players who are merely fine at
      everything.
    - Pure peak is degenerate. Every legend maxes at least one axis at 10.0, so
      they all tie at 100 and the ladder has nothing to sort on.

    Args:
        composites: league-percentile-normalized composites, 0-10, one per axis
            in COMPOSITE_NAMES. A missing axis raises KeyError rather than being
            silently treated as zero — a partial map means a bug upstream, and
            since #114 a zero is a real claim about a player, not a blank.
        weights: per-axis weights; defaults to OVERALL_COMPOSITE_WEIGHTS. Their
            ordering encodes the design principle — see weights.py before retuning.
        blend: mean/peak mix; defaults to OVERALL_MEAN_PEAK_BLEND.

    Raises:
        KeyError: if `composites` is missing an axis.
    """
    active_weights = OVERALL_COMPOSITE_WEIGHTS if weights is None else weights
    active_blend = OVERALL_MEAN_PEAK_BLEND if blend is None else blend

    missing = [name for name in COMPOSITE_NAMES if name not in composites]
    if missing:
        raise KeyError(f"compute_overall: missing composite axes: {missing}")

    total_weight = sum(active_weights[name] for name in COMPOSITE_NAMES)
    weighted_mean = (
        sum(composites[name] * active_weights[name] for name in COMPOSITE_NAMES)
        / total_weight
    )
    best_axis = max(composites[name] for name in COMPOSITE_NAMES)

    blended = active_blend * weighted_mean + (1.0 - active_blend) * best_axis
    return round(blended * 10.0, 1)
