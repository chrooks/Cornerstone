"""
scripts/dev_checks.py — read-only checks against the DEV database (#119 plan, M1.28a).

The one command behind every read-only verify in the #119 plan. STRICTLY
READ-ONLY, by construction:

  - refuses a SUPABASE_URL containing ``.supabase.co`` (the production cloud
    project) before any client exists;
  - wraps the client so only ``table(...).select(...)`` gets through — insert,
    upsert, update, delete, rpc and every other client attribute raise;
  - never imports ``players_service`` or ``notability`` (on 2026-09-21 the
    notability path inserted 174 career rows into dev from a "read-only" script);
  - pages every season-wide read past PostgREST's 1,000-row cap and sends every
    id list through ``in_chunks`` (the dev gateway returns 414 above ~220 ids).

Run (from backend/, venv active):
    python scripts/dev_checks.py --help
    python scripts/dev_checks.py ev
    python scripts/dev_checks.py draft [--run <run_id>]
    python scripts/dev_checks.py blob --player "OG Anunoby"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND_DIR / ".env")

from services.skills import HIGH_CONFIDENCE_SKILLS  # noqa: E402
from services.supabase_client import in_chunks  # noqa: E402

SEASON = "2025-26"
DEV_URL = "https://cornerstone-dev.hestia.chrooks.com"
_PAGE = 1000  # PostgREST returns at most 1,000 rows per request
_HUMAN = ("resolved", "manual_override")
POA, OBD, VD, RP = "point_of_attack_defender", "off_ball_disruptor", "versatile_defender", "rim_protector"
_LEGACY_POA = "perimeter_disruptor"  # pre-split key (#152); read as POA when POA is absent
CORE = (POA, OBD, VD, RP)
CLAIMS = {"Cone": (POA, OBD), "Defensive target": (RP, VD)}
FULL_MIN, FULL_GP = 1000, 30  # a full read (spec default c.6)
_BROKEN_MATCHUP_POSS = 1170491.7  # the league total every blob held before #134


# ---------------------------------------------------------------------------
# Read-only client
# ---------------------------------------------------------------------------


class ReadOnlyViolation(RuntimeError):
    """A write (or any non-select call) reached the read-only client."""


class _ReadOnlyTable:
    def __init__(self, builder, name: str):
        self._builder, self._name = builder, name

    def select(self, *columns, **kwargs):
        return self._builder.select(*columns, **kwargs)

    def __getattr__(self, attr):
        if attr.startswith("__"):
            raise AttributeError(attr)
        raise ReadOnlyViolation(f"{attr} on {self._name} blocked: read-only script")


class ReadOnlyClient:
    """Only ``table(name).select(...)`` gets through; everything else raises."""

    def __init__(self, client):
        self._client = client

    def table(self, name: str) -> _ReadOnlyTable:
        return _ReadOnlyTable(self._client.table(name), name)

    from_ = table

    def __getattr__(self, attr):
        if attr.startswith("__"):
            raise AttributeError(attr)
        raise ReadOnlyViolation(f"client.{attr} blocked: read-only script")


def refuse_production(url: str) -> None:
    if ".supabase.co" in (url or ""):
        sys.exit(f"refusing SUPABASE_URL {url}: *.supabase.co is the production project; these checks are dev-only")


def read_only_client() -> ReadOnlyClient:
    """The guarded client, installed as the shared singleton too: library code
    that calls get_supabase() directly gets it, and reset_client() (run_query's
    reconnect) cannot build an unguarded client — a reconnect fails loudly instead."""
    refuse_production(os.environ.get("SUPABASE_URL", ""))
    import services.supabase_client as sc

    def _refuse(*_a, **_k):
        raise ReadOnlyViolation("create_client blocked: read-only script")

    guarded = ReadOnlyClient(sc.get_supabase())
    sc._client = guarded
    sc.create_client = _refuse
    return guarded


# ---------------------------------------------------------------------------
# Shared reads
# ---------------------------------------------------------------------------


def pages(build):
    """Every row of a query, 1,000 at a time. ``build()`` must order the rows."""
    start = 0
    while True:
        rows = build().range(start, start + _PAGE - 1).execute().data or []
        yield from rows
        if len(rows) < _PAGE:
            return
        start += _PAGE


def count(sb, table: str, where=lambda q: q) -> int:
    return where(sb.table(table).select("*", count="exact", head=True)).execute().count or 0


def season_players(sb, season: str) -> list[dict]:
    """The draft pool: this season's players, excluded ones left out (as the validator does)."""
    return list(pages(lambda: sb.table("players")
                      .select("id, name, nba_api_id, position, height, weight")
                      .eq("season", season).eq("excluded_from_snapshot", False).order("id")))


