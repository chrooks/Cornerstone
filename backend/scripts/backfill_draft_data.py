"""
One-shot backfill: populate draft_round + season_exp for all existing players.

Calls PlayerIndex once (bulk, ~2s) and updates every player row.
Safe to re-run — upserts on nba_api_id.

Usage:
  cd backend
  source venv/bin/activate
  python scripts/backfill_draft_data.py
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import nba_api_client
from services.supabase_client import get_supabase
from services.players_service import CURRENT_SEASON


def main() -> None:
    season = CURRENT_SEASON
    season_start = int(season.split("-")[0])

    print(f"Fetching PlayerIndex for {season}...")
    player_index = nba_api_client.get_player_index(season)
    print(f"Got {len(player_index)} players from PlayerIndex.")

    supabase = get_supabase()

    # Fetch all player rows for this season
    rows = (
        supabase.table("players")
        .select("id, nba_api_id, draft_round, season_exp")
        .eq("season", season)
        .execute()
    ).data or []
    print(f"Found {len(rows)} player rows in DB for {season}.")

    updates = []
    for row in rows:
        nba_id = row["nba_api_id"]
        idx = player_index.get(nba_id, {})
        draft_round = idx.get("draft_round")
        draft_year = idx.get("draft_year")
        season_exp = (season_start - draft_year) if draft_year else None

        # Skip if nothing to update
        if draft_round is None and season_exp is None:
            continue

        updates.append({
            "id": row["id"],
            "draft_round": draft_round,
            "season_exp": season_exp,
        })

    if not updates:
        print("No updates needed.")
        return

    # Update each player row individually (Supabase doesn't support bulk update by PK)
    for i, u in enumerate(updates):
        supabase.table("players").update({
            "draft_round": u["draft_round"],
            "season_exp": u["season_exp"],
        }).eq("id", u["id"]).execute()
    print(f"Updated {len(updates)} players with draft_round + season_exp.")

    # Quick stats
    rd_count = sum(
        1 for u in updates
        if u["draft_round"] == 1 and (u["season_exp"] or 99) <= 3
    )
    print(f"Rookie deal players: {rd_count}")


if __name__ == "__main__":
    main()
