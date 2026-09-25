"""
scripts/rule_lab.py — READ-ONLY measurement for stat rules (#175, under #168).

Three subcommands, one per step of a threshold round:

  lint        every stored rule (or --skills a,b): tiers present, each bump's reach and
              whether it can change a tier at all, data-missing players and their null gate
              stats, stabilization entries that never produce a value, design-doc anchors.
  measure     one Skill's stored rule ("today") plus candidate rules from --variants,
              evaluated with evaluate_all_skills and apply_auto_promotions
              over the pipeline's pool as a threshold-edit run does (only the edited rule; a
              full run's auto-promotions are reported apart): tiers, the entries and flags it
              would stage (#120, _stage_composite_for_player), agreement with human calls,
              moves, input distributions over gate passers, anchors, named players.
              Writes <out>/<skill>.json (the source of truth) and <skill>.md.
  verify-run  compare a staged run with one measured variant; exit 1 on any mismatch.

STRICTLY READ-ONLY: dev_checks' guarded client (select only; *.supabase.co refused) and
sim_threshold_candidate.block_side_effect_paths() (NBA.com, career cache, notability raise).

Run (from backend/, venv active):
    python scripts/rule_lab.py lint
    python scripts/rule_lab.py measure --skill rebounder --variants v.json \
        --players "Rudy Gobert,Domantas Sabonis" --out ../.tasks/168-rule-lab/packs
    python scripts/rule_lab.py verify-run --run <run_id> --skill rebounder \
        --pack ../.tasks/168-rule-lab/packs/rebounder.json --variant R
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import re
import sys
import unicodedata
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dev_checks import (  # noqa: E402  (also puts backend/ on sys.path and loads backend/.env)
    SEASON,
    composites,
    newest_blobs,
    pages,
    read_only_client,
)
from sim_threshold_candidate import block_side_effect_paths, stat_paths  # noqa: E402
from services.skill_engine.cache import get_league_averages  # noqa: E402
from services.skill_engine.conditions import (  # noqa: E402
    evaluate_condition,
    evaluate_conditions_block,
    resolve_stat,
)
from services.skill_engine.evaluator import apply_auto_promotions, evaluate_all_skills  # noqa: E402
from services.skill_engine.transforms import (  # noqa: E402
    apply_pre_adjustments,
    apply_stabilization,
    compute_derived_stats,
)
from services.skills import SKILL_LABELS  # noqa: E402

# ponytail: mirrors players_service.DEFAULT_MIN_MPG (the pipeline's pool); not imported,
# dev_checks' rule is that read-only scripts never import players_service.
MIN_MPG = 15.0
TIER_ORDER = ["All-Time Great", "Elite", "Proficient", "Capable", "None"]
HUMAN = ("resolved", "manual_override")
QUANTILES = (10, 25, 50, 75, 90, 95)
ANCHOR_DOC = Path(__file__).resolve().parents[2] / "docs" / "skill_stat_mapping.md"
# The design doc's section 18 "Ball Dominator" is the rule stored under isolation_scorer.
LEGACY_ANCHOR_LABELS = {"isolation_scorer": "Ball Dominator"}
ALIASES = {"wemby": "Victor Wembanyama", "sga": "Shai Gilgeous-Alexander",
           "giannis": "Giannis Antetokounmpo", "stephcurry": "Stephen Curry"}


# ---------------------------------------------------------------------------
# Pure helpers (tested in tests/test_rule_lab.py, no database)
# ---------------------------------------------------------------------------


def norm(text: str) -> str:
    """Lowercase letters and digits only, accents removed: 'Nikola Jokić' -> 'nikolajokic'."""
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def percentiles(values: list[float]) -> dict:
    """n, p10..p95 and max by nearest rank (the rank the hand-written rounds used)."""
    vals = sorted(v for v in values if v is not None)
    if not vals:
        return {"n": 0}
    pick = lambda p: vals[min(len(vals) - 1, int(round(p / 100 * (len(vals) - 1))))]  # noqa: E731
    return {"n": len(vals), **{f"p{p}": pick(p) for p in QUANTILES}, "max": vals[-1]}


def tier_distance(a: str | None, b: str | None) -> int:
    """Steps between two tiers in production order (All-Time Great is its own tier)."""
    return abs(TIER_ORDER.index(a or "None") - TIER_ORDER.index(b or "None"))


def agreement(human: dict[str, str], tiers: dict[str, str]) -> dict:
    """How many human calls a variant's tiers match exactly and within one tier."""
    common = [k for k in human if k in tiers]
    return {"n": len(common),
            "exact": sum(tier_distance(human[k], tiers[k]) == 0 for k in common),
            "within_one": sum(tier_distance(human[k], tiers[k]) <= 1 for k in common)}


