"""
Authentication utilities for Flask API endpoints.

Provides the `require_admin` decorator, which:
1. Extracts the Bearer JWT from the Authorization header
2. Verifies its signature — HS256 via SUPABASE_JWT_SECRET, or RS256 via the
   Supabase JWKS endpoint (newer projects use RS256 asymmetric signing)
3. Queries user_roles to confirm the caller has admin access

Apply to any route that should be restricted to admins:
    @app.route("/api/some-write-endpoint", methods=["POST"])
    @require_admin
    def my_endpoint():
        ...
"""

import functools
import json
import logging
import os
from typing import Callable, TypeVar

import jwt
import requests as http_requests
from flask import g, jsonify, request
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from services.supabase_client import get_supabase
from services.snapshot_versions import repo as snap_repo

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable)

# Module-level cache for the asymmetric public key — fetched once on first use.
# Avoids a JWKS round-trip on every request while keeping startup fast.
_cached_public_key = None
_cached_public_key_alg: str | None = None


def _load_public_key(alg: str):
    """
    Fetch the public key for the given algorithm from Supabase's JWKS endpoint
    and cache it. Supports RS256 (RSA) and ES256 (ECDSA P-256).

    Supabase JWKS URL: https://<project>.supabase.co/auth/v1/.well-known/jwks.json
    """
    global _cached_public_key, _cached_public_key_alg
    if _cached_public_key is not None and _cached_public_key_alg == alg:
        return _cached_public_key

    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        raise RuntimeError("SUPABASE_URL is not set — cannot fetch JWKS for asymmetric JWT verification")

    jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
    response = http_requests.get(jwks_url, timeout=10)
    response.raise_for_status()
    jwks = response.json()

    if not jwks.get("keys"):
        raise RuntimeError(f"No keys found in JWKS response from {jwks_url}")

    # Use the first signing key in the set
    key_data = json.dumps(jwks["keys"][0])
    if alg == "RS256":
        _cached_public_key = RSAAlgorithm.from_jwk(key_data)
    elif alg == "ES256":
        _cached_public_key = ECAlgorithm.from_jwk(key_data)
    else:
        raise RuntimeError(f"No JWKS loader for algorithm: {alg}")

    _cached_public_key_alg = alg
    logger.info("Loaded %s public key from %s", alg, jwks_url)
    return _cached_public_key


