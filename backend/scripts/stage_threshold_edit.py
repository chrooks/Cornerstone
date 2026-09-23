"""
scripts/stage_threshold_edit.py — drive the DEV draft's threshold edits and pipeline
runs from the command line (#119 plan, M5.2-M5.8).

Two commands, one auth/guard/summary path:

  (no command)  stage a threshold rule — replaces the hand-clicking in M5.2/M5.3/M5.4
                (paste into the Monaco editor on /admin/calibration, "Stage Edit",
                Pipeline tab, wait, read the diff, "Commit"). Drives
                `POST /api/skills/thresholds/<skill>/save` (`api/calibration.py`).

  run           start a skill-evaluation run — replaces the checkbox-ticking in
                M5.5/M5.6/M5.7/M5.8 (`#skill-eval-runner` in the draft's Pipeline tab).
                Drives `POST /api/pipeline/skill-evaluation` (`api/pipeline.py`).

Both drive the same HTTP Surface the UI drives, so nothing about the
draft / diff-preview / commit workflow changes — only who clicks.

Staging applies NOTHING. A run stages rows in pipeline_run_results; the separate
commit endpoint is what writes them into the draft working tables. `run` NEVER
commits — reading the diff and then committing (--commit-run) or throwing the run
away (--discard-run) stay a deliberate second act.

Run (from backend/, venv active):
    python scripts/stage_threshold_edit.py --skill versatile_defender \
        --rule ../.tasks/119-3d-archetypes/vd_rule_candidate.json --wait
    python scripts/stage_threshold_edit.py run --wait                     # M5.5
    python scripts/stage_threshold_edit.py run --skills rim_protector,... \
        --recompute-composite --wait                                      # M5.6
    python scripts/stage_threshold_edit.py --commit-run <run_id>

Safety, by construction:
  - refuses any target that looks like production (*.supabase.co, or an API base that
    is not the dev host) unless --allow-prod;
  - refuses --with-claude without --recompute-composite, and without --yes, before
    anything leaves the machine — a ~400-call Claude spend never starts by accident;
  - never writes to the database — every mutation goes through the dev API;
  - never prints the calibration key, the admin password or the access token.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

import requests

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import dotenv_values  # noqa: E402

from services.skills import ALL_SKILLS  # noqa: E402

DEV_API = "https://cornerstone-dev.hestia.chrooks.com"
# The live dev stack's own env file: the CALIBRATION_API_KEY the dev backend container
# actually loaded, and the dev Supabase the browser talks to. The repo's
# frontend/.env.local points NEXT_PUBLIC_SUPABASE_URL at the PRODUCTION cloud project,
# so it is deliberately not a source here.
DEV_ENV_FILE = "/srv/compose/cornerstone-dev/.env"
E2E_ENV_FILE = REPO_DIR / "frontend" / ".env.e2e.local"

POLL_SECONDS = 10
PROGRESS_SECONDS = 60
DEFAULT_TIMEOUT = 2700  # the first threshold run of a session refreshes career rows (~15 min)
CLAUDE_TIMEOUT = 5700  # M5.8: ~45 min of Claude calls; the plan calls it stuck at 90 min

# Cost estimate for the --with-claude gate. M5.8 asks Claude once per player, 5 at a
# time: about 45 minutes and a real API spend across the ~400-player dev pool.
POOL_PLAYERS = 400
CLAUDE_MINUTES_PER_POOL = 45


# ---------------------------------------------------------------------------
# Env + production guard
# ---------------------------------------------------------------------------


def read_env(path) -> dict[str, str]:
    """Non-empty values from a dotenv file. Missing file → {}. Values are never printed."""
    path = Path(path)
    if not path.is_file():
        return {}
    return {k: v for k, v in dotenv_values(path).items() if v}


def refuse_production(api_base: str, urls: list[str], allow_prod: bool) -> None:
    """Abort unless the target is the dev stack."""
    if allow_prod:
        print("WARNING: --allow-prod given; the production guard is off")
        return
    for url in urls:
        if ".supabase.co" in (url or ""):
            sys.exit(f"refusing {url}: *.supabase.co is the production project; this script is dev-only")
    if urlparse(api_base).netloc != urlparse(DEV_API).netloc:
        sys.exit(f"refusing API base {api_base}: expected the dev host {DEV_API}")


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _body(resp) -> dict:
    try:
        return resp.json() or {}
    except ValueError:
        return {}


def api_call(method: str, base: str, path: str, headers: dict, **kwargs):
    """One call against the dev API, unwrapping the {success, data, error} envelope."""
    resp = requests.request(method, base + path, headers=headers, timeout=120, **kwargs)
    body = _body(resp)
    if resp.status_code >= 400 or body.get("success") is False:
        # No secret is echoed here: the envelope carries only the server's error string.
        sys.exit(f"{method} {path} failed: HTTP {resp.status_code} — {body.get('error') or resp.text[:200]}")
    return body.get("data")


def access_token(dev_env: dict) -> str:
    """Exchange the dev-only admin test account (plan decision f) for a Supabase JWT."""
    creds = read_env(E2E_ENV_FILE)
    email, password = creds.get("E2E_ADMIN_EMAIL"), creds.get("E2E_ADMIN_PASSWORD")
    if not email or not password:
        sys.exit(f"missing E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD in {E2E_ENV_FILE} (plan decision f, M1.0)")

    supabase_url = dev_env.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    anon = dev_env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    if not supabase_url or not anon:
        sys.exit(f"missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in {DEV_ENV_FILE}")

    resp = requests.request(
        "POST",
        f"{supabase_url}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=60,
    )
    if resp.status_code != 200:
        sys.exit(f"dev admin login failed: HTTP {resp.status_code} — {_body(resp).get('error_description') or 'see the dev Supabase logs'}")
    token = _body(resp).get("access_token")
    if not token:
        sys.exit("dev admin login returned no access_token")
    return token


# ---------------------------------------------------------------------------
# Rule validation (fail before the request, not after)
# ---------------------------------------------------------------------------


def split_csv(value: str | None) -> list[str]:
    """``"a, b ,,c"`` -> ``["a", "b", "c"]``. Empty/None -> ``[]`` (which means "all")."""
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def check_skill(skill: str) -> str:
    """Reject a Skill the server's allowlist would reject, before the request goes out.

    `api/pipeline.py` and `api/calibration.py` both validate against this same
    `ALL_SKILLS`, so a typo dies here with a suggestion instead of as a 400.
    """
    if skill not in ALL_SKILLS:
        near = [s for s in ALL_SKILLS if s.startswith(skill[:4])]
        sys.exit(f"unknown skill '{skill}' — not in the taxonomy the server allowlists"
                 + (f". Did you mean: {', '.join(near)}?" if near else f". Known: {', '.join(ALL_SKILLS)}"))
    return skill


def load_rule(skill: str, rule_path: str) -> dict:
    check_skill(skill)
    path = Path(rule_path)
    if not path.is_file():
        sys.exit(f"rule file not found: {path}")
    try:
        rule = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        sys.exit(f"rule file is not valid JSON: {path}: {exc}")
    if not isinstance(rule, dict) or "tiers" not in rule:
        sys.exit(f"rule file must be a JSON object with a 'tiers' key: {path}")
    stored = rule.get("skill_name")
    if stored and stored != skill:
        sys.exit(f"rule file says skill_name='{stored}' but --skill is '{skill}'")
    return rule


def validate_run(args) -> tuple[list[str], list[str]]:
    """Every `run` check that needs no network. Exits on the first bad input.

    Returns (skill keys, player names). Runs BEFORE the login, so a refused run
    sends nothing at all — that is the point of the --with-claude gates.
    """
    if args.commit or args.commit_run or args.discard_run:
        sys.exit("run never commits — read the diff, then: "
                 "python scripts/stage_threshold_edit.py --commit-run <run_id> "
                 "(or --discard-run <run_id>)")
    if args.skill or args.rule:
        sys.exit("--skill/--rule stage a threshold rule; run takes --skills instead")

    skills = [check_skill(s) for s in split_csv(args.skills)]
    players = split_csv(args.players)

    # Mirror the server's own refusals (api/pipeline.py) so the message arrives
    # before the request, not as a 400 after it.
    if args.with_claude and not args.recompute_composite:
        sys.exit("--with-claude needs --recompute-composite: a fresh Claude tier only "
                 "reaches the profile through the composite merge")
    if (args.recompute_composite or args.with_claude) and not skills:
        sys.exit("--recompute-composite / --with-claude must name their Skills with "
                 "--skills a,b,c — an unscoped composite recompute is refused")

    if args.with_claude and not args.yes:
        count = len(players) or POOL_PLAYERS
        minutes = max(3, round(count * CLAUDE_MINUTES_PER_POOL / POOL_PLAYERS))
        sys.exit(
            f"\nCOST: --with-claude calls the Claude API once per player.\n"
            f"  players:  {count if players else f'all qualifying (about {POOL_PLAYERS})'}\n"
            f"  skills:   {', '.join(skills)}\n"
            f"  expect:   about {minutes} minutes and a real API spend\n"
            f"  while it runs: no develop pushes (a push kills the run thread)\n"
            f"Re-run with --yes when you mean it."
        )
    return skills, players


def resolve_player_ids(base: str, headers: dict, names: list[str]) -> list[str]:
    """Player names -> UUIDs through the DB-only search endpoint (never NBA.com)."""
    ids = []
    for name in names:
        rows = api_call("GET", base, "/api/players/search", headers,
                        params={"q": name, "limit": 50}) or []
        exact = [r for r in rows if (r.get("name") or "").strip().lower() == name.lower()]
        matches = exact or rows
        if not matches:
            sys.exit(f"no player named '{name}' in the dev pool for this season — check the spelling")
        if len(matches) > 1:
            sys.exit(f"'{name}' matches {len(matches)} players "
                     f"({', '.join(r['name'] for r in matches[:5])}) — give the full name")
        print(f"  player: {name} -> {matches[0]['name']} ({matches[0].get('team')})")
        ids.append(matches[0]["id"])
    return ids


# ---------------------------------------------------------------------------
# Diff summary — its whole job is being readable by a person deciding to commit
# ---------------------------------------------------------------------------


def count_flag_rows(rows) -> dict:
    """Staged flag rows counted by (skill, reason). A reason like ``low_confidence:foo``
    counts under ``low_confidence``, as the draft's own run view does."""
    return dict(Counter((r["skill_name"], (r["flag_reason"] or "").split(":")[0]) for r in rows))


