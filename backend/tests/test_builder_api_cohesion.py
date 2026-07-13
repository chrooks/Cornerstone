"""
Integration tests for POST /api/builder/evaluate.
"""

from __future__ import annotations

import json
from math import comb

import pytest

from app import create_app
from api import builder
from services.cohesion_engine import weights as cohesion_weights
from services.cohesion_engine.weights import VIABLE_LINEUP_THRESHOLD


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(builder, "ensure_distributions", lambda _season, _values: None)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def make_player(name: str, slot: int, skills: dict[str, str], height: str = "6-7") -> dict:
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": slot == 0,
        "height": height,
        "skills": skills,
    }


def post_evaluate(client, body: dict) -> tuple:
    resp = client.post(
        "/api/builder/evaluate",
        data=json.dumps(body),
        content_type="application/json",
    )
    return resp, resp.get_json()


def cohesion_roster() -> list[dict]:
    return [
        make_player("Cornerstone", 0, {"passer": "Elite", "pnr_ball_handler": "Elite"}, "6-8"),
        make_player("Shooter", 1, {"movement_shooter": "Elite", "spot_up_shooter": "Elite"}, "6-5"),
        make_player("Cutter", 2, {"cutter": "Elite", "driver": "Proficient"}, "6-7"),
        make_player("Big", 3, {"rim_protector": "Elite", "rebounder": "Elite", "pnr_finisher": "Elite", "screen_setter": "Elite"}, "7-0"),
        make_player("Wing", 4, {"versatile_defender": "Elite", "transition_threat": "Elite", "high_flyer": "Elite"}, "6-8"),
    ]


def test_evaluate_returns_cohesion_response_shape(client):

    resp, data = post_evaluate(
        client,
        {"players": cohesion_roster(), "mode": "live", "debug": False},
    )

    assert resp.status_code == 200
    assert data["success"] is True
    payload = data["data"]
    assert "scores" not in payload
    assert 0.0 <= payload["star_rating"] <= 5.0
    assert set(payload["star_rating_breakdown"]) == {
        "starting_5",
        "depth",
        "archetype_diversity",
        "floor",
    }
    assert payload["starting_lineup"]["cohesion_score"] >= 0.0
    assert "subscores" in payload["starting_lineup"]
    assert "strength_amplification" in payload["starting_lineup"]["accentuation"]
    assert len(payload["player_composites"]) == 5
    assert set(payload["player_composites"][0]["base"]) == set(cohesion_weights.COMPOSITE_NAMES)
    assert "amplitude" in payload["player_composites"][0]["bell_curve"]
    assert payload["lineup_summary"]["total_lineups"] == 1
    assert isinstance(payload["notes"], list)


def test_evaluate_names_the_evaluation_version_that_scored_it(client):
    """#94 — the commit moment pins the Evaluation Version, so the engine that
    produced the score has to name itself in the response it produced."""
    from services.evaluation_versions.repo import get_active

    resp, data = post_evaluate(
        client,
        {"players": cohesion_roster(), "mode": "live", "debug": False},
    )

    assert resp.status_code == 200
    active = get_active()
    assert data["data"]["evaluation_version"] == {"id": active.id, "slug": active.slug}


def test_partial_roster_returns_mode_a_notes(client):
    players = [
        make_player("Cornerstone", 0, {"spot_up_shooter": "Elite"}, "6-6"),
        make_player("Support", 1, {}, "6-5"),
    ]

    resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})

    assert resp.status_code == 200
    payload = data["data"]
    assert payload["lineup_summary"]["total_lineups"] == 0
    assert payload["starting_lineup"]["cohesion_score"] == 0.0
    assert len(payload["notes"]) > 0