def moves(base: dict[str, str], new: dict[str, str]) -> dict[str, list[str]]:
    """'from -> to': sorted keys, for every key whose tier changed; largest groups first."""
    out: dict[str, list[str]] = {}
    for k in sorted(set(base) & set(new)):
        if base[k] != new[k]:
            out.setdefault(f"{base[k]} -> {new[k]}", []).append(k)
    return dict(sorted(out.items(), key=lambda kv: -len(kv[1])))


def parse_anchor_table(markdown: str) -> dict[str, dict[str, list[str]]]:
    """The design doc's 'Anchor Player Sanity Checks' table: norm(label) -> {tier: [names]}."""
    section = markdown.split("## Anchor Player Sanity Checks", 1)[-1]
    out: dict[str, dict[str, list[str]]] = {}
    for line in section.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 4 or cells[0] in ("Skill", "") or set(cells[0]) <= {"-"}:
            continue
        out[norm(cells[0])] = {tier: [n.strip() for n in cell.split(",") if n.strip()]
                               for tier, cell in zip(("Elite", "Capable", "None"), cells[1:])}
    return out


def anchors_for(skill: str, table: dict) -> dict[str, list[str]]:
    """The anchor row for a Skill, by legacy label, display label, or key."""
    label = LEGACY_ANCHOR_LABELS.get(skill) or SKILL_LABELS.get(skill, skill)
    wanted = {norm(label), norm(skill)}
    for key, row in table.items():
        if key in wanted or any(key.startswith(w) or w.startswith(key) for w in wanted):
            return row
    return {}


def anchor_ok(expected: str, got: str) -> bool:
    """The anchor table has no Proficient column: its 'Capable' reads 'rated, below Elite'."""
    return got in {"Elite": ("Elite", "All-Time Great"), "Capable": ("Capable", "Proficient"),
                   "None": ("None",)}[expected]


def name_candidates(query: str, names: dict[str, str]) -> list[str]:
    """player_ids for a name or nickname: the exact normalized match, else every substring match."""
    q = norm(ALIASES.get(norm(query), query))
    exact = [pid for pid, n in names.items() if norm(n) == q]
    return exact[:1] or [pid for pid, n in names.items() if q in norm(n)]


def match_name(query: str, names: dict[str, str]) -> str | None:
    """player_id when exactly one player matches, else None (absent or ambiguous)."""
    found = name_candidates(query, names)
    return found[0] if len(found) == 1 else None


def unmatched(query: str, names: dict[str, str]) -> str:
    """Why a name did not match: 'not in pool' or 'ambiguous: <names>'."""
    found = name_candidates(query, names)
    return f"ambiguous: {', '.join(names[p] for p in found)}" if found else "not in pool"


def compare_staged(skill: str, staged: dict[str, dict], current: dict[str, dict],
                   sim: dict[str, dict], flags: dict[str, list[dict]]) -> dict:
    """Check a staged run against a measured variant; every difference is a mismatch.

    staged / current: player_id -> composite profile (staged row / live row).
    sim: player_id -> {"entry": the staged entry the lab simulated (None: no composite, not
         staged), "flags": [[skill_name, flag_reason, stats_tier], ...] it simulated}.
    flags: player_id -> staged flag rows ({"skill_name", "flag_reason", "stats_tier"}).
    """
    counts = Counter()
    bad: list[list] = []
    expected = {pid for pid, x in sim.items() if x.get("entry") is not None}
    for pid in sorted(expected - set(staged)):
        bad.append(["simulated player not staged", pid])
    for pid in sorted(set(flags) - set(staged)):
        bad.append(["flag without a staged composite", pid, flags[pid]])
    for pid, new_prof in staged.items():
        new_prof, cur_prof = new_prof or {}, current.get(pid) or {}
        if pid not in expected:
            bad.append(["staged player not in simulation", pid])
            continue
        for k in sorted((set(cur_prof) | set(new_prof)) - {skill}):
            if cur_prof.get(k) != new_prof.get(k):
                bad.append(["other Skill changed", pid, k])
        cur, new = cur_prof.get(skill) or {}, new_prof.get(skill) or {}
        if cur.get("source") in HUMAN and new != cur:
            bad.append(["human entry changed", pid])
        elif new != sim[pid]["entry"]:
            bad.append(["entry differs from the simulation", pid, new, sim[pid]["entry"]])
        else:
            counts["human_untouched" if cur.get("source") in HUMAN else "auto_at_sim"] += 1
        got = Counter((f["skill_name"], f["flag_reason"], f.get("stats_tier")) for f in flags.get(pid, []))
        want = Counter(tuple(f) for f in sim[pid]["flags"])
        if got != want:
            bad.append(["flags differ", pid, sorted(got.elements()), sorted(want.elements())])
        else:
            counts["flags_matched"] += sum(got.values())
    return {"counts": dict(counts), "mismatches": bad}


