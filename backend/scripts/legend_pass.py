"""
scripts/legend_pass.py — a Legend pass by command, reviewed in one pass (#119 M5.12).

  fetch   ask Claude (the same endpoint as the editor's "Get Claude's Take") to rate every
          Legend on --skills, in parallel, and write <out>.json plus a phone-readable
          <out>.md: the current tier beside Claude's, with Claude's reason. Writes nothing
          to the database; it spends one Claude call per Legend.
  apply   write the chosen tiers through PUT /api/legends/<id>/skills (the editor's save).
          Dry run by default; --yes writes. --override "Name:skill=Tier" changes one pick.

Dev only: the dev admin test account and the production guard of stage_threshold_edit.py.

Run (from backend/, venv active):
    python scripts/legend_pass.py fetch --skills point_of_attack_defender,off_ball_disruptor \
        --out ../.tasks/119-3d-archetypes/legend-pass
    python scripts/legend_pass.py apply --file ../.tasks/119-3d-archetypes/legend-pass.json \
        --override "Michael Jordan:off_ball_disruptor=Elite" --yes
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from stage_threshold_edit import (  # noqa: E402  (loads the dev env paths and the guard)
    BACKEND_DIR,
    DEV_API,
    DEV_ENV_FILE,
    access_token,
    api_call,
    read_env,
    refuse_production,
)
from services.skills import ALL_SKILLS, SKILL_LABELS  # noqa: E402

PARALLEL = 5  # Claude calls in flight; the dev backend runs 2 workers x 4 threads
TIERS = ("None", "Capable", "Proficient", "Elite", "All-Time Great")


def connect() -> tuple[str, dict]:
    dev_env = read_env(DEV_ENV_FILE)
    base = (dev_env.get("NEXT_PUBLIC_API_URL") or DEV_API).rstrip("/")
    refuse_production(base, [read_env(BACKEND_DIR / ".env").get("SUPABASE_URL", ""),
                             dev_env.get("NEXT_PUBLIC_SUPABASE_URL", "")], allow_prod=False)
    return base, {"Authorization": f"Bearer {access_token(dev_env)}", "Content-Type": "application/json"}


def legend_tier(value) -> str | None:
    return value.get("final_tier") if isinstance(value, dict) else value


def cmd_fetch(args) -> None:
    skills = [s.strip() for s in args.skills.split(",") if s.strip()]
    unknown = [s for s in skills if s not in ALL_SKILLS]
    if unknown:
        sys.exit(f"unknown skills: {unknown}")
    base, headers = connect()
    legends = api_call("GET", base, "/api/legends", headers) or []
    legends = legends.get("legends", legends) if isinstance(legends, dict) else legends
    print(f"{len(legends)} Legends; asking Claude about {skills} ({PARALLEL} at a time)")

    def one(lg: dict) -> dict:
        detail = api_call("GET", base, f"/api/legends/{lg['id']}?source=draft", headers) or {}
        profile = (detail.get("profile") or detail.get("skills") or {}) if isinstance(detail, dict) else {}
        got = api_call("POST", base, f"/api/legends/{lg['id']}/claude-suggestion", headers, json={"skills": skills}) or {}
        return {"id": lg["id"], "name": lg["name"], "peak_era": lg.get("peak_era"),
                "current": {s: legend_tier(profile.get(s)) for s in skills},
                "claude": {s: (got.get("skills") or {}).get(s) or {} for s in skills}}

    with ThreadPoolExecutor(PARALLEL) as pool:
        rows = sorted(pool.map(one, legends), key=lambda r: r["name"])
    out = Path(args.out)
    out.with_suffix(".json").write_text(json.dumps({"skills": skills, "legends": rows}, indent=1, ensure_ascii=False) + "\n")
    out.with_suffix(".md").write_text(render(skills, rows))
    missing = [r["name"] for r in rows for s in skills if not r["claude"][s].get("tier")]
    print(f"wrote {out.with_suffix('.json')} and .md; Legends without a suggestion: {missing or 'none'}")


def render(skills: list[str], rows: list[dict]) -> str:
    """One table to scan, then the changes, then every reason (collapsed, for a phone)."""
    short = {s: SKILL_LABELS.get(s, s) for s in skills}
    lines = ["| Legend | " + " | ".join(f"{short[s]}: now → Claude" for s in skills) + " |",
             "|---|" + "---|" * len(skills)]
    for r in rows:
        cells = []
        for s in skills:
            now, new = r["current"][s] or "—", r["claude"][s].get("tier") or "?"
            cells.append(f"{now} → **{new}**" if now != new else f"{now} (same)")
        lines.append(f"| {r['name']} | " + " | ".join(cells) + " |")
    lines += ["", "<details><summary>Claude's reasons, Legend by Legend</summary>", ""]
    for r in rows:
        lines.append(f"**{r['name']}** ({r['peak_era'] or 'era ?'})")
        for s in skills:
            c = r["claude"][s]
            lines.append(f"- {short[s]}: **{c.get('tier') or '?'}** — {c.get('justification') or 'no reason returned'}")
        lines.append("")
    lines.append("</details>")
    return "\n".join(lines) + "\n"


def cmd_apply(args) -> None:
    data = json.loads(Path(args.file).read_text())
    skills = data["skills"]
    picks = {r["id"]: {s: r["claude"][s].get("tier") for s in skills} for r in data["legends"]}
    by_name = {r["name"]: r["id"] for r in data["legends"]}
    for o in args.override or []:
        name, _, rest = o.partition(":")
        skill, _, tier = rest.partition("=")
        if name not in by_name or skill not in skills or tier not in TIERS:
            sys.exit(f"bad --override {o!r}: expected 'Legend Name:skill=Tier' with a skill from {skills}")
        picks[by_name[name]][skill] = tier
    empty = [r["name"] for r in data["legends"] for s in skills if not picks[r["id"]][s]]
    if empty:
        sys.exit(f"no tier to write for {empty}; add an --override for each")
    changes = [(r["name"], s, r["current"][s], picks[r["id"]][s]) for r in data["legends"] for s in skills
               if r["current"][s] != picks[r["id"]][s]]
    print(f"{len(changes)} tier changes across {len(data['legends'])} Legends:")
    for name, s, now, new in changes:
        print(f"  {name}: {s} {now} -> {new}")
    if not args.yes:
        print("dry run: nothing written. Add --yes to write.")
        return
    base, headers = connect()
    for r in data["legends"]:
        api_call("PUT", base, f"/api/legends/{r['id']}/skills", headers, json={"profile": picks[r["id"]]})
    print(f"wrote {len(data['legends'])} Legend profiles")


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Legend pass by command (dev only).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--skills", required=True)
    f.add_argument("--out", required=True, help="path without extension; writes .json and .md")
    a = sub.add_parser("apply")
    a.add_argument("--file", required=True, help="the .json that fetch wrote")
    a.add_argument("--override", action="append", help="'Legend Name:skill=Tier', repeatable")
    a.add_argument("--yes", action="store_true", help="write (default: dry run)")
    args = ap.parse_args(argv)
    {"fetch": cmd_fetch, "apply": cmd_apply}[args.cmd](args)


if __name__ == "__main__":
    main()