def names_for(sb, ids) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in in_chunks(sorted({i for i in ids if i})):
        for r in sb.table("players").select("id, name").in_("id", chunk).execute().data or []:
            out[r["id"]] = r["name"]
    return out


def find_player(sb, name: str, season: str) -> dict:
    rows = sb.table("players").select("id, name, nba_api_id").eq("season", season).eq("name", name).execute().data
    rows = rows or sb.table("players").select("id, name, nba_api_id").eq("season", season).ilike("name", f"%{name}%").execute().data
    if len(rows or []) != 1:
        sys.exit(f"'{name}': {len(rows or [])} players match in {season}: {[r['name'] for r in rows or []]}")
    return rows[0]


def usable(blob: dict | None) -> bool:
    """Mirror of players_service._blob_has_data (not imported: this script never imports players_service)."""
    if not blob:
        return False
    box = blob.get("box_score")
    if isinstance(box, dict):
        return any(v is not None for v in box.values())
    return any(v is not None for v in blob.values())


def stats_rows(sb, ids, season: str) -> dict[str, list[dict]]:
    """Every player_stats row per player, newest first."""
    out: dict[str, list[dict]] = {}
    for chunk in in_chunks(list(ids)):
        for r in pages(lambda c=chunk: sb.table("player_stats").select("id, player_id, stats, fetched_at")
                       .eq("season", season).in_("player_id", c)
                       .order("fetched_at", desc=True).order("id")):
            out.setdefault(r["player_id"], []).append(r)
    return out


def newest_blobs(sb, ids, season: str) -> dict[str, dict]:
    """player_id -> newest usable blob (the row the evaluator reads)."""
    return {pid: next(r["stats"] for r in rows if usable(r["stats"]))
            for pid, rows in stats_rows(sb, ids, season).items() if any(usable(r["stats"]) for r in rows)}


def composites(sb, season: str) -> dict[str, dict]:
    """player_id -> {id, profile} for this season's composite profiles."""
    return {r["player_id"]: r for r in pages(lambda: sb.table("draft_skill_profiles").select("id, player_id, profile")
                                               .eq("source", "composite").eq("season", season).order("id"))}


def open_flags(sb, comps: dict[str, dict]) -> list[dict]:
    """Unresolved flags on this season's composite profiles (the review queue and publish-gate scope)."""
    by_profile = {c["id"]: pid for pid, c in comps.items()}
    flags: list[dict] = []
    for chunk in in_chunks(list(by_profile)):
        for f in pages(lambda c=chunk: sb.table("draft_skill_flags")
                       .select("id, skill_profile_id, skill_name, flag_reason, stat_rating, claude_rating")
                       .is_("resolution", "null").in_("skill_profile_id", c).order("id")):
            flags.append({**f, "player_id": by_profile[f["skill_profile_id"]]})
    return flags


def entry(profile: dict, skill: str):
    e = (profile or {}).get(skill)
    if e is None and skill == POA:
        e = (profile or {}).get(_LEGACY_POA)
    return e


def tier(e) -> str | None:
    return e.get("final_tier") if isinstance(e, dict) else e


def get(blob: dict, path: str):
    section, _, key = path.partition(".")
    return ((blob or {}).get(section) or {}).get(key) if key else (blob or {}).get(section)


def inches(height) -> int | None:
    try:
        feet, inch = str(height).split("-")
        return int(feet) * 12 + int(inch)
    except (TypeError, ValueError):
        return None


