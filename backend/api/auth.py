"""
Authentication utilities for Flask API endpoints.

Provides the `require_admin` decorator, which:
1. Extracts the Bearer JWT from the Authorization header
2. Verifies its signature against the Supabase JWT secret
3. Queries user_roles to confirm the caller has admin access

Apply to any route that should be restricted to admins:
    @app.route("/api/some-write-endpoint", methods=["POST"])
    @require_admin
    def my_endpoint():
        ...
"""

import functools
import logging
import os
from typing import Callable, TypeVar

import jwt
from flask import jsonify, request

from services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable)


def require_admin(f: F) -> F:
    """
    Decorator that enforces Supabase-backed admin authentication on a Flask route.

    Flow:
      Authorization: Bearer <supabase-access-token>
        → verify JWT signature with SUPABASE_JWT_SECRET
        → extract user_id from sub claim
        → confirm user_id exists in user_roles table
        → call the wrapped route function

    HTTP errors returned:
      401 — missing/malformed/expired/invalid token
      403 — valid token but user has no admin role
      500 — SUPABASE_JWT_SECRET not configured, or role lookup failed
    """

    @functools.wraps(f)
    def decorated(*args, **kwargs):
        # Extract Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return (
                jsonify({"success": False, "error": "Missing or malformed Authorization header"}),
                401,
            )

        token = auth_header.split(" ", 1)[1]

        jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")
        if not jwt_secret:
            # Configuration error — log loudly so it's caught during setup
            logger.error(
                "SUPABASE_JWT_SECRET is not set — cannot verify admin JWT. "
                "Add it to backend/.env (Supabase Dashboard → Project Settings → API → JWT Secret)."
            )
            return jsonify({"success": False, "error": "Server auth not configured"}), 500

        try:
            # Verify signature, expiry, and audience in one call
            payload = jwt.decode(
                token,
                jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
            user_id: str = payload["sub"]
        except jwt.ExpiredSignatureError:
            return jsonify({"success": False, "error": "Token expired"}), 401
        except jwt.InvalidTokenError as exc:
            logger.debug("JWT validation failed: %s", exc)
            return jsonify({"success": False, "error": "Invalid token"}), 401

        # Confirm admin role — service-role client bypasses RLS so this always works
        try:
            res = (
                get_supabase()
                .table("user_roles")
                .select("role")
                .eq("user_id", user_id)
                .maybe_single()
                .execute()
            )
        except Exception as exc:
            logger.error("user_roles lookup failed for user %s: %s", user_id, exc)
            return jsonify({"success": False, "error": "Auth check failed"}), 500

        if not res.data:
            logger.debug("Access denied for user %s — no admin role", user_id)
            return jsonify({"success": False, "error": "Forbidden — admin role required"}), 403

        return f(*args, **kwargs)

    return decorated  # type: ignore[return-value]