def test_evaluate_returns_ranked_lineup_combinations_for_current_selection(client):
    players = [
        *cohesion_roster(),
        make_player("Bench", 5, {"rebounder": "Elite", "spot_up_shooter": "Proficient"}, "6-9"),
    ]

    resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})

    assert resp.status_code == 200
    payload = data["data"]
    combinations = payload["lineup_combinations"]
    scores = [lineup["cohesion_score"] for lineup in combinations]

    assert payload["lineup_summary"]["total_lineups"] == comb(6, 5)
    assert len(combinations) == comb(6, 5)
    assert scores == sorted(scores, reverse=True)
    assert [lineup["rank"] for lineup in combinations] == list(range(1, len(combinations) + 1))
    assert sum(1 for lineup in combinations if lineup["is_starting_lineup"]) == 1
    assert {"rank", "player_names", "player_ids", "subscores", "is_viable"}.issubset(combinations[0])
    assert all(lineup["is_viable"] is (lineup["cohesion_score"] >= VIABLE_LINEUP_THRESHOLD) for lineup in combinations)
    assert sum(1 for lineup in combinations if lineup["is_viable"]) == payload["lineup_summary"]["viable_lineups"]

# ---------------------------------------------------------------------------
# POST /api/builder/lineup-ledger (#104) — per-combo Attribution Ledger
# ---------------------------------------------------------------------------

def post_lineup_ledger(client, body: dict) -> tuple:
    resp = client.post(
        "/api/builder/lineup-ledger",
        data=json.dumps(body),
        content_type="application/json",
    )
    return resp, resp.get_json()


def test_lineup_ledger_matches_the_combos_evaluate_scores(client):
    """#104 / ADR 0006 — the on-demand ledger runs the exact evaluate path:
    same cohesion score and subscores as the combo in /evaluate, with ledgers
    that reconcile to those subscores."""
    roster = [
        *cohesion_roster(),
        make_player("Bench", 5, {"rebounder": "Elite", "spot_up_shooter": "Proficient"}, "6-9"),
    ]
    _, eval_data = post_evaluate(client, {"players": roster, "mode": "live", "debug": False})
    bench_combo = next(
        combo for combo in eval_data["data"]["lineup_combinations"]
        if "Bench" in combo["player_names"]
    )
    combo_players = [p for p in roster if p["name"] in bench_combo["player_names"]]

    resp, data = post_lineup_ledger(client, {"players": combo_players})

    assert resp.status_code == 200
    payload = data["data"]
    assert payload["cohesion_score"] == bench_combo["cohesion_score"]
    assert payload["subscores"] == bench_combo["subscores"]
    breakdowns = payload["subscore_breakdowns"]
    assert breakdowns
    for key, ledger in breakdowns.items():
        assert ledger["total"] == pytest.approx(payload["subscores"][key], abs=0.05)


def test_lineup_ledger_names_bench_players_with_driving_skills(client):
    """#104 / ADR 0007 — bench players get their "name your bite" surface:
    ledger player lines in a bench-including combo carry driving-skill labels."""
    roster = [
        *cohesion_roster(),
        make_player("Bench", 5, {"rebounder": "Elite", "spot_up_shooter": "Proficient"}, "6-9"),
    ]
    combo_players = roster[1:]  # the five that include Bench

    resp, data = post_lineup_ledger(client, {"players": combo_players})

    assert resp.status_code == 200
    bench_lines = [
        line
        for ledger in data["data"]["subscore_breakdowns"].values()
        for line in ledger["lines"]
        if line.get("player_name") == "Bench" and line["kind"] == "player"
    ]
    assert bench_lines
    assert any(line.get("skill") for line in bench_lines)


def test_evaluate_keeps_lineup_combinations_score_only(client):
    """#104 AC4 — no ledger payload bloat: combos in the default /evaluate
    response stay score-only until one is selected."""
    roster = [
        *cohesion_roster(),
        make_player("Bench", 5, {"rebounder": "Elite", "spot_up_shooter": "Proficient"}, "6-9"),
    ]

    _, data = post_evaluate(client, {"players": roster, "mode": "live", "debug": False})

    assert all(
        combo["subscore_breakdowns"] is None
        for combo in data["data"]["lineup_combinations"]
    )


def test_lineup_ledger_rejects_wrong_size(client):
    resp, data = post_lineup_ledger(client, {"players": cohesion_roster()[:4]})

    assert resp.status_code == 400
    assert "exactly 5" in data["error"]


def test_lineup_ledger_rejects_duplicate_players(client):
    resp, data = post_lineup_ledger(client, {"players": [cohesion_roster()[0]] * 5})

    assert resp.status_code == 400
    assert "duplicate" in data["error"]
