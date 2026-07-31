"""
scripts/audit_tier_drift.py — read-only sweep for stale stat-derived skill
tiers (issue #86).

Question: does any player's stored, stats-derived composite skill tier
(source='stats_only' — the HIGH_CONFIDENCE_SKILLS no-Claude, no-human path)
disagree with what the current evaluator + live thresholds would produce
from their latest player_stats row? Nothing re-runs the pipeline
automatically when a threshold or stat blob changes, so a stored tier can go
stale and survive every later publish forever (the Giannis
offensive_rebounder bug behind #86).

Sweeps every player with a composite profile for the working season (the
open draft's season, or the active release's season if no draft is open —
services.snapshot_versions.repo.get_working_season) x every skill.

STRICTLY READ-ONLY. Delegates to
services.snapshot_versions.drift_audit.find_tier_drift(), which never writes.

Run:
    cd backend && source venv/bin/activate && python scripts/audit_tier_drift.py
    cd backend && source venv/bin/activate && python scripts/audit_tier_drift.py --season 2025-26
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services.snapshot_versions.drift_audit import find_tier_drift  # noqa: E402
from services.snapshot_versions.repo import get_working_season  # noqa: E402
from services.supabase_client import get_supabase  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--season",
        default=None,
        help=(
            "Season to audit (default: the current working season — the open "
            "draft's season, or the active release's season if no draft is open)."
        ),
    )
    args = parser.parse_args()

    client = get_supabase()
    season = args.season or get_working_season(client)

    print(f"Auditing stat-tier drift for season={season!r}...")
    drift = find_tier_drift(season, client=client)

    if not drift:
        print("No drift found — every stats_only stored tier matches a fresh recompute.")
        return

    print(f"\n{'player':<24} {'skill':<24} {'stored':<16} {'recomputed':<16}")
    print("-" * 82)
    for entry in sorted(drift, key=lambda e: (e.player_name or "", e.skill_name)):
        print(
            f"{entry.player_name:<24} {entry.skill_name:<24} "
            f"{entry.stored_tier or 'None':<16} {entry.recomputed_tier:<16}"
        )

    affected_players = len({entry.player_id for entry in drift})
    print(f"\n{len(drift)} drifted tier(s) found across {affected_players} player(s).")


if __name__ == "__main__":
    main()
