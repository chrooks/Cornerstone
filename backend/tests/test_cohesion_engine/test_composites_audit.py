"""
TDD tests for composite formula audit changes (2026-05-25).

Covers 10 vertical slices:
  1. finishing_crafty_weight applied to crafty_finisher
  2. paint_touch finishing floor penalizes non-finishers
  3. paint_touch includes offensive_rebounder
  4. ball_security expanded to 3 skills
  5. transition outlet-passer bug fixed (latent)
  6. transition includes off_dribble_shooter
  7. off_ball_impact includes movement_shooter + screen_setter
  8. shot_creation iso coefficient explicit
  9. hardcoded / declarative formula parity after audit
  10. THEORETICAL_MAX equals all-ATG raw output
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from backend.services.cohesion_engine import composites, weights
from backend.services.snapshot_versions import distribution_cache
from backend.services.cohesion_engine.weights import (
    COMPOSITE_COEFFICIENTS,
    TIER_VALUES,
    THEORETICAL_MAX,
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _bootstrap_values() -> dict:
    seed_path = (
        Path(__file__).resolve().parents[3]
        / "supabase"
        / "migrations"
        / "data"
        / "evaluation_version_v1_seed.json"
    )
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


BASE_VALUES = _bootstrap_values()

# Build a values dict that uses the bootstrap coefficients plus the new
# audit keys so the hardcoded path exercises the new defaults.
def _audit_values(overrides: dict | None = None) -> dict:
    """
    Return a VALUES dict with the 9 new audit coefficient keys injected.
    Seed file is untouched; new keys come from COMPOSITE_COEFFICIENTS defaults.
    """
    v = copy.deepcopy(BASE_VALUES)
    # Inject all keys from the canonical COMPOSITE_COEFFICIENTS dict so any
    # new key added there is automatically visible to the hardcoded path.
    v["composite_coefficients"].update(COMPOSITE_COEFFICIENTS)
    if overrides:
        v["composite_coefficients"].update(overrides)
    # Remove composite_formulas so the hardcoded path is exercised, not the
    # declarative engine.
    v.pop("composite_formulas", None)
    return v


def _all_none_skills() -> dict[str, str]:
    """All 21 skills at None."""
    from backend.services.skills import ALL_SKILLS

    return {s: "None" for s in ALL_SKILLS}


def _skills(**overrides) -> dict[str, str]:
    base = _all_none_skills()
    base.update(overrides)
    return base


ATG = "All-Time Great"
ELITE = "Elite"
PROF = "Proficient"
CAPABLE = "Capable"
NONE = "None"

TV = TIER_VALUES  # shortcut

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_distributions():
    """Isolation via force_clear: the gated clear() consults the live draft
    pin (a real DB read) — test isolation must not depend on production state."""
    distribution_cache.force_clear_distributions()
    yield
    distribution_cache.force_clear_distributions()


# ===========================================================================
# Slice 1 — finishing_crafty_weight applied to crafty_finisher
# ===========================================================================


def test_finishing_crafty_weight_applied():
    """
    raw_finishing = finishing_crafty_weight * crafty_finisher + high_flyer
    With crafty_finisher=ATG (16) and high_flyer=None (0):
    raw_finishing = 1.3 * 16 + 0 = 20.8
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(_skills(crafty_finisher=ATG), vals)
    assert raw["finishing"] == pytest.approx(1.3 * TV[ATG])


# ===========================================================================
# Slice 2 — paint_touch finishing floor penalizes non-finishers
# ===========================================================================


def test_paint_touch_finishing_floor_penalizes_non_finishers():
    """
    The finishing_mult floor drops from 1.0 → 0.9.

    Formula convention (matches formula engine): max(floor, floor + scale * src)
    - Non-finisher (src=0): max(0.9, 0.9 + 0.08*0) = 0.9  → 10% penalty
    - Great finisher (src=20.8): max(0.9, 0.9 + 0.08*20.8) = max(0.9, 2.564) = 2.564

    Non-finisher now gets a 10% penalty on paint touch vs the old behavior
    where they got full 1.0 multiplier.
    """
    vals = _audit_values()
    scale = vals["composite_coefficients"]["paint_touch_finishing_scale"]

    # Non-finisher: driver=Elite, no finishing skills
    raw_no_finish = composites.compute_raw_composites(_skills(driver=ELITE), vals)
    # raw_finishing = 0 → finishing_mult = max(0.9, 0.9 + 0.08*0) = 0.9
    assert raw_no_finish["paint_touch"] == pytest.approx(0.9 * TV[ELITE])

    # Good finisher: driver=Elite, crafty_finisher=ATG
    raw_with_finish = composites.compute_raw_composites(
        _skills(driver=ELITE, crafty_finisher=ATG), vals
    )
    # raw_finishing = 1.3 * 16 = 20.8
    # finishing_mult = max(0.9, 0.9 + 0.08 * 20.8) = max(0.9, 2.564) = 2.564
    raw_finishing_atg = 1.3 * TV[ATG]
    expected_mult = max(0.9, 0.9 + scale * raw_finishing_atg)
    assert raw_with_finish["paint_touch"] == pytest.approx(expected_mult * TV[ELITE])

    # Finisher scores higher — amplification is real
    assert raw_with_finish["paint_touch"] > raw_no_finish["paint_touch"]


