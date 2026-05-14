"""
api/rulesets.py — RuleSet read + admin write endpoints.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

from flask import Blueprint, jsonify, request

from api.auth import require_admin
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

rulesets_bp = Blueprint("rulesets", __name__, url_prefix="/api")


def canonical_rules_hash(rules_json: dict[str, Any]) -> str:
    """Deterministic hash of rules_json regardless of key order."""
    canonical = json.dumps(rules_json, sort_keys=True, separators=(",", ":"))
    return hashlib.md5(canonical.encode()).hexdigest()


def _ok(data: Any, status: int = 200) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


def _published_version_for_ruleset(supabase, ruleset_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table("ruleset_versions")
        .select("id, ruleset_id, version_label, rules_hash, rules_json, status, published_at")
        .eq("ruleset_id", ruleset_id)
        .eq("status", "published")
        .order("published_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _serialize_ruleset(row: dict[str, Any], version: dict[str, Any] | None) -> dict[str, Any]:
    current_version = None
    rules = None
    if version:
        rules = version.get("rules_json") or {}
        current_version = {
            "id": version["id"],
            "version_label": version["version_label"],
            "rules_hash": version["rules_hash"],
            "rules_json": rules,
            "published_at": version.get("published_at"),
        }

    return {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "description": row.get("description"),
        "status": row["status"],
        "display_order": row.get("display_order", 0),
        "current_version": current_version,
        "rules": rules,
    }


@rulesets_bp.route("/rulesets/<slug>", methods=["PATCH"])
@require_admin
def update_ruleset(slug: str):
    try:
        supabase = get_supabase()
        # Verify RuleSet exists
        res = (
            supabase.table("rulesets")
            .select("id, slug, name, description, status, display_order")
            .eq("slug", slug)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("RuleSet not found", status=404)

        body = request.get_json(silent=True) or {}
        updates: dict[str, Any] = {}

        if "name" in body:
            name = (body["name"] or "").strip()
            if not name:
                return _err("name cannot be empty")
            updates["name"] = name
        if "description" in body:
            updates["description"] = body["description"]
        if "status" in body:
            if body["status"] not in VALID_STATUSES:
                return _err(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")
            updates["status"] = body["status"]
        if "display_order" in body:
            updates["display_order"] = body["display_order"]

        if not updates:
            return _err("No fields to update")

        res = (
            supabase.table("rulesets")
            .update(updates)
            .eq("slug", slug)
            .execute()
        )
        updated_rows = res.data or []
        if not updated_rows:
            return _err("Update failed", status=500)

        row = updated_rows[0]
        return _ok({
            "id": row["id"],
            "slug": row["slug"],
            "name": row["name"],
            "description": row.get("description"),
            "status": row["status"],
            "display_order": row.get("display_order", 0),
        })
    except Exception:
        logger.exception("Error in PATCH /api/rulesets/%s", slug)
        return _err("Internal server error", status=500)


@rulesets_bp.route("/rulesets/<slug>", methods=["GET"])
def get_ruleset(slug: str):
    try:
        supabase = get_supabase()
        res = (
            supabase.table("rulesets")
            .select("id, slug, name, description, status, display_order")
            .eq("slug", slug)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("RuleSet not found", status=404)
        row = rows[0]
        version = _published_version_for_ruleset(supabase, row["id"])
        return _ok(_serialize_ruleset(row, version))
    except Exception:
        logger.exception("Error in GET /api/rulesets/%s", slug)
        return _err("Internal server error", status=500)


VALID_STATUSES = {"active", "coming_soon", "archived"}
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
VALID_TEAM_SIZES = {5, 9, 12}
TEAM_SIZE_LABELS = {5: "Lineup", 9: "Rotation", 12: "Roster"}


def _normalize_rules_json(rules_json: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    normalized = dict(rules_json)

    team_size = normalized.get("team_size")
    if team_size is not None:
        if isinstance(team_size, bool) or team_size not in VALID_TEAM_SIZES:
            return None, f"team_size must be one of: {sorted(VALID_TEAM_SIZES)}"
        normalized["team_label"] = TEAM_SIZE_LABELS[team_size]

    allowed_team_sizes = normalized.get("allowed_team_sizes")
    if allowed_team_sizes is not None:
        if not isinstance(allowed_team_sizes, list) or not allowed_team_sizes:
            return None, "allowed_team_sizes must be a non-empty array"
        if any(isinstance(size, bool) or size not in VALID_TEAM_SIZES for size in allowed_team_sizes):
            return None, f"allowed_team_sizes must only contain: {sorted(VALID_TEAM_SIZES)}"
        if len(set(allowed_team_sizes)) != len(allowed_team_sizes):
            return None, "allowed_team_sizes must not contain duplicates"
        normalized["allowed_team_sizes"] = sorted(allowed_team_sizes)
        if team_size is not None and team_size not in normalized["allowed_team_sizes"]:
            return None, "team_size must be included in allowed_team_sizes"

    return normalized, None


@rulesets_bp.route("/rulesets", methods=["POST"])
@require_admin
def create_ruleset():
    try:
        body = request.get_json(silent=True) or {}
        slug = (body.get("slug") or "").strip()
        name = (body.get("name") or "").strip()

        if not slug:
            return _err("slug is required")
        if not SLUG_PATTERN.match(slug):
            return _err("slug must be lowercase alphanumeric with hyphens")
        if not name:
            return _err("name is required")

        status = body.get("status", "coming_soon")
        if status not in VALID_STATUSES:
            return _err(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")

        display_order = body.get("display_order", 0)

        supabase = get_supabase()
        res = (
            supabase.table("rulesets")
            .insert({
                "slug": slug,
                "name": name,
                "description": body.get("description"),
                "status": status,
                "display_order": display_order,
            })
            .execute()
        )
        row = (res.data or [None])[0]
        if not row:
            return _err("Failed to create RuleSet", status=500)

        return _ok({
            "id": row["id"],
            "slug": row["slug"],
            "name": row["name"],
            "description": row.get("description"),
            "status": row["status"],
            "display_order": row.get("display_order", 0),
        }, status=201)
    except Exception:
        logger.exception("Error in POST /api/rulesets")
        return _err("Internal server error", status=500)


@rulesets_bp.route("/rulesets", methods=["GET"])
def list_rulesets():
    try:
        supabase = get_supabase()
        res = (
            supabase.table("rulesets")
            .select("id, slug, name, description, status, display_order")
            .order("display_order")
            .execute()
        )
        rows = res.data or []
        data = [
            _serialize_ruleset(row, _published_version_for_ruleset(supabase, row["id"]))
            for row in rows
        ]
        return _ok(data)
    except Exception:
        logger.exception("Error in GET /api/rulesets")
        return _err("Internal server error", status=500)


def _find_ruleset_by_slug(supabase, slug: str) -> dict[str, Any] | None:
    """Look up a single RuleSet row by slug, or return None."""
    res = (
        supabase.table("rulesets")
        .select("id, slug, name, description, status, display_order")
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


@rulesets_bp.route("/rulesets/<slug>/versions", methods=["GET"])
@require_admin
def list_versions(slug: str):
    try:
        supabase = get_supabase()
        ruleset = _find_ruleset_by_slug(supabase, slug)
        if not ruleset:
            return _err("RuleSet not found", status=404)

        res = (
            supabase.table("ruleset_versions")
            .select("id, version_label, rules_hash, rules_json, status, published_at, created_at")
            .eq("ruleset_id", ruleset["id"])
            .order("created_at", desc=True)
            .execute()
        )
        return _ok(res.data or [])
    except Exception:
        logger.exception("Error in GET /api/rulesets/%s/versions", slug)
        return _err("Internal server error", status=500)


@rulesets_bp.route("/rulesets/<slug>/versions", methods=["POST"])
@require_admin
def create_version(slug: str):
    try:
        supabase = get_supabase()
        ruleset = _find_ruleset_by_slug(supabase, slug)
        if not ruleset:
            return _err("RuleSet not found", status=404)

        body = request.get_json(silent=True) or {}
        version_label = (body.get("version_label") or "").strip()
        rules_json = body.get("rules_json")

        if not version_label:
            return _err("version_label is required")
        if not rules_json or not isinstance(rules_json, dict):
            return _err("rules_json must be a non-empty JSON object")

        rules_json, validation_error = _normalize_rules_json(rules_json)
        if validation_error:
            return _err(validation_error)
        assert rules_json is not None

        rules_hash = canonical_rules_hash(rules_json)

        res = (
            supabase.table("ruleset_versions")
            .insert({
                "ruleset_id": ruleset["id"],
                "version_label": version_label,
                "rules_hash": rules_hash,
                "rules_json": rules_json,
                "status": "draft",
            })
            .execute()
        )
        row = (res.data or [None])[0]
        if not row:
            return _err("Failed to create version", status=500)

        return _ok(row, status=201)
    except Exception:
        logger.exception("Error in POST /api/rulesets/%s/versions", slug)
        return _err("Internal server error", status=500)


@rulesets_bp.route("/rulesets/<slug>/versions/<version_id>/publish", methods=["POST"])
@require_admin
def publish_version(slug: str, version_id: str):
    try:
        supabase = get_supabase()
        ruleset = _find_ruleset_by_slug(supabase, slug)
        if not ruleset:
            return _err("RuleSet not found", status=404)

        # Find the target version
        res = (
            supabase.table("ruleset_versions")
            .select("id, ruleset_id, version_label, rules_hash, rules_json, status, published_at")
            .eq("id", version_id)
            .eq("ruleset_id", ruleset["id"])
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return _err("Version not found", status=404)

        version = rows[0]
        if version["status"] != "draft":
            return _err(f"Only draft versions can be published (current status: {version['status']})")

        # Retire any currently published version
        supabase.table("ruleset_versions") \
            .update({"status": "retired"}) \
            .eq("ruleset_id", ruleset["id"]) \
            .eq("status", "published") \
            .execute()

        # Publish the target version
        now = datetime.now(timezone.utc).isoformat()

        res = (
            supabase.table("ruleset_versions")
            .update({"status": "published", "published_at": now})
            .eq("id", version_id)
            .execute()
        )
        updated = (res.data or [None])[0]
        if not updated:
            return _err("Publish failed", status=500)

        return _ok(updated)
    except Exception:
        logger.exception("Error in POST /api/rulesets/%s/versions/%s/publish", slug, version_id)
        return _err("Internal server error", status=500)