def size_class(height, weight) -> str:
    """Listed height + weight (spec §3.2, D17): big 6'10"+ or 6'8"+ at 240 lb+; guard 6'5" and under."""
    h, w = inches(height), weight or 0
    if h is not None and (h >= 82 or (h >= 80 and w >= 240)):
        return "big"
    return "guard" if h is not None and h <= 77 else "wing"


def review_link(pid: str) -> str:
    return f"{DEV_URL}/admin/review/{pid}"


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

_WORKING_TABLES = ("players", "player_stats", "league_averages", "draft_skill_thresholds", "draft_skill_profiles",
                   "draft_skill_flags", "pipeline_runs", "pipeline_run_results", "pipeline_run_flag_results")


def cmd_draft(sb, args) -> None:
    from services.snapshot_versions.repo import get_active_release, get_draft
    from services.snapshot_versions.validator import validate_publishable

    draft = get_draft(sb)
    if draft is None:
        print("open draft: none")
    else:
        print(f"open draft: {draft.id} status={draft.status} season={draft.season}")
        runs = list(pages(lambda: sb.table("pipeline_runs").select("*")
                          .eq("snapshot_release_id", draft.id).order("started_at")))
        print("runs by status:", dict(Counter(r["status"] for r in runs)))
        for r in runs:
            uncommitted = (r["status"] == "success" and r.get("committed_at") is None
                           and r["pipeline_name"] in ("skill_evaluation", "threshold_edit"))
            if r["status"] == "running" or uncommitted:
                print(f"  {'RUNNING' if r['status'] == 'running' else 'UNCOMMITTED'} {r['id']} "
                      f"{r['pipeline_name']} started {r.get('started_at')}")
    print("row counts:")
    for t in _WORKING_TABLES:
        print(f"  {t}: {count(sb, t)}")
    print(f"  draft_skill_flags (open): {count(sb, 'draft_skill_flags', lambda q: q.is_('resolution', 'null'))}")

    # The validator only reads the release's season, so with no draft it runs
    # against the active release: still the full-pool, chunked read path.
    target = draft.id if draft else get_active_release(sb).id
    v = validate_publishable(target, client=sb)
    print(f"validate_publishable({'draft' if draft else 'active release'} {target}):",
          {k: v[k] for k in v if not isinstance(v[k], list)})

    if args.run:
        _print_run(sb, args.run, args.limit)


def _print_run(sb, run_id: str, limit: int) -> None:
    results = list(pages(lambda: sb.table("pipeline_run_results").select("player_id, source, profile")
                         .eq("run_id", run_id).order("player_id").order("source")))
    flags = list(pages(lambda: sb.table("pipeline_run_flag_results").select("*")
                       .eq("run_id", run_id).order("player_id").order("skill_name")))
    names = names_for(sb, [r["player_id"] for r in results] + [f["player_id"] for f in flags])
    print(f"run {run_id}: staged profiles by source {dict(Counter(r['source'] for r in results))}; {len(flags)} staged flags")

    # Human-decision entries (resolved / manual_override) must come through a run verbatim (#120).
    staged = {r["player_id"]: r["profile"] for r in results if r["source"] == "composite"}
    current = {}
    for chunk in in_chunks(list(staged)):
        for r in sb.table("draft_skill_profiles").select("player_id, profile").eq("source", "composite") \
                .in_("player_id", chunk).execute().data or []:
            current[r["player_id"]] = r["profile"]
    same = changed = 0
    for pid, prof in staged.items():
        for skill, e in (current.get(pid) or {}).items():
            if isinstance(e, dict) and e.get("source") in _HUMAN:
                if prof.get(skill) == e:
                    same += 1
                else:
                    changed += 1
                    print(f"  HUMAN ENTRY CHANGED: {names.get(pid, pid)} {skill}: {e} -> {prof.get(skill)}")
    print(f"human-decision entries in staged composites: {same} unchanged, {changed} changed")

    print("staged flags by skill/reason:",
          dict(Counter((f["skill_name"], f["flag_reason"].split(":")[0]) for f in flags)))
    for f in flags[:limit]:
        print(f"  {names.get(f['player_id'], f['player_id'])} {f['skill_name']}: {f['flag_reason']} "
              f"stats={f.get('stats_tier')} claude={f.get('claude_tier')} "
              f"justification={(f.get('claude_justification') or '')[:120]!r}")


