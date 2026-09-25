"""
scripts/sim_threshold_candidate.py — READ-ONLY drift simulation for a candidate stat rule (#119 plan, M1.28).

For every player in the season's draft pool: evaluate the stored rule and the
candidate rule on the newest usable 2025-26 blob with the production
evaluator, then count the review flags a skill-scoped recompute would stage
under each (the production #120 merge, `_stage_composite_for_player`). Prints
Markdown: tier moves, flag counts by reason, the distribution of every stat the
candidate reads, and rows for named players.

--from-pickle <path> rebuilds each blob's matchup_defense with the current
assembler (`_compute_matchup_defense`) from a cached league bulk pickle
(matchup rows, PlayerIndex, Base totals). That pickle has no Synergy frames,
so handler_share is None in pickle mode; a rule that reads it needs database
mode (the refetched blobs).

STRICTLY READ-ONLY: the dev_checks client guard (select only; *.supabase.co
refused), and the NBA.com, career-cache and notability paths replaced with
functions that raise. Notability comes from the stored record instead.

Run (from backend/, venv active):
    python scripts/sim_threshold_candidate.py --skill versatile_defender \
        --candidate ../.tasks/119-3d-archetypes/vd_rule_candidate.json \
        --players "OG Anunoby,Scottie Barnes,Evan Mobley"
"""

from __future__ import annotations

import argparse
import copy
import json
import pickle
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dev_checks import (  # noqa: E402  (also puts backend/ on sys.path and loads backend/.env)
    SEASON,
    ReadOnlyViolation,
    composites,
    find_player,
    newest_blobs,
    read_only_client,
    season_players,
)
from services.skill_engine.cache import get_league_averages, get_thresholds  # noqa: E402
from services.skill_engine.conditions import resolve_stat  # noqa: E402
from services.skill_engine.evaluator import evaluate_skill  # noqa: E402
from services.stats_assembler import _compute_matchup_defense  # noqa: E402
from services.stats_schema import empty_stats_blob  # noqa: E402

_QUANTILES = (0.1, 0.25, 0.5, 0.75, 0.9)


def block_side_effect_paths() -> None:
    """Replace every per-player NBA.com, career-cache and notability entry point with one that raises."""
    from services import nba_api_client, notability, players_service
    from services.skill_engine import evaluation_only

    def refuse(name):
        def _raise(*a, **k):
            raise ReadOnlyViolation(f"{name} blocked: read-only simulation")
        return _raise

    blocked = {
        nba_api_client: ("get_bulk_stats", "get_player_index", "get_league_matchups", "get_player_career_stats",
                         "get_player_awards", "get_player_info", "get_player_shot_chart"),
        players_service: ("get_or_fetch_career", "get_or_fetch_player_stats"),
        # notability imports get_or_fetch_career by name, so block its copy too.
        notability: ("get_notability_score", "get_or_fetch_career"),
        evaluation_only: ("get_notability_score", "get_or_fetch_player_stats"),
    }
    for module, names in blocked.items():
        for name in names:
            if hasattr(module, name):
                setattr(module, name, refuse(f"{module.__name__}.{name}"))


