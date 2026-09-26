"""Admin gate on read routes (#182, #167).

Five GET routes answered without a login: the review queue, a player's
flags, a player's skill breakdown, the pipeline status, and league
averages (whose refresh= and empty-season fallback both write). Each
must now return 401 with no token, 403 with a non-admin token, and let
an admin through.

Tokens are real HS256 JWTs signed with a test secret so _verify_jwt
runs; only the user_roles lookup is faked.
ponytail: admin case asserts "past the gate", not a literal 200 — a 200
needs a fake Supabase per handler body.
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock

import jwt
import pytest

from app import create_app
import api.auth as auth_mod

_SECRET = "test-jwt-secret"
_PID = "ddc0c97b-782a-4878-8a88-baaf9945baa8"

_GATED_READS = [
    "/api/review/queue",
    f"/api/review/{_PID}/flags",
    f"/api/review/{_PID}/skill-breakdown?skill_name=scorer",
    "/api/pipeline/status",
    "/api/league-averages?refresh=true",
]


def _token(sub: str) -> str:
    return jwt.encode(
        {"sub": sub, "aud": "authenticated", "exp": int(time.time()) + 60},
        _SECRET,
        algorithm="HS256",
    )


def _role_client(role_row):
    client = MagicMock()
    result = MagicMock()
    result.data = role_row
    (
        client.table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = result
    return client


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("SUPABASE_JWT_SECRET", _SECRET)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.mark.parametrize("path", _GATED_READS)
def test_anonymous_gets_401(client, path):
    resp = client.get(path)
    assert resp.status_code == 401, f"{path} -> {resp.status_code}"
    assert resp.get_json()["success"] is False


@pytest.mark.parametrize("path", _GATED_READS)
def test_non_admin_gets_403(client, monkeypatch, path):
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: _role_client(None))
    resp = client.get(path, headers={"Authorization": f"Bearer {_token('plain-user')}"})
    assert resp.status_code == 403, f"{path} -> {resp.status_code}"


@pytest.mark.parametrize("path", _GATED_READS)
def test_admin_passes_the_gate(client, monkeypatch, path):
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: _role_client({"role": "admin"}))
    resp = client.get(path, headers={"Authorization": f"Bearer {_token('admin-user')}"})
    assert resp.status_code not in (401, 403), f"{path} -> {resp.status_code}"


@pytest.mark.parametrize("path", _GATED_READS)
def test_bad_signature_gets_401(client, path):
    forged = jwt.encode(
        {"sub": "x", "aud": "authenticated", "exp": int(time.time()) + 60},
        "wrong-secret",
        algorithm="HS256",
    )
    resp = client.get(path, headers={"Authorization": f"Bearer {forged}"})
    assert resp.status_code == 401, f"{path} -> {resp.status_code}"
