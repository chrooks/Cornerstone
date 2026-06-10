"""
services/snapshot_versions/release_diff.py — draft-vs-published diff (#8).

Computes what publishing the open draft would change relative to the active
published Snapshot Release. The publish RPC's freeze CTEs
(supabase/migrations/20260606000000_publish_season_from_draft.sql) are the
spec for the draft side — this module mirrors that row selection exactly so
the diff is an honest prediction of the freeze:

- Regular players: ``players WHERE season = draft.season`` INNER JOIN
  ``canonical_players`` on ``nba_api_id`` (no canonical link → not frozen →
  not diffed; the validation Surface owns that gate). Profile = latest
  ``draft_skill_profiles`` row per player with ``source='composite'``,
  ``is_legend=false`` (DISTINCT ON mirror). Salary coalesced to 0.
- Legends: ``legends`` INNER JOIN ``canonical_players``. Profile = latest
  ``source='manual'``, ``is_legend=true`` row per legend. Salary always 0.

Published side: ``released_players`` rows of the active release.

Identity key is ``(canonical_player_id, is_legend)`` — the same identity the
freeze writes, so a person who is both a current Player and a Legend diffs as
two independent entities.

Read-only — never writes.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)

# PostgREST .in_ chunk size (mirrors released_repo / summary conventions).
_CHUNK = 100

# Contract/bio fields compared per entity, in display order.
_CONTRACT_FIELDS = ("name", "team", "position", "salary")

# Entity identity: (canonical_player_id, is_legend)
EntityKey = tuple[str, bool]


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


# ---------------------------------------------------------------------------
# Normalization helpers (pure)
# ---------------------------------------------------------------------------


def _normalize_profile(profile: Optional[dict]) -> dict[str, str]:
    """Reduce a JSONB skill profile to ``{skill: final_tier}``.

    Skill entries without a dict shape or without a ``final_tier`` are treated
    as absent — the diff reports absence as ``None`` (distinct from the
    literal tier string ``"None"``).
    """
    tiers: dict[str, str] = {}
    for skill, entry in (profile or {}).items():
        if isinstance(entry, dict):
            tier = entry.get("final_tier")
            if tier is not None:
                tiers[skill] = tier
    return tiers


def _latest_profiles(rows: list[dict], key_field: str) -> dict[Any, dict]:
    """Mirror the publish RPC's DISTINCT ON: latest profile per key.

    Ordering: ``updated_at DESC NULLS LAST, created_at DESC NULLS LAST``.
    ISO-8601 timestamps compare correctly as strings; None sorts last.
    """
    def _sort_key(row: dict) -> tuple[str, str]:
        return (row.get("updated_at") or "", row.get("created_at") or "")

    best: dict[Any, dict] = {}
    for row in rows:
        key = row.get(key_field)
        if key is None:
            continue
        current = best.get(key)
        if current is None or _sort_key(row) > _sort_key(current):
            best[key] = row
    return {key: (row.get("profile") or {}) for key, row in best.items()}


def _make_entity(
    canonical_player_id: str,
    *,
    name: Optional[str],
    team: Optional[str],
    position: Optional[str],
    salary: Any,
    is_legend: bool,
    profile: Optional[dict],
) -> dict:
    return {
        "canonical_player_id": canonical_player_id,
        "name": name,
        "team": team,
        "position": position,
        # COALESCE(salary, 0) — mirrors the freeze.
        "salary": salary if salary is not None else 0,
        "is_legend": is_legend,
        "skills": _normalize_profile(profile),
    }


# ---------------------------------------------------------------------------
# Fetchers (thin — patched in tests)
# ---------------------------------------------------------------------------


def _fetch_canonical_map(nba_api_ids: list, client) -> dict[Any, str]:
    """Return {nba_api_id: canonical_players.id} for the given ids."""
    mapping: dict[Any, str] = {}
    ids = [n for n in nba_api_ids if n is not None]
    for i in range(0, len(ids), _CHUNK):
        chunk = ids[i : i + _CHUNK]
        rows = run_query(
            lambda c_chunk=chunk: client.table("canonical_players")
            .select("id, nba_api_id")
            .in_("nba_api_id", c_chunk)
            .execute()
        )
        for row in rows.data or []:
            mapping[row["nba_api_id"]] = str(row["id"])
    return mapping


def _fetch_regular_profiles(player_ids: list[str], client) -> dict[str, dict]:
    """Latest composite profile per player id (regular players)."""
    rows: list[dict] = []
    for i in range(0, len(player_ids), _CHUNK):
        chunk = player_ids[i : i + _CHUNK]
        result = run_query(
            lambda c_chunk=chunk: client.table("draft_skill_profiles")
            .select("player_id, profile, updated_at, created_at")
            .eq("source", "composite")
            .eq("is_legend", False)
            .in_("player_id", c_chunk)
            .execute()
        )
        rows.extend(result.data or [])
    return {
        str(key): profile
        for key, profile in _latest_profiles(rows, "player_id").items()
    }


def _fetch_legend_profiles(client) -> dict[str, dict]:
    """Latest manual profile per legend id."""
    result = run_query(
        lambda: client.table("draft_skill_profiles")
        .select("legend_id, profile, updated_at, created_at")
        .eq("source", "manual")
        .eq("is_legend", True)
        .execute()
    )
    return {
        str(key): profile
        for key, profile in _latest_profiles(result.data or [], "legend_id").items()
    }


def _collect_draft_entities(season: str, client) -> dict[EntityKey, dict]:
    """Normalized draft-side entities — exactly what a publish would freeze."""
    players = (
        run_query(
            lambda: client.table("players")
            .select("id, nba_api_id, name, team, position, salary")
            .eq("season", season)
            .execute()
        ).data
        or []
    )
    legends = (
        run_query(
            lambda: client.table("legends")
            .select("id, nba_api_id, name, team, position")
            .execute()
        ).data
        or []
    )

    nba_ids = [p.get("nba_api_id") for p in players] + [
        l.get("nba_api_id") for l in legends
    ]
    canonical_by_nba = _fetch_canonical_map(nba_ids, client)

    regular_profiles = _fetch_regular_profiles(
        [str(p["id"]) for p in players], client
    )
    legend_profiles = _fetch_legend_profiles(client)

    entities: dict[EntityKey, dict] = {}
    for p in players:
        canonical_id = canonical_by_nba.get(p.get("nba_api_id"))
        if canonical_id is None:
            # INNER JOIN canonical_players — the freeze skips this row too.
            continue
        entities[(canonical_id, False)] = _make_entity(
            canonical_id,
            name=p.get("name"),
            team=p.get("team"),
            position=p.get("position"),
            salary=p.get("salary"),
            is_legend=False,
            profile=regular_profiles.get(str(p["id"])),
        )
    for l in legends:
        canonical_id = canonical_by_nba.get(l.get("nba_api_id"))
        if canonical_id is None:
            continue
        entities[(canonical_id, True)] = _make_entity(
            canonical_id,
            name=l.get("name"),
            team=l.get("team"),
            position=l.get("position"),
            salary=0,
            is_legend=True,
            profile=legend_profiles.get(str(l["id"])),
        )
    return entities


def _collect_released_entities(release_id: str, client) -> dict[EntityKey, dict]:
    """Normalized published-side entities from the active release."""
    rows = (
        run_query(
            lambda: client.table("released_players")
            .select(
                "canonical_player_id, name, team, position, salary, "
                "skill_profile_snapshot, is_legend"
            )
            .eq("snapshot_release_id", release_id)
            .execute()
        ).data
        or []
    )
    entities: dict[EntityKey, dict] = {}
    for row in rows:
        canonical_id = row.get("canonical_player_id")
        if canonical_id is None:
            continue
        canonical_id = str(canonical_id)
        is_legend = bool(row.get("is_legend"))
        entities[(canonical_id, is_legend)] = _make_entity(
            canonical_id,
            name=row.get("name"),
            team=row.get("team"),
            position=row.get("position"),
            salary=row.get("salary"),
            is_legend=is_legend,
            profile=row.get("skill_profile_snapshot"),
        )
    return entities


# ---------------------------------------------------------------------------
# Pure diff core
# ---------------------------------------------------------------------------


def _entity_summary(entity: dict) -> dict:
    """Public row shape for added/removed lists (drops the skills map)."""
    return {
        "canonical_player_id": entity["canonical_player_id"],
        "name": entity["name"],
        "team": entity["team"],
        "position": entity["position"],
        "salary": entity["salary"],
        "is_legend": entity["is_legend"],
    }


def _name_sort_key(row: dict) -> str:
    return (row.get("name") or "").lower()


def build_diff(
    draft_entities: dict[EntityKey, dict],
    released_entities: dict[EntityKey, dict],
) -> dict:
    """Pure diff over normalized entity maps. No DB access."""
    added = [
        _entity_summary(entity)
        for key, entity in draft_entities.items()
        if key not in released_entities
    ]
    removed = [
        _entity_summary(entity)
        for key, entity in released_entities.items()
        if key not in draft_entities
    ]

    changed: list[dict] = []
    unchanged = 0
    for key, draft_entity in draft_entities.items():
        released_entity = released_entities.get(key)
        if released_entity is None:
            continue

        draft_skills = draft_entity["skills"]
        released_skills = released_entity["skills"]
        skill_changes = [
            {
                "skill": skill,
                "old_tier": released_skills.get(skill),
                "new_tier": draft_skills.get(skill),
            }
            for skill in sorted(set(draft_skills) | set(released_skills))
            if released_skills.get(skill) != draft_skills.get(skill)
        ]

        contract_changes = [
            {
                "field": field,
                "old": released_entity[field],
                "new": draft_entity[field],
            }
            for field in _CONTRACT_FIELDS
            if released_entity[field] != draft_entity[field]
        ]

        if skill_changes or contract_changes:
            changed.append(
                {
                    "canonical_player_id": draft_entity["canonical_player_id"],
                    "name": draft_entity["name"],
                    "is_legend": draft_entity["is_legend"],
                    "team": draft_entity["team"],
                    "position": draft_entity["position"],
                    "skill_changes": skill_changes,
                    "contract_changes": contract_changes,
                }
            )
        else:
            unchanged += 1

    added.sort(key=_name_sort_key)
    removed.sort(key=_name_sort_key)
    changed.sort(key=_name_sort_key)

    return {
        "summary": {
            "added": len(added),
            "removed": len(removed),
            "changed": len(changed),
            "unchanged": unchanged,
        },
        "players_added": added,
        "players_removed": removed,
        "players_changed": changed,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def compute_release_diff(client=None) -> dict:
    """Diff the open draft against the active published Snapshot Release.

    Raises:
        ValueError('no_open_draft'): no draft/review row is open.
        ValueError('no_active_release'): no snapshot_releases row is active.
    """
    from services.snapshot_versions import repo

    c = client or _get_client()

    draft = repo.get_draft(client=c)
    if draft is None:
        raise ValueError("no_open_draft")

    active_rows = run_query(
        lambda: c.table("snapshot_releases")
        .select("*")
        .eq("is_active", True)
        .execute()
    )
    if not active_rows.data:
        raise ValueError("no_active_release")
    active = repo._row_to_release(active_rows.data[0])

    draft_entities = _collect_draft_entities(draft.season, c)
    released_entities = _collect_released_entities(active.id, c)
    diff = build_diff(draft_entities, released_entities)

    return {
        "draft": {
            "id": draft.id,
            "label": draft.label,
            "season": draft.season,
            "status": draft.status,
        },
        "active_release": {
            "id": active.id,
            "label": active.label,
            "season": active.season,
            "published_at": active.published_at,
        },
        **diff,
    }