# ===========================================================================
# Slice 3 — paint_touch includes offensive_rebounder
# ===========================================================================


def test_paint_touch_includes_offensive_rebounder():
    """
    With only offensive_rebounder=Elite (all others None):
    raw_finishing = 0 → finishing_mult = max(0.9, 0.9 + 0.08*0) = 0.9
    raw_paint_touch = 0.9 * (oreb_coeff * 8.0) > 0
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(_skills(offensive_rebounder=ELITE), vals)

    # paint_touch must be positive — offensive_rebounder contributes
    assert raw["paint_touch"] > 0.0

    oreb_coeff = vals["composite_coefficients"].get("paint_touch_oreb", 0.0)
    assert oreb_coeff > 0.0, "paint_touch_oreb coefficient must be positive"
    # finishing_mult = 0.9 (floor) when raw_finishing = 0
    expected = 0.9 * (oreb_coeff * TV[ELITE])
    assert raw["paint_touch"] == pytest.approx(expected)


# ===========================================================================
# Slice 4 — ball_security expanded to 3 skills
# ===========================================================================


def test_ball_security_three_skills():
    """
    passer=Elite(8), pnr_ball_handler=Elite(8), driver=Elite(8):
    raw = 8.0 + 0.45*8.0 + 0.35*8.0 = 8 + 3.6 + 2.8 = 14.4
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(
        _skills(passer=ELITE, pnr_ball_handler=ELITE, driver=ELITE), vals
    )

    pnr_c = vals["composite_coefficients"].get("ball_security_pnr_handler", 0.0)
    drv_c = vals["composite_coefficients"].get("ball_security_driver", 0.0)
    expected = TV[ELITE] + pnr_c * TV[ELITE] + drv_c * TV[ELITE]
    assert raw["ball_security"] == pytest.approx(expected)
    assert raw["ball_security"] == pytest.approx(14.4)


# ===========================================================================
# Slice 5 — transition outlet-passer bug fixed
# ===========================================================================


def test_transition_outlet_passer_no_threat_bug_fixed():
    """
    passer=ATG, transition_threat=None → raw_transition MUST be > 0.

    Old code: transition_threat * passer_mult + ... = 0 * anything = 0 (for passer contribution).
    New code: flat additive c["transition_passer"] * passer → contributes even when threat=0.
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(_skills(passer=ATG), vals)

    # transition must be positive — passer contributes flat additively
    assert raw["transition"] > 0.0

    passer_c = vals["composite_coefficients"].get("transition_passer", 0.0)
    assert raw["transition"] == pytest.approx(passer_c * TV[ATG])


# ===========================================================================
# Slice 6 — transition includes off_dribble_shooter
# ===========================================================================


def test_transition_includes_off_dribble_shooter():
    """
    With only off_dribble_shooter=Elite, raw_transition must be positive.
    raw_transition = c["transition_off_dribble"] * 8.0
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(_skills(off_dribble_shooter=ELITE), vals)

    # spacing is a composite dependency; off_dribble also contributes to spacing.
    # Isolate just the transition contribution.
    od_c = vals["composite_coefficients"].get("transition_off_dribble", 0.0)
    assert od_c > 0.0, "transition_off_dribble coefficient must be positive"
    assert raw["transition"] == pytest.approx(od_c * TV[ELITE])


# ===========================================================================
# Slice 7 — off_ball_impact includes movement_shooter + screen_setter
# ===========================================================================


