"""
scripts/audit_recompute_losses.py — read-only audit for issue #120.

Question: did any PUBLISHED Snapshot Release lose a human review decision
(draft_skill_flags.resolution in {trust_stats, trust_claude, manual_override})
via the evaluate_skills_for_run(recompute_composite=True) overwrite path in
services/skill_engine/evaluation_only.py?

That function rebuilds a player's composite entry for the skills a
threshold_edit run touches from fresh stat tiers, regardless of what the
entry's `source` was beforehand — so a prior 'resolved' or 'manual_override'
entry gets silently collapsed back to 'stats_only' / 'auto_accepted'.

recompute_composite=True has exactly one call site (api/calibration.py's
threshold_edit propose-and-evaluate worker) — every threshold_edit run's
worker sets it unconditionally. But not every `pipeline_runs` row with
pipeline_name='threshold_edit' went through that path: the `?force=true`
direct-write route never calls evaluate_skills_for_run at all — it writes
draft_skill_thresholds directly via pipeline_runs.repo.record_force_audit(),
which always sets snapshot_release_id=None. That is the reliable signal this
script uses to classify each threshold_edit run:

  snapshot_release_id IS NULL                       -> force_audit_direct_write (no composite touch)
  snapshot_release_id IS NOT NULL, committed_at NULL -> staged_uncommitted (no live effect)
  snapshot_release_id IS NOT NULL, committed_at set  -> recompute_commit (the bug path, committed)

Two independent detection methods, run in sequence:

  METHOD A — draft_skill_flags timestamp cross-check. For every recompute_commit
  run, find flags resolved (resolved_at) before the run's committed_at, then
  check whether that decision survived into the run's published release.
  LIMITATION (discovered while building this script against the connected
  Supabase project): draft_skill_flags is completely empty right now — the
  audit-trail rows behind every past 'resolved'/'manual_override' composite
  entry have been deleted by the delete-then-reinsert step every commit or
  full composite rebuild performs for a re-flagged skill. Method A cannot see
  anything it isn't given, so it is reported as best-effort, not proof.

  METHOD B — release-pair snapshot diff (the reliable one). Every published
  Snapshot Release freezes an immutable skill_profile_snapshot per player in
  released_players. For every skill touched by a recompute_commit run, diff
  that skill's entries between the run's published release and the published
  release immediately before it. A player whose entry was 'resolved' or
  'manual_override' in the prior release but isn't in the new one is a directly
  observed, dated loss — no dependency on the (empty) flags table.

STRICTLY READ-ONLY: SELECT-only queries. No writes, no pipeline triggers, no
publishes, no draft resets.

Run:
    cd backend && source venv/bin/activate && python scripts/audit_recompute_losses.py
"""

from __future__ import annotations

import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services.supabase_client import get_supabase, run_query  # noqa: E402

_PAGE = 1000  # PostgREST's per-request row cap — every read below pages past it.
_CHUNK = 200  # IN-list chunk size, well under PostgREST URL limits.
_HUMAN_SOURCES = ("resolved", "manual_override")


def _paginate(build_query) -> list[dict]:
    """build_query() returns a fresh, unexecuted query builder each call.

    Chains .range() and loops until a short page ends it — guards every read
    in this script against PostgREST's 1000-row cap silently truncating.
    """
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


