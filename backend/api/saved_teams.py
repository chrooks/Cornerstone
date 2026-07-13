"""
api/saved_teams.py — Saved Team persistence endpoints.
"""

from __future__ import annotations

import logging
import uuid as _uuid_mod
from typing import Any

from flask import Blueprint, g, jsonify, request

from api.auth import require_user
from services.evaluation_versions import repo as eval_versions_repo
from services.evaluation_versions.compat import diff_taxonomy
from services.evaluation_versions.repo import get_active as get_active_eval_version
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

saved_teams_bp = Blueprint("saved_teams", __name__, url_prefix="/api")

EVALUATION_VERSION = "cohesion-v1"  # HISTORICAL — FK uses evaluation_version_id now
VALID_TEAM_SIZES = {5, 9, 12}
TEAM_SIZE_LABELS = {5: "Lineup", 9: "Rotation", 12: "Roster"}


def _ok(data: Any, status: int = 200) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


def _validate_uuid(value: Any) -> bool:
    try:
        _uuid_mod.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _published_snapshot_release_id(supabase, requested_id: str | None) -> str | None:
    query = (
        supabase.table("snapshot_releases")
        .select("id, status")
        .eq("status", "published")
    )
    if requested_id:
        query = query.eq("id", requested_id)
    else:
        query = query.order("published_at", desc=True).limit(1)

    res = query.execute()
    rows = res.data or []
    return rows[0]["id"] if rows else None


