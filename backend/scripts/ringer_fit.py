"""scripts/ringer_fit.py — the Ringer 100 fit harness (#119 plan, M4.5-M4.7).

Measures the #119 pass line (D1) against The Ringer's final 2025-26 Top 100:

  A. the three anchors land within +/-15 of their Ringer rank
     (OG Anunoby 21, Scottie Barnes 17, Evan Mobley 24);
  B. all 10 of the Ringer top 10 land inside our top 15
     (the #108 floor of 8/10 prints for information only);
  C. every gated 3-and-D player is priced at 0.80 or more of the ladder price
     at his Ringer rank (default c.8). ``peer_ratio``, the research's second
     reading, prints for information only and never gates.

STRICTLY READ-ONLY, by construction:

  - refuses a SUPABASE_URL containing ``.supabase.co`` (the production cloud
    project) unless ``--allow-prod``, which nothing in the plan passes;
  - wraps the shared client so only ``table(...).select(...)`` gets through,
    and blocks ``create_client`` so a reconnect cannot build an unguarded one;
  - never imports ``players_service`` or ``notability`` — the notability path
    inserts career rows, which is how a "read-only" script wrote to dev on
    2026-09-21 — and never calls NBA.com.

``measure()`` is pure and holds every number: no database, no network, no
module-level DB import (they all live inside ``main()``), so the test suite
drives it on a synthetic pool with the real-DB guard on.

Run (from backend/, venv active):
    python scripts/ringer_fit.py
    python scripts/ringer_fit.py --patch '{"normalization_legend_clip_axes":["perimeter_defense","interior_defense"]}'
    python scripts/ringer_fit.py --out ../.tasks/119-3d-archetypes/ringer-fit-baseline.json
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import urllib.request
from pathlib import Path
from typing import Any, Mapping, Sequence

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

RINGER_FILE = BACKEND_DIR / "scripts" / "ringer100.json"
SEASON = "2025-26"
DEV_URL = "https://cornerstone-dev.hestia.chrooks.com"

# --- the pass line (D1) ----------------------------------------------------
ANCHORS = ("OG Anunoby", "Scottie Barnes", "Evan Mobley")
ANCHOR_TOLERANCE = 15
TOP10_INSIDE = 15  # the Ringer top 10 must land inside our top 15
TOP10_FLOOR = 8  # #108's floor — information only
PRICE_BAR = 0.80

# Gated set for clause C (default c.8). It goes past wings: 3-and-D guards and
# bigs (Mobley, Holiday, White, Daniels) are gated too.
GATED = (
    "OG Anunoby", "Scottie Barnes", "Evan Mobley", "Mikal Bridges",
    "Derrick White", "Jaden McDaniels", "Dillon Brooks", "Alex Caruso",
    "Jrue Holiday", "Dyson Daniels", "Amen Thompson", "Ausar Thompson",
)
# Printed with a ratio, but never gating (default c.8).
REPORTED = (
    "Trey Murphy III", "Desmond Bane", "Nickeil Alexander-Walker",
    "Toumani Camara", "Cam Johnson", "Jalen Suggs",
)

# peer_ratio's pool (the research's second reading): actives off rookie deals.
PEER_MIN_AGE = 25
PEER_MIN_SALARY = 16_000_000
PEER_N = 10

PARITY_TOLERANCE = 10_000  # $0.01M

# #152's split keys. A release published before the split carries only the old
# folded `perimeter_disruptor`, and with_legacy_skill_keys then routes every
# profile down the pre-split fallback — so such a run reproduces the pre-split
# numbers by arithmetic, and says nothing about the split's own weighting.
SPLIT_KEYS = ("point_of_attack_defender", "off_ball_disruptor")


# ---------------------------------------------------------------------------
# Pure metrics
# ---------------------------------------------------------------------------


def _average_ranks(values: Sequence[float]) -> list[float]:
    """Ranks 1..n; tied values share the average of the ranks they span."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        shared = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1
    return ranks


