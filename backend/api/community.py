"""
api/community.py — Community leaderboard and aggregate stats endpoints.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Any

from flask import Blueprint, jsonify, request

from api.saved_teams import VISIBLE_TO_ANYONE
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

community_bp = Blueprint("community", __name__, url_prefix="/api")

VALID_SORT_VALUES = {"score", "date"}
MAX_PER_PAGE = 50
DEFAULT_PER_PAGE = 20


def _ok(data: Any, status: int = 200) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


def _parse_int_param(name: str, raw: str | None, default: int | None = None) -> tuple[int | None, str | None]:
    """Parse an integer query param. Returns (value, error_message).

    When *raw* is ``None`` (param absent), returns *default* with no error.
    """
    if raw is None:
        return default, None
    try:
        return int(raw), None
    except (ValueError, TypeError):
        return None, f"{name} must be an integer"


def _resolve_legend_names(supabase: Any, teams: list[dict]) -> dict[str, str]:
    """Fetch legend names for all cornerstone_legend_ids in the given teams."""
    legend_ids = list({
        t["cornerstone_legend_id"]
        for t in teams
        if t.get("cornerstone_legend_id")
    })
    if not legend_ids:
        return {}

    leg_res = (
        supabase.table("legends")
        .select("id, name")
        .in_("id", legend_ids)
        .execute()
    )
    result: dict[str, str] = {}
    for leg in leg_res.data or []:
        result[leg["id"]] = leg["name"]
    return result


def _resolve_legends(supabase: Any, legend_ids: list[str]) -> tuple[dict[str, str], dict[str, int | None]]:
    """Fetch legend names and nba_api_ids in a single query.

    Returns (names_map, nba_api_map).
    """
    if not legend_ids:
        return {}, {}

    leg_res = (
        supabase.table("legends")
        .select("id, name, nba_api_id")
        .in_("id", legend_ids)
        .execute()
    )
    names: dict[str, str] = {}
    nba_ids: dict[str, int | None] = {}
    for leg in leg_res.data or []:
        names[leg["id"]] = leg["name"]
        nba_ids[leg["id"]] = leg.get("nba_api_id")
    return names, nba_ids


@community_bp.route("/community/stats", methods=["GET"])
def community_stats() -> tuple:
    """Return per-RuleSet aggregate stats for public/unlisted Saved Teams."""
    try:
        supabase = get_supabase()

        # Fetch all visible teams in a single query
        res = (
            supabase.table("saved_teams")
            .select("id, ruleset_slug, cornerstone_legend_id")
            .in_("visibility", list(VISIBLE_TO_ANYONE))
            .execute()
        )
        visible_teams = res.data or []

        if not visible_teams:
            return _ok({})

        # Fetch evaluations ordered by created_at desc — first seen per team wins
        team_ids = [t["id"] for t in visible_teams]
        eval_res = (
            supabase.table("saved_team_evaluations")
            .select("saved_team_id, star_rating")
            .in_("saved_team_id", team_ids)
            .order("created_at", desc=True)
            .execute()
        )
        evals_by_team: dict[str, float] = {}
        for ev in eval_res.data or []:
            tid = ev["saved_team_id"]
            if tid in evals_by_team:
                continue
            rating = ev.get("star_rating")
            if rating is not None:
                evals_by_team[tid] = float(rating)

        legend_names = _resolve_legend_names(supabase, visible_teams)

        # Group by ruleset_slug and compute aggregates
        by_ruleset: dict[str, list[dict]] = {}
        for team in visible_teams:
            slug = team["ruleset_slug"]
            by_ruleset.setdefault(slug, []).append(team)

        result: dict[str, dict] = {}
        for slug, teams in by_ruleset.items():
            team_count = len(teams)

            # Average star rating across teams that have evaluations
            ratings = [
                evals_by_team[t["id"]]
                for t in teams
                if t["id"] in evals_by_team
            ]
            avg_score = round(sum(ratings) / len(ratings), 2) if ratings else None

            # Most popular cornerstone
            cornerstone_ids = [
                t["cornerstone_legend_id"]
                for t in teams
                if t.get("cornerstone_legend_id")
            ]
            if cornerstone_ids:
                most_common_id = Counter(cornerstone_ids).most_common(1)[0][0]
                top_cornerstone = legend_names.get(most_common_id, "Unknown")
                if top_cornerstone == "Unknown":
                    logger.warning("Legend %s referenced by teams but not found", most_common_id)
            else:
                top_cornerstone = "-"

            result[slug] = {
                "team_count": team_count,
                "avg_score": avg_score,
                "top_cornerstone": top_cornerstone,
            }

        return _ok(result)

    except Exception:
        logger.exception("Error in GET /api/community/stats")
        return _err("Internal server error", status=500)


@community_bp.route("/community/teams", methods=["GET"])
def community_teams() -> tuple:
    """Return a paginated list of public/unlisted Saved Teams."""
    try:
        supabase = get_supabase()

        # Parse and validate query params
        ruleset_slug = request.args.get("ruleset_slug")

        team_size: int | None = None
        team_size_raw = request.args.get("team_size")
        if team_size_raw is not None:
            ts_val, ts_err = _parse_int_param("team_size", team_size_raw)
            if ts_err:
                return _err(ts_err)
            team_size = ts_val

        page_val, page_err = _parse_int_param("page", request.args.get("page"), 1)
        if page_err:
            return _err(page_err)
        assert page_val is not None
        page = max(1, page_val)

        pp_val, pp_err = _parse_int_param("per_page", request.args.get("per_page"), DEFAULT_PER_PAGE)
        if pp_err:
            return _err(pp_err)
        assert pp_val is not None
        per_page = min(MAX_PER_PAGE, max(1, pp_val))

        sort = request.args.get("sort", "score")
        if sort not in VALID_SORT_VALUES:
            return _err(f"sort must be one of: {', '.join(sorted(VALID_SORT_VALUES))}")

        # Fetch visible teams with explicit columns
        query = (
            supabase.table("saved_teams")
            .select("id, name, ruleset_slug, team_size, cornerstone_legend_id, created_at")
            .in_("visibility", list(VISIBLE_TO_ANYONE))
        )
        if ruleset_slug:
            query = query.eq("ruleset_slug", ruleset_slug)
        if team_size is not None:
            query = query.eq("team_size", team_size)
        visible_teams: list[dict] = query.execute().data or []

        # Fetch evaluations ordered by created_at desc — first seen per team wins
        team_ids = [t["id"] for t in visible_teams]
        evals_by_team: dict[str, dict] = {}
        if team_ids:
            eval_res = (
                supabase.table("saved_team_evaluations")
                .select("saved_team_id, star_rating, starting_lineup_score")
                .in_("saved_team_id", team_ids)
                .order("created_at", desc=True)
                .execute()
            )
            for ev in eval_res.data or []:
                tid = ev["saved_team_id"]
                if tid not in evals_by_team:
                    evals_by_team[tid] = ev

        # Build lightweight entries for sorting (no child data yet)
        pre_entries = []
        for team in visible_teams:
            ev = evals_by_team.get(team["id"], {})
            pre_entries.append({
                "id": team["id"],
                "name": team.get("name", "Untitled"),
                "ruleset_slug": team.get("ruleset_slug", ""),
                "team_size": team.get("team_size"),
                "cornerstone_legend_id": team.get("cornerstone_legend_id"),
                "star_rating": ev.get("star_rating"),
                "starting_lineup_score": ev.get("starting_lineup_score"),
                "created_at": team.get("created_at"),
            })

        # Sort and paginate BEFORE fetching child data
        if sort == "date":
            pre_entries.sort(key=lambda e: e.get("created_at") or "", reverse=True)
        else:
            pre_entries.sort(key=lambda e: e.get("star_rating") or 0, reverse=True)

        total = len(pre_entries)
        start = (page - 1) * per_page
        page_entries = pre_entries[start : start + per_page]
        page_team_ids = [e["id"] for e in page_entries]

        # Resolve legend names for cornerstone display (page-scoped)
        all_legend_ids = list({
            e["cornerstone_legend_id"]
            for e in page_entries
            if e.get("cornerstone_legend_id")
        })

        # Fetch players for page teams only
        players_by_team: dict[str, list[dict]] = {}
        if page_team_ids:
            players_res = (
                supabase.table("saved_team_players")
                .select("saved_team_id, slot, is_cornerstone, player_name_snapshot, position_snapshot, player_id, legend_id")
                .in_("saved_team_id", page_team_ids)
                .order("slot")
                .execute()
            )
            all_stp = players_res.data or []

            # Collect legend IDs from roster players for merged resolution
            roster_legend_ids = [p["legend_id"] for p in all_stp if p.get("legend_id")]
            all_legend_ids = list(set(all_legend_ids) | set(roster_legend_ids))

            # Resolve nba_api_id for portrait URLs
            player_ids = list({p["player_id"] for p in all_stp if p.get("player_id")})

            nba_api_map: dict[str, int | None] = {}
            if player_ids:
                p_res = supabase.table("players").select("id, nba_api_id").in_("id", player_ids).execute()
                for row in p_res.data or []:
                    nba_api_map[row["id"]] = row.get("nba_api_id")

            for p in all_stp:
                tid = p["saved_team_id"]
                pid = p["player_id"] if p.get("player_id") is not None else p.get("legend_id")
                players_by_team.setdefault(tid, []).append({
                    "name": p.get("player_name_snapshot", "Unknown"),
                    "position": p.get("position_snapshot"),
                    "is_cornerstone": p.get("is_cornerstone", False),
                    "slot": p.get("slot", 0),
                    "player_id": p.get("player_id"),
                    "legend_id": p.get("legend_id"),
                    "nba_api_id": nba_api_map.get(pid) if pid else None,
                })

        # Single merged legends query for names + nba_api_ids
        legend_names, legend_nba_ids = _resolve_legends(supabase, all_legend_ids)

        # Backfill nba_api_id for legend-sourced players
        for team_players in players_by_team.values():
            for p in team_players:
                if p["nba_api_id"] is None and p.get("legend_id"):
                    p["nba_api_id"] = legend_nba_ids.get(p["legend_id"])

        # Build final entries with child data
        entries = []
        for e in page_entries:
            entries.append({
                "id": e["id"],
                "name": e["name"],
                "ruleset_slug": e["ruleset_slug"],
                "team_size": e["team_size"],
                "cornerstone_name": legend_names.get(
                    e.get("cornerstone_legend_id", ""), "-"
                ),
                "star_rating": e["star_rating"],
                "starting_lineup_score": e["starting_lineup_score"],
                "created_at": e["created_at"],
                "players": players_by_team.get(e["id"], []),
            })

        return _ok({
            "teams": entries,
            "total": total,
            "page": page,
            "per_page": per_page,
        })

    except Exception:
        logger.exception("Error in GET /api/community/teams")
        return _err("Internal server error", status=500)