def staged_flags_by_reason(run_id: str) -> dict:
    """Staged flag rows for the run, counted by (skill, reason).

    A read-only database read: pipeline_run_flag_results has no HTTP Surface, and the
    flags a run would stage are half of what a person needs to judge a rule. Uses
    dev_checks' guarded client, so only SELECT gets through.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from dev_checks import pages, read_only_client

    sb = read_only_client()
    return count_flag_rows(pages(lambda: sb.table("pipeline_run_flag_results")
                                 .select("skill_name, flag_reason").eq("run_id", run_id).order("player_id")))


def print_summary(run: dict, diff: dict, flags: dict | None) -> None:
    print()
    print(f"run {run['id']}  status={run['status']}  rows_processed={run.get('rows_processed')}")
    if run.get("error_tail"):
        print(f"ERROR recorded by the run: {run['error_tail']}")

    changes = diff.get("changes") or []
    summary = diff.get("summary") or {}
    moved = [c for c in changes if c.get("change_type") != "unchanged"]
    print(f"\ntier moves ({len(moved)} changed of {len(changes)} staged entries):")
    for (old, new), n in sorted(Counter((c.get("old_tier") or "(none)", c.get("new_tier")) for c in moved).items(),
                                key=lambda kv: -kv[1]):
        print(f"  {old} -> {new}: {n}")
    if not moved:
        print("  (none)")

    print("\nper skill:")
    for skill, s in sorted((summary.get("per_skill") or {}).items()):
        print(f"  {skill}: promotions={s.get('promotions')} demotions={s.get('demotions')} "
              f"new={s.get('new')} unchanged={s.get('unchanged')}")

    if flags is None:
        print("\nflags this run would stage: unavailable (could not read the dev database)")
    else:
        print(f"\nflags this run would stage ({sum(flags.values())}):")
        for (skill, reason), n in sorted(flags.items(), key=lambda kv: -kv[1]):
            print(f"  {skill} / {reason}: {n}")
        if not flags:
            print("  (none)")


def wait_for_run(base: str, headers: dict, run_id: str, timeout_s: int) -> dict:
    started = time.monotonic()
    last_note = 0.0
    while True:
        run = api_call("GET", base, f"/api/pipeline-runs/{run_id}", headers)
        if run.get("status") != "running":
            return run
        elapsed = time.monotonic() - started
        if elapsed > timeout_s:
            sys.exit(f"run {run_id} still running after {int(elapsed)}s — it is not lost; "
                     f"check the Pipeline tab, or re-poll with --commit-run once it succeeds")
        if elapsed - last_note >= PROGRESS_SECONDS:
            last_note = elapsed
            print(f"  still running ({int(elapsed)}s)...", flush=True)
        time.sleep(POLL_SECONDS)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Drive the dev draft's threshold edits and pipeline runs (#119 plan, M5.2-M5.8).")
    p.add_argument("command", nargs="?", choices=["run"],
                   help="'run' starts a skill-evaluation run (M5.5-M5.8); omit it to stage a threshold rule (M5.2-M5.4)")
    p.add_argument("--skill", help="skill key, e.g. versatile_defender")
    p.add_argument("--rule", help="path to the candidate rule JSON")
    p.add_argument("--wait", action="store_true", help="poll the staged run and print its diff summary")
    p.add_argument("--commit", action="store_true", help="commit the run after it succeeds (implies --wait); default is stage-only")
    p.add_argument("--commit-run", metavar="RUN_ID", help="commit an already-staged run and exit (the 'I read the diff, ship it' step)")
    p.add_argument("--discard-run", metavar="RUN_ID", help="throw away an already-staged run's rows and exit (how M5.7 ends)")
    p.add_argument("--allow-prod", action="store_true", help="disable the production guard (nobody passes this)")
    p.add_argument("--dry-run", action="store_true", help="authenticate and validate, then stop without staging")
    p.add_argument("--env-file", default=DEV_ENV_FILE, help=f"dev stack env file (default {DEV_ENV_FILE})")
    p.add_argument("--timeout", type=int,
                   help=f"seconds to wait for the run (default {DEFAULT_TIMEOUT}, or {CLAUDE_TIMEOUT} with --with-claude)")

    g = p.add_argument_group("run (M5.5-M5.8)")
    g.add_argument("--skills", help="comma-separated skill keys for the run; empty means all 21")
    g.add_argument("--players", help="comma-separated player names; empty means all qualifying players")
    g.add_argument("--recompute-composite", action="store_true", help="stage the merged composite, not a stats row (M5.6-M5.8)")
    g.add_argument("--with-claude", action="store_true", help="re-rate the filtered Skills with Claude; needs --recompute-composite and --yes (M5.7-M5.8)")
    g.add_argument("--yes", action="store_true", help="confirm the Claude API spend a --with-claude run costs")
    return p


def main(argv=None) -> None:
    args = build_parser().parse_args(argv)
    is_run = args.command == "run"
    if not is_run and not (args.commit_run or args.discard_run) and not (args.skill and args.rule):
        sys.exit("--skill and --rule are required (or 'run' for a pipeline run, or "
                 "--commit-run / --discard-run <run_id> to finish an existing run)")

    dev_env = read_env(args.env_file)
    backend_env = read_env(BACKEND_DIR / ".env")
    api_base = (dev_env.get("NEXT_PUBLIC_API_URL") or DEV_API).rstrip("/")
    refuse_production(
        api_base,
        [backend_env.get("SUPABASE_URL", ""), dev_env.get("NEXT_PUBLIC_SUPABASE_URL", "")],
        args.allow_prod,
    )

    calibration_key = dev_env.get("CALIBRATION_API_KEY")
    if not calibration_key:
        sys.exit(f"CALIBRATION_API_KEY is not set in {args.env_file} — that is the key the dev backend loaded")

    # Everything that can fail locally fails here — before the login, so a refused
    # run (a Skill typo, a missing --yes) sends nothing at all.
    skills, player_names = validate_run(args) if is_run else ([], [])
    rule = load_rule(args.skill, args.rule) if args.skill else None

    print(f"target: {api_base}")
    if rule is not None:
        print(f"rule:   {args.rule} ({len(rule.get('tiers') or {})} tiers) -> {args.skill}")
    if is_run:
        print(f"run:    skills={', '.join(skills) or 'all 21'}  "
              f"players={len(player_names) or 'all qualifying'}  "
              f"recompute_composite={args.recompute_composite}  with_claude={args.with_claude}")

    headers = {
        "Authorization": f"Bearer {access_token(dev_env)}",
        "X-Calibration-Key": calibration_key,
        "Content-Type": "application/json",
    }
    print("auth:   logged in as the dev admin test account")

    if args.commit_run:
        result = api_call("POST", api_base, f"/api/pipeline-runs/{args.commit_run}/commit", headers)
        print(f"committed run {args.commit_run} at {result.get('committed_at')}")
        return

    if args.discard_run:
        api_call("POST", api_base, f"/api/pipeline-runs/{args.discard_run}/discard", headers)
        print(f"discarded run {args.discard_run} — its staged rows are gone; the draft is untouched")
        return

    player_ids = resolve_player_ids(api_base, headers, player_names) if player_names else []

    if args.dry_run:
        print("dry run: validated and authenticated; nothing staged")
        return

    if is_run:
        data = api_call("POST", api_base, "/api/pipeline/skill-evaluation", headers, json={
            "player_ids": player_ids,
            "skill_filter": skills or None,
            "recompute_composite": bool(args.recompute_composite),
            "with_claude": bool(args.with_claude),
        })
    else:
        data = api_call("POST", api_base, f"/api/skills/thresholds/{args.skill}/save", headers, json=rule)
    run_id = data["run_id"]
    print(f"staged run {run_id} — NOTHING is applied until it is committed")

    if not (args.wait or args.commit):
        print(f"next: python scripts/stage_threshold_edit.py --commit-run {run_id}   (or click Commit in the draft's Pipeline tab)")
        return

    timeout = args.timeout or (CLAUDE_TIMEOUT if args.with_claude else DEFAULT_TIMEOUT)
    run = wait_for_run(api_base, headers, run_id, timeout)
    diff = api_call("GET", api_base, f"/api/pipeline-runs/{run_id}/diff", headers)
    try:
        flags = staged_flags_by_reason(run_id)
    except Exception as exc:  # a summary without flags still beats no summary
        print(f"note: could not read staged flags ({type(exc).__name__}: {exc})")
        flags = None
    print_summary(run, diff, flags)

    if run.get("status") != "success":
        sys.exit(f"\nrun finished with status={run['status']} — nothing to commit")

    # `run` deliberately has no commit path: M5.7 ends in a Discard, M5.8 in a
    # Commit, and which one it is stays a person's call after reading the diff.
    if is_run:
        print(f"\nnot committed — run never commits. To commit: "
              f"python scripts/stage_threshold_edit.py --commit-run {run_id}"
              f"\n(or throw it away: python scripts/stage_threshold_edit.py "
              f"--discard-run {run_id} — that is how M5.7 ends)")
    elif args.commit:
        result = api_call("POST", api_base, f"/api/pipeline-runs/{run_id}/commit", headers)
        print(f"\ncommitted run {run_id} at {result.get('committed_at')}")
    else:
        print(f"\nnot committed (default). To commit: "
              f"python scripts/stage_threshold_edit.py --commit-run {run_id}")


if __name__ == "__main__":
    main()