def _parse_ts(value) -> datetime | None:
    """Parse a Postgres/PostgREST timestamptz string into a comparable datetime."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


def fetch_threshold_edit_runs(client) -> list[dict]:
    return _paginate(
        lambda: client.table("pipeline_runs")
        .select(
            "id, pipeline_name, scope, status, snapshot_release_id, params, "
            "started_at, finished_at, committed_at, committed_diff, rows_processed"
        )
        .eq("pipeline_name", "threshold_edit")
        .order("id")
    )


def fetch_published_releases(client) -> list[dict]:
    return _paginate(
        lambda: client.table("snapshot_releases")
        .select("id, label, season, status, is_active, published_at, created_at")
        .eq("status", "published")
        .order("id")
    )


def fetch_resolved_flags(client) -> list[dict]:
    """All draft_skill_flags rows with a human resolution recorded (currently: none)."""
    return _paginate(
        lambda: client.table("draft_skill_flags")
        .select(
            "id, skill_profile_id, skill_name, resolution, resolved_value, "
            "resolved_at, notes"
        )
        .not_.is_("resolution", "null")
        .order("id")
    )


def fetch_composite_profile_owners(client, profile_ids: set[str]) -> dict[str, tuple[str, str]]:
    """skill_profile_id -> (player_id, season) via draft_skill_profiles."""
    owners: dict[str, tuple[str, str]] = {}
    ids = [i for i in profile_ids if i]
    for i in range(0, len(ids), _CHUNK):
        chunk = ids[i : i + _CHUNK]
        rows = _paginate(
            lambda c=chunk: client.table("draft_skill_profiles")
            .select("id, player_id, season")
            .in_("id", c)
            .order("id")
        )
        for row in rows:
            owners[row["id"]] = (row["player_id"], row["season"])
    return owners


def fetch_released_skill(client, release_id: str, skill: str) -> dict[str, dict]:
    """source_player_id -> {name, source, final_tier, stat_tier} for one skill,
    one release, non-legend rows only."""
    result: dict[str, dict] = {}
    rows = _paginate(
        lambda: client.table("released_players")
        .select("source_player_id, name, is_legend, skill_profile_snapshot")
        .eq("snapshot_release_id", release_id)
        .eq("is_legend", False)
        .order("source_player_id")
    )
    for row in rows:
        pid = row.get("source_player_id")
        snap = row.get("skill_profile_snapshot") or {}
        entry = snap.get(skill)
        if pid and isinstance(entry, dict):
            result[pid] = {
                "name": row.get("name"),
                "source": entry.get("source"),
                "final_tier": entry.get("final_tier"),
                "stat_tier": entry.get("stat_tier"),
            }
    return result


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------


def classify_run(run: dict) -> str:
    """Which write path produced this threshold_edit pipeline_runs row."""
    if run.get("snapshot_release_id") is None:
        return "force_audit_direct_write"  # ?force=true — never touches composites
    if run.get("committed_at") is None:
        return "staged_uncommitted"  # never committed — no live effect
    return "recompute_commit"  # evaluate_skills_for_run(recompute_composite=True) + commit_pipeline_run


def _skill_name_for_run(run: dict) -> str | None:
    """Resolve the skill a run touched: params first, committed_diff as fallback.

    Some recompute_commit rows in this dataset have params=None (started
    outside the normal calibration.py endpoint — e.g. an ad hoc console/script
    invocation) but still carry a committed_diff snapshot-vs-current tier diff
    that names the skill(s) actually changed.
    """
    from_params = (run.get("params") or {}).get("skill_name")
    if from_params:
        return from_params
    diff = run.get("committed_diff") or {}
    skills = {c.get("skill_name") for c in diff.get("changes", []) if c.get("skill_name")}
    if len(skills) == 1:
        return next(iter(skills))
    if len(skills) > 1:
        return f"AMBIGUOUS({sorted(skills)})"
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    client = get_supabase()

    print("=" * 79)
    print("STEP 1 — threshold_edit pipeline_runs (the only recompute_composite=True call site)")
    print("=" * 79)
    runs = fetch_threshold_edit_runs(client)
    for r in runs:
        r["_skill_name"] = _skill_name_for_run(r)
        r["_classification"] = classify_run(r)
    runs.sort(key=lambda r: r.get("started_at") or "")

    recompute_commits = [r for r in runs if r["_classification"] == "recompute_commit"]
    force_audits = [r for r in runs if r["_classification"] == "force_audit_direct_write"]
    staged_only = [r for r in runs if r["_classification"] == "staged_uncommitted"]

    print(f"Total threshold_edit runs: {len(runs)}")
    print(f"  recompute_commit (bug path, committed):          {len(recompute_commits)}")
    print(f"  force_audit_direct_write (?force=true, safe):    {len(force_audits)}")
    print(f"  staged_uncommitted (never committed, no effect): {len(staged_only)}")
    print()

    for r in recompute_commits:
        print(
            f"  RECOMPUTE COMMIT id={r['id']} skill={r['_skill_name']!r} "
            f"snapshot_release_id={r['snapshot_release_id']} "
            f"started_at={r['started_at']} committed_at={r['committed_at']} "
            f"rows_processed={r['rows_processed']} status={r['status']}"
            f"{' [params was None — skill derived from committed_diff]' if not (r.get('params') or {}).get('skill_name') else ''}"
        )
    for r in staged_only:
        print(
            f"  STAGED-ONLY (never committed — e.g. rolled back) id={r['id']} "
            f"skill={r['_skill_name']!r} snapshot_release_id={r['snapshot_release_id']} "
            f"status={r['status']} started_at={r['started_at']}"
        )
    print(f"  ({len(force_audits)} force_audit_direct_write runs omitted from listing — they never touch composites)")
    print()

    if not recompute_commits:
        print("No committed recompute_commit runs found — the bug path never fired against")
        print("any draft that could have shipped. VERDICT: no losses possible.")
        return

    print("=" * 79)
    print("STEP 2 — published Snapshot Releases (chronological)")
    print("=" * 79)
    releases = fetch_published_releases(client)
    releases_sorted = sorted(releases, key=lambda x: x.get("published_at") or "")
    releases_by_id = {r["id"]: r for r in releases}
    print(f"Total published releases: {len(releases)}")
    for r in releases_sorted:
        print(
            f"  {r['id']} label={r['label']!r} season={r['season']} "
            f"published_at={r['published_at']} active={r['is_active']}"
        )
    print()

    print("=" * 79)
    print("STEP 3 — METHOD A: draft_skill_flags timestamp cross-check (best-effort)")
    print("=" * 79)
    resolved_flags = fetch_resolved_flags(client)
    print(f"Total resolved/overridden draft_skill_flags rows: {len(resolved_flags)}")
    if not resolved_flags:
        print(
            "draft_skill_flags is empty — no resolved_at timestamps exist to cross-check "
            "against recompute commits. This does NOT mean no human decisions ever "
            "existed (released_players snapshots show plenty — see Step 4); it means the "
            "audit-trail table behind them has since been cleared by a later commit or "
            "full composite rebuild. Method A can find nothing here; Method B below does "
            "not depend on this table."
        )
    else:
        profile_ids = {f["skill_profile_id"] for f in resolved_flags if f.get("skill_profile_id")}
        owners = fetch_composite_profile_owners(client, profile_ids)
        for f in resolved_flags:
            owner = owners.get(f["skill_profile_id"])
            f["_player_id"] = owner[0] if owner else None
        by_skill: dict[str, list[dict]] = defaultdict(list)
        for f in resolved_flags:
            by_skill[f["skill_name"]].append(f)
        for skill, flags in sorted(by_skill.items()):
            print(f"  {skill}: {len(flags)} human decision(s) with a resolved_at timestamp")
    print()

    print("=" * 79)
    print("STEP 4 — METHOD B: release-pair snapshot diff (primary evidence)")
    print("=" * 79)
    print(
        "For each skill touched by a recompute_commit run, diff that skill's frozen "
        "released_players entries between the run's published release and the published "
        "release immediately before it."
    )
    print()

    # Group recompute_commit runs by (skill, target release) — several runs can
    # target the same skill+release (e.g. rebounder had 4 separate commits before
    # one publish); only one diff is needed per group.
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in recompute_commits:
        groups[(r["_skill_name"], r["snapshot_release_id"])].append(r)

    all_candidate_losses: list[dict] = []
    all_preserved: list[dict] = []
    unpublished_groups: list[tuple[str, str, list[dict]]] = []
    unresolved_skill_groups: list[tuple[str, str, list[dict]]] = []

    for (skill, release_id), group_runs in sorted(groups.items(), key=lambda kv: kv[0]):
        run_ids = [r["id"] for r in group_runs]
        if skill is None or (isinstance(skill, str) and skill.startswith("AMBIGUOUS")):
            print(f"Skill unresolved for runs {run_ids} (release={release_id}) — skipping diff, flagging for human review.")
            unresolved_skill_groups.append((skill, release_id, group_runs))
            continue

        release = releases_by_id.get(release_id)
        if release is None:
            print(f"Skill={skill!r} runs {run_ids}: draft {release_id} was never published — no shipped exposure.")
            unpublished_groups.append((skill, release_id, group_runs))
            continue

        idx = next((i for i, r in enumerate(releases_sorted) if r["id"] == release_id), None)
        prior_release = releases_sorted[idx - 1] if idx and idx > 0 else None

        if prior_release is None:
            print(f"Skill={skill!r} release={release['label']!r}: no prior published release to diff against — skipping.")
            continue

        before = fetch_released_skill(client, prior_release["id"], skill)
        after = fetch_released_skill(client, release_id, skill)

        before_human = {pid: v for pid, v in before.items() if v["source"] in _HUMAN_SOURCES}
        losses = []
        preserved = []
        for pid, v in before_human.items():
            a = after.get(pid)
            if a is None:
                continue  # player dropped from the pool — not a loss to track here
            if a["source"] in _HUMAN_SOURCES:
                preserved.append((pid, v, a))
            else:
                losses.append((pid, v, a))

        print(
            f"Skill={skill!r}: prior release={prior_release['label']!r} "
            f"({prior_release['published_at']}) -> target release={release['label']!r} "
            f"({release['published_at']}) [runs {run_ids}]"
        )
        print(
            f"  human-decided entries in prior release: {len(before_human)}  |  "
            f"preserved into target: {len(preserved)}  |  LOST: {len(losses)}"
        )

        for pid, v, a in losses:
            record = {
                "skill": skill,
                "player_id": pid,
                "player_name": v["name"],
                "prior_release": prior_release["label"],
                "prior_source": v["source"],
                "prior_tier": v["final_tier"],
                "target_release": release["label"],
                "target_source": a["source"],
                "target_tier": a["final_tier"],
                "run_ids": run_ids,
            }
            all_candidate_losses.append(record)
            print(
                f"    LOSS: {v['name']!r} ({pid}) {v['source']}={v['final_tier']!r} "
                f"-> {a['source']}={a['final_tier']!r}"
            )
        for pid, v, a in preserved:
            all_preserved.append({"skill": skill, "player_id": pid, "player_name": v["name"]})
        print()

    print("=" * 79)
    print("RESULTS")
    print("=" * 79)
    print(f"Candidate losses (human decision present before, gone after a recompute_commit + publish): {len(all_candidate_losses)}")
    by_skill_loss = Counter(c["skill"] for c in all_candidate_losses)
    for skill, n in by_skill_loss.items():
        print(f"  {skill}: {n} player(s)")
    print()
    for c in all_candidate_losses:
        print(
            f"  LOSS: player={c['player_name']!r} skill={c['skill']} "
            f"{c['prior_source']}={c['prior_tier']!r} (in {c['prior_release']!r}) "
            f"-> {c['target_source']}={c['target_tier']!r} (in {c['target_release']!r}) "
            f"caused by run(s) {c['run_ids']}"
        )

    print(f"\nConfirmed preserved (human decision survived the recompute): {len(all_preserved)}")
    print(f"Recompute committed but draft never published (no shipped exposure): {len(unpublished_groups)}")
    print(f"Skill could not be resolved for {len(unresolved_skill_groups)} run group(s) — needs human review")

    print()
    if all_candidate_losses:
        print(f"VERDICT: {len(all_candidate_losses)} confirmed loss(es) shipped to a published Snapshot Release.")
    elif unresolved_skill_groups:
        print("VERDICT: no confirmed losses, but some runs could not be classified — needs human review.")
    else:
        print("VERDICT: no losses found in any published Snapshot Release.")


if __name__ == "__main__":
    main()