def cmd_blob(sb, args) -> None:
    p = find_player(sb, args.player, args.season)
    rows = stats_rows(sb, [p["id"]], args.season).get(p["id"], [])
    print(f"{p['name']} id={p['id']} nba_api_id={p['nba_api_id']}: {len(rows)} {args.season} player_stats rows")
    row = next((r for r in rows if usable(r["stats"])), None)
    if row is None:
        sys.exit("no usable blob")
    if rows[0] is not row:
        print(f"  note: the newest row ({rows[0]['fetched_at']}) is all-null; showing the newest usable row")
    b = row["stats"]
    print(f"fetched_at: {row['fetched_at']}")
    for k, v in (b.get("matchup_defense") or {}).items():
        print(f"matchup_defense.{k}: {v}")
    for path in ("advanced.pace", "advanced.poss", "box_score.gp", "metadata.games_played", "metadata.minutes_per_game"):
        print(f"{path}: {get(b, path)}")
    print("shooting_history:", b.get("shooting_history", "ABSENT"))
    print("metadata.sources_succeeded:", get(b, "metadata.sources_succeeded"))


_PLAY_TYPES = ("isolation", "pr_ball_handler", "pr_roll_man", "spotup", "offscreen", "handoff", "cut",
               "transition", "postup")
_FEED_GAP = 0.15  # prototype offense.py: single-team players stay within 11.6% of their box-score volume


def feed_cover(b: dict) -> float | None:
    """Play-type volume / box-score volume per game; about 1.0 when the feed covers his season (prototype offense.py)."""
    pt = b.get("play_type") or {}
    freq = sum(pt.get(f"{k}_freq") or 0 for k in _PLAY_TYPES)
    poss = sum(pt.get(f"{k}_poss") or 0 for k in _PLAY_TYPES if pt.get(f"{k}_freq") is not None)
    box = (get(b, "box_score.fga") or 0) + 0.44 * (get(b, "box_score.fta") or 0) + (get(b, "box_score.tov") or 0)
    return poss / freq / box if freq > 0 and box > 0 else None


def cmd_blob_stats(sb, args) -> None:
    players = season_players(sb, args.season)
    blobs = newest_blobs(sb, [p["id"] for p in players], args.season)
    name = {p["id"]: p["name"] for p in players}
    md = {pid: b.get("matchup_defense") or {} for pid, b in blobs.items()}
    diffs = [m.get("cross_group_fg_pct_diff") for m in md.values()]
    print(f"newest usable {args.season} blobs: {len(blobs)} of {len(players)} season players")
    print(f"cross_group_fg_pct_diff: {len({d for d in diffs if d is not None})} distinct values "
          f"({sum(d is None for d in diffs)} null)")
    print(f"total_matchup_poss == {_BROKEN_MATCHUP_POSS}: "
          f"{sum(m.get('total_matchup_poss') == _BROKEN_MATCHUP_POSS for m in md.values())} blobs")
    for k in ("matchup_difficulty", "handler_share"):
        print(f"{k} present: {sum(m.get(k) is not None for m in md.values())} blobs")
    split = sorted(name[pid] for pid, b in blobs.items()
                   if (c := feed_cover(b)) is not None and abs(c - 1) > _FEED_GAP)
    print(f"split or partial play-type feeds (feed cover outside 1 ± {_FEED_GAP}): {len(split)}: {split[:25]}")
    for n in [x.strip() for x in (args.players or "").split(",") if x.strip()]:
        p = find_player(sb, n, args.season)
        good = [r for r in stats_rows(sb, [p["id"]], args.season).get(p["id"], []) if usable(r["stats"])]
        new = good[0] if good else None
        old = good[1] if len(good) > 1 else None
        print(f"{p['name']}: new games_played={get(new['stats'], 'metadata.games_played') if new else None} "
              f"box_score.gp={get(new['stats'], 'box_score.gp') if new else None} ({new and new['fetched_at']}); "
              f"old games_played={get(old['stats'], 'metadata.games_played') if old else None} ({old and old['fetched_at']}); "
              f"feed cover={feed_cover(new['stats']) if new else None}")