def stat_paths(rule) -> list[str]:
    """Every condition `stat` path a rule reads, in first-seen order."""
    found: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            if isinstance(node.get("stat"), str) and node["stat"] not in found:
                found.append(node["stat"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(rule)
    return found


def matchups_from_pickle(path: str, blobs: dict[str, dict], nba_ids: dict[str, int]) -> dict[str, dict]:
    """Blobs with matchup_defense rebuilt from the pickle's league matchup rows (production assembler)."""
    matchups, player_index, base = pickle.load(open(path, "rb"))
    # The pickle's Base frame is season TOTALS; the fetch stores per-game rows,
    # and the assembler turns them back into totals (value x GP). So divide here.
    def per_game(v, gp):
        return v / gp if gp else None

    bulk_data = {"base": {int(r.PLAYER_ID): {"GP": r.GP, "PTS": per_game(r.PTS, r.GP),
                                             "FGA": per_game(r.FGA, r.GP), "FGM": per_game(r.FGM, r.GP)}
                          for r in base.itertuples()}}
    by_def = {int(k): g for k, g in matchups.groupby("DEF_PLAYER_ID")}
    template = empty_stats_blob()["matchup_defense"]
    out = {}
    for pid, blob in blobs.items():
        nba = nba_ids.get(pid)
        fixed = _compute_matchup_defense(nba, by_def.get(nba), bulk_data, player_index) if nba else None
        b = copy.deepcopy(blob)
        b["matchup_defense"] = {**template, **(fixed or {})}  # production: a None result leaves the template
        out[pid] = b
    return out


def flag_rows(skill, result, comp, pid, season, kept_calls=None):
    from services.skill_engine.evaluation_only import _stage_composite_for_player

    # ponytail: notability from the stored record (low <=> a low_notability flag), not get_notability_score,
    # which fetches from NBA.com and inserts career rows.
    notability = 0 if any(isinstance(e, dict) and e.get("flag_reason") == "low_notability" for e in comp.values()) else 100
    _, flags = _stage_composite_for_player(pid, season, {skill: result}, [skill], comp, notability,
                                           kept_calls=kept_calls)
    return flags


def describe(values: list) -> str:
    s = pd.Series([v for v in values if v is not None], dtype=float)
    if s.empty:
        return f"n=0 null={len(values)}"
    q = " ".join(f"p{int(p * 100)}={s.quantile(p):.4g}" for p in _QUANTILES)
    return f"n={len(s)} null={len(values) - len(s)} min={s.min():.4g} {q} max={s.max():.4g}"


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Read-only drift simulation for a candidate stat rule.")
    ap.add_argument("--skill", required=True)
    ap.add_argument("--candidate", required=True, help="JSON file holding the candidate rule body")
    ap.add_argument("--from-pickle", help="rebuild matchup_defense from this league bulk pickle")
    ap.add_argument("--players", default="", help="comma-separated names to show row by row")
    ap.add_argument("--season", default=SEASON)
    args = ap.parse_args(argv)

    candidate = json.loads(Path(args.candidate).read_text())
    sb = read_only_client()
    block_side_effect_paths()

    current = get_thresholds(sb).get(args.skill)
    league_avgs = get_league_averages(args.season, sb)
    players = season_players(sb, args.season)
    name = {p["id"]: p["name"] for p in players}
    blobs = newest_blobs(sb, list(name), args.season)
    if args.from_pickle:
        blobs = matchups_from_pickle(args.from_pickle, blobs, {p["id"]: p["nba_api_id"] for p in players})
    from services.skill_engine.evaluation_only import _read_kept_calls

    comp_rows = composites(sb, args.season)
    comps = {pid: c["profile"] or {} for pid, c in comp_rows.items()}
    kept = _read_kept_calls(sb, comp_rows, [args.skill])  # #177: as the run reads it

    moves, flags_now, flags_new = Counter(), Counter(), Counter()
    rows: dict[str, dict] = {}
    for pid, blob in blobs.items():
        now = evaluate_skill(args.skill, current, blob, league_avgs) if current else None
        new = evaluate_skill(args.skill, candidate, blob, league_avgs)
        moves[(now["tier"] if now else "-", new["tier"])] += 1
        if pid in comps:
            if now:
                flags_now.update(f.flag_reason.split(":")[0] for f in flag_rows(args.skill, now, comps[pid], pid, args.season, kept))
            flags_new.update(f.flag_reason.split(":")[0] for f in flag_rows(args.skill, new, comps[pid], pid, args.season, kept))
        rows[pid] = {"now": now["tier"] if now else "-", "new": new["tier"]}

    paths = stat_paths(candidate)
    print(f"# Drift: {args.skill} candidate ({args.candidate})\n")
    print(f"Season {args.season}; {len(blobs)} players with a usable blob, {len(comps)} composites; "
          f"matchups from {'pickle ' + args.from_pickle if args.from_pickle else 'the stored blobs'}; "
          f"stored rule: {'yes' if current else 'none'}. Read-only: no writes, no NBA.com calls.\n")
    if args.from_pickle and any("handler_share" in p for p in paths):
        print("WARNING: the candidate reads handler_share, which is None in pickle mode; use database mode.\n")

    print("## Tier moves (stored rule → candidate)\n\n| stored rule | candidate | players |\n|---|---|---|")
    for (a, b), n in sorted(moves.items(), key=lambda kv: -kv[1]):
        print(f"| {a} | {b} | {n}{' (unchanged)' if a == b else ''} |")

    print(f"\n## Review flags a {args.skill} recompute would stage\n\n| reason | stored rule | candidate |\n|---|---|---|")
    for reason in sorted(set(flags_now) | set(flags_new)):
        print(f"| {reason} | {flags_now[reason]} | {flags_new[reason]} |")
    print(f"| **total** | {sum(flags_now.values())} | {sum(flags_new.values())} |")

    print("\n## Candidate inputs\n")
    for path in paths:
        print(f"- `{path}`: {describe([resolve_stat(b, path) for b in blobs.values()])}")

    names = [n.strip() for n in args.players.split(",") if n.strip()]
    if names:
        print("\n## Named players\n\n| player | final | stat | claude | source | stored rule | candidate | "
              + " | ".join(f"`{p.split('.')[-1]}`" for p in paths) + " |")
        print("|---" * (7 + len(paths)) + "|")
        for n in names:
            pid = find_player(sb, n, args.season)["id"]
            e = (comps.get(pid) or {}).get(args.skill) or {}
            r = rows.get(pid, {"now": "no blob", "new": "no blob"})
            vals = [resolve_stat(blobs[pid], p) if pid in blobs else None for p in paths]
            print(f"| {name.get(pid, n)} | {e.get('final_tier')} | {e.get('stat_tier')} | {e.get('claude_tier')} | "
                  f"{e.get('source')} | {r['now']} | {r['new']} | " + " | ".join(str(v) for v in vals) + " |")


if __name__ == "__main__":
    main()
