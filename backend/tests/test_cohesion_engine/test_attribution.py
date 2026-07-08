"""
Attribution Ledger tests (#93, ADR 0006).

Ledger lines are captured intermediates of the real formula run: per-player
input lines plus labeled adjustment lines that reconcile to the subscore total
by construction. "context" lines are informational and excluded from the sum.
"""

from __future__ import annotations

import json
from pathlib import Path

from services.cohesion_engine.cohesion import evaluate_lineup
from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion
from services.cohesion_engine.roster import evaluate_roster

# Ensure handlers are registered before tests run
import services.cohesion_engine.handlers.composites_v1  # noqa: F401
import services.cohesion_engine.handlers.composites_v2  # noqa: F401

LEDGER_KEYS = {
    # The 11 Team Shape axes
    "spacing", "shot_creation", "paint_touch", "post_game",
    "off_ball_impact", "ball_security",
    "perimeter_defense", "interior_defense",
    "defensive_rebounding", "offensive_rebounding", "transition",
    # Decomposable extras
    "pnr_pairing", "collective_passing",
}


def _bootstrap_engine(formula_overrides: dict[str, str] | None = None) -> CohesionEngine:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    if formula_overrides:
        data["payload"]["formula_refs"] = {**data["payload"]["formula_refs"], **formula_overrides}
    version = EvaluationVersion(id="test", slug="test", status="published", payload=data["payload"])
    return CohesionEngine(version)


ENGINE = _bootstrap_engine()


def make_player(name: str, height: str, skills: dict[str, str]) -> dict:
    return {"id": name, "name": name, "height": height, "skills": skills}


def _fixture_lineup() -> list[dict]:
    return [
        make_player("Handler", "6-3", {"pnr_ball_handler": "Elite", "passer": "Elite", "perimeter_disruptor": "Elite"}),
        make_player("Shooter", "6-5", {"movement_shooter": "Elite", "spot_up_shooter": "Elite"}),
        make_player("Cutter", "6-7", {"cutter": "Elite", "driver": "Proficient"}),
        make_player("Big", "7-0", {"rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite"}),
        make_player("Wing", "6-8", {"versatile_defender": "Elite", "transition_threat": "Elite", "high_flyer": "Elite"}),
    ]


def _summed(ledger: dict) -> float:
    return sum(line["value"] for line in ledger["lines"] if line["kind"] != "context")


def test_breakdowns_absent_by_default():
    result = evaluate_lineup(_fixture_lineup(), ENGINE)
    assert result.subscore_breakdowns is None


def test_every_ledger_reconciles_to_its_subscore():
    result = evaluate_lineup(_fixture_lineup(), ENGINE, with_attribution=True)
    breakdowns = result.subscore_breakdowns
    assert breakdowns is not None
    assert LEDGER_KEYS <= set(breakdowns)

    for key, ledger in breakdowns.items():
        assert ledger["total"] == result.subscores[key], key
        assert abs(_summed(ledger) - result.subscores[key]) < 1e-6, key
        # A clamp residual is only legitimate when the clamp actually bound;
        # anywhere else it would mean ledger algebra drifted from the formula.
        for line in ledger["lines"]:
            if line["kind"] == "adjustment" and line["label"].startswith("Clamped"):
                assert result.subscores[key] in (0.0, 10.0), key


def test_average_ledger_has_five_equal_weight_player_lines():
    result = evaluate_lineup(_fixture_lineup(), ENGINE, with_attribution=True)
    lines = [l for l in result.subscore_breakdowns["spacing"]["lines"] if l["kind"] == "player"]
    assert len(lines) == 5
    for line in lines:
        assert line["role"] == "depth"
        assert abs(line["weight"] - 0.2) < 1e-9
        assert line["player_name"]


def test_top_two_plus_depth_names_a_primary():
    result = evaluate_lineup(_fixture_lineup(), ENGINE, with_attribution=True)
    lines = [l for l in result.subscore_breakdowns["perimeter_defense"]["lines"] if l["kind"] == "player"]
    primaries = [l for l in lines if l["role"] == "primary"]
    assert len(primaries) == 1
    # Primary should be the largest player line
    assert primaries[0]["value"] == max(l["value"] for l in lines)


def test_driving_skill_is_named_on_player_lines():
    result = evaluate_lineup(_fixture_lineup(), ENGINE, with_attribution=True)
    shooter_line = next(
        l for l in result.subscore_breakdowns["spacing"]["lines"]
        if l["kind"] == "player" and l["player_name"] == "Shooter"
    )
    assert shooter_line["skill"] in {"movement_shooter", "spot_up_shooter"}


