"""
backfill_legend_canonical_players.py — ensure every legend has a canonical_players row.

The publish_snapshot_draft RPC freezes each legend into released_players by joining
legends -> canonical_players on nba_api_id. Legends who were never current-season
players (retired greats) never got a canonical_players row from the current-player
seed, so the RPC's legends_missing_canonical_player preflight hard-blocks publish.

This script inserts a canonical_players row (nba_api_id + display_name) for any
legend that is missing one. Idempotent: existing canonical rows are left untouched
(nba_api_id is UNIQUE). Legends with a NULL nba_api_id are reported and skipped —
run backfill_legend_nba_api_ids.py first for those.

Usage (from backend/):
  python scripts/backfill_legend_canonical_players.py --dry-run
  python scripts/backfill_legend_canonical_players.py
"""

import argparse
import logging
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SCRIPT_DIR)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from services.supabase_client import get_supabase  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be inserted without writing.",
    )
    args = parser.parse_args()

    sb = get_supabase()

    legends = sb.table("legends").select("id, name, nba_api_id").execute().data or []
    canon_ids = {
        str(c["nba_api_id"])
        for c in (sb.table("canonical_players").select("nba_api_id").execute().data or [])
    }

    missing = []
    null_ids = []
    for legend in legends:
        nba_id = legend.get("nba_api_id")
        if not nba_id:
            null_ids.append(legend)
            continue
        if str(nba_id) not in canon_ids:
            missing.append(legend)

    logger.info("legends total=%d  missing_canonical=%d  null_nba_api_id=%d",
                len(legends), len(missing), len(null_ids))

    for legend in null_ids:
        logger.warning("SKIP (no nba_api_id): %s — run backfill_legend_nba_api_ids.py first",
                       legend["name"])

    if not missing:
        logger.info("Nothing to backfill. Every legend with an nba_api_id has a canonical row.")
        return 0

    for legend in missing:
        logger.info("%s INSERT canonical_players nba_api_id=%s display_name=%r",
                    "[dry-run]" if args.dry_run else "",
                    legend["nba_api_id"], legend["name"])

    if args.dry_run:
        logger.info("Dry run — no rows written. Re-run without --dry-run to apply.")
        return 0

    rows = [
        {"nba_api_id": legend["nba_api_id"], "display_name": legend["name"]}
        for legend in missing
    ]
    sb.table("canonical_players").insert(rows).execute()
    logger.info("Inserted %d canonical_players rows.", len(rows))

    # Verify none remain.
    canon_ids_after = {
        str(c["nba_api_id"])
        for c in (sb.table("canonical_players").select("nba_api_id").execute().data or [])
    }
    still_missing = [
        legend for legend in legends
        if legend.get("nba_api_id") and str(legend["nba_api_id"]) not in canon_ids_after
    ]
    logger.info("legends still missing canonical after backfill: %d", len(still_missing))
    return 0 if not still_missing else 1


if __name__ == "__main__":
    raise SystemExit(main())