# ---------------------------------------------------------------------------
# Evaluation (pure: blobs, rules and league averages in, results out)
# ---------------------------------------------------------------------------


def stat_map(rule: dict, blob: dict, league_avgs: dict) -> dict:
    """The evaluator's steps 1-3 for one rule: pre-adjustments, computed stats, stabilization."""
    gp = int((blob.get("metadata") or {}).get("games_played") or 0)
    sm = compute_derived_stats(rule, apply_pre_adjustments(rule, blob))
    stab = apply_stabilization(rule, sm, gp, league_avgs)
    return {**sm, "stabilized": {k[len("stabilized."):]: v for k, v in stab.items()}}


def season_stats(node) -> list[str]:
    """Stats that some condition reads with per: "season" (value x games played)."""
    if isinstance(node, dict):
        own = [node["stat"]] if node.get("per") == "season" and isinstance(node.get("stat"), str) else []
        return own + [p for v in node.values() for p in season_stats(v)]
    return [p for v in node for p in season_stats(v)] if isinstance(node, list) else []


def promoters(rules: dict, skill: str) -> list[str]:
    """Skills whose auto_promotions set a minimum tier on `skill`."""
    return [s for s, r in rules.items() if any(p.get("then_set_skill") == skill for p in r.get("auto_promotions") or [])]


def safe_stat_map(rule: dict, blob: dict, league_avgs: dict) -> dict | None:
    """stat_map, or None where the engine would record an evaluation_error for this player."""
    try:
        return stat_map(rule, blob, league_avgs)
    except Exception:  # ponytail: mirrors evaluate_all_skills' catch-all; the player is skipped
        return None


def evaluate(blobs: dict, rules: dict, league_avgs: dict, skill: str, rule: dict,
             full_run: bool = False) -> dict[str, dict]:
    """player_id -> the Skill's result, as a pipeline run computes it.

    Default: a threshold-edit run (api/calibration.py passes {skill: body} as the override),
    so no auto-promotion from another Skill applies. full_run=True: a skill-evaluation run
    over every stored rule, then apply_auto_promotions.
    """
    needed = {skill: rule}
    if full_run:
        needed.update({s: rules[s] for s in promoters(rules, skill) if s != skill})
    return {pid: apply_auto_promotions(evaluate_all_skills(blob, needed, league_avgs), needed)[skill]
            for pid, blob in blobs.items()}


def _check(block: dict, sm: dict, gp: int):
    return (evaluate_conditions_block(block, sm, gp) if "conditions" in block or "logic" in block
            else evaluate_condition(block, sm, gp))


def bump_effects(blobs: dict, rules: dict, league_avgs: dict, skill: str, rule: dict) -> list[dict]:
    """Per bump: gate passers whose condition holds; tiers it changes when removed; tiers it
    changes when it is the only bump. The evaluator applies the first bump-up that fires, so an
    overlapping bump can change nothing when removed and still act alone. DEAD = cannot act alone.
    """
    bumps = rule.get("tier_bumps") or []
    base = evaluate(blobs, rules, league_avgs, skill, rule)
    bare = evaluate(blobs, rules, league_avgs, skill, {**rule, "tier_bumps": []}) if bumps else base
    gate = [pid for pid in base if base[pid].get("volume_gate_passed")]
    out = []
    for i, bump in enumerate(bumps):
        without = evaluate(blobs, rules, league_avgs, skill, {**rule, "tier_bumps": bumps[:i] + bumps[i + 1:]})
        alone = evaluate(blobs, rules, league_avgs, skill, {**rule, "tier_bumps": [bump]})
        changed = sorted(pid for pid in base if base[pid]["tier"] != without[pid]["tier"])
        reach = sum(alone[pid]["tier"] != bare[pid]["tier"] for pid in base)
        fires = 0
        for pid in gate:
            sm = safe_stat_map(rule, blobs[pid], league_avgs)
            gp = int((blobs[pid].get("metadata") or {}).get("games_played") or 0)
            fires += sm is not None and _check(bump.get("condition") or {}, sm, gp) is True
        out.append({"index": i, "effect": bump.get("effect"),
                    "limit": bump.get("max_tier") or bump.get("min_tier"),
                    "fires_among_gate_passers": fires, "gate_passers": len(gate),
                    "changes": len(changed), "reach_alone": reach, "dead": reach == 0,
                    "changed_ids": changed})
    return out


