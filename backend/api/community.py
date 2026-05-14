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

        legend_names = _resolve_legend_names(supabase, visible_teams)

        # Build team entries with evaluation data
        entries = []
        for team in visible_teams:
            ev = evals_by_team.get(team["id"], {})
            entries.append({
                "id": team["id"],
                "name": team.get("name", "Untitled"),
                "ruleset_slug": team.get("ruleset_slug", ""),
                "team_size": team.get("team_size"),
                "cornerstone_name": legend_names.get(
                    team.get("cornerstone_legend_id", ""), "-"
                ),
                "star_rating": ev.get("star_rating"),
                "starting_lineup_score": ev.get("starting_lineup_score"),
                "created_at": team.get("created_at"),
            })

        # Sort
        if sort == "date":
            entries.sort(key=lambda e: e.get("created_at") or "", reverse=True)
        else:
            entries.sort(key=lambda e: e.get("star_rating") or 0, reverse=True)

        total = len(entries)
        start = (page - 1) * per_page
        page_entries = entries[start : start + per_page]

        return _ok({
            "teams": page_entries,
            "total": total,
            "page": page,
            "per_page": per_page,
        })

    except Exception:
        logger.exception("Error in GET /api/community/teams")
        return _err("Internal server error", status=500)
