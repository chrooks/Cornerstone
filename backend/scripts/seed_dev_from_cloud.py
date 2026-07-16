"""Seed the hestia dev-stack Supabase from the cloud project — Lab-path tables only.

The dev box (cornerstone-dev) has schema but no player data (#106 parity gap),
so the Lab renders an empty PlayerPool. This copies the minimal set the Lab
reads: players, legends, snapshot_releases, released_players (ACTIVE release
only — history stays a #106 gap), evaluation_versions, player_stats.

Dry-run by default: prints per-table row counts from both sides and what would
be written. Pass --apply to write. Idempotent: everything is upserted on
primary key, and is_active flags are reconciled to match the cloud exactly.

Usage (from backend/ with its venv, on hestia):

    DEV_SUPABASE_KEY=$(docker exec cornerstone-dev-backend printenv SUPABASE_SERVICE_KEY) \
        python scripts/seed_dev_from_cloud.py [--apply]

Reads the cloud via backend/.env (get_supabase); writes the dev stack via kong
at 127.0.0.1:8092 with the key above. Never touches the cloud project.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from supabase import create_client  # noqa: E402

from services.supabase_client import get_supabase  # noqa: E402

DEV_URL = "http://127.0.0.1:8092"

# (table, upsert batch size) in FK-safe insert order.
TABLES = [
    ("players", 100),
    ("legends", 50),
    ("snapshot_releases", 20),
    ("released_players", 25),  # active release only — see fetch below
    ("evaluation_versions", 5),
    ("player_stats", 25),
]


def fetch_all(client, table, flt=None):
    """Paginate past the 1000-row cap; PostgREST silently truncates otherwise."""
    rows, start, page = [], 0, 1000
    while True:
        q = client.table(table).select("*").range(start, start + page - 1)
        if flt:
            q = flt(q)
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < page:
            return rows
        start += page


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write to the dev DB (default: dry-run)")
    args = parser.parse_args()

    dev_key = os.environ.get("DEV_SUPABASE_KEY")
    if not dev_key:
        sys.exit("DEV_SUPABASE_KEY not set — see module docstring for the one-liner.")

    cloud = get_supabase()
    dev = create_client(DEV_URL, dev_key)

    cloud_releases = fetch_all(cloud, "snapshot_releases")
    active_ids = [r["id"] for r in cloud_releases if r.get("is_active")]
    if len(active_ids) != 1:
        sys.exit(f"Expected exactly one active cloud release, found {len(active_ids)} — aborting.")
    active_id = active_ids[0]
    print(f"cloud active release: {active_id}")

    for table, batch_size in TABLES:
        if table == "snapshot_releases":
            rows = cloud_releases
        elif table == "released_players":
            rows = fetch_all(cloud, table, flt=lambda q: q.eq("snapshot_release_id", active_id))
        else:
            rows = fetch_all(cloud, table)

        dev_count = dev.table(table).select("id", count="exact").limit(1).execute().count
        print(f"{table:22s} cloud={len(rows):5d}  dev={dev_count:5d}", end="")

        if not args.apply:
            print("  [dry-run: would upsert]")
            continue

        for i in range(0, len(rows), batch_size):
            dev.table(table).upsert(rows[i : i + batch_size]).execute()
        print(f"  upserted {len(rows)}")

        if table == "snapshot_releases":
            # Exactly the cloud's active release stays active on dev.
            dev.table("snapshot_releases").update({"is_active": False}).neq("id", active_id).execute()

    print("done" + ("" if args.apply else " (dry-run — pass --apply to write)"))
    if args.apply:
        print("restart the dev backend to rewarm caches: docker restart cornerstone-dev-backend")


if __name__ == "__main__":
    main()