def spearman(xs: Sequence[float], ys: Sequence[float]) -> float:
    """Spearman's rho: Pearson correlation of the two average-rank lists.

    The d-squared shortcut is only correct without ties; this form is correct
    either way, which matters because our `overall` can tie.
    """
    rx, ry = _average_ranks(xs), _average_ranks(ys)
    n = len(rx)
    if n < 2:
        return 0.0
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = (sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry)) ** 0.5
    return num / den if den else 0.0


def _peer_ratio(
    pid: str,
    price: int,
    prices: Mapping[str, int],
    salary_by_id: Mapping[str, int],
    age_by_id: Mapping[str, Any],
) -> float | None:
    """price / the median price of the PEER_N actives nearest him in real salary.

    The pool is players off rookie deals (age 25+ or salary $16M+) — the
    research's second reading of "players of equal consensus standing".
    Information only; it never gates.
    """
    mine = salary_by_id.get(pid)
    if not mine:
        return None
    pool = [
        p for p, sal in salary_by_id.items()
        if p != pid and sal and p in prices
        and ((age_by_id.get(p) or 0) >= PEER_MIN_AGE or sal >= PEER_MIN_SALARY)
    ]
    if not pool:
        return None
    nearest = sorted(pool, key=lambda p: abs(salary_by_id[p] - mine))[:PEER_N]
    median = statistics.median(prices[p] for p in nearest)
    return round(price / median, 3) if median else None


def split_coverage(snapshots: Sequence[Mapping[str, Any]] | Any) -> dict:
    """How many released profiles carry each of #152's split Skill keys.

    A run over a release that carries neither key cannot detect an M3 split
    bug: every profile falls back to the folded pre-split expression, so it
    reproduces the old numbers whatever the split weights say. Pure.
    """
    total = 0
    counts = {key: 0 for key in SPLIT_KEYS}
    for snapshot in snapshots:
        total += 1
        for key in SPLIT_KEYS:
            if key in (snapshot or {}):
                counts[key] += 1
    return {
        "total": total,
        "counts": counts,
        "exercises_split": all(counts.values()),
    }


