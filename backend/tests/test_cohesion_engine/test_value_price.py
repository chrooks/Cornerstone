"""Unit tests for the value price ladder mechanics (#109).

The ladder rank-pairs a pool's `overall` scores against its own real NBA
salaries, then stacks legends in an extrapolated tier above the top real salary.
These tests pin the mechanism and the two invariants the acceptance criteria
lean on: monotonicity within a tier, and legends strictly above actives.
"""

from __future__ import annotations

import pytest

from backend.services.cohesion_engine.value_price import (
    build_ladder,
    extrapolate_legend_prices,
    rank_pair_prices,
    top_marginal_step,
)


def test_rank_pair_gives_the_best_skillset_the_biggest_paycheck():
    overalls = {"a": 90.0, "b": 50.0, "c": 70.0}
    salaries = [10, 30, 20]  # same pool, unsorted

    prices = rank_pair_prices(overalls, salaries)

    assert prices == {"a": 30, "c": 20, "b": 10}


def test_rank_pair_is_monotone_in_overall():
    overalls = {f"p{i}": float(i) for i in range(20)}
    salaries = [i * 1000 for i in range(20)]

    prices = rank_pair_prices(overalls, salaries)

    ordered = sorted(overalls, key=lambda k: overalls[k])
    seq = [prices[k] for k in ordered]
    assert seq == sorted(seq), "higher overall must never price lower"


def test_rank_pair_rejects_a_mismatched_pool():
    with pytest.raises(ValueError):
        rank_pair_prices({"a": 1.0, "b": 2.0}, [100])


def test_top_marginal_step_is_the_top_tier_dollars_per_rank():
    # 11 salaries; top decile k = int(11*0.1) = 1 → (S[0]-S[1]) / 1.
    salaries_desc = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0]

    assert top_marginal_step(salaries_desc, fraction=0.1) == 10.0


def test_legends_are_ordered_by_overall_and_sit_above_the_top_salary():
    prices = extrapolate_legend_prices(
        {"lebron": 90.0, "wade": 82.0, "nash": 79.0}, top_salary=60, step=5
    )

    # weakest legend one step up, best legend furthest up
    assert prices["nash"] == 65     # 60 + 5*1
    assert prices["wade"] == 70     # 60 + 5*2
    assert prices["lebron"] == 75   # 60 + 5*3
    assert min(prices.values()) > 60


def test_build_ladder_stacks_every_legend_above_every_active():
    active_overalls = {f"a{i}": float(i) for i in range(40)}
    active_salaries = [i * 1_000_000 for i in range(40)]
    legend_overalls = {"L1": 45.0, "L2": 50.0}

    ladder = build_ladder(active_overalls, active_salaries, legend_overalls)

    assert min(ladder.legend_prices.values()) > max(ladder.active_prices.values())
    # legends still ordered by skill among themselves
    assert ladder.legend_prices["L2"] > ladder.legend_prices["L1"]


def test_build_ladder_stays_recognizable_when_the_top_tier_is_flat():
    # A degenerate all-equal top tier must still keep legends above actives
    # without exploding into un-NBA money.
    active_overalls = {f"a{i}": float(i) for i in range(10)}
    active_salaries = [50_000_000] * 10
    legend_overalls = {"L1": 20.0}

    ladder = build_ladder(active_overalls, active_salaries, legend_overalls)

    assert ladder.legend_prices["L1"] > 50_000_000
    assert ladder.legend_prices["L1"] < 100_000_000


def test_empty_pools_do_not_crash():
    ladder = build_ladder({}, [], {})
    assert ladder.active_prices == {}
    assert ladder.legend_prices == {}