def cmd_profiles(sb, args) -> None:
    rows = list(pages(lambda: sb.table("draft_skill_profiles").select("player_id, profile")
                      .eq("source", args.source).eq("season", args.season).order("id")))
    print(f"{args.source} profiles ({args.season}): {len(rows)}")
    print("key counts (skills per profile -> profiles):", dict(sorted(Counter(len(r["profile"] or {}) for r in rows).items())))
    only = Counter(tuple(sorted(r["profile"] or {})) for r in rows if len(r["profile"] or {}) <= 2)
    if only:
        print("profiles with 1-2 keys:", {"+".join(k) or "(empty)": n for k, n in only.items()})
    entries = [(r["player_id"], s, e) for r in rows for s, e in (r["profile"] or {}).items()
               if isinstance(e, dict) and (not args.skill or s == args.skill)]
    print(f"entry sources{' on ' + args.skill if args.skill else ''}:", dict(Counter(e.get("source") for _, _, e in entries)))
    print("human_reviewed entries:", sum(bool(e.get("human_reviewed")) for _, _, e in entries))
    if args.skill and args.skill not in HIGH_CONFIDENCE_SKILLS:
        no_claude = [pid for pid, _, e in entries if e.get("claude_tier") is None]
        print(f"entries with no Claude tier (Claude failed or never asked): {len(no_claude)}:",
              sorted(names_for(sb, no_claude).values())[:40])
    if args.skill in (None, POA):
        carried = [e for r in rows for e in [(r["profile"] or {}).get(POA)]
                   if isinstance(e, dict) and e.get("source") in _HUMAN and not e.get("human_reviewed")]
        print(f"carried human {POA} entries (no human_reviewed): {len(carried)}, by source/tier:",
              dict(Counter((e.get("source"), e.get("final_tier")) for e in carried)))
    if args.source == "composite":
        legends = list(pages(lambda: sb.table("draft_skill_profiles").select("legend_id, profile")
                             .eq("is_legend", True).order("id")))
        print(f"legend profiles: {len(legends)}; with both {POA} and {OBD}: "
              f"{sum(POA in (r['profile'] or {}) and OBD in (r['profile'] or {}) for r in legends)}")


def cmd_flags(sb, args) -> None:
    flags = [f for f in open_flags(sb, composites(sb, args.season)) if not args.skill or f["skill_name"] == args.skill]
    print(f"open flags ({args.season} composites{', ' + args.skill if args.skill else ''}): {len(flags)}")
    print(f"  on HIGH Skills: {sum(f['skill_name'] in HIGH_CONFIDENCE_SKILLS for f in flags)}")
    for (skill, reason), n in sorted(Counter((f["skill_name"], f["flag_reason"].split(":")[0]) for f in flags).items()):
        print(f"  {skill:26s} {reason:32s} {n}")


def cmd_thresholds(sb, args) -> None:
    rows = sb.table("draft_skill_thresholds").select("thresholds").eq("skill_name", args.skill).execute().data
    if not rows:
        sys.exit(f"no stored rule for {args.skill}")
    body = json.dumps(rows[0]["thresholds"], indent=2)
    if args.out:
        Path(args.out).write_text(body + "\n")
        print(f"wrote {args.out}")
    else:
        print(body)


def cmd_damage(sb, args) -> None:
    """The #154 damage pattern: a HIGH entry resolved to 'None' over a real stats tier."""
    comps = composites(sb, args.season)
    hits = [(pid, s, e.get("stat_tier")) for pid, c in comps.items() for s, e in (c["profile"] or {}).items()
            if s in HIGH_CONFIDENCE_SKILLS and isinstance(e, dict) and e.get("final_tier") == "None"
            and e.get("source") == "resolved" and e.get("stat_tier") not in (None, "None")]
    names = names_for(sb, [h[0] for h in hits])
    print(f"#154 damage entries: {len(hits)}")
    for pid, s, st in hits:
        print(f"  {names.get(pid, pid)} {s}: final None over stat {st}  {review_link(pid)}")


