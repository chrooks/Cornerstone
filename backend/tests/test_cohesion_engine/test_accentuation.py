"""
Unit tests for Phase 3 accentuation scoring.
"""

from __future__ import annotations

from backend.services.cohesion_engine.accentuation import compute_accentuation
from backend.services.cohesion_engine.types import PlayerComposites


def make_composites(name: str, **overrides: float) -> PlayerComposites:
    values = {
        "spacing": 1.0,
        "finishing": 1.0,
        "paint_touch": 1.0,
        "anchor": 1.0,
        "post_game": 1.0,
        "pnr_screener": 1.0,
        "off_ball_impact": 1.0,
        "shot_creation": 1.0,
        "rebounding": 1.0,
        "transition": 1.0,
        "perimeter_defense": 1.0,
        "interior_defense": 1.0,
    }
    values.update(overrides)
    return PlayerComposites(
        player_id=name,
        name=name,
        bell_amplitude=0.5,
        bell_peak=78,
        bell_range_down=1,
        bell_range_up=1,
        bell_flat_down=0,
        bell_flat_up=0,
        **values,
    )


def test_strength_amplification_rewards_complementary_pair():
    spacer = make_composites(
        "Spacer",
        spacing=9.0,
        finishing=4.0,
        paint_touch=4.0,
        anchor=4.0,
        post_game=4.0,
        pnr_screener=4.0,
        off_ball_impact=4.0,
        shot_creation=4.0,
        rebounding=4.0,
        transition=4.0,
    )
    interior = make_composites(
        "Interior",
        spacing=4.0,
        finishing=4.0,
        paint_touch=8.0,
        anchor=4.0,
        post_game=4.0,
        pnr_screener=4.0,
        off_ball_impact=4.0,
        shot_creation=4.0,
        rebounding=4.0,
        transition=4.0,
    )

    strength, weakness = compute_accentuation([spacer, interior])

    assert strength > 0
    assert weakness == 0.0


def test_weakness_coverage_rewards_teammate_same_composite_strength():
    weak_spacer = make_composites("Weak Spacer", spacing=1.0, paint_touch=8.0)
    strong_spacer = make_composites("Strong Spacer", spacing=9.0, anchor=8.0)

    _strength, weakness = compute_accentuation([weak_spacer, strong_spacer])

    assert weakness > 0


def test_strength_amplification_rewards_perimeter_and_interior_defense_pair():
    point_of_attack = make_composites("Point of Attack", perimeter_defense=9.0)
    rim_protector = make_composites("Rim Protector", interior_defense=8.0)

    strength, _weakness = compute_accentuation([point_of_attack, rim_protector])

    assert strength > 0


def test_strength_amplification_rewards_perimeter_defense_and_transition_pair():
    pressure_guard = make_composites("Pressure Guard", perimeter_defense=9.0)
    runner = make_composites("Runner", transition=8.0)

    strength, _weakness = compute_accentuation([pressure_guard, runner])

    assert strength > 0


def test_accentuation_returns_zero_for_single_player():
    assert compute_accentuation([make_composites("Solo", spacing=9.0)]) == (0.0, 0.0)
