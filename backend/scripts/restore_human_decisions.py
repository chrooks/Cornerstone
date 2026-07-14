"""
scripts/restore_human_decisions.py — surgically restore a human decision that a
threshold_edit recompute_commit run (#120's disease) silently clobbered back to
`stats_only`, found by scripts/audit_recompute_losses.py --draft.

Generalized from the one-off `restore_rebounder_decisions.py` (issue #121, the
12 rebounder losses) to take `--skill` / `--players` / `--source-release`, so
the same surgical-write discipline covers any future loss (e.g. #122's LeBron
James spot_up_shooter loss) without a new script per skill.

Default args (no flags) reproduce the original #121 rebounder restoration
exactly, for reproducibility:
  --skill rebounder
  --players "Josh Hart,Evan Mobley,Kenrich Williams,Steven Adams,Stephen Curry,
             Jayson Tatum,Jalen Smith,Kevin Love,Luke Kornet,Joel Embiid,
             Russell Westbrook,Jalen Johnson"
  --source-release "Finals Refresh"

Source of truth for the restored value: the named published release — the
last release that carried the correct human decision before a recompute
clobbered it (confirmed by scripts/audit_recompute_losses.py's Method B).

Safety: never guesses. A player is skipped and reported "needs human" when:
  - the players table doesn't resolve to exactly one row for their name,
  - the source release has no entry for them for this skill, or that entry's
    source isn't resolved/manual_override (unexpected — would mean the source
    release itself wasn't clean),
  - no current draft composite profile exists, or
  - the CURRENT draft entry is ALREADY a human decision (resolved /
    manual_override) that disagrees with the source release — someone
    re-decided it since; restoring over that would be the same silent-
    overwrite bug this script exists to fix.

Modes:
    python scripts/restore_human_decisions.py [--skill S --players "A,B"]         # dry run (default)
    python scripts/restore_human_decisions.py [...] --apply                       # write + verify
    python scripts/restore_human_decisions.py [...] --verify-guard                # guarded-recompute
                                                                                      dry-run evidence;
                                                                                      read-only, run
                                                                                      after --apply

--verify-guard drives services.skill_engine.evaluation_only._merge_composite_for_skills
directly, in-memory, against real current thresholds — the same function every
recompute_composite=True call site routes through. It never creates a
pipeline_runs row and never writes to the database.

Writes (--apply only): exactly one JSONB field — the skill's key inside each
named player's draft_skill_profiles.profile (source='composite',
season='2025-26'). Nothing else in the profile is touched. No other skill, no
released table, no publish.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services.supabase_client import get_supabase, run_query  # noqa: E402

SEASON = "2025-26"
_HUMAN_SOURCES = ("resolved", "manual_override")
_PAGE = 1000  # PostgREST's per-request row cap — every read below pages past it.

# Defaults reproduce the original #121 rebounder restoration verbatim.
DEFAULT_SKILL = "rebounder"
DEFAULT_SOURCE_RELEASE = "Finals Refresh"
DEFAULT_PLAYERS = [
    "Josh Hart", "Evan Mobley", "Kenrich Williams", "Steven Adams", "Stephen Curry",
    "Jayson Tatum", "Jalen Smith", "Kevin Love", "Luke Kornet", "Joel Embiid",
    "Russell Westbrook", "Jalen Johnson",
]


def _paginate(build_query) -> list[dict]:
    """build_query() returns a fresh, unexecuted query builder each call."""
    rows: list[dict] = []
    offset = 0
    while True:
        page = run_query(
            lambda o=offset: build_query().range(o, o + _PAGE - 1).execute()
        ).data or []
        rows.extend(page)
        if len(page) < _PAGE:
            break
        offset += _PAGE
    return rows


# ---------------------------------------------------------------------------
# Fetchers (all read-only)
# ---------------------------------------------------------------------------


def _find_source_release(client, label: str) -> dict:
    releases = _paginate(
        lambda: client.table("snapshot_releases")
        .select("id, label, status, published_at")
        .eq("label", label)
        .order("published_at")
    )
    published = [r for r in releases if r["status"] == "published"]
    if not published:
        raise RuntimeError(f"No published release labeled {label!r} found")
    if len(published) > 1:
        raise RuntimeError(f"Multiple published releases labeled {label!r} — ambiguous")
    return published[0]


def _fetch_player_ids_by_name(client, players: list[str]) -> dict[str, list[str]]:
    """name -> [player_id, ...] — a list so ambiguous names are visible, not silently picked."""
    rows = _paginate(
        lambda: client.table("players").select("id, name").in_("name", players).order("id")
    )
    by_name: dict[str, list[str]] = {}
    for r in rows:
        by_name.setdefault(r["name"], []).append(r["id"])
    return by_name


def _fetch_source_entries(client, release_id: str, skill: str, player_ids: list[str]) -> dict[str, dict]:
    """source_player_id -> full skill entry, copied verbatim from the frozen snapshot."""
    rows = _paginate(
        lambda: client.table("released_players")
        .select("source_player_id, is_legend, skill_profile_snapshot")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", False)
        .in_("source_player_id", player_ids)
        .order("source_player_id")
    )
    result: dict[str, dict] = {}
    for r in rows:
        pid = r.get("source_player_id")
        entry = (r.get("skill_profile_snapshot") or {}).get(skill)
        if pid and isinstance(entry, dict):
            result[pid] = entry
    return result


def _fetch_draft_composites(client, player_ids: list[str]) -> dict[str, dict]:
    """player_id -> draft_skill_profiles row (id, player_id, profile)."""
    rows = _paginate(
        lambda: client.table("draft_skill_profiles")
        .select("id, player_id, profile")
        .eq("source", "composite")
        .eq("season", SEASON)
        .in_("player_id", player_ids)
        .order("player_id")
    )
    return {r["player_id"]: r for r in rows}


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------


def build_plan(client, skill: str, players: list[str], source_label: str) -> tuple[list[dict], list[dict]]:
    """Returns (restorable, needs_human)."""
    source_release = _find_source_release(client, source_label)
    print(f"Source release {source_label!r}: {source_release['id']} (published {source_release['published_at']})\n")

    name_to_ids = _fetch_player_ids_by_name(client, players)

    restorable: list[dict] = []
    needs_human: list[dict] = []
    resolved_ids: list[str] = []
    id_to_name: dict[str, str] = {}

    for name in players:
        ids = name_to_ids.get(name, [])
        if len(ids) != 1:
            needs_human.append({"name": name, "reason": f"expected exactly 1 players row, found {len(ids)}: {ids}"})
            continue
        resolved_ids.append(ids[0])
        id_to_name[ids[0]] = name

    source_entries = _fetch_source_entries(client, source_release["id"], skill, resolved_ids)
    draft_rows = _fetch_draft_composites(client, resolved_ids)

    for player_id in resolved_ids:
        name = id_to_name[player_id]

        source_entry = source_entries.get(player_id)
        if source_entry is None:
            needs_human.append({"name": name, "player_id": player_id,
                                 "reason": f"no {skill} entry in {source_label!r} snapshot"})
            continue
        if source_entry.get("source") not in _HUMAN_SOURCES:
            needs_human.append({
                "name": name, "player_id": player_id,
                "reason": f"{source_label!r} entry source={source_entry.get('source')!r} — not a human decision",
            })
            continue

        draft_row = draft_rows.get(player_id)
        if draft_row is None:
            needs_human.append({"name": name, "player_id": player_id,
                                 "reason": "no draft composite profile found"})
            continue

        current_entry = (draft_row.get("profile") or {}).get(skill)

        if current_entry == source_entry:
            restorable.append({
                "name": name, "player_id": player_id, "profile_id": draft_row["id"],
                "before": current_entry, "after": source_entry, "noop": True,
            })
            continue

        if isinstance(current_entry, dict) and current_entry.get("source") in _HUMAN_SOURCES:
            # The draft already carries a human decision that disagrees with the
            # source release — someone re-decided it since. Do not guess;
            # overwriting this would be exactly the bug this script exists to fix.
            needs_human.append({
                "name": name, "player_id": player_id,
                "reason": (
                    f"draft already has a human decision (source={current_entry.get('source')!r}, "
                    f"final_tier={current_entry.get('final_tier')!r}) that differs from {source_label!r} "
                    f"(final_tier={source_entry.get('final_tier')!r}) — needs human adjudication"
                ),
            })
            continue

        restorable.append({
            "name": name, "player_id": player_id, "profile_id": draft_row["id"],
            "before": current_entry, "after": source_entry, "noop": False,
        })

    return restorable, needs_human


def print_plan(restorable: list[dict], needs_human: list[dict], source_label: str) -> None:
    print("=" * 79)
    print(f"RESTORABLE ({len(restorable)})  — this printout is the backup record of the pre-restore state")
    print("=" * 79)
    for r in restorable:
        tag = f"NO-OP (already matches {source_label!r})" if r["noop"] else "RESTORE"
        print(f"\n{r['name']} [{tag}]")
        print(f"    before: {json.dumps(r['before'], sort_keys=True)}")
        print(f"    after : {json.dumps(r['after'], sort_keys=True)}")
    print()
    print("=" * 79)
    print(f"NEEDS HUMAN ({len(needs_human)})")
    print("=" * 79)
    for n in needs_human:
        print(f"  {n['name']}: {n['reason']}")
    print()


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def apply_restoration(client, restorable: list[dict], skill: str) -> None:
    for r in restorable:
        if r["noop"]:
            print(f"  SKIP (no-op): {r['name']}")
            continue

        # Re-read immediately before writing — the dry-run print above may be stale.
        profile_row = run_query(
            lambda pid=r["profile_id"]: client.table("draft_skill_profiles")
            .select("profile").eq("id", pid).limit(1).execute()
        )
        current_profile = (profile_row.data or [{}])[0].get("profile") or {}

        updated_profile = {**current_profile, skill: dict(r["after"])}
        client.table("draft_skill_profiles").update(
            {"profile": updated_profile}
        ).eq("id", r["profile_id"]).execute()

        # Verify by re-reading.
        verify_row = run_query(
            lambda pid=r["profile_id"]: client.table("draft_skill_profiles")
            .select("profile").eq("id", pid).limit(1).execute()
        )
        verify_profile = (verify_row.data or [{}])[0].get("profile") or {}
        assert verify_profile.get(skill) == r["after"], f"verify mismatch for {r['name']}"

        # Surgical write check: every other skill in the profile is byte-identical.
        untouched_before = {k: v for k, v in current_profile.items() if k != skill}
        untouched_after = {k: v for k, v in verify_profile.items() if k != skill}
        assert untouched_before == untouched_after, f"non-{skill} field mutated for {r['name']}"

        print(f"  APPLIED + VERIFIED: {r['name']} -> final_tier={r['after'].get('final_tier')!r} "
              f"source={r['after'].get('source')!r}")


# ---------------------------------------------------------------------------
# Guarded-recompute dry-run evidence — read-only, in-memory
# ---------------------------------------------------------------------------


def verify_guard(client, skill: str, players: list[str]) -> None:
    """
    Drive _merge_composite_for_skills directly against the (now restored) draft
    entries with real current thresholds — the same function every
    recompute_composite=True caller routes through (#120's guardrail). Never
    writes to the database and never creates a pipeline_runs row.
    """
    from services.skill_engine.cache import get_thresholds, get_league_averages
    from services.skill_engine.evaluator import evaluate_all_skills, apply_auto_promotions
    from services.skill_engine.evaluation_only import _merge_composite_for_skills
    from services.players_service import _blob_has_data

    name_to_ids = _fetch_player_ids_by_name(client, players)
    player_ids: list[str] = []
    id_to_name: dict[str, str] = {}
    for name in players:
        ids = name_to_ids.get(name, [])
        if len(ids) != 1:
            print(f"  SKIP {name}: ambiguous/missing players row ({ids})")
            continue
        player_ids.append(ids[0])
        id_to_name[ids[0]] = name

    thresholds = get_thresholds(client)
    league_avgs = get_league_averages(SEASON, client)
    thresholds_scoped = {skill: thresholds[skill]} if skill in thresholds else thresholds

    stats_rows = _paginate(
        lambda: client.table("player_stats")
        .select("player_id, stats, fetched_at")
        .eq("season", SEASON)
        .in_("player_id", player_ids)
        .order("fetched_at", desc=True)
    )
    stats_by_player: dict[str, dict] = {}
    for row in stats_rows:
        pid = row["player_id"]
        if pid in stats_by_player:
            continue
        blob = row.get("stats") or {}
        if _blob_has_data(blob):
            stats_by_player[pid] = blob

    draft_rows = _fetch_draft_composites(client, player_ids)

    print("=" * 79)
    print("GUARDED RECOMPUTE DRY-RUN EVIDENCE (in-memory only — no writes, no pipeline_runs row)")
    print("=" * 79)

    all_preserved = True
    for player_id in player_ids:
        name = id_to_name[player_id]
        draft_row = draft_rows.get(player_id)
        if draft_row is None:
            print(f"  {name}: no draft composite profile — skip")
            continue
        existing_composite = draft_row.get("profile") or {}
        human_entry = existing_composite.get(skill) or {}
        human_source = human_entry.get("source")
        human_tier = human_entry.get("final_tier")

        stats_blob = stats_by_player.get(player_id)
        if not stats_blob:
            print(f"  {name}: no usable player_stats — skip")
            continue

        skills_result = evaluate_all_skills(stats_blob, thresholds_scoped, league_avgs)
        skills_result = apply_auto_promotions(skills_result, thresholds_scoped)

        merged, flags = _merge_composite_for_skills(
            skills_result, [skill], existing_composite, notability_score=0,
            player_id=player_id, season=SEASON,
        )

        preserved = merged.get(skill) == human_entry
        all_preserved = all_preserved and preserved
        fresh_tier = skills_result.get(skill, {}).get("tier")
        flagged = len(flags) > 0

        status = "preserved" if preserved else "*** NOT PRESERVED ***"
        print(
            f"  {name:20s} human={human_source}:{human_tier!r:16s} "
            f"fresh_stat_tier={fresh_tier!r:16s} flagged={'YES' if flagged else 'no'}  [{status}]"
        )
        if flagged:
            print(f"      flag_reason={flags[0].flag_reason!r}")
        if not preserved:
            print(f"      BEFORE: {json.dumps(human_entry, sort_keys=True)}")
            print(f"      AFTER : {json.dumps(merged.get(skill), sort_keys=True)}")

    print()
    if all_preserved:
        print(f"VERDICT: all restored entries survive a real-threshold {skill} recompute verbatim.")
    else:
        print("VERDICT: *** at least one restored entry was NOT preserved — investigate before publishing. ***")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--skill", default=DEFAULT_SKILL, help=f"skill key to restore (default: {DEFAULT_SKILL!r})")
    parser.add_argument(
        "--players", default=None,
        help="comma-separated player names (default: the original 12 rebounder-loss players)",
    )
    parser.add_argument(
        "--source-release", default=None,
        help=f"published release label to restore from (default: {DEFAULT_SOURCE_RELEASE!r} when "
             "--skill is unset; required alongside --players for a non-default skill)",
    )
    parser.add_argument("--apply", action="store_true", help="write + verify")
    parser.add_argument("--verify-guard", action="store_true", help="guarded-recompute dry-run evidence")
    args = parser.parse_args()

    args.players = [p.strip() for p in args.players.split(",")] if args.players else DEFAULT_PLAYERS
    args.source_release = args.source_release or DEFAULT_SOURCE_RELEASE
    return args


def main() -> None:
    args = _parse_args()
    client = get_supabase()

    if args.verify_guard:
        verify_guard(client, args.skill, args.players)
        return

    restorable, needs_human = build_plan(client, args.skill, args.players, args.source_release)
    print_plan(restorable, needs_human, args.source_release)

    to_write = [r for r in restorable if not r["noop"]]
    print(
        f"{len(to_write)} entries need a write, {len(restorable) - len(to_write)} already match, "
        f"{len(needs_human)} need human review.\n"
    )

    if not args.apply:
        print("Dry run — nothing written. Re-run with --apply to persist, "
              "then --verify-guard for the guarded-recompute evidence.")
        return

    apply_restoration(client, restorable, args.skill)
    print("\nApplied and verified. Nothing published — this is a draft-only change.")


if __name__ == "__main__":
    main()
