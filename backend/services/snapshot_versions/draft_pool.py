"""
services/snapshot_versions/draft_pool.py — draft composite player pool.

Backs the draft workspace "Player Pool" tab. Returns every player and legend
with the DRAFT composite Skill Profile — i.e. the ratings that *will* be frozen
when this draft publishes, NOT the currently-published release.

Row selection mirrors the publish RPC's freeze exactly. Rather than re-deriving
that selection, this module reuses the fetcher/normalization helpers from
``release_diff`` (the canonical mirror of
``supabase/migrations/20260606000000_publish_season_from_draft.sql``):

- Regular players: ``players WHERE season = draft.season`` INNER JOIN
  ``canonical_players`` on ``nba_api_id``. Profile = latest
  ``draft_skill_profiles`` row per player, ``source='composite'``,
  ``is_legend=false``.
- Legends: ``legends`` INNER JOIN ``canonical_players``. Profile = latest
  ``source='manual'``, ``is_legend=true`` row per legend.

Each row is shaped as the frontend ``PlayerWithSkills`` contract, plus a
``data_missing_skills`` list — the canonical 21 skills (services.skills
ALL_SKILLS) that have NO rating in the draft composite (the #5b badge source).

Read-only — never writes.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from services.skills import ALL_SKILLS
from services.supabase_client import get_supabase, run_query
from services.snapshot_versions import release_diff, repo

logger = logging.getLogger(__name__)


def _get_client():
    """Indirection point so tests can patch without touching get_supabase."""
    return get_supabase()


# ---------------------------------------------------------------------------
# Pure shaping helpers
# ---------------------------------------------------------------------------


def _tier_or_none(value: Any) -> Optional[str]:
    """Normalize a skill tier value to a string tier or None.

    ``None`` and the literal string ``"None"`` both mean *unrated*.
    """
    if value is None:
        return None
    if isinstance(value, str) and value == "None":
        return None
    return value


def _skill_map(profile: Optional[dict]) -> dict[str, Optional[str]]:
    """Reduce a JSONB skill profile to ``{skill: final_tier | None}``.

    Reuses ``release_diff._normalize_profile`` for the rated entries, then
    backfills every canonical skill so the map is total over ALL_SKILLS.
    """
    rated = release_diff._normalize_profile(profile)
    return {skill: _tier_or_none(rated.get(skill)) for skill in ALL_SKILLS}


def _data_missing(skill_map: dict[str, Optional[str]]) -> list[str]:
    """Canonical skills with no rating in the draft composite (#5b)."""
    return [skill for skill in ALL_SKILLS if skill_map[skill] is None]


def _make_row(
    *,
    player_id: str,
    name: Optional[str],
    team: Optional[str],
    position: Optional[str],
    age: Any,
    height: Optional[str],
    weight: Any,
    salary: Any,
    season: str,
    is_legend: bool,
    nba_api_id: Any,
    profile: Optional[dict],
    flag_summary: dict,
    excluded_from_snapshot: bool = False,
) -> dict:
    skill_map = _skill_map(profile)
    return {
        "id": player_id,
        "name": name,
        "team": team,
        "position": position,
        "age": age,
        "height": height,
        "weight": weight,
        # COALESCE(salary, 0) — mirrors the freeze.
        "salary": salary if salary is not None else 0,
        "games_played": None,
        "minutes_per_game": None,
        "season": season,
        "is_legend": is_legend,
        "nba_api_id": nba_api_id,
        "skills": skill_map,
        "data_missing_skills": _data_missing(skill_map),
        "flag_summary": flag_summary,
        # True → skipped by the publish freeze; the Player Pool tab greys these
        # and offers an "include" action. Legends are never excludable.
        "excluded_from_snapshot": excluded_from_snapshot,
    }


# ---------------------------------------------------------------------------
# Flag counts (cheap, best-effort)
# ---------------------------------------------------------------------------


def _fetch_flag_counts(player_ids: list[str], client) -> dict[str, dict]:
    """Per-player UNRESOLVED draft flag counts: {player_id: {total, unresolved}}.

    Mirrors the Review queue (api/review.py): draft_skill_flags links to a player
    via draft_skill_profiles.id -> player_id, and a flag is unresolved when
    resolution IS NULL. We surface the unresolved count (the actionable one);
    total is reported equal to it since this tab only signals open work.

    Best-effort: any failure degrades to empty counts — the badge that matters
    on this tab is data-missing, and flag triage lives in the Review tab.
    """
    if not player_ids:
        return {}
    try:
        # Map draft profile id -> player_id for these players.
        profile_to_player: dict[str, str] = {}
        for i in range(0, len(player_ids), release_diff._CHUNK):
            chunk = player_ids[i : i + release_diff._CHUNK]
            result = run_query(
                lambda c_chunk=chunk: client.table("draft_skill_profiles")
                .select("id, player_id")
                .in_("player_id", c_chunk)
                .execute()
            )
            for row in result.data or []:
                profile_to_player[str(row["id"])] = str(row["player_id"])

        profile_ids = list(profile_to_player.keys())
        counts: dict[str, dict] = {}
        for i in range(0, len(profile_ids), release_diff._CHUNK):
            chunk = profile_ids[i : i + release_diff._CHUNK]
            result = run_query(
                lambda c_chunk=chunk: client.table("draft_skill_flags")
                .select("skill_profile_id")
                .in_("skill_profile_id", c_chunk)
                .is_("resolution", "null")
                .execute()
            )
            for row in result.data or []:
                pid = profile_to_player.get(str(row.get("skill_profile_id")))
                if pid is None:
                    continue
                entry = counts.setdefault(pid, {"total": 0, "unresolved": 0})
                entry["total"] += 1
                entry["unresolved"] += 1
        return counts
    except Exception:
        logger.warning("draft_pool: flag counts unavailable; defaulting to 0")
        return {}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _collect_pool_rows(season: str, client) -> list[dict]:
    """Every player + legend with their draft composite, as PlayerWithSkills rows."""
    players = (
        run_query(
            lambda: client.table("players")
            .select(
                "id, nba_api_id, name, team, position, age, height, weight, "
                "salary, excluded_from_snapshot"
            )
            .eq("season", season)
            .execute()
        ).data
        or []
    )
    legends = (
        run_query(
            lambda: client.table("legends")
            .select("id, nba_api_id, name, team, position, age, height, weight")
            .execute()
        ).data
        or []
    )

    nba_ids = [p.get("nba_api_id") for p in players] + [
        l.get("nba_api_id") for l in legends
    ]
    canonical_by_nba = release_diff._fetch_canonical_map(nba_ids, client)

    player_ids = [str(p["id"]) for p in players]
    regular_profiles = release_diff._fetch_regular_profiles(player_ids, client)
    legend_profiles = release_diff._fetch_legend_profiles(client)
    flag_counts = _fetch_flag_counts(player_ids, client)

    rows: list[dict] = []
    for p in players:
        # INNER JOIN canonical_players — the freeze skips unlinked rows too.
        if canonical_by_nba.get(p.get("nba_api_id")) is None:
            continue
        pid = str(p["id"])
        rows.append(
            _make_row(
                player_id=pid,
                name=p.get("name"),
                team=p.get("team"),
                position=p.get("position"),
                age=p.get("age"),
                height=p.get("height"),
                weight=p.get("weight"),
                salary=p.get("salary"),
                season=season,
                is_legend=False,
                nba_api_id=p.get("nba_api_id"),
                profile=regular_profiles.get(pid),
                flag_summary=flag_counts.get(pid, {"total": 0, "unresolved": 0}),
                excluded_from_snapshot=bool(p.get("excluded_from_snapshot")),
            )
        )
    for l in legends:
        if canonical_by_nba.get(l.get("nba_api_id")) is None:
            continue
        lid = str(l["id"])
        rows.append(
            _make_row(
                player_id=lid,
                name=l.get("name"),
                team=l.get("team"),
                position=l.get("position"),
                age=l.get("age"),
                height=l.get("height"),
                weight=l.get("weight"),
                salary=0,
                season=season,
                is_legend=True,
                nba_api_id=l.get("nba_api_id"),
                profile=legend_profiles.get(lid),
                flag_summary={"total": 0, "unresolved": 0},
            )
        )

    rows.sort(key=lambda r: (r.get("name") or "").lower())
    return rows


def get_draft_player_pool(client=None) -> list[dict]:
    """All players + legends with the open draft's composite Skill Profile.

    Raises:
        ValueError('no_open_draft'): no draft/review row is open.
    """
    c = client or _get_client()

    draft = repo.get_draft(client=c)
    if draft is None:
        raise ValueError("no_open_draft")

    return _collect_pool_rows(draft.season, c)
