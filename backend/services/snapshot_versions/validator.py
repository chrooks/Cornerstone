"""
Pre-publish validation for Snapshot Releases.

Returns counts of hard/soft blockers so the API layer can gate publish.
"""

from __future__ import annotations

import logging
from typing import Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

_CURRENT_SEASON = "2025-26"


def _get_client():
    return get_supabase()


def validate_publishable(
    draft_id: str,
    client=None,
) -> dict:
    """
    Return validation counts for the publish modal.

    Returns::

        {
            "players_missing_canonical": int,  # hard block if > 0
            "players_missing_composite": int,  # soft warning
            "missing_composite_players": [    # full list — Player identities for the disclosure
                {"id": str, "name": str, "team": str | None, "position": str | None},
                ...
            ],
        }
    """
    c = client or _get_client()

    # Players in the current season — pull display fields up front so we can
    # surface missing-composite Player identities without a second round-trip.
    all_players = run_query(
        lambda: c.table("players")
        .select("id, nba_api_id, name, team, position")
        .eq("season", _CURRENT_SEASON)
        .execute()
    )
    players = all_players.data or []
    player_nba_ids = [str(p["nba_api_id"]) for p in players if p.get("nba_api_id")]

    missing_canonical = 0
    if player_nba_ids:
        canonical_rows = run_query(
            lambda: c.table("canonical_players")
            .select("nba_api_id")
            .in_("nba_api_id", player_nba_ids)
            .execute()
        )
        matched_ids = {str(r["nba_api_id"]) for r in (canonical_rows.data or [])}
        missing_canonical = sum(1 for nba_id in player_nba_ids if nba_id not in matched_ids)

    # Players in the current season missing a composite profile
    player_ids = [str(p["id"]) for p in players]
    missing_composite = 0
    missing_composite_players: list[dict] = []
    if player_ids:
        _CHUNK = 500
        composite_player_ids: set[str] = set()
        for i in range(0, len(player_ids), _CHUNK):
            chunk = player_ids[i: i + _CHUNK]
            profiles = run_query(
                lambda c_chunk=chunk: c.table("skill_profiles")
                .select("player_id")
                .in_("player_id", c_chunk)
                .eq("source", "composite")
                .execute()
            )
            composite_player_ids.update(
                str(r["player_id"]) for r in (profiles.data or [])
            )

        for p in players:
            pid = str(p["id"])
            if pid in composite_player_ids:
                continue
            missing_composite += 1
            missing_composite_players.append(
                {
                    "id": pid,
                    "name": p.get("name") or "Unknown",
                    "team": p.get("team"),
                    "position": p.get("position"),
                }
            )

    return {
        "players_missing_canonical": missing_canonical,
        "players_missing_composite": missing_composite,
        "missing_composite_players": missing_composite_players,
    }
