"""
Bulk-fetch Claude's steady_hand suggestion for every Legend still missing that
rating, and dump them to a file for admin review/paste into the Legends editor.

Does NOT write anything — /legends/<id>/skills still requires a human accept
via the open Snapshot draft (see issue #83). This just saves the click-and-wait
of triggering claude-suggestion one legend at a time.

Usage:
  ADMIN_TOKEN=<supabase-access-token> python scripts/backfill_legend_suggestions.py \
      [--api-url http://localhost:5001] [--out steady_hand_suggestions.md]
"""

import argparse
import os
import sys

import requests

SKILL = "steady_hand"


def find_key_absent_legends(legends_with_profiles: list[dict]) -> list[dict]:
    """legends_with_profiles: [{"id", "name", "profile": {...}}, ...]."""
    return [lg for lg in legends_with_profiles if lg["profile"].get(SKILL) is None]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", default=os.environ.get("API_URL", "http://localhost:5001"))
    parser.add_argument("--out", default="steady_hand_suggestions.md")
    args = parser.parse_args()

    token = os.environ.get("ADMIN_TOKEN")
    if not token:
        print("Set ADMIN_TOKEN to a Supabase admin access token", file=sys.stderr)
        return 1
    headers = {"Authorization": f"Bearer {token}"}

    base = args.api_url.rstrip("/") + "/api"
    legends = requests.get(f"{base}/legends", params={"source": "draft"}, headers=headers, timeout=30).json()["data"]

    with_profiles = []
    for lg in legends:
        detail = requests.get(f"{base}/legends/{lg['id']}", params={"source": "draft"}, headers=headers, timeout=30).json()["data"]
        with_profiles.append({"id": lg["id"], "name": lg["name"], "profile": detail["profile"]})

    targets = find_key_absent_legends(with_profiles)
    print(f"{len(targets)}/{len(with_profiles)} legends missing {SKILL}")

    lines = [f"# {SKILL} suggestions ({len(targets)} legends)\n"]
    for lg in targets:
        resp = requests.post(
            f"{base}/legends/{lg['id']}/claude-suggestion",
            json={"skills": [SKILL]},
            headers=headers,
            timeout=60,
        )
        if resp.status_code != 200:
            lines.append(f"## {lg['name']} — ERROR {resp.status_code}: {resp.text}\n")
            continue
        suggestion = resp.json()["data"]["skills"][SKILL]
        lines.append(
            f"## {lg['name']} ({lg['id']})\n"
            f"- tier: **{suggestion['tier']}**\n"
            f"- justification: {suggestion['justification']}\n"
        )
        print(f"  {lg['name']}: {suggestion['tier']}")

    with open(args.out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {args.out}")
    return 0


def _demo() -> None:
    """ponytail: no live server in this repo's test env, so the self-check
    covers the pure filter helper only — the actual API calls are exercised
    manually against a running backend."""
    sample = [
        {"id": "1", "name": "Has it", "profile": {SKILL: "Elite"}},
        {"id": "2", "name": "None tier (rated)", "profile": {SKILL: "None"}},
        {"id": "3", "name": "Key-absent", "profile": {}},
    ]
    result = find_key_absent_legends(sample)
    assert [lg["name"] for lg in result] == ["Key-absent"]
    print("demo ok")


if __name__ == "__main__":
    if "--demo" in sys.argv:
        _demo()
    else:
        sys.exit(main())
