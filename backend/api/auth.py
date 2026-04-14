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
from flask import jsonify, request
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from services.supabase_client import get_supabase

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

        return f(*args, **kwargs)

    return decorated  # type: ignore[return-value]