def null_gate(blobs: dict, league_avgs: dict, rule: dict, results: dict) -> dict[str, list[str]]:
    """player_id -> null stats the rule reads (gate first), for every data_missing player."""
    paths = [p for p in stat_paths(rule.get("volume_gate") or {}) + stat_paths(rule.get("tiers") or {})
             + stat_paths(rule.get("tier_bumps") or []) if not p.startswith("stabilized.")]
    out = {}
    for pid, res in results.items():
        if res.get("data_missing"):
            sm = safe_stat_map(rule, blobs[pid], league_avgs) or {}
            out[pid] = list(dict.fromkeys(p for p in paths if resolve_stat(sm, p) is None))
    return out


def stabilization_noops(blobs: dict, league_avgs: dict, rule: dict) -> list[str]:
    """Stabilized stats that never get a value for any player (no attempt field, no average)."""
    paths = [e.get("stat") for e in rule.get("stabilization") or []]
    seen = {p: False for p in paths}
    for blob in blobs.values():
        stab = (safe_stat_map(rule, blob, league_avgs) or {"stabilized": {}})["stabilized"]
        for p in paths:
            seen[p] = seen[p] or stab.get(p) is not None
        if all(seen.values()):
            break
    return [p for p, ok in seen.items() if not ok]


# ---------------------------------------------------------------------------
# The dev world (read-only)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class World:
    names: dict      # player_id -> name, the pipeline's pool
    blobs: dict      # player_id -> newest usable stats blob
    rules: dict      # skill -> stored rule (draft_skill_thresholds)
    league_avgs: dict
    comps: dict      # player_id -> composite profile
    kept: set        # calls reviewers already kept (#177), as the pipeline reads them


def load_world(sb, season: str) -> World:
    from services.skill_engine.evaluation_only import _read_kept_calls

    logging.getLogger().setLevel(logging.WARNING)
    block_side_effect_paths()
    names = {p["id"]: p["name"] for p in pages(lambda: sb.table("players").select("id, name")
                                               .eq("season", season).gte("minutes_per_game", MIN_MPG).order("id"))}
    rules = {r["skill_name"]: r["thresholds"]
             for r in sb.table("draft_skill_thresholds").select("skill_name, thresholds").execute().data or []}
    comp_rows = composites(sb, season)
    return World(names=names, blobs=newest_blobs(sb, list(names), season), rules=rules,
                 league_avgs=get_league_averages(season, sb),
                 comps={pid: c["profile"] or {} for pid, c in comp_rows.items()},
                 kept=_read_kept_calls(sb, comp_rows, list(rules)))


def stage(world: World, skill: str, pid: str, result: dict):
    """The composite entry and flags a skill-scoped recompute would stage for one player."""
    from services.skill_engine.evaluation_only import _stage_composite_for_player

    comp = world.comps[pid]
    # ponytail: notability from the stored record (as sim_threshold_candidate.flag_rows does);
    # get_notability_score would fetch from NBA.com.
    notability = 0 if any(isinstance(e, dict) and e.get("flag_reason") == "low_notability" for e in comp.values()) else 100
    row, flags = _stage_composite_for_player(pid, SEASON, {skill: result}, [skill], comp, notability,
                                             kept_calls=world.kept)
    return (row.profile.get(skill) or {}), flags


