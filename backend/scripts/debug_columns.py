"""
debug_columns.py — Print actual column names and Wembanyama's row from
the tracking defense, hustle, and passing bulk endpoints.

Run from the backend/ directory:
    python -m scripts.debug_columns

Requires the bulk stats to be cached (or will trigger a fresh fetch ~42s).
"""

import sys
import os

# Allow running from backend/ as working directory
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from services import nba_api_client

# Victor Wembanyama's nba_api player ID
WEMBY_ID = 1641705
SEASON = "2025-26"


def inspect_source(label: str, key: str, bulk_data: dict) -> None:
    """Print column names and Wembanyama's row for a single bulk data source."""
    print(f"\n{'='*60}")
    print(f"SOURCE: {label!r}  (key={key!r})")
    source = bulk_data.get(key, {})
    if not source:
        print("  *** EMPTY or MISSING ***")
        return

    # Grab any row to inspect column names (first player in dict)
    sample_row = next(iter(source.values()), {})
    print(f"  Columns ({len(sample_row)}): {list(sample_row.keys())}")

    wemby_row = source.get(WEMBY_ID)
    if wemby_row is None:
        print(f"  *** Wembanyama (id={WEMBY_ID}) NOT FOUND in this source ***")
    else:
        print(f"  Wembanyama's row:")
        for k, v in wemby_row.items():
            print(f"    {k}: {v}")


def main() -> None:
    print(f"Fetching bulk stats for {SEASON} (uses cache if available)...")
    bulk_data = nba_api_client.get_bulk_stats(SEASON)
    print(f"Loaded {len(bulk_data)} sources: {list(bulk_data.keys())}")

    # --- Tracking defense (all null for Wemby) ---
    inspect_source("LeagueDashPtStats/Defense", "defense", bulk_data)
    inspect_source("LeagueDashPtDefend/LessThan6Ft", "defend_less_than_6ft", bulk_data)

    # --- Hustle (box_outs null for Wemby) ---
    inspect_source("LeagueHustleStatsPlayer", "hustle", bulk_data)

    # --- Passing (ast_adj null for Wemby) ---
    inspect_source("LeagueDashPtStats/Passing", "passing", bulk_data)

    # --- Advanced (blk_pct / stl_pct null for Wemby) ---
    inspect_source("LeagueDashPlayerStats/Advanced", "advanced", bulk_data)


if __name__ == "__main__":
    main()