def measure(
    active_overalls: Mapping[str, float],
    prices: Mapping[str, int],
    ringer_rows: Sequence[Mapping[str, Any]],
    pid_by_nba: Mapping[str, str],
    wings: Sequence[str],
    *,
    reported: Sequence[str] = (),
    salary_by_id: Mapping[str, int] | None = None,
    age_by_id: Mapping[str, Any] | None = None,
) -> dict:
    """The whole #119 pass line, from an already-priced pool. No I/O.

    ``active_overalls`` and ``prices`` are the production numbers, keyed by
    players.id; ``ringer_rows`` are ringer100.json's rows; ``pid_by_nba`` maps
    str(nba_api_id) to players.id; ``wings`` names the gated set for clause C.

    A Ringer player the pool cannot see is listed in ``missing``, never raised —
    but a missing anchor or a missing gated wing still fails its own clause.
    """
    order = sorted(active_overalls, key=lambda pid: active_overalls[pid], reverse=True)
    our_rank = {pid: i + 1 for i, pid in enumerate(order)}

    found: list[tuple[dict, str]] = []
    missing: list[dict] = []
    for row in ringer_rows:
        pid = pid_by_nba.get(str(row["nba_api_id"]))
        if pid is None or pid not in our_rank:
            missing.append({
                "rank": row["rank"],
                "name": row["name"],
                "nba_api_id": str(row["nba_api_id"]),
            })
            continue
        found.append((dict(row), pid))

    rank_by_name = {row["name"]: our_rank[pid] for row, pid in found}
    pid_by_name = {row["name"]: pid for row, pid in found}
    ringer_by_name = {row["name"]: row["rank"] for row, pid in found}

    # --- clause A: the three anchors -------------------------------------
    ringer_rank_of = {row["name"]: row["rank"] for row in ringer_rows}
    anchors: dict[str, dict] = {}
    for name in ANCHORS:
        target = ringer_rank_of.get(name)
        ours = rank_by_name.get(name)
        anchors[name] = {
            "ringer": target,
            "ours": ours,
            "low": max(1, target - ANCHOR_TOLERANCE) if target else None,
            "high": target + ANCHOR_TOLERANCE if target else None,
            "ok": bool(target and ours and abs(ours - target) <= ANCHOR_TOLERANCE),
        }

    # --- clause B: the Ringer top 10 --------------------------------------
    top10 = [(row, pid) for row, pid in found if row["rank"] <= 10]
    top10_in_top15 = sum(1 for row, pid in top10 if our_rank[pid] <= TOP10_INSIDE)

    # --- clause C: the ladder price at his Ringer rank --------------------
    # prices ARE the pool's real salaries, rank-paired (value_price.build_ladder),
    # so the salary ladder is just the price list sorted high to low.
    sals_desc = sorted(prices.values(), reverse=True)
    wing_ratios: dict[str, dict] = {}
    for name in list(wings) + [n for n in reported if n not in wings]:
        pid = pid_by_name.get(name)
        if pid is None or pid not in prices:
            continue
        ringer = ringer_by_name[name]
        # ponytail: a Ringer rank past the end of the pool takes the last rung.
        # The real pool is 401 actives against 100 ranks, so only tests hit it.
        ladder_price = sals_desc[min(ringer - 1, len(sals_desc) - 1)]
        price = prices[pid]
        # Gate on the exact quotient; round only for the printed table, or a
        # 0.7996 would pass the 0.80 money bar on a display artefact.
        exact = price / ladder_price if ladder_price else None
        ratio = round(exact, 3) if exact is not None else None
        is_gated = name in wings
        wing_ratios[name] = {
            "ringer": ringer,
            "ours": our_rank[pid],
            "price": price,
            "ladder_price": ladder_price,
            "price_ratio": ratio,
            "peer_ratio": (
                _peer_ratio(pid, price, prices, salary_by_id, age_by_id)
                if salary_by_id is not None and age_by_id is not None
                else None
            ),
            "gated": is_gated,
            "ok": (not is_gated) or (exact is not None and exact >= PRICE_BAR),
        }

    # --- fit over the whole list, and over the holdout --------------------
    ringer_ranks = [row["rank"] for row, _ in found]
    ours_ranks = [our_rank[pid] for _, pid in found]
    errors = [abs(a - b) for a, b in zip(ringer_ranks, ours_ranks)]

    holdout = [
        (row, pid) for row, pid in found
        if row["rank"] > 10 and row["name"] not in ANCHORS
    ]
    h_ringer = [row["rank"] for row, _ in holdout]
    h_ours = [our_rank[pid] for _, pid in holdout]
    h_errors = [abs(a - b) for a, b in zip(h_ringer, h_ours)]

    gated_ok = all(r["ok"] for r in wing_ratios.values() if r["gated"])
    gated_present = {n for n, r in wing_ratios.items() if r["gated"]}
    missing_gated = [n for n in wings if n not in gated_present]

    return {
        "found": len(found),
        "anchors": anchors,
        "top10_in_top15": top10_in_top15,
        "top10_found": len(top10),
        "top10_floor_8": top10_in_top15 >= TOP10_FLOOR,
        "wing_ratios": wing_ratios,
        "missing_gated": missing_gated,
        "spearman100": round(spearman(ringer_ranks, ours_ranks), 3) if found else 0.0,
        "within15": sum(1 for e in errors if e <= 15),
        "median_abs_error": statistics.median(errors) if errors else None,
        "holdout": {
            "n": len(holdout),
            "names": [row["name"] for row, _ in holdout],
            "spearman": round(spearman(h_ringer, h_ours), 3) if holdout else 0.0,
            "within15": sum(1 for e in h_errors if e <= 15),
            "median_abs_error": statistics.median(h_errors) if h_errors else None,
        },
        "missing": missing,
        "passes": (
            all(a["ok"] for a in anchors.values())
            and top10_in_top15 == 10
            and gated_ok
            and not missing_gated
        ),
    }