def anchor_rows(world: World, skill: str, tiers_by_variant: dict[str, dict[str, str]]) -> list[dict]:
    rows = []
    for expected, names in anchors_for(skill, parse_anchor_table(ANCHOR_DOC.read_text())).items():
        for name in names:
            pid = match_name(name, world.names)
            got = {v: t[pid] for v, t in tiers_by_variant.items()} if pid else {}
            rows.append({"anchor": name, "player": world.names.get(pid), "expected": expected, "tiers": got,
                         "ok": {v: anchor_ok(expected, t) for v, t in got.items()},
                         "unmatched": None if pid else unmatched(name, world.names)})
    return rows


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def cmd_lint(sb, args) -> None:
    world = load_world(sb, args.season)
    skills = args.skills.split(",") if args.skills else sorted(world.rules)
    report = []
    for skill in skills:
        rule = world.rules[skill]
        res = evaluate(world.blobs, world.rules, world.league_avgs, skill, rule)
        tiers = {pid: r["tier"] for pid, r in res.items()}
        anchors = anchor_rows(world, skill, {"today": tiers})
        report.append({
            "skill": skill,
            "stat_confidence": rule.get("stat_confidence"),
            "tiers": [t for t in ("elite", "proficient", "capable") if t in {k.lower() for k in rule.get("tiers") or {}}],
            "counts": dict(Counter(tiers.values())),
            "bumps": [{k: v for k, v in b.items() if k != "changed_ids"}
                      for b in bump_effects(world.blobs, world.rules, world.league_avgs, skill, rule)],
            "data_missing": {world.names[p]: paths for p, paths in null_gate(world.blobs, world.league_avgs, rule, res).items()},
            "stabilization_noops": stabilization_noops(world.blobs, world.league_avgs, rule),
            "anchors": {"checked": sum(1 for a in anchors if a["player"]), "missing": sum(1 for a in anchors if not a["player"]),
                        "misses": [f"{a['player']} (expected {a['expected']}, got {a['tiers']['today']})"
                                   for a in anchors if a["player"] and not a["ok"]["today"]]},
        })
    print(f"# Rule lint — {args.season}, {len(world.blobs)} players (read-only)\n")
    print("| Skill | conf. | tiers | E/P/C/N | bumps (fires → changes) | data missing | stab. no-ops | anchor misses |")
    print("|---|---|---|---|---|---|---|---|")
    for r in report:
        c = r["counts"]
        bumps = "; ".join(f"{b['effect'].replace('bump_', '').replace('_one_tier', '')}≤{b['limit']} "
                          f"{b['fires_among_gate_passers']}/{b['gate_passers']} → {b['changes']}{' DEAD' if b['dead'] else ''}"
                          for b in r["bumps"]) or "—"
        noops = ", ".join(p.split(".")[-1] for p in r["stabilization_noops"]) or "—"
        misses = f"{len(r['anchors']['misses'])} of {r['anchors']['checked']}" if r["anchors"]["checked"] else "no anchors"
        flag = "" if "proficient" in r["tiers"] else " **no Proficient**"
        print(f"| {r['skill']} | {r['stat_confidence']} | {'/'.join(t[:4] for t in r['tiers'])}{flag} | "
              f"{c.get('Elite', 0)}/{c.get('Proficient', 0)}/{c.get('Capable', 0)}/{c.get('None', 0)} | {bumps} | "
              f"{len(r['data_missing'])} | {noops} | {misses} |")
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n")
        print(f"\nwrote {args.out}")


