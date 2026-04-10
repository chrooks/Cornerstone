"""
backfill_legend_nba_api_ids.py — Backfill nba_api_id for all legends rows.

For each legend, looks up their full name using nba_api's static player index
and writes the matched NBA.com player ID into the legends table.

Usage (from backend/):
  python scripts/backfill_legend_nba_api_ids.py
  python scripts/backfill_legend_nba_api_ids.py --dry-run
"""

import argparse
import logging
import os
import sys

# ---------------------------------------------------------------------------
# Path setup — allow running from backend/ or backend/scripts/
# ---------------------------------------------------------------------------

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPT_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

# ---------------------------------------------------------------------------

from nba_api.stats.static import players as nba_static_players  # noqa: E402
from services.supabase_client import get_supabase  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


# Common nickname → canonical name mappings for legends stored under nicknames.
_NAME_OVERRIDES: dict[str, str] = {
    "Steph Curry": "Stephen Curry",
}


def main(dry_run: bool = False) -> None:
    supabase = get_supabase()

    # Fetch all legends
    res = supabase.table("legends").select("id, name").order("name").execute()
    legends = res.data or []
    logger.info("Found %d legends to process", len(legends))

    matched = []
    unmatched = []

    for legend in legends:
        lid = legend["id"]
        name = legend["name"]

        lookup_name = _NAME_OVERRIDES.get(name, name)
        results = nba_static_players.find_players_by_full_name(lookup_name)
        if results:
            nba_api_id = results[0]["id"]
            matched.append((name, nba_api_id))
            if not dry_run:
                supabase.table("legends").update({"nba_api_id": nba_api_id}).eq("id", lid).execute()
            logger.info("  MATCHED  %-30s → %s", name, nba_api_id)
        else:
            unmatched.append(name)
            logger.warning("  NO MATCH %-30s", name)

    print(f"\n=== Results ===")
    print(f"  Matched:   {len(matched)}")
    print(f"  Unmatched: {len(unmatched)}")
    if unmatched:
        print("\nUnmatched legends (manual lookup required):")
        for name in unmatched:
            print(f"  - {name}")
    if dry_run:
        print("\n[DRY RUN] No database updates written.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill nba_api_id for legends")
    parser.add_argument("--dry-run", action="store_true", help="Print matches without writing to DB")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
