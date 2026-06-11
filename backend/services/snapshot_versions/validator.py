"""
Pre-publish validation for Snapshot Releases.

Returns counts of hard/soft blockers so the API layer can gate publish.

open_flags count matches the RPC predicate in publish_snapshot_draft
(20260527000003_publish_open_flags_gate.sql):

    SELECT COUNT(*) FROM draft_skill_flags WHERE resolution IS NULL;

No season or source filter. The Python backend writes NULL for unresolved
flags and a concrete string ('trust_stats', 'trust_claude', 'manual_override')
for resolved ones; the string 'unresolved' is never written.
"""

from __future__ import annotations

import logging
from typing import Optional

from services.supabase_client import get_supabase, run_query

logger = logging.getLogger(__name__)


def _get_client():
    return get_supabase()


def _draft_season(draft_id: str, client) -> str:
    """Return the season stored on the draft/release being validated (issue #72).

    The preflight counts must scope to the SAME season the publish RPC freezes
    and gates against — which is the draft's own ``snapshot_releases.season`` —
    so the UI count and the hard gate stay equal by construction instead of both
    hardcoding ``2025-26``.
    """
    row = (
        client.table("snapshot_releases")
        .select("season")
        .eq("id", draft_id)
        .single()
        .execute()
    )
    return (row.data or {}).get("season")


def validate_publishable(
    draft_id: str,
    client=None,
) -> dict:
    """
    Return validation counts for the publish modal.

    Returns::

        {
            "players_missing_canonical": int,  # hard block if > 0
            "legends_missing_canonical": int,  # hard block if > 0; legends whose
                                               # nba_api_id has no canonical_players row
                                               # (mirrors the publish RPC predicate
                                               # legends_missing_canonical_player)
            "players_missing_composite": int,  # soft warning
            "missing_composite_players": [    # full list — Player identities for the disclosure
                {"id": str, "name": str, "team": str | None, "position": str | None},
                ...
            ],
            "open_flags": int,  # hard block if > 0; unresolved flags scoped to
                                # current-season composite profiles (matches the
                                # Review queue + the publish RPC, migration ...013)
        }
    """
    c = client or _get_client()
    season = _draft_season(draft_id, c)

    # Players in the draft's season — pull display fields up front so we can
    # surface missing-composite Player identities without a second round-trip.
    # Excluded players are skipped by the publish freeze, so they must not count
    # toward the missing-composite gate either — mirrors publish_snapshot_draft.
    all_players = run_query(
        lambda: c.table("players")
        .select("id, nba_api_id, name, team, position")
        .eq("season", season)
        .eq("excluded_from_snapshot", False)
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

    # Legends missing a canonical_players row. The publish RPC hard-blocks with
    # legends_missing_canonical_player when a Legend's nba_api_id has no
    # canonical_players row (it can't be frozen into released_players). Mirror the
    # RPC's exact predicate here so the publish modal surfaces the block up front:
    #
    #   SELECT COUNT(*) FROM legends l
    #   LEFT JOIN canonical_players cp ON cp.nba_api_id = l.nba_api_id
    #   WHERE cp.id IS NULL
    all_legends = run_query(
        lambda: c.table("legends").select("nba_api_id").execute()
    )
    legend_nba_ids = [
        str(l["nba_api_id"]) for l in (all_legends.data or []) if l.get("nba_api_id")
    ]

    legends_missing_canonical = 0
    if legend_nba_ids:
        legend_canonical_rows = run_query(
            lambda: c.table("canonical_players")
            .select("nba_api_id")
            .in_("nba_api_id", legend_nba_ids)
            .execute()
        )
        legend_matched_ids = {
            str(r["nba_api_id"]) for r in (legend_canonical_rows.data or [])
        }
        legends_missing_canonical = sum(
            1 for nba_id in legend_nba_ids if nba_id not in legend_matched_ids
        )

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
                lambda c_chunk=chunk: c.table("draft_skill_profiles")
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

    # Open flags: count unresolved (resolution IS NULL) draft_skill_flags scoped
    # to current-season composite Skill Profiles. This mirrors the Review queue
    # scope (backend/api/review.py) so the publish gate count matches what the
    # admin actually sees and can resolve — prior-season / non-composite flags
    # do not block publish. The publish_snapshot_draft RPC applies the same scope
    # (see migration 20260527000013) so the UI count and the hard gate agree.
    # NOTE: this is a preflight read; the RPC is the authoritative gate. The
    # count can race flag writes between this read and publish — count-pinning
    # the override is tracked as a follow-up (see review fan-out concerns).
    season_composite = run_query(
        lambda: c.table("draft_skill_profiles")
        .select("id")
        .eq("season", season)
        .eq("source", "composite")
        .execute()
    )
    composite_profile_ids = [str(r["id"]) for r in (season_composite.data or [])]

    open_flags = 0
    if composite_profile_ids:
        _FLAG_CHUNK = 500
        for i in range(0, len(composite_profile_ids), _FLAG_CHUNK):
            chunk = composite_profile_ids[i: i + _FLAG_CHUNK]
            flags_result = run_query(
                lambda c_chunk=chunk: c.table("draft_skill_flags")
                .select("id")
                .is_("resolution", "null")
                .in_("skill_profile_id", c_chunk)
                .execute()
            )
            open_flags += len(flags_result.data or [])

    return {
        "players_missing_canonical": missing_canonical,
        "legends_missing_canonical": legends_missing_canonical,
        "players_missing_composite": missing_composite,
        "missing_composite_players": missing_composite_players,
        "open_flags": open_flags,
    }
