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


# A (dropped skill, appeared skill, same tier) pair seen on at least this many
# players is a taxonomy rename, not per-player news. Real renames hit hundreds
# of players; organic coincidences don't reach 20.
RENAME_COLLAPSE_MIN_PLAYERS = 20


def collapse_skill_renames(diff: dict) -> dict:
    """Collapse taxonomy-rename noise out of a diff. Pure — returns a new dict.

    A skill key rename (e.g. secure_handler → possession_protector) shows up
    on nearly every player as the same pair: the old key dropped
    (``new_tier: None``) plus the new key appeared (``old_tier: None``) at the
    same tier. That is one taxonomy event, not N player changes. Detect pairs
    supported by >= RENAME_COLLAPSE_MIN_PLAYERS players, strip them from every
    player's ``skill_changes``, hide players left with no changes at all, and
    report the events as ``skill_renames`` so the UI can render one banner.
    """
    players = diff["players_changed"]

    # Detect: count (dropped, appeared) pairs with matching tiers per player.
    pair_counts: dict[tuple[str, str], int] = {}
    for player in players:
        dropped = {
            c["skill"]: c["old_tier"]
            for c in player["skill_changes"]
            if c["new_tier"] is None and c["old_tier"] is not None
        }
        appeared = {
            c["skill"]: c["new_tier"]
            for c in player["skill_changes"]
            if c["old_tier"] is None and c["new_tier"] is not None
        }
        for old_skill, old_tier in dropped.items():
            for new_skill, new_tier in appeared.items():
                if old_tier == new_tier:
                    key = (old_skill, new_skill)
                    pair_counts[key] = pair_counts.get(key, 0) + 1

    renames = sorted(
        (pair for pair, count in pair_counts.items()
         if count >= RENAME_COLLAPSE_MIN_PLAYERS),
    )
    if not renames:
        return {**diff, "skill_renames": []}

    def _is_rename_entry(player_changes: list[dict], change: dict) -> bool:
        by_skill = {c["skill"]: c for c in player_changes}
        for old_skill, new_skill in renames:
            old_c = by_skill.get(old_skill)
            new_c = by_skill.get(new_skill)
            if (
                old_c is not None
                and new_c is not None
                and old_c["new_tier"] is None
                and new_c["old_tier"] is None
                and old_c["old_tier"] == new_c["new_tier"]
                and change["skill"] in (old_skill, new_skill)
            ):
                return True
        return False

    rename_counts = {pair: 0 for pair in renames}
    remaining_players: list[dict] = []
    for player in players:
        kept = [
            c for c in player["skill_changes"]
            if not _is_rename_entry(player["skill_changes"], c)
        ]
        if len(kept) < len(player["skill_changes"]):
            for pair in renames:
                by_skill = {c["skill"]: c for c in player["skill_changes"]}
                if pair[0] in by_skill and pair[1] in by_skill:
                    rename_counts[pair] += 1
        if kept or player["contract_changes"]:
            remaining_players.append({**player, "skill_changes": kept})

    return {
        **diff,
        "summary": {**diff["summary"], "changed": len(remaining_players)},
        "players_changed": remaining_players,
        "skill_renames": [
            {"from_skill": old, "to_skill": new, "count": rename_counts[(old, new)]}
            for old, new in renames
        ],
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
    diff = collapse_skill_renames(build_diff(draft_entities, released_entities))

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


def _get_published_release(release_id: str, client):
    """Fetch a snapshot_releases row by id; only published rows qualify."""
    from services.snapshot_versions import repo

    result = run_query(
        lambda: client.table("snapshot_releases")
        .select("*")
        .eq("id", release_id)
        .execute()
    )
    rows = result.data or []
    if not rows or rows[0].get("status") != "published":
        raise ValueError("not_found")
    return repo._row_to_release(rows[0])


def compute_published_release_diff(release_id: str, client=None) -> dict:
    """Diff a published release against the previous published release.

    "Previous" is the published release with the greatest ``created_at``
    strictly before this release's. ``created_at`` (never rewritten) rather
    than ``published_at``: the reactivate RPC bumps ``published_at`` to now()
    (supabase/migrations/20260526000003), which would reshuffle publish-date
    order — ``created_at`` keeps a release's diff stable forever. For
    published rows creation order equals original publish order, because only
    one draft is open at a time.

    Raises:
        ValueError('not_found'): unknown id or release not published.
    """
    c = client or _get_client()

    release = _get_published_release(release_id, c)
    previous = _get_previous_published(release.created_at, c)

    current_entities = _collect_released_entities(release.id, c)
    if previous is None:
        return {
            "release": _release_meta(release),
            "previous": None,
            "summary": {
                "added": 0,
                "removed": 0,
                "changed": 0,
                "unchanged": len(current_entities),
            },
            "players_added": [],
            "players_removed": [],
            "players_changed": [],
            "skill_renames": [],
        }
    previous_entities = _collect_released_entities(previous.id, c)
    diff = collapse_skill_renames(build_diff(current_entities, previous_entities))
    return {
        "release": _release_meta(release),
        "previous": _release_meta(previous),
        **diff,
    }


def _get_previous_published(created_at, client):
    """Latest published release created strictly before ``created_at``, or None.

    Ordered by ``created_at``, not ``published_at`` — see
    compute_published_release_diff's docstring for why.
    """
    from services.snapshot_versions import repo

    result = run_query(
        lambda: client.table("snapshot_releases")
        .select("*")
        .eq("status", "published")
        .lt("created_at", created_at)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return repo._row_to_release(rows[0]) if rows else None


def _release_meta(release) -> dict:
    # No is_active here: the payload is cached publicly for a day, and
    # is_active is the one field reactivation can flip under the cache.
    return {
        "id": release.id,
        "label": release.label,
        "season": release.season,
        "published_at": release.published_at,
    }
