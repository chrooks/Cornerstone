"""
Count summary for the review-state Surface.

Returns high-level counts so admins can decide whether to publish.
"""

from __future__ import annotations

import logging

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)


def _get_client():
    return get_supabase()


def _draft_season(draft_id: str, client) -> str:
    """Return the season stored on the draft being summarized (issue #72).

    The summary counts scope to the draft's own ``snapshot_releases.season`` so
    they describe the same Player set the publish RPC will freeze, rather than a
    hardcoded ``2025-26``.
    """
    row = (
        client.table("snapshot_releases")
        .select("season")
        .eq("id", draft_id)
        .single()
        .execute()
    )
    return (row.data or {}).get("season")


def count_summary(draft_id: str, client=None) -> dict:
    """
    Return a count summary for the review-state Surface.

    Returns::

        {
            "players_total": int,
            "players_changed_since_active": int,
            "players_missing_composite": int,
            "thresholds_changed": int,           # always 0 in this slice; #7 owns threshold versioning
            "manual_overrides_since_active": int, # manual draft_skill_profiles updated after active published_at
        }
    """
    c = client or _get_client()
    season = _draft_season(draft_id, c)

    # Total qualifying players in the draft's season
    all_players = run_query(
        lambda: c.table("players")
        .select("id")
        .eq("season", season)
        .execute()
    )
    player_ids = [str(r["id"]) for r in (all_players.data or [])]
    players_total = len(player_ids)

    # Players missing a composite profile
    missing_composite = 0
    if player_ids:
        _CHUNK = 500
        composite_ids: set[str] = set()
        for i in range(0, len(player_ids), _CHUNK):
            chunk = player_ids[i: i + _CHUNK]
            profiles = run_query(
                lambda c_chunk=chunk: c.table("draft_skill_profiles")
                .select("player_id")
                .in_("player_id", c_chunk)
                .eq("source", "composite")
                .execute()
            )
            composite_ids.update(str(r["player_id"]) for r in (profiles.data or []))
        missing_composite = sum(1 for pid in player_ids if pid not in composite_ids)

    # Players changed since the active snapshot was published, and manual overrides.
    # Both heuristics share the active_published_at timestamp.
    changed_since_active = 0
    manual_overrides_since_active = 0
    try:
        active_rows = run_query(
            lambda: c.table("snapshot_releases")
            .select("published_at")
            .eq("is_active", True)
            .execute()
        )
        if active_rows.data:
            active_published_at = active_rows.data[0].get("published_at")
            if active_published_at:
                # Players whose composite profile was updated after the last publish
                updated_profiles = run_query(
                    lambda: c.table("draft_skill_profiles")
                    .select("player_id")
                    .eq("source", "composite")
                    .eq("season", season)
                    .gt("updated_at", active_published_at)
                    .execute()
                )
                changed_player_ids = {
                    str(r["player_id"]) for r in (updated_profiles.data or [])
                }
                changed_since_active = len(changed_player_ids)

                # Manual draft_skill_profiles updated after the last publish
                manual_profiles = run_query(
                    lambda: c.table("draft_skill_profiles")
                    .select("player_id")
                    .eq("source", "manual")
                    .eq("season", season)
                    .gt("updated_at", active_published_at)
                    .execute()
                )
                manual_player_ids = {
                    str(r["player_id"]) for r in (manual_profiles.data or [])
                }
                manual_overrides_since_active = len(manual_player_ids)
    except Exception:
        logger.exception("Unable to compute players_changed_since_active or manual_overrides_since_active")

    return {
        "players_total": players_total,
        "players_changed_since_active": changed_since_active,
        "players_missing_composite": missing_composite,
        # thresholds_changed is always 0 in this slice; issue #7 owns threshold versioning
        # and will wire thresholds_snapshot into this count when that work lands.
        "thresholds_changed": 0,
        "manual_overrides_since_active": manual_overrides_since_active,
    }
