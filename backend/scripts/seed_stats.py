"""
seed_stats.py — Bulk seed player stats into Supabase.

Runs in three phases:
  1. Fetch all qualifying players (min_mpg threshold) and upsert into players table.
  1.5. Scrape ESPN for salaries and write them into players.salary before stats assembly.
  2. Iterate every player and fetch their full stats blob, caching into player_stats.

Usage (from backend/):
  python scripts/seed_stats.py
  python scripts/seed_stats.py --min-mpg 10
  python scripts/seed_stats.py --season 2024-25
  python scripts/seed_stats.py --skip-existing   # Skip players already in player_stats
  python scripts/seed_stats.py --skip-salaries   # Skip ESPN salary scrape (Phase 1.5)
  python scripts/seed_stats.py --dry-run         # List players only, no stats fetching

The NBA API has a rate limit — a 2s delay is inserted between each per-player stats
call. For ~250 qualified players this takes ~10-15 minutes total. The salary scrape
(Phase 1.5) adds ~30-45 seconds for a full league sweep.
"""

import argparse
import logging
import os
import sys
import time

# ---------------------------------------------------------------------------
# Path setup — allow running from backend/ or backend/scripts/
# ---------------------------------------------------------------------------
script_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.dirname(script_dir)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# Load .env before importing any service modules
from dotenv import load_dotenv
load_dotenv(os.path.join(backend_dir, ".env"))

# Configure logging early so service-layer logs are visible
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("seed_stats")

from services.supabase_client import get_supabase
from services import players_service


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _player_has_cached_stats(player_id: str, season: str, supabase) -> bool:
    """Return True if a non-expired stats row already exists for this player/season."""
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(hours=players_service._STATS_TTL_HOURS)
    result = (
        supabase.table("player_stats")
        .select("fetched_at")
        .eq("player_id", player_id)
        .eq("season", season)
        .order("fetched_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return False
    fetched_at_str = result.data[0]["fetched_at"]
    try:
        fetched_at_str = fetched_at_str.replace("Z", "+00:00")
        fetched_at = datetime.fromisoformat(fetched_at_str)
        if fetched_at.tzinfo is None:
            from datetime import timezone
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        return fetched_at > cutoff
    except (ValueError, AttributeError):
        return False


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Seed player stats into Supabase.")
    parser.add_argument(
        "--season",
        default=players_service.CURRENT_SEASON,
        help=f"NBA season string (default: {players_service.CURRENT_SEASON})",
    )
    parser.add_argument(
        "--min-mpg",
        type=float,
        default=players_service.DEFAULT_MIN_MPG,
        help=f"Minimum minutes-per-game filter (default: {players_service.DEFAULT_MIN_MPG})",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip players that already have a fresh stats row (avoids re-fetching)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Phase 1 only: list qualifying players without fetching stats",
    )
    parser.add_argument(
        "--skip-salaries",
        action="store_true",
        help="Skip the ESPN salary scrape (Phase 1.5) — useful if salaries are already fresh",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Seconds to wait between per-player API calls (default: 2.0)",
    )
    args = parser.parse_args()

    supabase = get_supabase()

    # ------------------------------------------------------------------
    # Phase 1 — Populate / refresh the players table
    # ------------------------------------------------------------------
    logger.info("Phase 1 — fetching player list for season=%s min_mpg=%.1f", args.season, args.min_mpg)
    players = players_service.get_or_fetch_players(
        season=args.season,
        min_mpg=args.min_mpg,
        refresh=True,  # Always refresh the player list so we have fresh IDs
        supabase=supabase,
    )

    if not players:
        logger.error("No players returned — check nba_api connectivity and season string.")
        sys.exit(1)

    logger.info("Phase 1 complete — %d qualifying players found.", len(players))

    if args.dry_run:
        logger.info("--dry-run enabled, skipping salary and stats phases.")
        for p in players:
            print(f"  {p['name']:30s} {p['team']:5s} {p['minutes_per_game']:.1f} mpg")
        return

    # ------------------------------------------------------------------
    # Phase 1.5 — Bulk salary scrape from ESPN
    # Runs before stats assembly so salary is embedded in the stats blob.
    # ------------------------------------------------------------------
    if args.skip_salaries:
        logger.info("Phase 1.5 — skipping salary scrape (--skip-salaries set).")
    else:
        logger.info("Phase 1.5 — scraping ESPN salaries for all teams (~30-45s) ...")
        try:
            salary_result = players_service.run_bulk_salary_scrape(
                team_abbrev=None,  # None = full league sweep
                supabase=supabase,
            )
            logger.info(
                "Phase 1.5 complete — matched=%d unmatched=%d total=%d",
                salary_result["matched"],
                salary_result["unmatched"],
                salary_result["total"],
            )
        except Exception as exc:
            # Non-fatal — log and continue; stats will be assembled without salary
            logger.warning("Phase 1.5 salary scrape failed (%s) — continuing without salaries.", exc)

    # ------------------------------------------------------------------
    # Phase 2 — Fetch full stats blob for each player
    # ------------------------------------------------------------------
    total       = len(players)
    succeeded   = 0
    skipped     = 0
    failed      = 0
    failed_names: list[str] = []

    logger.info("Phase 2 — seeding stats for %d players (delay=%.1fs between calls).", total, args.delay)

    for idx, player in enumerate(players, start=1):
        player_id   = player["id"]
        player_name = player["name"]

        # Optionally skip players that already have fresh cached stats
        if args.skip_existing and _player_has_cached_stats(player_id, args.season, supabase):
            logger.info("[%d/%d] SKIP  %s — fresh cache exists", idx, total, player_name)
            skipped += 1
            continue

        logger.info("[%d/%d] Fetching stats for %s ...", idx, total, player_name)
        try:
            blob = players_service.get_or_fetch_player_stats(
                player_id=player_id,
                season=args.season,
                supabase=supabase,
            )
            if blob:
                logger.info("[%d/%d] OK    %s", idx, total, player_name)
                succeeded += 1
            else:
                logger.warning("[%d/%d] EMPTY %s — no stats blob returned", idx, total, player_name)
                failed += 1
                failed_names.append(player_name)
        except Exception as exc:
            logger.error("[%d/%d] ERROR %s — %s", idx, total, player_name, exc)
            failed += 1
            failed_names.append(player_name)

        # Respect NBA API rate limits — pause between players
        if idx < total:
            time.sleep(args.delay)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    logger.info(
        "Seeding complete — %d succeeded, %d skipped, %d failed (out of %d total).",
        succeeded, skipped, failed, total,
    )
    if failed_names:
        logger.warning("Failed players:\n  %s", "\n  ".join(failed_names))


if __name__ == "__main__":
    main()