def format_report(result: Mapping[str, Any]) -> str:
    """The printed table. Pure — the same lines the --out JSON carries."""
    lines: list[str] = []
    width = max(len(n) for n in ANCHORS)
    for name, a in result["anchors"].items():
        # Both sides format as str: an anchor the Ringer file does not carry
        # has ringer None, and format(None, '>3') raises.
        ours = a["ours"] if a["ours"] is not None else "missing"
        ringer = a["ringer"] if a["ringer"] is not None else "missing"
        verdict = "ok  " if a["ok"] else "FAIL"
        lines.append(
            f"  {name:<{width}}  ringer {str(ringer):>7}  ours {str(ours):>7}  "
            f"{verdict} (band {a['low']}-{a['high']})"
        )
    lines.append(
        f"  Ringer top 10 inside our top {TOP10_INSIDE}: "
        f"{result['top10_in_top15']}/{result['top10_found']}"
        f"   (#108 floor {TOP10_FLOOR}/10: {'ok' if result['top10_floor_8'] else 'FAIL'})"
    )
    mae = result["median_abs_error"]
    lines.append(
        f"  spearman100 {result['spearman100']}   within +/-15: "
        f"{result['within15']}/{result['found']}   median abs error "
        f"{mae if mae is not None else '-'}"
    )
    h = result["holdout"]
    lines.append(
        f"  holdout ({h['n']}): spearman {h['spearman']}   within +/-15: "
        f"{h['within15']}/{h['n']}   median abs error "
        f"{h['median_abs_error'] if h['median_abs_error'] is not None else '-'}"
    )

    gated = [(n, r) for n, r in result["wing_ratios"].items() if r["gated"]]
    lines.append(f"  price check C (ladder price at Ringer rank, bar {PRICE_BAR:.2f}):")
    for name, r in sorted(gated, key=lambda t: t[1]["price_ratio"] or 0):
        peer = f"  peer {r['peer_ratio']}" if r["peer_ratio"] is not None else ""
        lines.append(
            f"      {name:<24} ringer {r['ringer']:>3}  ours {r['ours']:>3}  "
            f"${r['price'] / 1e6:>5.1f}M / ${r['ladder_price'] / 1e6:>5.1f}M = "
            f"{r['price_ratio']}  {'ok' if r['ok'] else 'FAIL'}{peer}"
        )
    info = [(n, r) for n, r in result["wing_ratios"].items() if not r["gated"]]
    if info:
        lines.append("  reported, not gated: " + ", ".join(
            f"{n} {r['price_ratio']}" for n, r in info
        ))
    if result["missing_gated"]:
        lines.append("  gated players MISSING from the pool: "
                     + ", ".join(result["missing_gated"]))
    if result["missing"]:
        lines.append("  Ringer players missing from the pool: " + ", ".join(
            f"{m['name']} (#{m['rank']})" for m in result["missing"]
        ))
    cov = result.get("split_coverage")
    if cov and not cov["exercises_split"]:
        counts = ", ".join(f"{k} {v}/{cov['total']}" for k, v in cov["counts"].items())
        lines.append(f"  #152 split keys in this release: {counts}")
        lines.append("      -> this run does not exercise the split weighting; "
                     "reproducing the pre-split numbers is forced, not evidence")
    seasons = result.get("season_coverage")
    if seasons:
        stored = ", ".join(f"{s} {n}" for s, n in seasons["rows_by_season"].items())
        lines.append(f"  #164 what these ratings can see: player_stats rows by season: {stored}")
        lines.append(f"      -> regular season only (no postseason anywhere in the pipeline), and "
                     f"history.py blends {seasons['blend_seasons']} of 3 weighted seasons")
        if seasons["blend_seasons"] < 2:
            lines.append("      -> the 3-season blend redistributes 100% onto one season, so every "
                         "rating below is ONE regular season. The Ringer ranks partly on playoffs "
                         "this engine cannot see: do not tune the gap away.")
    lines.append(f"  #119 pass line: {'PASS' if result['passes'] else 'FAIL'}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# main() — everything that touches the database or the network lives here
# ---------------------------------------------------------------------------


def _read_only_client(allow_prod: bool):
    """The shared Supabase client, wrapped so only selects get through.

    Installed as the singleton too, so library code calling get_supabase()
    directly gets the guarded one, and a run_query reconnect fails loudly
    instead of building an unguarded client.
    """
    import services.supabase_client as sc
    from scripts.dev_checks import ReadOnlyClient, ReadOnlyViolation

    url = os.environ.get("SUPABASE_URL", "")
    if ".supabase.co" in url and not allow_prod:
        sys.exit(
            f"refusing SUPABASE_URL {url}: *.supabase.co is the production "
            "project; this harness is dev-only (pass --allow-prod to override)"
        )

    def _refuse(*_a, **_k):
        raise ReadOnlyViolation("create_client blocked: read-only harness")

    guarded = ReadOnlyClient(sc.get_supabase())
    sc._client = guarded
    sc.create_client = _refuse
    return guarded


def _parity_check(prices: Mapping[str, int], ringer_pids: Mapping[str, str]) -> dict:
    """Compare every Ringer player's price with the live dev API's value_price.

    After M4.3 an in-process comparison against build_ladder_from_release would
    compare a function with itself, so the yardstick is the Surface the Lab
    actually serves.
    """
    url = f"{DEV_URL}/api/players/bulk?include_legends=true"
    with urllib.request.urlopen(url, timeout=120) as fh:
        payload = json.load(fh)
    api_price = {
        row["id"]: row.get("value_price")
        for row in payload.get("data") or []
        if not row.get("is_legend")
    }
    mismatches, absent, compared = [], [], []
    for name, pid in ringer_pids.items():
        ours = prices.get(pid)
        theirs = api_price.get(pid)
        if ours is None:
            # Not priced here (excluded from the snapshot) — compared against
            # nothing, so it counts in neither `checked` nor a mismatch.
            continue
        if theirs is None:
            absent.append(name)  # below the bulk endpoint's 15-mpg floor
            continue
        compared.append(name)
        if abs(theirs - ours) > PARITY_TOLERANCE:
            mismatches.append({"name": name, "ours": ours, "api": theirs})
    return {
        "checked": len(compared),
        "absent_from_bulk": absent,
        "mismatches": mismatches,
        "ok": not mismatches,
    }


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="ringer_fit.py",
        description="Measure the #119 pass line against The Ringer's Top 100 (read-only).",
    )
    ap.add_argument(
        "--patch",
        help="JSON merged into the active Evaluation Version's values, IN MEMORY "
             "ONLY (nothing is written). Shallow merge at the top level.",
    )
    ap.add_argument("--out", help="write the full result as JSON to this path")
    ap.add_argument(
        "--allow-prod", action="store_true",
        help="permit a *.supabase.co SUPABASE_URL (the plan never passes this)",
    )
    ap.add_argument(
        "--no-parity", action="store_true",
        help="skip the live dev API parity check (it is skipped with --patch anyway)",
    )
    args = ap.parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv(BACKEND_DIR / ".env")
    client = _read_only_client(args.allow_prod)

    from scripts.dev_checks import pages
    from services.cohesion_engine import composites, value_price
    from services.evaluation_versions.repo import get_active
    from services.snapshot_versions.active import get_active_release_id
    from services.snapshot_versions.value_ladder_cache import release_overalls

    version = get_active()
    values = dict(version.values)
    if args.patch:
        patch = json.loads(args.patch)
        if not isinstance(patch, dict):
            sys.exit("--patch must be a JSON object")
        values.update(patch)  # in memory only — nothing is written back

    release_id = get_active_release_id(client)
    distributions = composites.build_distributions(SEASON, values, release_id)
    active_overalls, active_salaries, legend_overalls = release_overalls(
        SEASON, values, release_id, distributions
    )
    ladder = value_price.build_ladder(active_overalls, active_salaries, legend_overalls)

    # Ringer rows join on nba_api_id. Page the players read (PostgREST caps at
    # 1,000) rather than sending 401 ids through .in_().
    pid_by_nba: dict[str, str] = {}
    salary_by_id: dict[str, int] = {}
    age_by_id: dict[str, Any] = {}
    for row in pages(
        lambda: client.table("players")
        .select("id, nba_api_id, salary, age")
        .eq("season", SEASON)
        .order("id")
    ):
        if row.get("nba_api_id") is not None:
            pid_by_nba[str(row["nba_api_id"])] = row["id"]
        if row.get("salary"):
            salary_by_id[row["id"]] = int(row["salary"])
        age_by_id[row["id"]] = row.get("age")

    ringer_rows = json.loads(RINGER_FILE.read_text())["players"]
    result = measure(
        active_overalls, ladder.active_prices, ringer_rows, pid_by_nba, GATED,
        reported=REPORTED, salary_by_id=salary_by_id, age_by_id=age_by_id,
    )
    result["evaluation_version"] = version.slug
    result["release_id"] = release_id
    result["patch"] = args.patch
    result["pool"] = len(active_overalls)
    result["split_coverage"] = split_coverage(
        row.get("skill_profile_snapshot") or {}
        for row in pages(
            lambda: client.table("released_players")
            .select("skill_profile_snapshot")
            .eq("snapshot_release_id", release_id)
            .order("id")
        )
    )

    # #164: what these ratings can actually see. Counted here rather than
    # trusted from a document, because the answer changes the moment someone
    # backfills a season and nobody re-reads the document.
    rows_by_season: dict[str, int] = {}
    for row in pages(
        lambda: client.table("player_stats").select("season").order("id")
    ):
        season_key = row.get("season") or "unknown"
        rows_by_season[season_key] = rows_by_season.get(season_key, 0) + 1
    from services.skill_engine import history as _history

    result["season_coverage"] = {
        "rows_by_season": dict(sorted(rows_by_season.items())),
        "blend_seasons": sum(
            1 for s in _history._HISTORY_WEIGHTS if rows_by_season.get(s)
        ),
    }

    print(f"Evaluation Version {version.slug}  release {release_id}  "
          f"pool {len(active_overalls)} actives, {len(legend_overalls)} legends")
    if args.patch:
        print(f"patch (in memory only): {args.patch}")
    print(format_report(result))

    # Parity against the Surface the Lab serves — only meaningful unpatched.
    if args.patch or args.no_parity:
        result["parity"] = None
        print("  API parity: skipped" + (" (--patch)" if args.patch else ""))
    else:
        ringer_pids = {
            row["name"]: pid_by_nba[str(row["nba_api_id"])]
            for row in ringer_rows
            if str(row["nba_api_id"]) in pid_by_nba
        }
        parity = _parity_check(ladder.active_prices, ringer_pids)
        result["parity"] = parity
        if parity["ok"]:
            print(f"  API parity: ok ({parity['checked']} Ringer players match the dev API)")
        else:
            first = parity["mismatches"][0]
            print(f"  API parity: FAIL — {first['name']} ours ${first['ours'] / 1e6:.2f}M "
                  f"vs API ${first['api'] / 1e6:.2f}M "
                  f"({len(parity['mismatches'])} mismatches)")
        if parity["absent_from_bulk"]:
            print("  API parity: not served by /players/bulk (under the 15-mpg floor): "
                  + ", ".join(parity["absent_from_bulk"]))

    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
        print(f"  wrote {args.out}")

    if result.get("parity") and not result["parity"]["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