def cmd_career_stale(sb, args) -> None:
    players = season_players(sb, args.season)
    newest: dict[str, str] = {}
    for chunk in in_chunks([p["id"] for p in players]):
        for r in pages(lambda c=chunk: sb.table("player_stats").select("player_id, fetched_at")
                       .eq("season", "career").in_("player_id", c).order("fetched_at", desc=True).order("id")):
            newest.setdefault(r["player_id"], r["fetched_at"])
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    missing = [p for p in players if p["id"] not in newest]
    stale = [p for p in players if p["id"] in newest and datetime.fromisoformat(newest[p["id"]]) < cutoff]
    print(f"season players: {len(players)}; career row missing: {len(missing)}; newest career row older than 30 days: {len(stale)}")
    print(f"a non-HIGH skill run refreshes these {len(missing) + len(stale)} from NBA.com (2 calls each) and inserts career rows")
    print("  e.g.", sorted(p["name"] for p in missing + stale)[:20])


def cmd_negatives(sb, args) -> None:
    """The M5.9 lists: negative candidates (full read, all four core Skills at None) and carried claim Nones."""
    players = season_players(sb, args.season)
    comps = composites(sb, args.season)
    blobs = newest_blobs(sb, [p["id"] for p in players], args.season)
    flags = open_flags(sb, comps)
    open_by = {(f["player_id"], f["skill_name"]): f["flag_reason"] for f in flags}
    missing_core = 0
    print("(1) negative candidates — full read (1,000+ min, 30+ games), all four core Skills at None:")
    for p in sorted(players, key=lambda x: x["name"]):
        prof = (comps.get(p["id"]) or {}).get("profile") or {}
        es = {k: entry(prof, k) for k in CORE}
        if prof and any(e is None for e in es.values()):
            missing_core += 1
            continue
        meta = (blobs.get(p["id"]) or {}).get("metadata") or {}
        gp, mpg = meta.get("games_played") or 0, meta.get("minutes_per_game") or 0
        if not prof or gp < FULL_GP or gp * mpg < FULL_MIN or any(tier(e) != "None" for e in es.values()):
            continue
        size = size_class(p.get("height"), p.get("weight"))
        role = "Defensive target" if size == "big" else "Cone"
        print(f"  {p['name']} ({size}, {role}; {gp} GP, {round(gp * mpg)} min)  {review_link(p['id'])}")
        for k in CLAIMS[role]:
            e = es[k]
            print(f"      {k}: source={e.get('source')} human_reviewed={bool(e.get('human_reviewed'))} "
                  f"open flag={open_by.get((p['id'], k), 'none')}"
                  + (" (HIGH: no flag; needs a manual override to count)" if k in HIGH_CONFIDENCE_SKILLS else ""))
    if missing_core:
        print(f"  ({missing_core} composites lack a core key and were skipped — before the #152 split, {OBD} is absent)")
    print(f"(2) carried claim Nones — {POA} None from a human decision, no human_reviewed, no open flag:")
    name = {p["id"]: p["name"] for p in players}
    for pid, c in sorted(comps.items(), key=lambda kv: name.get(kv[0], "")):
        e = (c["profile"] or {}).get(POA)
        if (isinstance(e, dict) and e.get("final_tier") == "None" and e.get("source") in _HUMAN
                and not e.get("human_reviewed") and (pid, POA) not in open_by):
            print(f"  {name.get(pid, pid)} ({e.get('source')})  {review_link(pid)}")


