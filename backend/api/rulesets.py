"""
api/rulesets.py — RuleSet read endpoints for Lab entry points.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from flask import Blueprint, jsonify

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
