"""
services/snapshot_versions/released_repo.py — Lab-side read helpers for released_players.

Centralizes the released-players read Contract introduced in M3 so future Lab
Surfaces share one Seam instead of re-rolling the query against
draft_skill_profiles by mistake. Every Lab Surface that needs Skill Profile
data should go through this module; admin Surfaces continue to read
draft_skill_profiles directly via their own paths.

All queries filter by `snapshot_release_id = active_release_id`. Callers obtain
the active release id via services.snapshot_versions.active.get_active_release_id().
"""

from __future__ import annotations

from typing import Iterable

_BATCH = 100
_LEGENDS_QUERY_LIMIT = 500  # legends ~36 today; ceiling guards against silent truncation


def fetch_profiles_by_source_player_ids(
    source_player_ids: Iterable[str],
    active_release_id: str,
    *,
    client=None,
) -> dict[str, dict]:
    """Return {source_player_id: skill_profile_snapshot} for the given Player ids
    in the active Snapshot Release.

    Batches into chunks of 100 to stay inside PostgREST URL limits. Each batch
    issues a `.limit(_BATCH + 1)` so a future overflow guard can detect
    over-full batches.
    """
    from services.supabase_client import get_supabase

    ids = [pid for pid in source_player_ids if pid]
    if not ids:
        return {}

    c = client or get_supabase()
    result: dict[str, dict] = {}
    for i in range(0, len(ids), _BATCH):
        batch = ids[i : i + _BATCH]
        rows = (
            c.table("released_players")
            .select("source_player_id, skill_profile_snapshot")
            .eq("snapshot_release_id", active_release_id)
            .eq("is_legend", False)
            .in_("source_player_id", batch)
            .limit(_BATCH + 1)
            .execute()
        )
        for row in (rows.data or []):
            pid = row.get("source_player_id")
            if pid:
                result[str(pid)] = row.get("skill_profile_snapshot") or {}
    return result


def fetch_legend_profiles_by_nba_api_ids(
    legend_nba_api_ids: Iterable[int] | None,
    active_release_id: str,
    *,
    client=None,
) -> dict[str, dict]:
    """Return {nba_api_id_str: skill_profile_snapshot} for legend rows in the
    active Snapshot Release.

    released_players has no legend_id; the join chain is:
        released_players.canonical_player_id -> canonical_players.id
        canonical_players.nba_api_id          <- caller's filter

    If legend_nba_api_ids is None, returns every legend row in the active
    release. When a filter is supplied, it is pushed down to the
    canonical_players query so only matching rows return.
    """
    from services.supabase_client import get_supabase

    c = client or get_supabase()

    rows = (
        c.table("released_players")
        .select("canonical_player_id, skill_profile_snapshot")
        .eq("snapshot_release_id", active_release_id)
        .eq("is_legend", True)
        .limit(_LEGENDS_QUERY_LIMIT)
        .execute()
    )
    released_rows = rows.data or []
    if not released_rows:
        return {}

    canonical_ids = [
        r["canonical_player_id"] for r in released_rows if r.get("canonical_player_id")
    ]
    if not canonical_ids:
        return {}

    cp_query = (
        c.table("canonical_players")
        .select("id, nba_api_id")
        .in_("id", canonical_ids)
    )
    if legend_nba_api_ids is not None:
        wanted = [n for n in legend_nba_api_ids if n is not None]
        if not wanted:
            return {}
        cp_query = cp_query.in_("nba_api_id", wanted)

    cp_rows = cp_query.limit(_LEGENDS_QUERY_LIMIT).execute()
    canonical_by_id = {
        row["id"]: row["nba_api_id"] for row in (cp_rows.data or [])
    }

    result: dict[str, dict] = {}
    for row in released_rows:
        cid = row.get("canonical_player_id")
        nba_api_id = canonical_by_id.get(cid)
        if nba_api_id is not None:
            result[str(nba_api_id)] = row.get("skill_profile_snapshot") or {}
    return result