def test_pnr_pairing_gate_shows_as_line_when_no_screener():
    lineup = [
        make_player("Handler", "6-3", {"pnr_ball_handler": "Elite", "passer": "Elite"}),
        make_player("S1", "6-5", {"spot_up_shooter": "Elite"}),
        make_player("S2", "6-6", {"spot_up_shooter": "Elite"}),
        make_player("S3", "6-7", {"spot_up_shooter": "Elite"}),
        make_player("S4", "6-8", {"spot_up_shooter": "Elite"}),
    ]
    result = evaluate_lineup(lineup, ENGINE, with_attribution=True)
    ledger = result.subscore_breakdowns["pnr_pairing"]
    assert result.subscores["pnr_pairing"] == 0.0
    assert ledger["total"] == 0.0
    assert any("zeroed" in l["label"].lower() for l in ledger["lines"] if l["kind"] == "adjustment")
    assert abs(_summed(ledger)) < 1e-6


def test_transition_boost_is_a_labeled_adjustment():
    result = evaluate_lineup(_fixture_lineup(), ENGINE, with_attribution=True)
    lines = result.subscore_breakdowns["transition"]["lines"]
    assert any(l["kind"] == "adjustment" and "transition boost" in l["label"].lower() for l in lines)


def test_v2_multiplier_appears_as_adjustment_and_reconciles():
    engine = _bootstrap_engine({"spacing": "spacing_v2", "shot_creation": "shot_creation_v2"})
    # No shooters and no creators: both count gates bind, so both ledgers
    # must carry an explicit gate adjustment line.
    lineup = [
        make_player("D1", "6-5", {"perimeter_disruptor": "Elite"}),
        make_player("D2", "6-7", {"versatile_defender": "Elite"}),
        make_player("D3", "6-9", {"rim_protector": "Elite"}),
        make_player("D4", "6-10", {"rebounder": "Elite"}),
        make_player("D5", "6-11", {"cutter": "Capable"}),
    ]
    result = evaluate_lineup(lineup, engine, with_attribution=True)
    for key in ("spacing", "shot_creation"):
        ledger = result.subscore_breakdowns[key]
        assert abs(_summed(ledger) - result.subscores[key]) < 1e-6, key
        assert any(l["kind"] == "adjustment" and "gate" in l["label"].lower() for l in ledger["lines"]), key


def test_roster_attribution_only_on_starting_lineup():
    players = [
        {**p, "slot": i, "is_cornerstone": i == 0}
        for i, p in enumerate(_fixture_lineup() + [
            make_player("Bench1", "6-6", {"spot_up_shooter": "Proficient"}),
            make_player("Bench2", "6-9", {"rebounder": "Proficient"}),
        ])
    ]
    evaluation = evaluate_roster(players, ENGINE)
    assert evaluation.starting_lineup.subscore_breakdowns is not None
    assert LEDGER_KEYS <= set(evaluation.starting_lineup.subscore_breakdowns)


def test_player_lines_label_top_skills_ordered_by_input():
    """#105 — up to 3 contributing skills, ordered by input size; labels only,
    zero-input skills never appear."""
    lineup = _fixture_lineup()
    result = evaluate_lineup(lineup, ENGINE, with_attribution=True)

    shooter_line = next(
        l for l in result.subscore_breakdowns["spacing"]["lines"]
        if l["kind"] == "player" and l["player_name"] == "Shooter"
    )
    skills = shooter_line["skills"]
    assert 1 <= len(skills) <= 3
    assert skills[0] == shooter_line["skill"]  # first label stays the argmax
    assert len(skills) == len(set(skills))
    # Every labeled skill is a real nonzero input the player actually has
    shooter = next(p for p in lineup if p["name"] == "Shooter")
    for skill in skills:
        assert shooter["skills"].get(skill, "None") != "None"


def test_driving_skills_caps_at_three_ordered_with_stable_ties():
    """#105 — 4 nonzero transition inputs: top 3 by tier value, formula order
    breaks the tie, zero-input skills excluded."""
    from services.cohesion_engine.attribution import _driving_skills

    player = make_player("Combo", "6-6", {
        "transition_threat": "Proficient",   # tie ─┐ formula order: threat first
        "high_flyer": "Proficient",          # tie ─┘
        "driver": "Elite",                   # largest input
        "spot_up_shooter": "Capable",        # 4th — capped out
        "off_dribble_shooter": "None",       # zero input — never labeled
    })

    result = _driving_skills(player, "transition", ENGINE.version.values)

    assert result == ["driver", "transition_threat", "high_flyer"]


def test_player_lines_carry_the_tier_behind_each_skill_label():
    """#105 follow-up — each driving-skill label ships the player's tier so the
    UI can color it (tiers are engine truth, not a frontend lookup)."""
    lineup = _fixture_lineup()
    result = evaluate_lineup(lineup, ENGINE, with_attribution=True)

    shooter_line = next(
        l for l in result.subscore_breakdowns["spacing"]["lines"]
        if l["kind"] == "player" and l["player_name"] == "Shooter"
    )
    shooter = next(p for p in lineup if p["name"] == "Shooter")
    tiers = shooter_line["skill_tiers"]
    assert set(tiers) == set(shooter_line["skills"])
    for skill, tier in tiers.items():
        assert tier == shooter["skills"][skill]
