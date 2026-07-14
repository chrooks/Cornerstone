"""
scripts/restore_rebounder_decisions.py — restore the 12 human decisions #120's
rebounder recompute bug destroyed (issue #121).

#120's audit (scripts/audit_recompute_losses.py) proved the four `rebounder`
recompute runs of 2026-06-12 reverted 12 `manual_override`/`resolved`
composite entries to `stats_only`, shipped in the "Defensive Rebounding
Update" release, and carried into every later release including the current
active one. This restores the 12 in the DRAFT only — the release history is
immutable and untouched; the fix reaches the live engine on the next
deliberate publish.

The 12: Josh Hart, Evan Mobley, Kenrich Williams, Steven Adams, Stephen Curry,
Jayson Tatum, Jalen Smith, Kevin Love, Luke Kornet, Joel Embiid,
Russell Westbrook, Jalen Johnson.

Source of truth for the restored value: the "Finals Refresh" published
release — the last release that carried the correct human decision before
"Defensive Rebounding Update" clobbered it (confirmed by
scripts/audit_recompute_losses.py's Method B).

Safety: never guesses. A player is skipped and reported "needs human" when:
  - the players table doesn't resolve to exactly one row for their name,
  - Finals Refresh has no rebounder entry for them, or that entry's source
    isn't resolved/manual_override (unexpected — would mean Finals Refresh
    itself wasn't clean),
  - no current draft composite profile exists, or
  - the CURRENT draft entry is ALREADY a human decision (resolved /
    manual_override) that disagrees with Finals Refresh — someone re-decided
    it since; restoring over that would be the same silent-overwrite bug
    this issue exists to fix.

Modes:
    python scripts/restore_rebounder_decisions.py                 # dry run (default)
    python scripts/restore_rebounder_decisions.py --apply          # write + verify
    python scripts/restore_rebounder_decisions.py --verify-guard   # guarded-recompute
                                                                     # dry-run evidence
                                                                     # (issue #121 AC3);
                                                                     # read-only, run
                                                                     # after --apply

--verify-guard drives services.skill_engine.evaluation_only._merge_composite_for_skills
directly, in-memory, against real current thresholds — the same function every
recompute_composite=True call site routes through. It never creates a
pipeline_runs row and never writes to the database.

Writes (--apply only): exactly one JSONB field — the `rebounder` key inside
each of the 12 players' draft_skill_profiles.profile (source='composite',
season='2025-26'). Nothing else in the profile is touched. No other skill, no
released table, no publish.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services.supabase_client import get_supabase, run_query  # noqa: E402

SEASON = "2025-26"
SKILL = "rebounder"
FINALS_REFRESH_LABEL = "Finals Refresh"
_HUMAN_SOURCES = ("resolved", "manual_override")
_PAGE = 1000  # PostgREST's per-request row cap — every read below pages past it.

PLAYERS = [
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


def _find_finals_refresh(client) -> dict:
    releases = _paginate(
        lambda: client.table("snapshot_releases")
        .select("id, label, status, published_at")
        .eq("label", FINALS_REFRESH_LABEL)
        .order("published_at")
    )
    published = [r for r in releases if r["status"] == "published"]
    if not published:
        raise RuntimeError(f"No published release labeled {FINALS_REFRESH_LABEL!r} found")
    if len(published) > 1:
        raise RuntimeError(f"Multiple published releases labeled {FINALS_REFRESH_LABEL!r} — ambiguous")
    return published[0]


def _fetch_player_ids_by_name(client) -> dict[str, list[str]]:
    """name -> [player_id, ...] — a list so ambiguous names are visible, not silently picked."""
    rows = _paginate(
        lambda: client.table("players").select("id, name").in_("name", PLAYERS).order("id")
    )
    by_name: dict[str, list[str]] = {}
    for r in rows:
        by_name.setdefault(r["name"], []).append(r["id"])
    return by_name


def _fetch_finals_refresh_entries(client, release_id: str, player_ids: list[str]) -> dict[str, dict]:
    """source_player_id -> full rebounder entry, copied verbatim from the frozen snapshot."""
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
        entry = (r.get("skill_profile_snapshot") or {}).get(SKILL)
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


def build_plan(client) -> tuple[list[dict], list[dict]]:
    """Returns (restorable, needs_human)."""
    finals_refresh = _find_finals_refresh(client)
    print(f"Finals Refresh release: {finals_refresh['id']} (published {finals_refresh['published_at']})\n")

    name_to_ids = _fetch_player_ids_by_name(client)

    restorable: list[dict] = []
    needs_human: list[dict] = []
    resolved_ids: list[str] = []
    id_to_name: dict[str, str] = {}

    for name in PLAYERS:
        ids = name_to_ids.get(name, [])
        if len(ids) != 1:
            needs_human.append({"name": name, "reason": f"expected exactly 1 players row, found {len(ids)}: {ids}"})
            continue
        resolved_ids.append(ids[0])
        id_to_name[ids[0]] = name

    finals_entries = _fetch_finals_refresh_entries(client, finals_refresh["id"], resolved_ids)
    draft_rows = _fetch_draft_composites(client, resolved_ids)

    for player_id in resolved_ids:
        name = id_to_name[player_id]

        finals_entry = finals_entries.get(player_id)
        if finals_entry is None:
            needs_human.append({"name": name, "player_id": player_id,
                                 "reason": "no rebounder entry in Finals Refresh snapshot"})
            continue
        if finals_entry.get("source") not in _HUMAN_SOURCES:
            needs_human.append({
                "name": name, "player_id": player_id,
                "reason": f"Finals Refresh entry source={finals_entry.get('source')!r} — not a human decision",
            })
            continue

        draft_row = draft_rows.get(player_id)
        if draft_row is None:
            needs_human.append({"name": name, "player_id": player_id,
                                 "reason": "no draft composite profile found"})
            continue

        current_entry = (draft_row.get("profile") or {}).get(SKILL)

        if current_entry == finals_entry:
            restorable.append({
                "name": name, "player_id": player_id, "profile_id": draft_row["id"],
                "before": current_entry, "after": finals_entry, "noop": True,
            })
            continue

        if isinstance(current_entry, dict) and current_entry.get("source") in _HUMAN_SOURCES:
            # The draft already carries a human decision that disagrees with Finals
            # Refresh — someone re-decided it since. Do not guess; overwriting this
            # would be exactly the bug #120/#121 exist to fix.
            needs_human.append({
                "name": name, "player_id": player_id,
                "reason": (
                    f"draft already has a human decision (source={current_entry.get('source')!r}, "
                    f"final_tier={current_entry.get('final_tier')!r}) that differs from Finals Refresh "
                    f"(final_tier={finals_entry.get('final_tier')!r}) — needs human adjudication"
                ),
            })
            continue

        restorable.append({
            "name": name, "player_id": player_id, "profile_id": draft_row["id"],
            "before": current_entry, "after": finals_entry, "noop": False,
        })

    return restorable, needs_human


def print_plan(restorable: list[dict], needs_human: list[dict]) -> None:
    print("=" * 79)
    print(f"RESTORABLE ({len(restorable)})  — this printout is the backup record of the pre-restore state")
    print("=" * 79)
    for r in restorable:
        tag = "NO-OP (already matches Finals Refresh)" if r["noop"] else "RESTORE"
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


def apply_restoration(client, restorable: list[dict]) -> None:
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

        updated_profile = {**current_profile, SKILL: dict(r["after"])}
        client.table("draft_skill_profiles").update(
            {"profile": updated_profile}
        ).eq("id", r["profile_id"]).execute()

        # Verify by re-reading.
        verify_row = run_query(
            lambda pid=r["profile_id"]: client.table("draft_skill_profiles")
            .select("profile").eq("id", pid).limit(1).execute()
        )
        verify_profile = (verify_row.data or [{}])[0].get("profile") or {}
        assert verify_profile.get(SKILL) == r["after"], f"verify mismatch for {r['name']}"

        # Surgical write check: every other skill in the profile is byte-identical.
        untouched_before = {k: v for k, v in current_profile.items() if k != SKILL}
        untouched_after = {k: v for k, v in verify_profile.items() if k != SKILL}
        assert untouched_before == untouched_after, f"non-rebounder field mutated for {r['name']}"

        print(f"  APPLIED + VERIFIED: {r['name']} -> final_tier={r['after'].get('final_tier')!r} "
              f"source={r['after'].get('source')!r}")


# ---------------------------------------------------------------------------
# Guarded-recompute dry-run evidence (issue #121 AC3) — read-only, in-memory
# ---------------------------------------------------------------------------


def verify_guard(client) -> None:
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

    name_to_ids = _fetch_player_ids_by_name(client)
    player_ids: list[str] = []
    id_to_name: dict[str, str] = {}
    for name in PLAYERS:
        ids = name_to_ids.get(name, [])
        if len(ids) != 1:
            print(f"  SKIP {name}: ambiguous/missing players row ({ids})")
            continue
        player_ids.append(ids[0])
        id_to_name[ids[0]] = name

    thresholds = get_thresholds(client)
    league_avgs = get_league_averages(SEASON, client)
    thresholds_scoped = {SKILL: thresholds[SKILL]} if SKILL in thresholds else thresholds

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
        human_entry = existing_composite.get(SKILL) or {}
        human_source = human_entry.get("source")
        human_tier = human_entry.get("final_tier")

        stats_blob = stats_by_player.get(player_id)
        if not stats_blob:
            print(f"  {name}: no usable player_stats — skip")
            continue

        skills_result = evaluate_all_skills(stats_blob, thresholds_scoped, league_avgs)
        skills_result = apply_auto_promotions(skills_result, thresholds_scoped)

        merged, flags = _merge_composite_for_skills(
            skills_result, [SKILL], existing_composite, notability_score=0,
            player_id=player_id, season=SEASON,
        )

        preserved = merged.get(SKILL) == human_entry
        all_preserved = all_preserved and preserved
        fresh_tier = skills_result.get(SKILL, {}).get("tier")
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
            print(f"      AFTER : {json.dumps(merged.get(SKILL), sort_keys=True)}")

    print()
    if all_preserved:
        print("VERDICT: all restored entries survive a real-threshold rebounder recompute verbatim.")
    else:
        print("VERDICT: *** at least one restored entry was NOT preserved — investigate before publishing. ***")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    apply = "--apply" in sys.argv
    guard = "--verify-guard" in sys.argv
    client = get_supabase()

    if guard:
        verify_guard(client)
        return

    restorable, needs_human = build_plan(client)
    print_plan(restorable, needs_human)

    to_write = [r for r in restorable if not r["noop"]]
    print(
        f"{len(to_write)} entries need a write, {len(restorable) - len(to_write)} already match, "
        f"{len(needs_human)} need human review.\n"
    )

    if not apply:
        print("Dry run — nothing written. Re-run with --apply to persist, "
              "then --verify-guard for the guarded-recompute evidence.")
        return

    apply_restoration(client, restorable)
    print("\nApplied and verified. Nothing published — this is a draft-only change.")


if __name__ == "__main__":
    main()
