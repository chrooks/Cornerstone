"""
api/profile.py — minimal User Profile endpoints.
"""

from __future__ import annotations

import logging
from typing import Any

from flask import Blueprint, g, jsonify, request

from api.auth import require_user
from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

profile_bp = Blueprint("profile", __name__, url_prefix="/api")


def _ok(data: Any, status: int = 200) -> tuple:
    return jsonify({"success": True, "data": data, "error": None}), status


def _err(msg: str, status: int = 400) -> tuple:
    return jsonify({"success": False, "data": None, "error": msg}), status


def _profile_for_user(supabase, user_id: str) -> dict[str, Any] | None:
    res = (
        supabase.table("user_profiles")
        .select("id, user_id, display_name, favorite_player_name, created_at, updated_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _serialize_profile(row: dict[str, Any] | None, user_id: str) -> dict[str, Any]:
    if row is None:
        return {
            "id": None,
            "user_id": user_id,
            "display_name": None,
            "favorite_player_name": None,
            "created_at": None,
            "updated_at": None,
        }
    return {
        "id": row.get("id"),
        "user_id": row["user_id"],
        "display_name": row.get("display_name"),
        "favorite_player_name": row.get("favorite_player_name"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _clean_optional_text(value: Any, field: str) -> tuple[str | None, str | None]:
    if value is None:
        return None, None
    if not isinstance(value, str):
        return None, f"{field} must be a string"
    cleaned = value.strip()
    return cleaned or None, None


@profile_bp.route("/me/profile", methods=["GET"])
@require_user
def get_profile():
    try:
        supabase = get_supabase()
        return _ok(_serialize_profile(_profile_for_user(supabase, g.user_id), g.user_id))
    except Exception:
        logger.exception("Error in GET /api/me/profile")
        return _err("Internal server error", status=500)


@profile_bp.route("/me/profile", methods=["PATCH"])
@require_user
def update_profile():
    body = request.get_json(silent=True) or {}
    allowed_fields = {"display_name", "favorite_player_name"}
    unexpected_fields = sorted(set(body) - allowed_fields)
    if unexpected_fields:
        return _err(f"Unsupported User Profile fields: {', '.join(unexpected_fields)}")

    updates: dict[str, str | None] = {}
    for field in allowed_fields:
        if field in body:
            cleaned, error = _clean_optional_text(body[field], field)
            if error:
                return _err(error)
            updates[field] = cleaned

    if not updates:
        return _err("At least one User Profile field is required")

    try:
        supabase = get_supabase()
        existing = _profile_for_user(supabase, g.user_id)
        if existing:
            res = (
                supabase.table("user_profiles")
                .update(updates)
                .eq("user_id", g.user_id)
                .execute()
            )
            row = (res.data or [None])[0]
        else:
            payload = {"user_id": g.user_id, **updates}
            res = supabase.table("user_profiles").insert(payload).execute()
            row = (res.data or [None])[0]
        return _ok(_serialize_profile(row, g.user_id))
    except Exception:
        logger.exception("Error in PATCH /api/me/profile")
        return _err("Internal server error", status=500)
