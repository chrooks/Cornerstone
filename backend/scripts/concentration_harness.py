"""
concentration_harness.py — the exploit finder for the value economy (#111).

Question it answers: under `standard`'s value-currency pricing, how concentrated
is player selection across the best rosters you can build? If one player shows up
in nearly every top-scoring team, the pricing is not spreading the meta and the
ladder/blend needs another pass. This script MEASURES that; it decides nothing —
a human reads the numbers and picks the threshold X (#111 AC4).

What it does (read-only against the DB, deterministic):
  1. Loads the PlayerPool `standard` uses — current-season released actives + the
     released Legends — each carrying its #109 `value_price` (the same ladder the
     flipped builder prices with). Only priced players are searchable; a null
     price would read as "free" and pollute the economy, so those are dropped.
  2. Searches for top rosters under standard's constraints: 9 players, exactly one
     Legend as Cornerstone, total value_price <= the $195M cap. Random-restart
     hill-climbing, each restart greedily improving via single-player swaps.
  3. Ranks the best distinct rosters found by the REAL deterministic cohesion
     score, keeps the top 50, and prints a player-appearance concentration table
     plus Wembanyama's fraction and the 3&D-wing watchlist (#119 input).

Scoring path (documented choice):
  A full evaluate_roster scores C(9,5)=126 lineups (~140ms) — too slow for the
  inner hill-climb loop. So the hill-climb PROXY is the roster's starting-lineup
  score: evaluate_lineup on the best five (the same sort + five the full roster
  eval uses for its dominant `starting_5` term), ~1.9ms, cached by player-set.
  The FINAL ranking of surviving candidates uses the full deterministic
  evaluate_roster.star_rating. No Claude/narrative (mode="live"), no NBA.com.

Run:  cd backend && source venv/bin/activate && python scripts/concentration_harness.py
Tune: --restarts 120 --candidates 18 --steps 7 --final 250 --top 50 --seed 0
"""

from __future__ import annotations

import argparse
import os
import random
import sys
import time
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Standard's constraints (rules_json) — the flipped RuleSet plays value currency.
SALARY_CAP = 195_000_000
ROSTER_SIZE = 9
LEGEND_COUNT = 1  # exactly one Legend, as the Cornerstone

# 3&D wings the taxonomy can't fully price (#119 watchlist) + the headline names.
WATCHLIST = [
    "Wembanyama",
    "Paul George",
    "OG Anunoby",
    "Mikal Bridges",
    "Dorian Finney-Smith",
]
THREE_AND_D_WINGS = ["OG Anunoby", "Mikal Bridges", "Dorian Finney-Smith"]


def load_context():
    """Warm the ladder + distributions, build the engine, load the priced pool."""
    from services.players_service import CURRENT_SEASON, DEFAULT_MIN_MPG
    from services.snapshot_versions.value_ladder_cache import ensure_ladder
    from services.snapshot_versions.distribution_cache import ensure_distributions
    from services.evaluation_versions.repo import get_active as get_active_eval_version
    from services.cohesion_engine.engine import CohesionEngine
    import api.players as players_api

    ensure_ladder(CURRENT_SEASON)
    version = get_active_eval_version()
    ensure_distributions(CURRENT_SEASON, version.values)
    engine = CohesionEngine(version)

    actives = players_api._fetch_bulk_players(CURRENT_SEASON, DEFAULT_MIN_MPG)
    legends = players_api._fetch_legends_for_bulk()

    priced_actives = [p for p in actives if p.get("value_price") is not None]
    priced_legends = [p for p in legends if p.get("value_price") is not None]
    dropped = (len(actives) - len(priced_actives)) + (len(legends) - len(priced_legends))
    return engine, priced_actives, priced_legends, dropped


def cost(roster: list[dict[str, Any]]) -> int:
    return sum(p["value_price"] for p in roster)


def ids_of(roster: list[dict[str, Any]]) -> frozenset:
    return frozenset(p["id"] for p in roster)