def cmd_release(sb, args) -> None:
    from postgrest.exceptions import APIError
    from services.snapshot_versions.repo import get_active_release

    rel = get_active_release(sb)
    rows = list(pages(lambda: sb.table("released_players").select("is_legend, skill_profile_snapshot")
                      .eq("snapshot_release_id", rel.id).order("id")))
    print(f"active release: {rel.id} label={rel.label!r} season={rel.season} published_at={rel.published_at}")
    print(f"rows: {len(rows)} ({sum(not r['is_legend'] for r in rows)} actives, {sum(r['is_legend'] for r in rows)} legends)")
    print(f"rows with both {POA} and {OBD}: "
          f"{sum(POA in (r['skill_profile_snapshot'] or {}) and OBD in (r['skill_profile_snapshot'] or {}) for r in rows)}")
    try:
        snaps = [r["archetype_snapshot"] or {} for r in pages(lambda: sb.table("released_players")
                 .select("archetype_snapshot").eq("snapshot_release_id", rel.id).order("id"))]
        print(f"archetype_snapshot: {sum(bool(s.get('computed')) for s in snaps)} computed, "
              f"{sum(bool(s.get('pair')) for s in snaps)} with a pair name, {sum(not s for s in snaps)} empty")
    except APIError as exc:
        print(f"archetype_snapshot: column absent (M7.2 migration not applied): {exc.message}")


def cmd_ev(sb, args) -> None:
    rows = sb.table("evaluation_versions").select("id, slug, status, is_active, published_at") \
        .or_("is_active.eq.true,status.eq.draft").execute().data or []
    for r in sorted(rows, key=lambda r: not r["is_active"]):
        print(r["slug"] if r["is_active"] else f"open draft: {r['slug']}", f"(id {r['id']}, status {r['status']})")


def cmd_overrides(sb, args) -> None:
    from postgrest.exceptions import APIError

    for table in ("players", "legends"):
        try:
            rows = list(pages(lambda t=table: sb.table(t).select("id, name, archetype_override")
                              .not_.is_("archetype_override", "null").order("id")))
            print(f"{table}: {len(rows)} archetype_override rows")
            for r in rows:
                print(f"  {r['name']} ({r['id']}): {r['archetype_override']}")
        except APIError as exc:
            print(f"{table}.archetype_override: column absent (M7.2 migration not applied): {exc.message}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--season", default=SEASON)
    parser = argparse.ArgumentParser(description="Read-only checks against the dev database (#119 plan).")
    sub = parser.add_subparsers(dest="cmd", required=True, metavar="subcommand")

    def add(name, fn, help_text):
        p = sub.add_parser(name, parents=[common], help=help_text)
        p.set_defaults(fn=fn)
        return p

    p = add("draft", cmd_draft, "open draft, runs, working-table row counts, validate_publishable")
    p.add_argument("--run", help="also print this run's staged composite and flag rows")
    p.add_argument("--limit", type=int, default=20, help="staged flag rows to print (default 20)")
    add("blob", cmd_blob, "newest usable blob fields for one player").add_argument("--player", required=True)
    add("blob-stats", cmd_blob_stats, "season-wide matchup and feed checks").add_argument("--players", help="comma-separated names")
    p = add("profiles", cmd_profiles, "profile counts, key counts, entry sources, human_reviewed, carried entries")
    p.add_argument("--source", required=True, choices=("stats", "composite"))
    p.add_argument("--skill")
    add("flags", cmd_flags, "open flags by Skill and reason").add_argument("--skill")
    p = add("thresholds", cmd_thresholds, "the stored rule body")
    p.add_argument("--skill", required=True)
    p.add_argument("--out", help="write the body to this file instead of printing it")
    add("damage", cmd_damage, "#154 damage: HIGH entries resolved to None over a stats tier")
    add("career-stale", cmd_career_stale, "players whose newest career row is missing or older than 30 days")
    add("negatives", cmd_negatives, "the M5.9 lists: negative candidates and carried claim Nones")
    add("release", cmd_release, "active release rows, new keys, archetype_snapshot counts")
    add("ev", cmd_ev, "active Evaluation Version slug (and any open EV draft)")
    add("overrides", cmd_overrides, "non-null archetype_override rows on players and legends")
    return parser


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    args.fn(read_only_client(), args)


if __name__ == "__main__":
    main()
