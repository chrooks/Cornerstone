"""scripts/rule_lab.py (#175): the pure helpers the measurements rest on. No database."""

import importlib.util
import re
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rule_lab.py"
DOC = Path(__file__).resolve().parents[2] / "docs" / "skill_stat_mapping.md"


def _lab():
    spec = importlib.util.spec_from_file_location("rule_lab", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules["rule_lab"] = module  # a dataclass needs its module registered
    spec.loader.exec_module(module)
    return module


lab = _lab()


def test_percentiles_use_nearest_rank_and_skip_nulls():
    q = lab.percentiles([None, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0])
    assert q["n"] == 11 and q["p10"] == 2.0 and q["p50"] == 6.0 and q["p90"] == 10.0 and q["max"] == 11.0
    assert lab.percentiles([None]) == {"n": 0}


def test_agreement_keeps_all_time_great_apart_from_elite():
    human = {"a": "All-Time Great", "b": "Capable", "c": "Elite"}
    tiers = {"a": "Elite", "b": "Capable", "c": "None"}
    assert lab.agreement(human, tiers) == {"n": 3, "exact": 1, "within_one": 2}


def test_moves_group_by_transition_largest_first():
    base = {"a": "None", "b": "None", "c": "Capable", "d": "Elite"}
    new = {"a": "Capable", "b": "Capable", "c": "Proficient", "d": "Elite"}
    assert lab.moves(base, new) == {"None -> Capable": ["a", "b"], "Capable -> Proficient": ["c"]}


def test_anchor_table_parses_the_real_design_doc():
    table = lab.parse_anchor_table(DOC.read_text())
    assert table["rebounder"]["Elite"] == ["Domantas Sabonis", "Rudy Gobert"]
    assert lab.anchors_for("offensive_rebounder", table)["Capable"] == ["Giannis"]
    assert lab.anchors_for("isolation_scorer", table)["Elite"] == ["Luka Doncic", "SGA"]  # legacy Ball Dominator row
    assert lab.anchors_for("vertical_spacer", table)["Elite"] == ["Clint Capela", "Nic Claxton"]
    assert lab.anchor_ok("Capable", "Proficient") and not lab.anchor_ok("Elite", "Proficient")


def test_names_match_accents_aliases_and_suffixes():
    names = {"1": "Nikola Jokić", "2": "Victor Wembanyama", "3": "Derrick Jones Jr.", "4": "Jalen Williams", "5": "Jaylin Williams"}
    assert lab.match_name("Nikola Jokic", names) == "1"
    assert lab.match_name("Wemby", names) == "2"
    assert lab.match_name("Derrick Jones Jr", names) == "3"
    assert lab.match_name("Williams", names) is None  # ambiguous substring


def _blob(gp, **ts):
    return {"metadata": {"games_played": gp}, "box_score": {"pts": 1.0}, "tracking_shooting": ts}


A3, P3 = "tracking_shooting.pullup_fg3a", "tracking_shooting.pullup_fg3_pct"


def _rule(bumps):
    cond = lambda v: {"logic": "AND", "conditions": [{"stat": P3, "operator": ">=", "value": v}]}  # noqa: E731
    return {"volume_gate": {"logic": "AND", "fail_tier": "None", "conditions": [{"stat": A3, "operator": ">=", "value": 2.0}]},
            "tiers": {"elite": cond(0.37), "capable": cond(0.33)}, "tier_bumps": bumps}


def test_bump_effects_reports_a_live_bump_and_the_off_dribble_dead_bump_down():
    live_up = {"effect": "bump_up_one_tier", "max_tier": "Elite",
               "condition": {"stat": A3, "operator": ">=", "value": 5.0}}
    # The pre-2026-09-25 Off-Dribble bump-down: demote a sub-.32 shooter, floor Proficient.
    # A sub-.32 shooter is never above None, so it can change nothing.
    dead_down = {"effect": "bump_down_one_tier", "min_tier": "Proficient",
                 "condition": {"stat": P3, "operator": "<", "value": 0.32}}
    blobs = {"hi": _blob(70, pullup_fg3a=6.0, pullup_fg3_pct=0.34), "lo": _blob(70, pullup_fg3a=3.0, pullup_fg3_pct=0.30),
             "mid": _blob(70, pullup_fg3a=3.0, pullup_fg3_pct=0.35)}
    rule = _rule([live_up, dead_down])
    up, down = lab.bump_effects(blobs, {"x": rule}, {}, "x", rule)
    assert (up["changes"], up["reach_alone"], up["dead"], up["changed_ids"]) == (1, 1, False, ["hi"])
    assert down["fires_among_gate_passers"] == 1 and down["changes"] == 0 and down["dead"]


def test_overlapping_bumps_are_not_called_dead():
    # The evaluator applies the first bump-up that fires, so removing either one changes nothing.
    b5 = {"effect": "bump_up_one_tier", "max_tier": "Elite", "condition": {"stat": A3, "operator": ">=", "value": 5.0}}
    b4 = {"effect": "bump_up_one_tier", "max_tier": "Elite", "condition": {"stat": A3, "operator": ">=", "value": 4.0}}
    blobs = {"p": _blob(70, pullup_fg3a=6.0, pullup_fg3_pct=0.34)}
    rule = _rule([b5, b4])
    first, second = lab.bump_effects(blobs, {"x": rule}, {}, "x", rule)
    assert (first["changes"], second["changes"]) == (0, 0)
    assert not first["dead"] and not second["dead"]


def test_null_gate_names_the_missing_stat():
    rule = _rule([])
    blobs = {"big": _blob(60, pullup_fg3a=None, pullup_fg3_pct=None)}
    results = lab.evaluate(blobs, {"x": rule}, {}, "x", rule)
    assert results["big"]["data_missing"]
    assert lab.null_gate(blobs, {}, rule, results) == {"big": [A3, P3]}  # gate stat first


def test_compare_staged_passes_a_clean_run_and_catches_each_failure():
    human = {"source": "manual_override", "final_tier": "Elite"}
    auto = {"source": "stats_only", "final_tier": "Capable", "stat_tier": "Capable"}
    current = {"h": {"s": human, "t": {"final_tier": "None"}}, "a": {"s": {"source": "stats_only", "final_tier": "None"}}}
    staged = {"h": {"s": human, "t": {"final_tier": "None"}}, "a": {"s": auto}}
    contra = ["s", "human_decision_contradicted:manual_override:Elite", "Proficient"]
    sim = {"h": {"entry": human, "flags": [contra]}, "a": {"entry": auto, "flags": []}, "gone": {"entry": None, "flags": []}}
    flags = {"h": [{"skill_name": contra[0], "flag_reason": contra[1], "stats_tier": contra[2]}]}
    clean = lab.compare_staged("s", staged, current, sim, flags)
    assert clean["mismatches"] == [] and clean["counts"] == {"human_untouched": 1, "auto_at_sim": 1, "flags_matched": 1}

    def first(st=staged, fl=flags, sm=sim):
        return lab.compare_staged("s", st, current, sm, fl)["mismatches"][0][0]

    assert first(st={**staged, "h": {"s": {**human, "final_tier": "Proficient"}, "t": {"final_tier": "None"}}}) == "human entry changed"
    assert first(fl={}) == "flags differ"
    assert first(fl={**flags, "a": [{"skill_name": "s", "flag_reason": "data_missing", "stats_tier": "None"}]}) == "flags differ"
    assert first(st={**staged, "a": {"s": {**auto, "flagged": True}}}) == "entry differs from the simulation"
    assert first(st={**staged, "a": {"s": auto, "t": {"final_tier": "Elite"}}}) == "other Skill changed"
    assert first(st={"h": staged["h"]}) == "simulated player not staged"
    assert first(st={**staged, "x": {"s": auto}}) == "staged player not in simulation"
    assert first(fl={**flags, "x": [{"skill_name": "s", "flag_reason": "data_missing", "stats_tier": None}]}) == "flag without a staged composite"


def test_the_lab_only_builds_the_guarded_read_only_client():
    src = SCRIPT.read_text()
    assert "read_only_client()" in src
    for other_client in ("get_supabase", "create_client", ".rpc("):
        assert other_client not in src, other_client
    # A write is a table(...) call chained to insert/update/upsert/delete.
    assert not re.search(r"\.table\([^)]*\)\s*\.(insert|update|upsert|delete)\(", src)