def _published_ruleset_version(supabase, ruleset_slug: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    ruleset_res = (
        supabase.table("rulesets")
        .select("id, slug, name, status")
        .eq("slug", ruleset_slug)
        .limit(1)
        .execute()
    )
    ruleset_rows = ruleset_res.data or []
    if not ruleset_rows:
        return None

    ruleset = ruleset_rows[0]
    version_res = (
        supabase.table("ruleset_versions")
        .select("id, ruleset_id, version_label, rules_hash, rules_json, status, published_at")
        .eq("ruleset_id", ruleset["id"])
        .eq("status", "published")
        .order("published_at", desc=True)
        .limit(1)
        .execute()
    )
    version_rows = version_res.data or []
    if not version_rows:
        return None

    return ruleset, version_rows[0]


def _is_missing_snapshot_release_table(exc: Exception) -> bool:
    text = str(exc)
    return (
        "snapshot_releases" in text
        and (
            "schema cache" in text
            or "Could not find the table" in text
            or "relation" in text
        )
    )


def _validate_saved_team(
    body: dict[str, Any],
    rules_json: dict[str, Any],
) -> tuple[list[dict[str, Any]] | None, int | None, str | None]:
    configured_team_size = rules_json.get("team_size", 9)
    if not isinstance(configured_team_size, int) or isinstance(configured_team_size, bool):
        configured_team_size = 9

    raw_allowed_team_sizes = rules_json.get("allowed_team_sizes")
    if isinstance(raw_allowed_team_sizes, list) and raw_allowed_team_sizes:
        allowed_team_sizes = [
            size for size in raw_allowed_team_sizes
            if isinstance(size, int) and not isinstance(size, bool)
        ]
    else:
        allowed_team_sizes = [configured_team_size]


    salary_cap = rules_json.get("salary_cap")  # None when no cap (e.g. Free For All)
    cornerstone_source = rules_json.get("cornerstone_source", "legend")

    cornerstone_legend_id = body.get("cornerstone_legend_id")
    if cornerstone_legend_id is not None and not _validate_uuid(cornerstone_legend_id):
        return None, None, "cornerstone_legend_id must be a valid UUID when present"

    players = body.get("players")
    if not isinstance(players, list):
        return None, None, "players must be an array"

    requested_team_size = body.get(
        "team_size",
        len(players) if len(allowed_team_sizes) > 1 else configured_team_size,
    )
    if not isinstance(requested_team_size, int) or isinstance(requested_team_size, bool):
        return None, None, "team_size must be an integer"
    if requested_team_size not in VALID_TEAM_SIZES:
        return None, None, f"team_size must be one of: {sorted(VALID_TEAM_SIZES)}"
    if requested_team_size not in allowed_team_sizes:
        return None, None, f"team_size must be one of this RuleSet's allowed sizes: {sorted(allowed_team_sizes)}"

    team_size = requested_team_size
    team_label = TEAM_SIZE_LABELS.get(team_size, rules_json.get("team_label", "Team"))
    if len(players) != team_size:
        return None, None, f"{team_label} must include exactly {team_size} players"

    slots: list[int] = []
    cornerstone_rows: list[dict[str, Any]] = []
    total_salary = 0

    for player in players:
        if not isinstance(player, dict):
            return None, None, "each saved Team player must be an object"

        slot = player.get("slot")
        if not isinstance(slot, int) or isinstance(slot, bool):
            return None, None, "each saved Team player slot must be an integer"
        slots.append(slot)

        is_cornerstone = player.get("is_cornerstone")
        if not isinstance(is_cornerstone, bool):
            return None, None, "each saved Team player must include is_cornerstone"
        if is_cornerstone:
            cornerstone_rows.append(player)

        salary_value = player.get("salary_snapshot", 0)
        if not isinstance(salary_value, int) or salary_value < 0:
            return None, None, "salary_snapshot must be a non-negative integer"
        total_salary += salary_value

        name = player.get("player_name_snapshot")
        if not isinstance(name, str) or not name.strip():
            return None, None, "player_name_snapshot is required"

        skills = player.get("skill_profile_snapshot")
        if not isinstance(skills, dict):
            return None, None, "skill_profile_snapshot must be an object"

        player_id = player.get("player_id")
        legend_id = player.get("legend_id")
        if player_id is not None and not _validate_uuid(player_id):
            return None, None, "player_id must be a valid UUID when present"
        if legend_id is not None and not _validate_uuid(legend_id):
            return None, None, "legend_id must be a valid UUID when present"
        if player_id is None and legend_id is None:
            return None, None, "each saved Team player needs player_id or legend_id"

    if sorted(slots) != list(range(1, team_size + 1)):
        return None, None, f"{team_label} slots must be exactly 1 through {team_size}"

    # Cornerstone validation (when rules_json declares a cornerstone rule)
    cornerstone_rule = rules_json.get("cornerstone_rule")
    if cornerstone_rule:
        if len(cornerstone_rows) != 1:
            return None, None, f"{team_label} must include exactly one Cornerstone"
        cornerstone = cornerstone_rows[0]
        if cornerstone["slot"] != 1:
            return None, None, "Cornerstone must be in slot 1"
        if cornerstone_source == "legend":
            # Legend-only cornerstone: must use legend_id matching the top-level field
            if cornerstone.get("legend_id") != cornerstone_legend_id:
                return None, None, "Cornerstone legend_id must match cornerstone_legend_id"
            if cornerstone.get("player_id") is not None:
                return None, None, "Cornerstone must use legend_id, not player_id"
        # cornerstone_source == "all": any player or legend is valid as cornerstone

    if salary_cap is not None and total_salary > salary_cap:
        return None, None, f"Saved Team exceeds SalaryCap of ${salary_cap:,}"

    # RookieDeal limit (M3)
    rookie_deal_limit = rules_json.get("rookie_deal_limit")
    if rookie_deal_limit is not None:
        rookie_count = sum(1 for p in players if p.get("is_rookie_deal"))
        if rookie_count > rookie_deal_limit:
            return None, None, f"{team_label} allows at most {rookie_deal_limit} rookie-deal players"

    return players, team_size, None


def _auto_name(
    body: dict[str, Any],
    players: list[dict[str, Any]],
    team_size: int,
    rules_json: dict[str, Any] | None = None,
) -> str:
    raw_name = body.get("name")
    if isinstance(raw_name, str) and raw_name.strip():
        return raw_name.strip()
    cornerstone = next((player for player in players if player["is_cornerstone"]), None)
    name_part = cornerstone["player_name_snapshot"].strip() if cornerstone else players[0]["player_name_snapshot"].strip()
    team_label = TEAM_SIZE_LABELS.get(team_size, (rules_json or {}).get("team_label", "Rotation"))
    return f"{name_part} {team_label}"


def _resolve_snapshot_player(
    supabase,
    snapshot_release_id: str,
    source_player_id: str | None,
) -> tuple[str | None, str | None]:
    if not source_player_id:
        return None, None
    res = (
        supabase.table("released_players")
        .select("id, canonical_player_id")
        .eq("snapshot_release_id", snapshot_release_id)
        .eq("source_player_id", source_player_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None, None
    return rows[0]["id"], rows[0]["canonical_player_id"]


def _player_insert_rows(saved_team_id: str, players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for player in sorted(players, key=lambda item: item["slot"]):
        rows.append({
            "saved_team_id": saved_team_id,
            "player_id": player.get("player_id"),
            "source_player_id": player.get("player_id"),
            "snapshot_player_id": player.get("snapshot_player_id"),
            "canonical_player_id": player.get("canonical_player_id"),
            "legend_id": player.get("legend_id"),
            "slot": player["slot"],
            "is_cornerstone": player["is_cornerstone"],
            "salary_snapshot": player.get("salary_snapshot", 0),
            "player_name_snapshot": player["player_name_snapshot"].strip(),
            "team_snapshot": player.get("team_snapshot"),
            "position_snapshot": player.get("position_snapshot"),
            "skill_profile_snapshot": player.get("skill_profile_snapshot", {}),
        })
    return rows


def _enrich_players_with_nba_api_ids(supabase, players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched = [dict(player) for player in players]
    canonical_player_ids = list({
        player["canonical_player_id"]
        for player in enriched
        if player.get("canonical_player_id")
    })
    player_ids = list({player["player_id"] for player in enriched if player.get("player_id")})
    legend_ids = list({player["legend_id"] for player in enriched if player.get("legend_id")})

    canonical_nba_ids: dict[str, int | None] = {}
    if canonical_player_ids:
        res = (
            supabase.table("canonical_players")
            .select("id, nba_api_id")
            .in_("id", canonical_player_ids)
            .execute()
        )
        canonical_nba_ids = {row["id"]: row.get("nba_api_id") for row in res.data or []}

    player_nba_ids: dict[str, int | None] = {}
    if player_ids:
        res = supabase.table("players").select("id, nba_api_id").in_("id", player_ids).execute()
        player_nba_ids = {row["id"]: row.get("nba_api_id") for row in res.data or []}

    legend_nba_ids: dict[str, int | None] = {}
    if legend_ids:
        res = supabase.table("legends").select("id, nba_api_id").in_("id", legend_ids).execute()
        legend_nba_ids = {row["id"]: row.get("nba_api_id") for row in res.data or []}

    for player in enriched:
        nba_api_id = None
        if player.get("canonical_player_id"):
            nba_api_id = canonical_nba_ids.get(player["canonical_player_id"])
        if nba_api_id is None and player.get("player_id"):
            nba_api_id = player_nba_ids.get(player["player_id"])
        if nba_api_id is None and player.get("legend_id"):
            nba_api_id = legend_nba_ids.get(player["legend_id"])
        player["nba_api_id"] = nba_api_id

    return enriched


def _players_for_saved_team(
    supabase,
    saved_team_id: str,
    *,
    include_nba_api_ids: bool = False,
) -> list[dict[str, Any]]:
    res = (
        supabase.table("saved_team_players")
        .select("*")
        .eq("saved_team_id", saved_team_id)
        .order("slot")
        .execute()
    )
    players = res.data or []
    if include_nba_api_ids:
        return _enrich_players_with_nba_api_ids(supabase, players)
    return players


def _latest_evaluation_for_saved_team(supabase, saved_team_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table("saved_team_evaluations")
        .select("*, evaluation_versions(slug)")
        .eq("saved_team_id", saved_team_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    row = rows[0]
    # Flatten the joined slug into `evaluation_version` for frontend compat
    ev = row.pop("evaluation_versions", None)
    row["evaluation_version"] = ev["slug"] if ev and isinstance(ev, dict) else None
    return row


def _stored_evaluation_version_id(supabase, saved_team_id: str) -> str | None:
    """Return the Evaluation Version id of the Saved Team's latest evaluation."""
    res = (
        supabase.table("saved_team_evaluations")
        .select("evaluation_version_id, created_at")
        .eq("saved_team_id", saved_team_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return rows[0].get("evaluation_version_id")


def _version_chip(version: Any) -> dict[str, Any]:
    """Compact descriptor for an Evaluation Version (no payload)."""
    return {"id": version.id, "slug": version.slug, "status": version.status}


def _build_eval_compat_report(
    supabase,
    saved_team_id: str,
) -> tuple[dict[str, Any] | None, str | None, int]:
    """Compare the Saved Team's stored Evaluation Version taxonomy footprint to
    the active Version's. Returns (report, error_msg, status_code).

    Per ADR-0002, the compat check runs at Lab open time. When the stored and
    active Versions share a taxonomy footprint (only values changed), the report
    sets needs_resolution=False so re-evaluation proceeds without a dialog.
    """
    active_version = get_active_eval_version()

    stored_version_id = _stored_evaluation_version_id(supabase, saved_team_id)
    if not stored_version_id or stored_version_id == active_version.id:
        # No prior binding, or already scored under the active Version — nothing
        # to migrate; re-eval can proceed straight through.
        return {
            "saved_team_id": saved_team_id,
            "stored_version": None if not stored_version_id else _version_chip(active_version),
            "active_version": _version_chip(active_version),
            "same_version": bool(stored_version_id) and stored_version_id == active_version.id,
            "needs_resolution": False,
            "diff": diff_taxonomy(active_version.payload, active_version.payload),
        }, None, 200

    stored_version = eval_versions_repo.get_version(stored_version_id)
    diff = diff_taxonomy(stored_version.payload, active_version.payload)

    return {
        "saved_team_id": saved_team_id,
        "stored_version": _version_chip(stored_version),
        "active_version": _version_chip(active_version),
        "same_version": False,
        "needs_resolution": diff["needs_resolution"],
        "diff": diff,
    }, None, 200


def _extract_starting_lineup_score(evaluation: dict[str, Any]) -> Any:
    if "starting_lineup_score" in evaluation:
        return evaluation.get("starting_lineup_score")

    starting_lineup = evaluation.get("starting_lineup")
    if isinstance(starting_lineup, dict):
        return starting_lineup.get("cohesion_score")

    return None


def _serialize_saved_team(
    saved_team: dict[str, Any],
    players: list[dict[str, Any]],
    evaluation: dict[str, Any] | None,
    *,
    include_evaluation_payload: bool = False,
) -> dict[str, Any]:
    evaluation_data = None
    if evaluation:
        evaluation_data = {
            "id": evaluation.get("id"),
            "evaluation_version": evaluation.get("evaluation_version"),
            "star_rating": evaluation.get("star_rating"),
            "starting_lineup_score": evaluation.get("starting_lineup_score"),
            "team_description": evaluation.get("team_description"),
            "created_at": evaluation.get("created_at"),
        }
        if include_evaluation_payload:
            evaluation_data["evaluation_payload"] = evaluation.get("evaluation_payload")

    return {
        "id": saved_team["id"],
        "name": saved_team["name"],
        "ruleset_slug": saved_team["ruleset_slug"],
        "ruleset_version_id": saved_team.get("ruleset_version_id"),
        "ruleset_version_label": saved_team.get("ruleset_version_label"),
        "ruleset_version_hash": saved_team.get("ruleset_version_hash"),
        "team_size": saved_team.get("team_size"),
        "snapshot_release_id": saved_team["snapshot_release_id"],
        "visibility": saved_team["visibility"],
        "cornerstone_legend_id": saved_team.get("cornerstone_legend_id"),
        "total_salary": saved_team.get("total_salary", 0),
        "created_at": saved_team.get("created_at"),
        "updated_at": saved_team.get("updated_at"),
        "evaluation": evaluation_data,
        "players": players,
    }


def _check_legend_available(supabase, legend_id: str) -> tuple[bool, str | None]:
    """Check if a Legend exists and return (available, name)."""
    res = (
        supabase.table("legends")
        .select("id, name")
        .eq("id", legend_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return False, None
    return True, rows[0]["name"]


def _resolve_cornerstone_for_rebuild(
    supabase,
    cornerstone_legend_id: str | None,
    saved_team_players: list[dict[str, Any]],
    current_snapshot_release_id: str,
) -> dict[str, Any]:
    """Resolve the cornerstone for rebuild — Legend or active player."""
    # Try Legend first
    if cornerstone_legend_id:
        available, name = _check_legend_available(supabase, cornerstone_legend_id)
        if available:
            return {
                "id": cornerstone_legend_id,
                "legend_id": cornerstone_legend_id,
                "player_id": None,
                "name": name,
                "status": "legend",
                "available": True,
            }

    # Fall back to cornerstone row from saved roster
    cornerstone_row = next(
        (p for p in saved_team_players if p.get("is_cornerstone")),
        None,
    )
    if not cornerstone_row:
        return {
            "id": None,
            "legend_id": cornerstone_legend_id,
            "player_id": None,
            "name": "Unknown",
            "status": "missing",
            "available": False,
        }

    # Cornerstone row may be a Legend (FFA saves with legend_id on the row)
    row_legend_id = cornerstone_row.get("legend_id")
    if row_legend_id:
        available, name = _check_legend_available(supabase, row_legend_id)
        if available:
            return {
                "id": row_legend_id,
                "legend_id": row_legend_id,
                "player_id": None,
                "name": name,
                "status": "legend",
                "available": True,
            }

    # Active player cornerstone — resolve via source_player_id
    source_id = cornerstone_row.get("source_player_id")
    if source_id:
        res = (
            supabase.table("released_players")
            .select("source_player_id, name")
            .eq("snapshot_release_id", current_snapshot_release_id)
            .eq("source_player_id", source_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if rows:
            return {
                "id": rows[0]["source_player_id"],
                "legend_id": None,
                "player_id": rows[0]["source_player_id"],
                "name": rows[0]["name"],
                "status": "player",
                "available": True,
            }

    # Player not found in current snapshot
    return {
        "id": source_id,
        "legend_id": None,
        "player_id": source_id,
        "name": cornerstone_row.get("player_name_snapshot", "Unknown"),
        "status": "missing",
        "available": False,
    }


def _resolve_players_for_rebuild(
    supabase,
    saved_team_players: list[dict[str, Any]],
    current_snapshot_release_id: str,
) -> list[dict[str, Any]]:
    """Resolve each non-cornerstone saved player against the current Snapshot Release.

    Uses canonical_player_id → released_players join. Falls back to
    source_player_id when canonical_player_id is absent (legacy data).
    """
    reports: list[dict[str, Any]] = []
    for player in saved_team_players:
        if player.get("is_cornerstone"):
            continue

        saved_data = {
            "player_name_snapshot": player["player_name_snapshot"],
            "salary_snapshot": player.get("salary_snapshot", 0),
            "skill_profile_snapshot": player.get("skill_profile_snapshot", {}),
        }

        # Legend supporting players (FFA) — resolve via legends table
        legend_id = player.get("legend_id")
        if legend_id and not player.get("source_player_id"):
            available, name = _check_legend_available(supabase, legend_id)
            if available:
                reports.append({
                    "slot": player["slot"],
                    "status": "matched",
                    "saved": saved_data,
                    "current": {
                        "source_player_id": legend_id,
                        "name": name,
                        "salary": player.get("salary_snapshot", 0),
                        "team": player.get("team_snapshot"),
                        "position": player.get("position_snapshot"),
                        "skill_profile_snapshot": player.get("skill_profile_snapshot", {}),
                    },
                })
            else:
                reports.append({
                    "slot": player["slot"],
                    "status": "missing",
                    "saved": saved_data,
                    "current": None,
                })
            continue

        canonical_id = player.get("canonical_player_id")
        source_id = player.get("source_player_id")

        current_row = None
        if canonical_id:
            res = (
                supabase.table("released_players")
                .select("source_player_id, name, team, position, salary, skill_profile_snapshot")
                .eq("snapshot_release_id", current_snapshot_release_id)
                .eq("canonical_player_id", canonical_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if rows:
                current_row = rows[0]
        elif source_id:
            res = (
                supabase.table("released_players")
                .select("source_player_id, name, team, position, salary, skill_profile_snapshot")
                .eq("snapshot_release_id", current_snapshot_release_id)
                .eq("source_player_id", source_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if rows:
                current_row = rows[0]

        if current_row:
            reports.append({
                "slot": player["slot"],
                "status": "matched",
                "saved": saved_data,
                "current": {
                    "source_player_id": current_row["source_player_id"],
                    "name": current_row["name"],
                    "salary": current_row["salary"],
                    "team": current_row.get("team"),
                    "position": current_row.get("position"),
                    "skill_profile_snapshot": current_row.get("skill_profile_snapshot", {}),
                },
            })
        else:
            reports.append({
                "slot": player["slot"],
                "status": "missing",
                "saved": saved_data,
                "current": None,
            })

    return reports


def _version_summary(version_row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": version_row["id"],
        "version_label": version_row.get("version_label"),
        "rules_hash": version_row.get("rules_hash"),
        "rules_json": version_row.get("rules_json", {}),
    }


def _build_rebuild_report(
    supabase,
    saved_team: dict[str, Any],
    saved_team_id: str,
) -> tuple[dict[str, Any] | None, str | None, int]:
    """Build rebuild compatibility report. Returns (report, error_msg, status_code)."""
    players = _players_for_saved_team(supabase, saved_team_id)

    current_snapshot_id = _published_snapshot_release_id(supabase, None)
    if not current_snapshot_id:
        return None, "No published Snapshot Release available", 400

    ruleset_slug = saved_team["ruleset_slug"]
    current_version = _published_ruleset_version(supabase, ruleset_slug)
    if not current_version:
        return None, "No published RuleSet Version available", 400
    _current_ruleset, current_ruleset_version = current_version

    original_version_id = saved_team.get("ruleset_version_id")
    orig_res = (
        supabase.table("ruleset_versions")
        .select("id, version_label, rules_hash, rules_json, status, published_at")
        .eq("id", original_version_id)
        .limit(1)
        .execute()
    )
    orig_rows = orig_res.data or []
    original_ruleset_version = orig_rows[0] if orig_rows else None

    cornerstone_legend_id = saved_team.get("cornerstone_legend_id")
    cornerstone_info = _resolve_cornerstone_for_rebuild(
        supabase, cornerstone_legend_id, players, current_snapshot_id,
    )

    player_reports = _resolve_players_for_rebuild(supabase, players, current_snapshot_id)

    version_changed = original_version_id != current_ruleset_version["id"]
    version_drift = {
        "original": _version_summary(original_ruleset_version) if original_ruleset_version else None,
        "current": _version_summary(current_ruleset_version),
        "changed": version_changed,
    }

    rules_json = current_ruleset_version.get("rules_json") or {}
    cornerstone_source = rules_json.get("cornerstone_source", "legend")
    builder_params: dict[str, str] = {}
    saved_team_size = saved_team.get("team_size")
    if saved_team_size is not None:
        builder_params["team_size"] = str(saved_team_size)
    if cornerstone_info["available"]:
        if cornerstone_source == "all":
            builder_params["s1"] = cornerstone_info["id"]
        else:
            builder_params["cornerstone"] = cornerstone_info["id"]
    for report in player_reports:
        if report["status"] == "matched" and report["current"]:
            builder_params[f"s{report['slot']}"] = report["current"]["source_player_id"]

    return {
        "saved_team_id": saved_team_id,
        "ruleset_slug": ruleset_slug,
        "version_drift": version_drift,
        "cornerstone": cornerstone_info,
        "players": player_reports,
        "rebuild_ready": True,
        "builder_url_params": builder_params,
    }, None, 200


@saved_teams_bp.route("/saved-teams/<saved_team_id>/rebuild-check", methods=["GET"])
@require_user
def rebuild_check(saved_team_id: str):
    """Return a compatibility report for rebuilding a Saved Team."""
    try:
        supabase = get_supabase()

        res = (
            supabase.table("saved_teams")
            .select("*")
            .eq("id", saved_team_id)
            .eq("user_id", g.user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Saved Team not found", status=404)

        report, error_msg, status = _build_rebuild_report(supabase, rows[0], saved_team_id)
        if error_msg:
            return _err(error_msg, status=status)
        return _ok(report)

    except Exception:
        logger.exception("Error in GET /api/saved-teams/%s/rebuild-check", saved_team_id)
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/saved-teams/<saved_team_id>/eval-compat-check", methods=["GET"])
@require_user
def eval_compat_check(saved_team_id: str):
    """Compare a Saved Team's stored Evaluation Version taxonomy to the active one.

    Surfaces renamed Skills, removed Impact Traits, and added Subscores so the
    user can resolve taxonomy drift before the Lab re-evaluates (issue #33).
    """
    try:
        supabase = get_supabase()

        res = (
            supabase.table("saved_teams")
            .select("id")
            .eq("id", saved_team_id)
            .eq("user_id", g.user_id)
            .limit(1)
            .execute()
        )
        if not (res.data or []):
            return _err("Saved Team not found", status=404)

        report, error_msg, status = _build_eval_compat_report(supabase, saved_team_id)
        if error_msg:
            return _err(error_msg, status=status)
        return _ok(report)

    except Exception:
        logger.exception("Error in GET /api/saved-teams/%s/eval-compat-check", saved_team_id)
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/saved-teams", methods=["GET"])
@require_user
def list_saved_teams():
    try:
        supabase = get_supabase()
        res = (
            supabase.table("saved_teams")
            .select("*")
            .eq("user_id", g.user_id)
            .order("created_at", desc=True)
            .execute()
        )
        saved_teams = res.data or []
        data = [
            _serialize_saved_team(
                saved_team,
                _players_for_saved_team(supabase, saved_team["id"]),
                _latest_evaluation_for_saved_team(supabase, saved_team["id"]),
            )
            for saved_team in saved_teams
        ]
        return _ok(data)
    except Exception:
        logger.exception("Error in GET /api/saved-teams")
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/saved-teams/<saved_team_id>", methods=["GET"])
@require_user
def get_saved_team(saved_team_id: str):
    try:
        supabase = get_supabase()
        res = (
            supabase.table("saved_teams")
            .select("*")
            .eq("id", saved_team_id)
            .eq("user_id", g.user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Saved Team not found", status=404)

        saved_team = rows[0]

        # Resolve version_label for display
        version_id = saved_team.get("ruleset_version_id")
        if version_id:
            ver_res = supabase.table("ruleset_versions").select("version_label").eq("id", version_id).limit(1).execute()
            ver_rows = ver_res.data or []
            if ver_rows:
                saved_team["ruleset_version_label"] = ver_rows[0].get("version_label")

        return _ok(_serialize_saved_team(
            saved_team,
            _players_for_saved_team(supabase, saved_team["id"]),
            _latest_evaluation_for_saved_team(supabase, saved_team["id"]),
            include_evaluation_payload=True,
        ))
    except Exception:
        logger.exception("Error in GET /api/saved-teams/%s", saved_team_id)
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/saved-teams", methods=["POST"])
@require_user
def create_saved_team():
    body = request.get_json(silent=True) or {}

    # --- H2: Client must assert which RuleSet Version it built against ---
    client_version_id = body.get("ruleset_version_id")
    client_rules_hash = body.get("rules_hash")
    if not client_version_id or not _validate_uuid(client_version_id):
        return _err("ruleset_version_id is required")
    if not client_rules_hash or not isinstance(client_rules_hash, str):
        return _err("rules_hash is required")

    # #94: the commit moment chooses visibility, and the leaderboard shows only
    # public/unlisted — so the choice has to land here, not default silently.
    visibility = body.get("visibility", "private")
    if visibility not in VALID_VISIBILITIES:
        return _err(f"visibility must be one of: {', '.join(VALID_VISIBILITIES)}")

    try:
        supabase = get_supabase()

        # Load and verify the client-asserted RuleSet Version
        version_res = (
            supabase.table("ruleset_versions")
            .select("id, ruleset_id, version_label, rules_hash, rules_json, status, published_at")
            .eq("id", client_version_id)
            .eq("status", "published")
            .limit(1)
            .execute()
        )
        version_rows = version_res.data or []
        if not version_rows:
            return _err("RuleSet Version not found or not published", status=400)
        ruleset_version_row = version_rows[0]

        if client_rules_hash != ruleset_version_row["rules_hash"]:
            return _err(
                "RuleSet Version has changed since you started building. Reload to get the current version.",
                status=409,
            )

        # Resolve parent RuleSet
        ruleset_res = (
            supabase.table("rulesets")
            .select("id, slug, name, status")
            .eq("id", ruleset_version_row["ruleset_id"])
            .limit(1)
            .execute()
        )
        ruleset_rows = ruleset_res.data or []
        if not ruleset_rows:
            return _err("A published RuleSet Version is required", status=400)
        ruleset_row = ruleset_rows[0]

        rules_json = ruleset_version_row["rules_json"]
        players, team_size, validation_error = _validate_saved_team(body, rules_json)
        if validation_error:
            return _err(validation_error)
        assert players is not None
        assert team_size is not None

        snapshot_release_id = body.get("snapshot_release_id")
        if snapshot_release_id is not None and not _validate_uuid(snapshot_release_id):
            return _err("snapshot_release_id must be a valid UUID")

        try:
            published_snapshot_id = _published_snapshot_release_id(supabase, snapshot_release_id)
        except Exception as exc:
            if _is_missing_snapshot_release_table(exc):
                return _err(
                    "Snapshot Release migration has not been applied. Run the saved_teams Supabase migration before saving Teams.",
                    status=503,
                )
            raise
        if published_snapshot_id is None:
            return _err("A published Snapshot Release is required", status=400)

        total_salary = sum(player.get("salary_snapshot", 0) for player in players)
        evaluation = body.get("evaluation") if isinstance(body.get("evaluation"), dict) else {}

        saved_team_insert = {
            "user_id": g.user_id,
            "ruleset_slug": ruleset_row["slug"],
            "ruleset_id": ruleset_row["id"],
            "ruleset_version_id": ruleset_version_row["id"],
            "ruleset_version_hash": client_rules_hash,
            "snapshot_release_id": published_snapshot_id,
            "name": _auto_name(body, players, team_size, rules_json),
            "visibility": visibility,
            "cornerstone_legend_id": body.get("cornerstone_legend_id"),
            "total_salary": total_salary,
            "team_size": team_size,
        }

        team_res = supabase.table("saved_teams").insert(saved_team_insert).execute()
        saved_team = team_res.data[0]
        saved_team_id = saved_team["id"]

        # M4: resolve Snapshot Player + Canonical Player ids for each non-Legend player
        for player in players:
            source_pid = player.get("player_id")
            if source_pid:
                snap_id, canon_id = _resolve_snapshot_player(supabase, published_snapshot_id, source_pid)
                player["snapshot_player_id"] = snap_id
                player["canonical_player_id"] = canon_id

        try:
            supabase.table("saved_team_players").insert(
                _player_insert_rows(saved_team_id, players)
            ).execute()
            # Resolve active Evaluation Version FK for score-time binding
            active_eval_version = get_active_eval_version()

            supabase.table("saved_team_evaluations").insert({
                "saved_team_id": saved_team_id,
                "evaluation_version_id": active_eval_version.id,
                "star_rating": evaluation.get("star_rating"),
                "starting_lineup_score": _extract_starting_lineup_score(evaluation),
                "team_description": evaluation.get("team_description"),
                "evaluation_payload": evaluation,
            }).execute()
        except Exception:
            supabase.table("saved_teams").delete().eq("id", saved_team_id).execute()
            raise

        return _ok({
            "id": saved_team_id,
            "name": saved_team["name"],
            "ruleset_slug": saved_team["ruleset_slug"],
            "ruleset_version_id": saved_team["ruleset_version_id"],
            "ruleset_version_hash": saved_team["ruleset_version_hash"],
            "team_size": saved_team.get("team_size"),
            "snapshot_release_id": saved_team["snapshot_release_id"],
            "visibility": saved_team["visibility"],
        }, status=201)

    except Exception:
        logger.exception("Error in POST /api/saved-teams")
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/saved-teams/<saved_team_id>", methods=["DELETE"])
@require_user
def delete_saved_team(saved_team_id: str):
    try:
        supabase = get_supabase()

        res = (
            supabase.table("saved_teams")
            .select("id")
            .eq("id", saved_team_id)
            .eq("user_id", g.user_id)
            .limit(1)
            .execute()
        )
        if not (res.data or []):
            return _err("Saved Team not found", status=404)

        # Children cascade via FK ON DELETE CASCADE, but delete explicitly
        # for the fake test DB which doesn't enforce FK cascades.
        supabase.table("saved_team_evaluations").delete().eq("saved_team_id", saved_team_id).execute()
        supabase.table("saved_team_players").delete().eq("saved_team_id", saved_team_id).execute()
        supabase.table("saved_teams").delete().eq("id", saved_team_id).execute()

        return _ok({"id": saved_team_id, "deleted": True})

    except Exception:
        logger.exception("Error in DELETE /api/saved-teams/%s", saved_team_id)
        return _err("Internal server error", status=500)


VISIBLE_TO_ANYONE = ("public", "unlisted")


@saved_teams_bp.route("/shared/<saved_team_id>", methods=["GET"])
def get_shared_saved_team(saved_team_id: str):
    """Return a Saved Team if its visibility is public or unlisted. No auth required."""
    try:
        if not _validate_uuid(saved_team_id):
            return _err("Saved Team not found", status=404)

        supabase = get_supabase()
        res = (
            supabase.table("saved_teams")
            .select("*")
            .eq("id", saved_team_id)
            .in_("visibility", list(VISIBLE_TO_ANYONE))
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Saved Team not found", status=404)

        saved_team = rows[0]

        # Resolve version_label for display
        version_id = saved_team.get("ruleset_version_id")
        if version_id:
            ver_res = supabase.table("ruleset_versions").select("version_label").eq("id", version_id).limit(1).execute()
            ver_rows = ver_res.data or []
            if ver_rows:
                saved_team["ruleset_version_label"] = ver_rows[0].get("version_label")

        return _ok(_serialize_saved_team(
            saved_team,
            _players_for_saved_team(supabase, saved_team["id"], include_nba_api_ids=True),
            _latest_evaluation_for_saved_team(supabase, saved_team["id"]),
            include_evaluation_payload=True,
        ))
    except Exception:
        logger.exception("Error in GET /api/shared/%s", saved_team_id)
        return _err("Internal server error", status=500)


@saved_teams_bp.route("/shared/<saved_team_id>/rebuild-check", methods=["GET"])
def shared_rebuild_check(saved_team_id: str):
    """Return a rebuild compatibility report for a public/unlisted Saved Team. No auth required."""
    try:
        if not _validate_uuid(saved_team_id):
            return _err("Saved Team not found", status=404)

        supabase = get_supabase()

        res = (
            supabase.table("saved_teams")
            .select("*")
            .eq("id", saved_team_id)
            .in_("visibility", list(VISIBLE_TO_ANYONE))
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Saved Team not found", status=404)

        report, error_msg, status = _build_rebuild_report(supabase, rows[0], saved_team_id)
        if error_msg:
            return _err(error_msg, status=status)
        return _ok(report)

    except Exception:
        logger.exception("Error in GET /api/shared/%s/rebuild-check", saved_team_id)
        return _err("Internal server error", status=500)


VALID_VISIBILITIES = ("private", "unlisted", "public")


@saved_teams_bp.route("/saved-teams/<saved_team_id>", methods=["PATCH"])
@require_user
def update_saved_team(saved_team_id: str):
    body = request.get_json(silent=True) or {}

    updates: dict[str, Any] = {}

    name = body.get("name")
    if name is not None:
        if not isinstance(name, str) or not name.strip():
            return _err("name must be a non-empty string")
        updates["name"] = name.strip()

    visibility = body.get("visibility")
    if visibility is not None:
        if visibility not in VALID_VISIBILITIES:
            return _err(f"visibility must be one of: {', '.join(VALID_VISIBILITIES)}")
        updates["visibility"] = visibility

    if not updates:
        return _err("At least one of name or visibility is required")

    try:
        supabase = get_supabase()

        res = (
            supabase.table("saved_teams")
            .select("id, name, visibility")
            .eq("id", saved_team_id)
            .eq("user_id", g.user_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Saved Team not found", status=404)

        supabase.table("saved_teams").update(updates).eq("id", saved_team_id).execute()

        current = rows[0]
        current.update(updates)
        return _ok({
            "id": saved_team_id,
            "name": current["name"],
            "visibility": current["visibility"],
        })

    except Exception:
        logger.exception("Error in PATCH /api/saved-teams/%s", saved_team_id)
        return _err("Internal server error", status=500)