def cmd_measure(sb, args) -> None:
    world = load_world(sb, args.season)
    skill = args.skill
    variants = {"today": world.rules[skill]}
    if args.variants:
        extra = json.loads(Path(args.variants).read_text())
        if "today" in extra:
            sys.exit("'today' is the stored rule; name candidates something else")
        variants.update(extra)
    human = {pid: e.get("final_tier") for pid, c in world.comps.items() if pid in world.blobs
             for e in [c.get(skill)] if isinstance(e, dict) and e.get("source") in HUMAN}
    named = [(n, match_name(n, world.names)) for n in (args.players.split(",") if args.players else []) if n.strip()]

    pack = {"skill": skill, "season": args.season, "pool": len(world.blobs), "variants": {},
            "human_calls": {pid: {"name": world.names[pid], "tier": t, "source": world.comps[pid][skill].get("source"),
                                  "human_reviewed": bool(world.comps[pid][skill].get("human_reviewed"))}
                            for pid, t in human.items()}}
    tiers_by_variant: dict[str, dict[str, str]] = {}
    for vname, rule in variants.items():
        res = evaluate(world.blobs, world.rules, world.league_avgs, skill, rule)
        players, reasons = {}, Counter()
        for pid, r in res.items():
            # A threshold-edit run stages only players who already have a composite row.
            staged = pid in world.comps
            entry, flags = stage(world, skill, pid, r) if staged else (None, [])
            reasons.update(f.flag_reason.split(":")[0] for f in flags if f.skill_name == skill)
            players[pid] = {"tier": r["tier"], "final": (entry or {}).get("final_tier"), "staged": staged,
                            "entry": entry, "flags": [[f.skill_name, f.flag_reason, f.stats_tier] for f in flags],
                            "gate": bool(r.get("volume_gate_passed")), "data_missing": bool(r.get("data_missing")),
                            "bumped": bool(r.get("tier_bump_applied")), "auto_promoted": bool(r.get("auto_promoted"))}
        tiers = {pid: p["tier"] for pid, p in players.items()}
        tiers_by_variant[vname] = tiers
        gate = [pid for pid, p in players.items() if p["gate"]]
        dist = {}
        maps = [(m, int((world.blobs[pid].get("metadata") or {}).get("games_played") or 0))
                for pid in gate for m in [safe_stat_map(rule, world.blobs[pid], world.league_avgs)] if m is not None]
        season_paths = set(season_stats(rule))
        for path in stat_paths(rule):
            if path.startswith("stabilized."):
                continue
            dist[path] = {"raw": percentiles([resolve_stat(m, path) for m, _ in maps])}
            if any(path in m["stabilized"] for m, _ in maps):
                dist[path]["stabilized"] = percentiles([m["stabilized"].get(path) for m, _ in maps])
            if path in season_paths:  # a per: "season" condition compares value x games played
                dist[path]["season"] = percentiles([v * gp for m, gp in maps for v in [resolve_stat(m, path)] if v is not None])
        pack["variants"][vname] = {
            "rule": rule,
            "counts": {t: sum(1 for x in tiers.values() if x == t) for t in TIER_ORDER},
            "counts_staged": {t: sum(1 for p in players.values() if p["staged"] and p["tier"] == t) for t in TIER_ORDER},
            "gate_passers": len(gate),
            "data_missing": sum(p["data_missing"] for p in players.values()),
            "bumped": sum(p["bumped"] for p in players.values()),
            "flags": dict(reasons),
            "agreement": agreement(human, tiers),
            "moves_vs_today": {k: [world.names[p] for p in v] for k, v in moves(tiers_by_variant["today"], tiers).items()},
            "distributions": dist,
            "diagnostics": {
                "bumps": [{**{k: v for k, v in b.items() if k != "changed_ids"},
                           "changed": [world.names[p] for p in b["changed_ids"]][:12]}
                          for b in bump_effects(world.blobs, world.rules, world.league_avgs, skill, rule)],
                "data_missing": {world.names[p]: paths for p, paths in null_gate(world.blobs, world.league_avgs, rule, res).items()},
                "stabilization_noops": stabilization_noops(world.blobs, world.league_avgs, rule),
            },
            "players": players,
        }
    # Re-staging the stored rule must reproduce every live non-human entry, or the lab is not
    # the pipeline (or the live composite has drifted from its rule).
    today_players = pack["variants"]["today"]["players"]
    pack["composite_drift"] = [world.names[p] for p, x in today_players.items() if p in world.comps
                               and isinstance(world.comps[p].get(skill), dict)
                               and world.comps[p][skill].get("source") not in HUMAN
                               and world.comps[p][skill] != x["entry"]]
    # A full recompute would also apply other Skills' auto-promotions into this one.
    if promoters(world.rules, skill):
        full = evaluate(world.blobs, world.rules, world.league_avgs, skill, world.rules[skill], full_run=True)
        pack["full_run_promotions"] = {"from": promoters(world.rules, skill), "players": sorted(
            f"{world.names[p]} ({today_players[p]['tier']} -> {r['tier']})" for p, r in full.items()
            if r["tier"] != today_players[p]["tier"])}
    pack["anchors"] = anchor_rows(world, skill, tiers_by_variant)
    pack["named"] = []
    for query, pid in named:
        if not pid:
            pack["named"].append({"query": query, "player": None, "unmatched": unmatched(query, world.names)})
            continue
        inputs = {}  # variant -> path -> values: a candidate may stabilize or derive a stat differently
        for v, rule in variants.items():
            m = safe_stat_map(rule, world.blobs[pid], world.league_avgs) or {"stabilized": {}}
            inputs[v] = {path: {"raw": resolve_stat(m, path), "stabilized": m["stabilized"].get(path)}
                         for path in stat_paths(rule) if not path.startswith("stabilized.")}
        call = (world.comps.get(pid) or {}).get(skill) or {}
        pack["named"].append({"query": query, "player": world.names[pid], "inputs": inputs,
                              "tiers": {v: t[pid] for v, t in tiers_by_variant.items()},
                              "call": call.get("final_tier") if call.get("source") in HUMAN else None})
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{skill}.json").write_text(json.dumps(pack, indent=1, ensure_ascii=False) + "\n")
    (out / f"{skill}.md").write_text(render_markdown(pack))
    print(f"wrote {out / (skill + '.json')} and {skill}.md")
    print(render_counts(pack))