class ProxyScorer:
    """Starting-lineup score of a roster, cached by player-set (order-independent)."""

    def __init__(self, engine):
        from services.cohesion_engine.cohesion import evaluate_lineup
        from services.cohesion_engine.roster import (
            _normalize_player_skills,
            _sort_players_for_starting_lineup,
        )

        self._engine = engine
        self._evaluate_lineup = evaluate_lineup
        self._normalize = _normalize_player_skills
        self._sort = _sort_players_for_starting_lineup
        self._cache: dict[frozenset, float] = {}
        self.calls = 0

    def score(self, roster: list[dict[str, Any]]) -> float:
        key = ids_of(roster)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        self.calls += 1
        best_five = self._sort(self._normalize(list(roster)))[:5]
        val = self._evaluate_lineup(best_five, self._engine).score
        self._cache[key] = val
        return val


def random_seed_roster(rng, legends, actives) -> list[dict[str, Any]]:
    """A cap-valid seed: one random Legend + eight random actives under the cap."""
    for _ in range(200):
        legend = rng.choice(legends)
        picks = rng.sample(actives, ROSTER_SIZE - LEGEND_COUNT)
        roster = [legend, *picks]
        if cost(roster) <= SALARY_CAP:
            return roster
    # Degenerate fallback: cheapest actives around a cheap legend.
    legend = min(legends, key=lambda p: p["value_price"])
    cheap = sorted(actives, key=lambda p: p["value_price"])[: ROSTER_SIZE - LEGEND_COUNT]
    return [legend, *cheap]


def hill_climb(roster, rng, proxy, legends, actives, candidates, max_steps, record):
    """Greedy single-swap ascent on the proxy, keeping cap + one-Legend valid.

    Slot 0 is the Legend (swapped only against Legends); slots 1..8 are actives.
    Each step tries the single best improving swap across a sampled neighborhood.
    """
    record(roster)
    for _ in range(max_steps):
        base = proxy.score(roster)
        best_gain = 1e-9
        best_roster = None
        current_ids = ids_of(roster)

        # Legend swaps (slot 0): the pool is small, try all of it.
        for cand in legends:
            if cand["id"] in current_ids:
                continue
            new = [cand, *roster[1:]]
            if cost(new) > SALARY_CAP:
                continue
            gain = proxy.score(new) - base
            if gain > best_gain:
                best_gain, best_roster = gain, new

        # Active swaps (slots 1..8): sample candidates to bound the neighborhood.
        cand_actives = rng.sample(actives, min(candidates, len(actives)))
        for i in range(1, ROSTER_SIZE):
            for cand in cand_actives:
                if cand["id"] in current_ids:
                    continue
                new = roster[:i] + [cand] + roster[i + 1 :]
                if cost(new) > SALARY_CAP:
                    continue
                gain = proxy.score(new) - base
                if gain > best_gain:
                    best_gain, best_roster = gain, new

        if best_roster is None:
            break
        roster = best_roster
        record(roster)
    return roster


