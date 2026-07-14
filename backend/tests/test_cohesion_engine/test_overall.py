"""Unit tests for the player `overall` score (#108).

`overall` is the 0-100 number the value price ladder ranks on. It is a weighted
blend of the league-percentile composites, plus a mean/peak blend so a genuine
star is not averaged down to the level of a well-rounded role player.
"""

from __future__ import annotations

import pytest

from backend.services.cohesion_engine.overall import compute_overall
from backend.services.cohesion_engine.weights import (
    COMPOSITE_NAMES,
    OVERALL_COMPOSITE_WEIGHTS,
    OVERALL_MEAN_PEAK_BLEND,
)


def _composites(**axes: float) -> dict[str, float]:
    """A full composite map, defaulting every unnamed axis to league-average."""
    return {name: axes.get(name, 5.0) for name in COMPOSITE_NAMES}


def test_overall_is_zero_to_one_hundred():
    floor = compute_overall({name: 0.0 for name in COMPOSITE_NAMES})
    ceiling = compute_overall({name: 10.0 for name in COMPOSITE_NAMES})

    assert floor == 0.0
    assert ceiling == 100.0


def test_creation_outweighs_rebounding_for_the_same_score():
    """The whole point of the weighting: an elite creator beats an elite rebounder.

    Under an equal-weight mean these two tie exactly. They must not.
    """
    creator = _composites(shot_creation=10.0, pnr_orchestration=10.0)
    rebounder = _composites(defensive_rebounding=10.0, offensive_rebounding=10.0)

    assert compute_overall(creator) > compute_overall(rebounder)


def test_better_defender_breaks_the_tie_between_identical_offensive_players():
    """Chris's principle: defense does not lead, but it does break ties."""
    base = dict(shot_creation=8.0, pnr_orchestration=8.0, spacing=7.0)
    stopper = _composites(**base, perimeter_defense=9.0, interior_defense=9.0)
    turnstile = _composites(**base, perimeter_defense=2.0, interior_defense=2.0)

    assert compute_overall(stopper) > compute_overall(turnstile)


def test_offense_still_leads_defense():
    """A great defender does not out-rank a great offensive engine."""
    engine = _composites(shot_creation=9.5, pnr_orchestration=9.5,
                         perimeter_defense=2.0, interior_defense=2.0)
    stopper = _composites(perimeter_defense=10.0, interior_defense=10.0,
                          defensive_rebounding=10.0, shot_creation=4.0,
                          pnr_orchestration=4.0)

    assert compute_overall(engine) > compute_overall(stopper)


def test_spiky_specialist_is_not_averaged_down_to_a_rounded_role_player():
    """AC: the peak term exists so a star's best axis is not diluted by his mean.

    Curry is the case that motivated it — elite creation and spacing, ordinary
    everywhere else. A well-rounded role player who is merely fine at everything
    must not out-score him.
    """
    specialist = _composites(shot_creation=10.0, pnr_orchestration=9.5, spacing=10.0)
    generalist = {name: 6.0 for name in COMPOSITE_NAMES}

    assert compute_overall(specialist) > compute_overall(generalist)


def test_peak_term_actually_lifts_the_specialist():
    """Pure mean crushes the specialist; the blend is what rescues him."""
    specialist = _composites(shot_creation=10.0, pnr_orchestration=9.5, spacing=10.0)

    pure_mean = compute_overall(specialist, blend=1.0)
    blended = compute_overall(specialist, blend=OVERALL_MEAN_PEAK_BLEND)

    assert blended > pure_mean


def test_pure_peak_is_degenerate():
    """Why blend is not 0.0: on pure peak every player with one maxed axis ties.

    Every legend peaks at 10.0, so pure peak hands them all a 100 and the price
    ladder has nothing to sort on.
    """
    creator = _composites(shot_creation=10.0)
    rebounder = _composites(defensive_rebounding=10.0)

    assert compute_overall(creator, blend=0.0) == compute_overall(rebounder, blend=0.0) == 100.0
    assert compute_overall(creator) > compute_overall(rebounder)  # the real blend separates them


def test_weights_obey_the_design_principle():
    """The ordering is a Contract, not an artifact of one fit. Retunes must keep it.

    Left unconstrained, a fit against 10 players returns post_game as the third
    most valuable thing in basketball — it memorises that Jokic, Giannis and
    Embiid post up. This test is what stops that landing.
    """
    w = OVERALL_COMPOSITE_WEIGHTS
    creation = min(w["shot_creation"], w["pnr_orchestration"])
    defense = (w["perimeter_defense"], w["interior_defense"])
    support_offense = (w["spacing"], w["off_ball_impact"], w["finishing"],
                       w["transition"], w["ball_security"], w["paint_touch"])
    big_volume = (w["post_game"], w["pnr_screener"],
                  w["defensive_rebounding"], w["offensive_rebounding"])

    others = [v for k, v in w.items() if k not in ("shot_creation", "pnr_orchestration")]
    assert creation > max(others), "creation must lead every other axis"
    assert min(defense) >= 0.8, "defense must be meaningful, not decorative"
    assert max(defense) <= max(support_offense), "offense leads defense"
    assert max(big_volume) < min(defense), "pure-volume axes trail defense"


def test_unknown_axis_in_the_composite_map_is_rejected():
    """Fail loudly rather than silently scoring a player on a partial map."""
    with pytest.raises(KeyError):
        compute_overall({"shot_creation": 9.0})