def fmt(v) -> str:
    if v is None:
        return "—"
    return f"{v:.3f}" if isinstance(v, float) and abs(v) < 1 else (f"{v:.1f}" if isinstance(v, float) else str(v))


def render_counts(pack: dict) -> str:
    lines = ["| variant | Elite | Proficient | Capable | None | gate | flags | calls exact / ±1 of n |", "|---|---|---|---|---|---|---|---|"]
    for v, d in pack["variants"].items():
        c, a = d["counts"], d["agreement"]
        atg = f" (+{c['All-Time Great']} ATG)" if c["All-Time Great"] else ""
        flags = ", ".join(f"{k} {n}" for k, n in sorted(d["flags"].items())) or "0"
        lines.append(f"| {v} | {c['Elite']}{atg} | {c['Proficient']} | {c['Capable']} | {c['None']} | {d['gate_passers']} | "
                     f"{flags} | {a['exact']} / {a['within_one']} of {a['n']} |")
    return "\n".join(lines)


def render_markdown(pack: dict) -> str:
    out = [f"# Rule lab — {pack['skill']} ({pack['season']})", "",
           f"{pack['pool']} players (15+ min a game, newest usable blob), production evaluator with auto-promotions, "
           f"#120 staging, threshold-edit path. Read-only. Live non-human entries the stored rule does not reproduce: "
           f"{len(pack['composite_drift'])} {pack['composite_drift'][:5]}"]
    if pack.get("full_run_promotions"):
        fp = pack["full_run_promotions"]
        out.append(f"A full recompute would also apply auto-promotions from {fp['from']}: "
                   f"{len(fp['players'])} players {fp['players'][:8]}")
    staged = pack["variants"]["today"]["counts_staged"]
    out += ["", "## Counts", "", f"Counts cover all {pack['pool']} pool players. A threshold-edit run writes only the "
            f"{sum(staged.values())} with a composite row (today: " + " / ".join(str(staged[t]) for t in TIER_ORDER[1:]) + ").",
            "", render_counts(pack), ""]
    for v, d in pack["variants"].items():
        out += [f"## {v}", ""]
        dg = d["diagnostics"]
        for b in dg["bumps"]:
            out.append(f"- bump {b['index']} {b['effect']} (limit {b['limit']}): condition holds for {b['fires_among_gate_passers']} "
                       f"of {b['gate_passers']} gate passers; changes {b['changes']} tiers{' — DEAD' if b['dead'] else ''}. {b['changed'][:8]}")
        if dg["data_missing"]:
            out.append(f"- data missing: {len(dg['data_missing'])} — {list(dg['data_missing'].items())[:6]}")
        if dg["stabilization_noops"]:
            out.append(f"- stabilization never runs: {dg['stabilization_noops']}")
        out += ["", "| stat (gate passers) | kind | n | p10 | p25 | p50 | p75 | p90 | p95 | max |", "|---|---|---|---|---|---|---|---|---|---|"]
        for path, kinds in d["distributions"].items():
            for kind, q in kinds.items():
                out.append(f"| {path.split('.')[-1]} | {kind} | {q['n']} | " + " | ".join(fmt(q.get(k)) for k in
                           [f"p{p}" for p in QUANTILES] + ["max"]) + " |")
        if v != "today":
            out += ["", "Moves against today:"] + [f"- {k} ({len(n)}): {', '.join(n)}" for k, n in d["moves_vs_today"].items()]
        out.append("")
    vs = list(pack["variants"])
    out += ["## Anchors (design doc)", "", "| anchor | expected | " + " | ".join(vs) + " |", "|---|---|" + "---|" * len(vs)]
    for a in pack["anchors"]:
        cells = [f"{a['tiers'][v]}{'' if a['ok'][v] else ' ✗'}" for v in vs] if a["player"] else [a["unmatched"]] * len(vs)
        out.append(f"| {a['anchor']} | {a['expected']} | " + " | ".join(cells) + " |")
    out += ["", "## Named players", "", "| player | call | " + " | ".join(vs) + " | inputs (raw / stabilized) |", "|---|---|" + "---|" * (len(vs) + 1)]
    for r in pack["named"]:
        if not r["player"]:
            out.append(f"| {r['query']} | {r['unmatched']} |" + " |" * (len(vs) + 1))
            continue
        shown: dict[str, str] = {}  # one value per stat; a variant that computes it differently adds its own
        for v in vs:
            for p, x in r["inputs"][v].items():
                text = fmt(x["raw"]) + (f"/{fmt(x['stabilized'])}" if x["stabilized"] is not None else "")
                key = p.split(".")[-1]
                if key not in shown:
                    shown[key] = text
                elif text not in shown[key]:
                    shown[key] += f" ({v}: {text})"
        ins = "; ".join(f"{k} {t}" for k, t in shown.items())
        out.append(f"| {r['player']} | {r['call'] or '—'} | " + " | ".join(r["tiers"][v] for v in vs) + f" | {ins} |")
    calls = pack["human_calls"]
    out += ["", f"## Human calls ({len(calls)})", ""] + [
        f"- {c['name']}: {c['tier']} ({c['source']}{', reviewed' if c['human_reviewed'] else ''}) — "
        + ", ".join(f"{v} {pack['variants'][v]['players'][pid]['tier']}" for v in vs)
        for pid, c in sorted(calls.items(), key=lambda kv: kv[1]["name"])]
    return "\n".join(out) + "\n"


