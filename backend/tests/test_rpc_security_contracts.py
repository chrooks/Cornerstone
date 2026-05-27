"""
test_rpc_security_contracts.py — Regression tests asserting the RPC security
Contract established by migrations 20260527000007 (commit_pipeline_run) and
20260527000010 (issue #57: lock down every SECURITY DEFINER RPC in public).

Each SECURITY DEFINER function in `public.*` must REVOKE `EXECUTE` from
`PUBLIC`, `anon`, and `authenticated`, and GRANT only `service_role`. An
anon-role Supabase client calling any of these RPCs must receive a
permission-denied error from Postgres — not a business-logic error and not
success.

These tests require a live Supabase connection with an anon key available.
The anon key is read from:
  1. SUPABASE_ANON_KEY env var
  2. frontend/.env.local (NEXT_PUBLIC_SUPABASE_ANON_KEY)

If neither is available the tests are skipped with a clear marker so the gap
is visible in CI rather than silently absent.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# Anon-key discovery
# ---------------------------------------------------------------------------


def _get_anon_key() -> str | None:
    """Return the Supabase anon key, or None if not configured."""
    # 1. Direct env var (preferred for CI)
    key = os.environ.get("SUPABASE_ANON_KEY")
    if key:
        return key

    # 2. Frontend .env.local (test is at backend/tests/, so parents[2] = repo root)
    env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("NEXT_PUBLIC_SUPABASE_ANON_KEY="):
                return line.split("=", 1)[1].strip()

    return None


def _get_supabase_url() -> str | None:
    """Return the Supabase project URL."""
    url = os.environ.get("SUPABASE_URL")
    if url:
        return url

    # Try backend .env
    from pathlib import Path
    from dotenv import load_dotenv
    env_file = Path(__file__).resolve().parents[1] / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    return os.environ.get("SUPABASE_URL")


_ANON_KEY = _get_anon_key()
_SUPABASE_URL = _get_supabase_url()
_HAS_LIVE_ANON = bool(_ANON_KEY) and bool(_SUPABASE_URL)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not _HAS_LIVE_ANON,
    reason="Requires SUPABASE_URL + SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local)",
)
def test_anon_key_cannot_call_commit_pipeline_run():
    """An anon-role Supabase client must NOT be able to call commit_pipeline_run.

    Migration 20260527000007 revokes EXECUTE on the function from PUBLIC and
    grants it only to service_role. This test asserts that invariant is
    enforced at the database level — not just by the Python Layer.

    If this test fails:
      - Check that migration 20260527000007 was applied (supabase db push).
      - Ensure REVOKE/GRANT statements executed correctly.
      - Review any subsequent migrations that may have re-granted PUBLIC access.
    """
    from supabase import create_client

    anon_client = create_client(_SUPABASE_URL, _ANON_KEY)

    fake_run_id = str(uuid.uuid4())

    try:
        result = anon_client.rpc(
            "commit_pipeline_run",
            {"p_run_id": fake_run_id},
        ).execute()

        # If we reach here without exception, the RPC executed — fail.
        pytest.fail(
            f"commit_pipeline_run did not raise for anon-role client. "
            "Migration 20260527000007 REVOKE may not be applied. "
            f"Response: {result}"
        )

    except Exception as exc:
        exc_str = str(exc).lower()

        # These signals mean the function EXECUTED but encountered a business-logic
        # error (e.g. run not found, already committed). The function running at
        # all means the REVOKE is NOT in effect — treat as test failure.
        function_executed_signals = [
            "run_not_found",
            "already_committed",
            "open_flags_not_acknowledged",
        ]
        if any(sig in exc_str for sig in function_executed_signals):
            pytest.fail(
                f"commit_pipeline_run EXECUTED for anon-role client (got business-logic error: {exc}). "
                "The REVOKE from PUBLIC in migration 20260527000007 is not active. "
                "Run: supabase db push && verify the REVOKE statement was applied."
            )

        # Expect a permission-denied error — these are acceptable
        permission_denied_signals = [
            "permission denied",
            "insufficient_privilege",
            "42501",
            "access denied",
            "not allowed",
            "unauthorized",
        ]
        if not any(sig in exc_str for sig in permission_denied_signals):
            # Unexpected error — re-raise so the real issue is visible
            raise

        # Permission denied — Contract is intact


# ---------------------------------------------------------------------------
# Issue #57: every SECURITY DEFINER RPC in public.* must reject anon callers
# ---------------------------------------------------------------------------

# (rpc_name, params) — args just need to type-check at the PostgREST layer;
# permission-denied fires before the function body runs, so the values don't
# need to resolve to real rows.
_LOCKED_DOWN_RPCS = [
    (
        "publish_evaluation_version",
        {
            "p_draft_id": str(uuid.uuid4()),
            "p_slug": "anon-probe",
            "p_changelog_note": "anon-probe",
        },
    ),
    (
        "reactivate_evaluation_version",
        {"p_version_id": str(uuid.uuid4())},
    ),
    (
        "publish_snapshot_draft",
        {
            "p_draft_id": str(uuid.uuid4()),
            "p_label": "anon-probe",
            "p_allow_missing_composite": False,
            "p_allow_open_flags": False,
        },
    ),
    (
        "reactivate_snapshot_release",
        {"p_release_id": str(uuid.uuid4())},
    ),
    (
        "reset_working_state_from_active",
        {},
    ),
]


# Business-logic exception fragments that mean the function body executed —
# i.e. the REVOKE is NOT in effect. Union of fragments raised by every RPC
# under test; we don't need per-RPC granularity because *any* of them means
# the anon caller reached the body.
_FUNCTION_EXECUTED_SIGNALS = (
    "not_published",
    "draft_in_flight",
    "missing_composite",
    "open_flags_not_acknowledged",
    "version_not_found",
    "draft_not_found",
    "release_not_found",
    "no_active_release",
    "already_published",
    "already_active",
)

_PERMISSION_DENIED_SIGNALS = (
    "permission denied",
    "insufficient_privilege",
    "42501",
    "access denied",
    "not allowed",
    "unauthorized",
)


@pytest.mark.skipif(
    not _HAS_LIVE_ANON,
    reason="Requires SUPABASE_URL + SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY in frontend/.env.local)",
)
@pytest.mark.parametrize(("rpc_name", "params"), _LOCKED_DOWN_RPCS)
def test_anon_key_cannot_call_locked_down_rpc(rpc_name: str, params: dict) -> None:
    """Anon-role calls to every issue-#57-hardened RPC must be rejected by Postgres.

    If this test fails:
      - Confirm migration 20260527000010_secdef_rpc_lockdown was applied.
      - Re-run the discovery query from issue #57 and check the ACL of the
        failing function — it must contain only `service_role=X/postgres`.
      - Check whether a later migration redefined the function (Postgres
        `CREATE OR REPLACE` preserves grants, but a new overload with
        different arg types creates a fresh function with default grants).
    """
    from supabase import create_client

    anon_client = create_client(_SUPABASE_URL, _ANON_KEY)

    try:
        result = anon_client.rpc(rpc_name, params).execute()
    except Exception as exc:
        exc_str = str(exc).lower()

        if any(sig in exc_str for sig in _FUNCTION_EXECUTED_SIGNALS):
            pytest.fail(
                f"{rpc_name} EXECUTED for anon-role client (business-logic error: {exc}). "
                "Lockdown from migration 20260527000010 is not active for this RPC."
            )

        if not any(sig in exc_str for sig in _PERMISSION_DENIED_SIGNALS):
            raise

        return  # Permission denied — Contract intact

    pytest.fail(
        f"{rpc_name} did not raise for anon-role client. "
        "Migration 20260527000010 REVOKE may not be applied. "
        f"Response: {result}"
    )