def rank_final(candidates, engine):
    """Full deterministic evaluate_roster on each candidate; returns (star, roster)."""
    from services.cohesion_engine.roster import evaluate_roster

    ranked = []
    for roster in candidates:
        scored = []
        for i, p in enumerate(roster):
            # Fresh dicts with the constraint flags the full eval expects.
            scored.append({**p, "slot": i + 1, "is_cornerstone": i == 0})
        star = evaluate_roster(scored, engine, mode="live").star_rating
        ranked.append((star, roster))
    ranked.sort(key=lambda t: t[0], reverse=True)
    return ranked


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--restarts", type=int, default=120)
    ap.add_argument("--candidates", type=int, default=18, help="active swaps sampled per slot per step")
    ap.add_argument("--steps", type=int, default=7, help="max greedy steps per restart")
    ap.add_argument("--final", type=int, default=250, help="top proxy candidates re-scored with the full engine")
    ap.add_argument("--top", type=int, default=50, help="top distinct rosters kept for the concentration table")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    t0 = time.time()

    engine, actives, legends, dropped = load_context()
    print(f"Pool: {len(actives)} priced actives + {len(legends)} priced legends "
          f"({dropped} unpriced dropped).  Cap ${SALARY_CAP:,}.  Loaded in {time.time()-t0:.1f}s.")

    proxy = ProxyScorer(engine)
    # Every distinct cap-valid roster visited → its proxy score.
    visited: dict[frozenset, tuple[float, list[dict[str, Any]]]] = {}

    def record(roster):
        if cost(roster) > SALARY_CAP:
            return
        key = ids_of(roster)
        if key not in visited:
            visited[key] = (proxy.score(roster), list(roster))

    t_search = time.time()
    for _ in range(args.restarts):
        seed = random_seed_roster(rng, legends, actives)
        hill_climb(seed, rng, proxy, legends, actives, args.candidates, args.steps, record)
    search_s = time.time() - t_search

    # Top proxy candidates → full deterministic ranking.
    top_by_proxy = sorted(visited.values(), key=lambda t: t[0], reverse=True)[: args.final]
    t_rank = time.time()
    ranked = rank_final([roster for _, roster in top_by_proxy], engine)
    rank_s = time.time() - t_rank

    top = ranked[: args.top]
    print(f"\nSearch: {args.restarts} restarts, {proxy.calls} unique proxy evals, "
          f"{len(visited)} distinct cap-valid rosters visited in {search_s:.1f}s.")
    print(f"Final ranking: full evaluate_roster on {len(top_by_proxy)} candidates in {rank_s:.1f}s.")
    print(f"Kept top {len(top)} distinct rosters by star_rating "
          f"(best {top[0][0]:.2f}, worst {top[-1][0]:.2f}).")

    # --- Concentration: per-player appearance fraction across the top rosters ---
    n = len(top)
    counts: dict[str, int] = {}
    name_by_id: dict[str, str] = {}
    price_by_id: dict[str, int] = {}
    legend_ids = {lg["id"] for lg in legends}
    for _star, roster in top:
        for p in roster:
            counts[p["id"]] = counts.get(p["id"], 0) + 1
            name_by_id[p["id"]] = p["name"]
            price_by_id[p["id"]] = p["value_price"]

    ranked_players = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    max_frac = ranked_players[0][1] / n if ranked_players else 0.0
    # The Legend slot is MANDATORY (one Cornerstone required), so a single best
    # Legend dominating it is structural, not an economy leak. The economy-
    # relevant signal is concentration among the eight ACTIVE slots.
    active_ranked = [(pid, c) for pid, c in ranked_players if pid not in legend_ids]
    max_active_frac = active_ranked[0][1] / n if active_ranked else 0.0

    print(f"\n=== CONCENTRATION over top {n} rosters ===")
    print(f"Max appearance fraction (any): {max_frac:.0%} "
          f"({name_by_id[ranked_players[0][0]]})")
    print(f"Max appearance fraction (ACTIVE — the economy signal): {max_active_frac:.0%} "
          f"({name_by_id[active_ranked[0][0]] if active_ranked else 'n/a'})")
    print(f"\n{'#':>2}  {'player':28} {'appear':>7} {'frac':>6} {'value_price':>13}  kind")
    for i, (pid, c) in enumerate(ranked_players[:10], start=1):
        kind = "LEGEND" if pid in legend_ids else "active"
        print(f"{i:>2}  {name_by_id[pid]:28} {c:>4}/{n:<2} {c/n:>5.0%} "
              f"${price_by_id[pid]:>11,}  {kind}")

    # --- Watchlist: Wemby + the 3&D wings (#119 input) ---
    print("\n=== WATCHLIST (fraction of top rosters) ===")

    def frac_for(substr: str) -> tuple[str, int, int] | None:
        for pid, c in counts.items():
            if substr.lower() in name_by_id[pid].lower():
                return name_by_id[pid], c, price_by_id[pid]
        # Not in any top roster — still report presence in the priced pool.
        for pool in (actives, legends):
            for p in pool:
                if substr.lower() in p["name"].lower():
                    return p["name"], 0, p["value_price"]
        return None

    for name in WATCHLIST:
        hit = frac_for(name)
        if hit is None:
            print(f"  {name:28} not in priced pool")
            continue
        full, c, price = hit
        print(f"  {full:28} {c:>4}/{n:<2} {c/n:>5.0%}   value_price ${price:,}")

    wing_present = [w for w in THREE_AND_D_WINGS if (frac_for(w) or (None, 0, 0))[1] > 0]
    print(f"\n3&D wings appearing in >=1 top roster: "
          f"{', '.join(wing_present) if wing_present else 'none'}")
    print(f"\nTotal runtime: {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
