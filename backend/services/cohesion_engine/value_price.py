"""
Value price ladder (#109) — a skill-derived dollar price per rosterable player.

Mechanism (fixed by the epic #107, do not redesign):

- ACTIVES: sort the active pool by `overall` descending, sort that same pool's
  real NBA salaries descending, and pair by rank. The best skillset collects the
  league's biggest paycheck; the Nth-best collects the Nth salary. The NBA's own
  pay curve becomes the ladder — no hand-built curve to tune, prices stay in
  dollars people recognize, and the units never change so the salary cap / gauge
  keep working untouched.

- LEGENDS: an all-time great mostly out-scores every active, so ranked naively
  into one pool they would seize the top salaries and deflate every real player.
  They get their own tier stacked ABOVE the max real salary — option (a),
  "extrapolate the ladder past the top of the real distribution." Legends are
  ordered among themselves by `overall`; the price step per legend rank is the
  real distribution's own top-tier marginal dollars-per-rank, so even the legend
  band's shape comes from NBA money, not an invented constant.

Boundary: pure mechanics. This module takes already-computed `overall` scores and
real salaries and returns prices. It does not fetch, normalize, score, or cache
anything — the value_ladder_cache owns the DB reads and the (season, release) key.

The consequence worth naming: because the legend tier sits entirely above the top
real salary, a strong active (say SGA, the top active) can out-SKILL a weak legend
yet price BELOW him. That is inherent to both options the epic offered — legends
are a premium class by construction — so global monotonicity holds only WITHIN
each tier, plus the stacking invariant (every legend >= every active).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

# The top decile of real salaries defines the "marginal dollars per rank" at the
# star tier. That slope is what the legend tier is extrapolated along, so the
# legend band's spacing is inherited from real NBA money rather than invented.
TOP_SLOPE_FRACTION = 0.10

# Fallback step when the real top tier is flat (degenerate/synthetic data): 1% of
# the top salary per legend rank. Keeps legends strictly above actives and
# monotone even when top_marginal_step can't measure a slope.
_FLAT_TOP_STEP_FRACTION = 0.01


@dataclass(frozen=True)
class ValueLadder:
    """A resolved price ladder: two maps, one per tier.

    active_prices is keyed by player id (players.id); legend_prices is keyed by
    nba_api_id (string) — the natural join key on each read path. Both values are
    whole dollars.
    """

    active_prices: Mapping[str, int]
    legend_prices: Mapping[str, int]


def rank_pair_prices(overalls: Mapping[str, float], salaries: list[int]) -> dict[str, int]:
    """Pair overall-ranked players against salary-ranked dollars, rank for rank.

    ``overalls`` and ``salaries`` describe the SAME pool, so they are the same
    length by construction — the salaries ARE these players' real salaries.
    """
    if len(overalls) != len(salaries):
        raise ValueError(
            f"rank_pair_prices: {len(overalls)} players vs {len(salaries)} salaries "
            "— the pool's salaries must be exactly the pool being priced"
        )
    keys = sorted(overalls, key=lambda k: overalls[k], reverse=True)
    sals_desc = sorted(salaries, reverse=True)
    return {key: int(sals_desc[i]) for i, key in enumerate(keys)}


def top_marginal_step(salaries_desc: list[int], fraction: float = TOP_SLOPE_FRACTION) -> float:
    """Average dollars per rank across the top ``fraction`` of the salary curve.

    Telescoping mean of the top-tier rank-to-rank gaps: (S[0] - S[k]) / k. This is
    the natural cost of one rank at the star tier, and it sets how far apart the
    legend prices sit.
    """
    n = len(salaries_desc)
    if n < 2:
        return 0.0
    k = max(1, int(n * fraction))
    k = min(k, n - 1)
    return (salaries_desc[0] - salaries_desc[k]) / k


def extrapolate_legend_prices(
    legend_overalls: Mapping[str, float], top_salary: int, step: float
) -> dict[str, int]:
    """Stack legends above ``top_salary``, ordered by overall, ``step`` apart.

    The weakest legend lands one step above the top real salary; each better legend
    is one step higher. Monotone in overall within the tier, and the whole band
    sits strictly above the top real salary.
    """
    keys = sorted(legend_overalls, key=lambda k: legend_overalls[k], reverse=True)
    m = len(keys)
    # i=0 is the best legend → furthest above the top (top + step*m).
    # i=m-1 is the weakest → one step above the top (top + step*1).
    return {key: int(round(top_salary + step * (m - i))) for i, key in enumerate(keys)}


def build_ladder(
    active_overalls: Mapping[str, float],
    active_salaries: list[int],
    legend_overalls: Mapping[str, float],
    fraction: float = TOP_SLOPE_FRACTION,
) -> ValueLadder:
    """Build the full ladder: rank-paired actives + an extrapolated legend tier."""
    active_prices = rank_pair_prices(active_overalls, active_salaries) if active_overalls else {}

    sals_desc = sorted(active_salaries, reverse=True)
    top_salary = sals_desc[0] if sals_desc else 0
    step = top_marginal_step(sals_desc, fraction)
    if step <= 0:
        step = top_salary * _FLAT_TOP_STEP_FRACTION

    legend_prices = (
        extrapolate_legend_prices(legend_overalls, top_salary, step)
        if legend_overalls
        else {}
    )
    return ValueLadder(active_prices=active_prices, legend_prices=legend_prices)