def cmd_verify_run(sb, args) -> None:
    pack = json.loads(Path(args.pack).read_text())
    if pack["skill"] != args.skill or args.variant not in pack["variants"]:
        sys.exit(f"pack is for {pack['skill']} with variants {list(pack['variants'])}")
    sim = pack["variants"][args.variant]["players"]
    staged = {r["player_id"]: r["profile"] or {} for r in pages(lambda: sb.table("pipeline_run_results")
              .select("player_id, profile").eq("run_id", args.run).eq("source", "composite").order("player_id"))}
    if not staged:
        sys.exit(f"run {args.run} has no staged composite rows (not staged, or already committed)")
    flags: dict[str, list[dict]] = {}
    for f in pages(lambda: sb.table("pipeline_run_flag_results").select("player_id, skill_name, flag_reason, stats_tier")
                   .eq("run_id", args.run).order("player_id")):
        flags.setdefault(f["player_id"], []).append(f)
    current = {pid: c["profile"] or {} for pid, c in composites(sb, pack["season"]).items()}
    result = compare_staged(args.skill, staged, current, sim, flags)
    # The run must stage the measured rule: a threshold-edit run records it in its params.
    run = (sb.table("pipeline_runs").select("pipeline_name, params").eq("id", args.run).execute().data or [{}])[0]
    params = run.get("params") or {}
    if run.get("pipeline_name") == "threshold_edit" and (params.get("skill_name") != args.skill
                                                         or params.get("thresholds") != pack["variants"][args.variant]["rule"]):
        result["mismatches"].insert(0, ["the run's rule is not the measured variant's rule", params.get("skill_name")])
    n_flags = sum(len(v) for v in flags.values())
    print(f"run {args.run} vs {pack['skill']} variant {args.variant}: {len(staged)} staged composites, {n_flags} staged flags")
    print("counts:", result["counts"])
    print(f"MISMATCHES: {len(result['mismatches'])}")
    for m in result["mismatches"][:40]:
        print("  ", m)
    if result["mismatches"]:
        print("A review action after `measure` also shows here: re-run measure, then verify again.")
    sys.exit(1 if result["mismatches"] else 0)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Read-only rule lab (#175).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    lint = sub.add_parser("lint", help="check every stored rule for the recurring defects")
    lint.add_argument("--skills", help="comma-separated Skills (default: all)")
    lint.add_argument("--out", help="write the full report as JSON")
    meas = sub.add_parser("measure", help="measure the stored rule and candidates for one Skill")
    meas.add_argument("--skill", required=True)
    meas.add_argument("--variants", help="JSON file: {name: rule body}; the stored rule is 'today'")
    meas.add_argument("--players", default="", help="comma-separated names to show row by row")
    meas.add_argument("--out", required=True, help="directory for <skill>.json and <skill>.md")
    ver = sub.add_parser("verify-run", help="compare a staged run with a measured variant")
    ver.add_argument("--run", required=True)
    ver.add_argument("--skill", required=True)
    ver.add_argument("--pack", required=True)
    ver.add_argument("--variant", required=True)
    for p in (lint, meas, ver):
        p.add_argument("--season", default=SEASON)
    args = ap.parse_args(argv)
    sb = read_only_client()
    {"lint": cmd_lint, "measure": cmd_measure, "verify-run": cmd_verify_run}[args.cmd](sb, args)


if __name__ == "__main__":
    main()
