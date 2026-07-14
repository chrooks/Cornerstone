"""
One-shot script (#113): give high-usage creation engines a steady_hand tier floor above `None`.

The bug
-------
`steady_hand`'s lowest positive tier, Capable, gates on
`tov_pct <= 0.146 AND tov_per_touch <= 0.045`. That second cutoff bisects the
elite-creator cluster, and there is no tier below Capable — so a miss lands on
`None`, which the composite layer scores 0.0 ("worst ball-handler in the NBA").

Three of the league's highest-load engines fail by a rounding error:

    Giannis   tov_per_touch 0.0451   misses by 0.0001
    Luka      tov_per_touch 0.0456   misses by 0.0006
    Harden    tov_per_touch 0.0456   misses by 0.0006

An `ast_to_ratio >= 2.75` bump already rescues high-turnover *passers* (Jokic,
Trae). It cannot rescue high-turnover *scorers*, whose assist ratios are lower
by role, not by carelessness.

The fix
-------
Add a load-aware relief bump: turnovers are the cost of creation, so a player
ending 27%+ of his team's possessions earns Capable rather than the floor —
provided he is not actually careless (`tov_pct <= 0.16`).

    usage_rate >= 0.27  AND  tov_pct <= 0.16   ->  bump_up_one_tier (max: Capable)

`max_tier: Capable` means this only ever lifts None -> Capable. A player already
at Capable is not promoted (the evaluator's ceiling check skips the bump).

Both constants are role Boundaries, not curve-fits: 27% usage is unambiguously
"primary engine" (~30-40 players league-wide), and 0.16 tov_pct is careless even
for a hub.

Writes through the same path as the calibration API's `?force=true` route —
validate, upsert `draft_skill_thresholds`, bust the threshold cache, record an
audit `pipeline_run`. Never a SQL migration (thresholds are JSONB, per CLAUDE.md).

Idempotent: re-running is a no-op once the bump is present.

Usage:
    cd backend && source venv/bin/activate
    python scripts/retune_steady_hand_thresholds.py [--apply]

Without --apply it is a dry run: prints the league-wide before/after tier
distribution and every player the bump rescues, and writes nothing.

NOTE: this changes the *rules* only. Stored Skill Profiles are not rewritten
until the pipeline re-evaluates, and the composites will not see the new tiers
until a Snapshot Release is published.
"""

from __future__ import annotations

import copy
import os
import sys
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api.calibration import _validate_threshold_rule  # noqa: E402
from services.skill_engine.cache import (  # noqa: E402
    get_league_averages,
    get_thresholds,
)
from services.skill_engine.evaluator import evaluate_skill  # noqa: E402
from services.supabase_client import get_supabase  # noqa: E402

SKILL = "steady_hand"
SEASON = "2025-26"

# A player ending >=27% of his team's possessions is a primary creation engine;
# turnovers are the cost of that job. Above 0.16 tov_pct he is careless anyway.
MIN_ENGINE_USAGE_RATE = 0.27
MAX_ENGINE_TOV_PCT = 0.16

RELIEF_BUMP = {
    "effect": "bump_up_one_tier",
    "max_tier": "Capable",
    "condition": {
        "logic": "AND",
        "conditions": [
            {"stat": "advanced.usage_rate", "value": MIN_ENGINE_USAGE_RATE, "operator": ">="},
            {"stat": "computed.tov_pct", "value": MAX_ENGINE_TOV_PCT, "operator": "<="},
        ],
    },
}

TIERS = ["Elite", "Proficient", "Capable", "None"]


def _with_relief_bump(rule: dict) -> dict:
    """Return a copy of the rule with the relief bump appended (never mutates)."""
    patched = copy.deepcopy(rule)
    patched.setdefault("tier_bumps", []).append(copy.deepcopy(RELIEF_BUMP))
    return patched


def _has_relief_bump(rule: dict) -> bool:
    return any(b == RELIEF_BUMP for b in rule.get("tier_bumps", []))


def _tiers_for_league(rule: dict, players: list[tuple[str, dict]], avgs: dict) -> dict[str, str]:
    return {
        name: evaluate_skill(SKILL, rule, stats, avgs).get("tier")
        for name, stats in players
    }


def _fmt(dist: Counter, total: int) -> str:
    body = "  ".join(f"{t}={dist.get(t, 0)}" for t in TIERS)
    return f"{body}   (None = {100 * dist.get('None', 0) / total:.0f}%)"


def main() -> None:
    apply = "--apply" in sys.argv
    supabase = get_supabase()

    current = get_thresholds(supabase)[SKILL]
    if _has_relief_bump(current):
        print("Relief bump already present — nothing to do.")
        return

    patched = _with_relief_bump(current)

    error = _validate_threshold_rule(patched)
    if error:
        print(f"ERROR: patched rule failed validation: {error}")
        sys.exit(1)

    # --- Simulate league-wide before committing ---------------------------------
    avgs = get_league_averages(SEASON, supabase)
    names = {p["id"]: p["name"] for p in supabase.table("players").select("id,name").execute().data}
    rows = (
        supabase.table("player_stats")
        .select("player_id,stats")
        .eq("season", SEASON)
        .execute()
        .data
    )
    players = [
        (names.get(r["player_id"], "?"), r["stats"])
        for r in rows
        if (r["stats"].get("tracking_possessions") or {}).get("touches")
    ]

    before = _tiers_for_league(current, players, avgs)
    after = _tiers_for_league(patched, players, avgs)
    # player_stats carries several rows per player; the tier maps are keyed by
    # player, so count distinct players — not rows — or the percentages lie.
    total = len(before)

    print(f"steady_hand tiers across {total} players with tracking data\n")
    print(f"  before:  {_fmt(Counter(before.values()), total)}")
    print(f"  after:   {_fmt(Counter(after.values()), total)}\n")

    rescued = sorted(n for n in before if before[n] == "None" and after[n] != "None")
    print(f"  rescued from None -> Capable ({len(rescued)}):")
    for name in rescued:
        print(f"    {name}")

    # The bump must only ever lift None -> Capable. Nothing else may move.
    moved = {n for n in before if before[n] != after[n]}
    assert moved == set(rescued), f"bump moved players it should not have: {moved - set(rescued)}"
    assert all(after[n] == "Capable" for n in rescued), "bump promoted past Capable"
    assert all(
        before[n] == after[n] for n in before if before[n] != "None"
    ), "bump disturbed a player who already had a positive tier"

    if not apply:
        print("\nDry run — nothing written. Re-run with --apply to persist.")
        return

    supabase.table("draft_skill_thresholds").upsert(
        {"skill_name": SKILL, "thresholds": patched},
        on_conflict="skill_name",
    ).execute()
    get_thresholds(supabase, refresh=True)

    try:
        from services.pipeline_runs import repo as runs_repo
        from services.pipeline_runs.repo import ThresholdEditParams

        runs_repo.record_force_audit(
            pipeline_name="threshold_edit",
            params=asdict(ThresholdEditParams(skill_name=SKILL, thresholds=patched)),
            snapshot_release_id=None,
        )
    except Exception as exc:  # audit failure is non-fatal — the write already landed
        print(f"WARNING: audit pipeline_run not recorded: {exc}")

    print("\nApplied. draft_skill_thresholds updated and threshold cache busted.")
    print("Stored Skill Profiles still carry the old tiers — re-run the pipeline,")
    print("then publish a Snapshot Release for the composites to pick this up.")


if __name__ == "__main__":
    main()