def test_off_ball_impact_movement_shooter_screen_setter():
    """
    With only movement_shooter=Elite:
      raw_spacing = 8.0 (movement_shooter is already in spacing)
      off_ball_movement_bonus * 8.0 is the new additive term
      raw_off_ball_impact = 8.0 + 0.25*8.0 + (cutter terms...) = 8.0 + 2.0 = 10.0

    With only screen_setter=Elite:
      off_ball_screen_setter * 8.0 is the new additive term
      raw_off_ball_impact = 0 + 0.2*8.0 = 1.6
    """
    vals = _audit_values()

    # Test movement_shooter
    raw_ms = composites.compute_raw_composites(_skills(movement_shooter=ELITE), vals)
    mv_c = vals["composite_coefficients"].get("off_ball_movement_bonus", 0.0)
    # spacing = 8.0 (movement_shooter contributes at coefficient 1.0)
    # off_ball includes spacing + mv_c * movement_shooter
    # With no cutter/passer/screen_setter, off_ball = 8.0 + mv_c*8.0
    assert raw_ms["off_ball_impact"] == pytest.approx(TV[ELITE] + mv_c * TV[ELITE])

    # Test screen_setter alone
    raw_ss = composites.compute_raw_composites(_skills(screen_setter=ELITE), vals)
    ss_c = vals["composite_coefficients"].get("off_ball_screen_setter", 0.0)
    assert ss_c > 0.0, "off_ball_screen_setter coefficient must be positive"
    # spacing = 0, no cutter, no passer → off_ball = ss_c * 8.0
    assert raw_ss["off_ball_impact"] == pytest.approx(ss_c * TV[ELITE])


# ===========================================================================
# Slice 8 — shot_creation iso coefficient explicit
# ===========================================================================


def test_shot_creation_iso_explicit_coefficient_path():
    """
    shot_creation_iso defaults to 1.0 — must preserve prior behavior.

    With isolation_scorer=Elite (8.0) and all other skills=None:
    raw_shot_creation = c["shot_creation_iso"] * 8.0 = 1.0 * 8.0 = 8.0
    (spacing, pnr_orchestration, paint_touch all zero)
    """
    vals = _audit_values()
    raw = composites.compute_raw_composites(_skills(isolation_scorer=ELITE), vals)

    iso_c = vals["composite_coefficients"].get("shot_creation_iso", 1.0)
    assert iso_c == pytest.approx(1.0), "shot_creation_iso default must be 1.0"
    assert raw["shot_creation"] == pytest.approx(iso_c * TV[ELITE])


# ===========================================================================
# Slice 9 — hardcoded / declarative formula parity after audit
# ===========================================================================


def test_hardcoded_and_declarative_formula_parity_after_audit():
    """
    After structural changes, the hardcoded path and the declarative formula
    engine must produce identical composite values for a representative player.
    """
    from backend.services.cohesion_engine.formula_export import export_formulas

    player_skills = _skills(
        passer=ELITE,
        driver=ELITE,
        crafty_finisher=PROF,
        high_flyer=CAPABLE,
        movement_shooter=ELITE,
        screen_setter=PROF,
        spot_up_shooter=PROF,
        off_dribble_shooter=CAPABLE,
        cutter=PROF,
        offensive_rebounder=PROF,
        pnr_ball_handler=ELITE,
        isolation_scorer=PROF,
        transition_threat=PROF,
    )

    # Hardcoded path: no composite_formulas key
    vals_hardcoded = _audit_values()
    raw_hardcoded = composites.compute_raw_composites(player_skills, vals_hardcoded)

    # Declarative path: inject composite_formulas
    vals_declarative = copy.deepcopy(vals_hardcoded)
    vals_declarative["composite_formulas"] = export_formulas(
        vals_declarative["composite_coefficients"]
    )
    raw_declarative = composites.compute_raw_composites(player_skills, vals_declarative)

    for name in raw_hardcoded:
        assert raw_hardcoded[name] == pytest.approx(raw_declarative[name], abs=1e-9), (
            f"Parity mismatch for {name!r}: "
            f"hardcoded={raw_hardcoded[name]}, declarative={raw_declarative[name]}"
        )


# ===========================================================================
# Slice 10 — THEORETICAL_MAX equals all-ATG raw output
# ===========================================================================


def test_theoretical_max_equals_all_atg_raw():
    """
    THEORETICAL_MAX must equal the raw composites computed when every skill
    is All-Time Great (the maximum achievable score).

    This drives recomputation of the hand-calculated table after formula changes.
    """
    vals = _audit_values()
    atg_skills = {s: ATG for s in _all_none_skills()}
    raw_atg = composites.compute_raw_composites(atg_skills, vals)

    for name, max_val in THEORETICAL_MAX.items():
        assert raw_atg[name] == pytest.approx(max_val, rel=1e-6), (
            f"THEORETICAL_MAX[{name!r}] = {max_val}, "
            f"but all-ATG raw = {raw_atg[name]:.6f} — table needs recompute"
        )