def _verify_jwt(token: str) -> dict:
    """
    Verify a Supabase JWT and return its payload.

    Supports both HS256 (older projects, uses SUPABASE_JWT_SECRET) and RS256
    (newer projects, uses the public key fetched from the JWKS endpoint).
    The algorithm is detected from the token header so no config change is needed
    when a project uses one vs the other.

    Raises jwt.InvalidTokenError (or a subclass) on any verification failure.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "HS256")

    if alg == "HS256":
        jwt_secret = os.environ.get("SUPABASE_JWT_SECRET")
        if not jwt_secret:
            logger.error(
                "SUPABASE_JWT_SECRET is not set — required for HS256 JWT verification. "
                "Add it to backend/.env (Supabase Dashboard → Project Settings → API → JWT Secret)."
            )
            raise RuntimeError("SUPABASE_JWT_SECRET not configured")
        return jwt.decode(token, jwt_secret, algorithms=["HS256"], audience="authenticated")

    if alg in ("RS256", "ES256"):
        public_key = _load_public_key(alg)
        return jwt.decode(token, public_key, algorithms=[alg], audience="authenticated")

    raise jwt.InvalidAlgorithmError(f"Unsupported JWT algorithm: {alg}")


def require_admin(f: F) -> F:
    """
    Decorator that enforces Supabase-backed admin authentication on a Flask route.

    Flow:
      Authorization: Bearer <supabase-access-token>
        → detect JWT algorithm from token header (HS256 or RS256)
        → verify signature and expiry
        → extract user_id from sub claim
        → confirm user_id exists in user_roles table
        → call the wrapped route function

    HTTP errors returned:
      401 — missing/malformed/expired/invalid token
      403 — valid token but user has no admin role
      500 — auth config missing, JWKS fetch failed, or role lookup failed
    """

    @functools.wraps(f)
    def decorated(*args, **kwargs):
        # Extract Bearer token
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            logger.warning(
                "require_admin: missing/malformed Authorization header (got %r)",
                auth_header[:40] if auth_header else "<empty>",
            )
            return (
                jsonify({"success": False, "error": "Missing or malformed Authorization header"}),
                401,
            )

        token = auth_header.split(" ", 1)[1]

        try:
            payload = _verify_jwt(token)
            user_id: str = payload["sub"]
        except jwt.ExpiredSignatureError:
            logger.warning("require_admin: token expired for request to %s", request.path)
            return jsonify({"success": False, "error": "Token expired"}), 401
        except jwt.InvalidTokenError as exc:
            logger.warning("require_admin: invalid token — %s (path: %s)", exc, request.path)
            return jsonify({"success": False, "error": "Invalid token"}), 401
        except RuntimeError as exc:
            # Config errors (missing secret, JWKS fetch failure)
            logger.error("require_admin: auth config error — %s", exc)
            return jsonify({"success": False, "error": "Server auth not configured"}), 500

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

        # Expose the verified admin's id for routes that need to attribute
        # privileged actions (e.g. audit logging an open-flags publish override).
        g.user_id = user_id

        return f(*args, **kwargs)

    return decorated  # type: ignore[return-value]


def is_admin_request() -> bool:
    """
    Non-raising admin check for endpoints that conditionally enrich responses.

    Returns True only when the request carries a Bearer token that verifies
    against the configured JWT algorithm AND the resolved user_id has an admin
    role in the user_roles table. Returns False on any failure (missing header,
    invalid token, missing role, role-lookup error) so callers can degrade
    gracefully to a public projection without leaking 401/403 to clients that
    legitimately should receive the stripped public response.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return False

    token = auth_header.split(" ", 1)[1]

    try:
        payload = _verify_jwt(token)
        user_id: str = payload["sub"]
    except (jwt.InvalidTokenError, RuntimeError, KeyError):
        return False

    try:
        res = (
            get_supabase()
            .table("user_roles")
            .select("role")
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except Exception:
        return False

    return bool(res.data)


def require_open_draft(f: F) -> F:
    """
    Decorator that enforces an open Snapshot Release draft exists.

    Flow:
      - Call snap_repo.get_draft() to find a row with status IN ('draft','review').
      - If none found: return HTTP 409 {"success": false, "data": null, "error": "no_open_draft"}.
      - If found: set g.draft_id = draft.id and call the wrapped route.
      - If snap_repo.get_draft() raises: return HTTP 500.

    Stack this inside @require_admin so admin auth runs first:
        @require_admin
        @require_open_draft
        def my_write_endpoint(): ...
    """

    @functools.wraps(f)
    def decorated(*args, **kwargs):
        try:
            draft = snap_repo.get_draft()
        except Exception:
            logger.exception("require_open_draft: failed to query draft status")
            return jsonify({"success": False, "data": None, "error": "Failed to check draft status"}), 500

        if draft is None:
            return jsonify({"success": False, "data": None, "error": "no_open_draft"}), 409

        g.draft_id = draft.id
        return f(*args, **kwargs)

    return decorated  # type: ignore[return-value]


def require_user(f: F) -> F:
    """
    Decorator that enforces ordinary Supabase user authentication.

    This verifies the same JWTs as require_admin, but it does not check
    user_roles. Use it for endpoints where any logged-in user may act on
    their own data. The authenticated user's id is exposed as g.user_id.
    """

    @functools.wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return (
                jsonify({
                    "success": False,
                    "data": None,
                    "error": "Missing or malformed Authorization header",
                }),
                401,
            )

        token = auth_header.split(" ", 1)[1]

        try:
            payload = _verify_jwt(token)
            g.user_id = payload["sub"]
        except jwt.ExpiredSignatureError:
            return jsonify({"success": False, "data": None, "error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"success": False, "data": None, "error": "Invalid token"}), 401
        except RuntimeError:
            return jsonify({"success": False, "data": None, "error": "Server auth not configured"}), 500
        except KeyError:
            return jsonify({"success": False, "data": None, "error": "Invalid token"}), 401

        return f(*args, **kwargs)

    return decorated  # type: ignore[return-value]
