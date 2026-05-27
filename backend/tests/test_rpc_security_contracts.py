"""
test_rpc_security_contracts.py — Regression tests asserting the RPC security
Contract established by migration 20260527000007 (REVOKE commit_pipeline_run
from PUBLIC + GRANT to service_role only).

These tests require a live Supabase connection with an anon key available.
The anon key is read from:
  1. SUPABASE_ANON_KEY env var
  2. frontend/.env.local (NEXT_PUBLIC_SUPABASE_ANON_KEY)

If neither is available the tests are skipped with a clear marker so the gap
is visible in CI rather than silently absent.

Contract being locked:
  - An anon-role client calling rpc('commit_pipeline_run', ...) must receive
    a permission-denied error (not succeed).
  - This prevents a class of privilege-escalation bugs where a frontend caller
    without service-role credentials could directly commit a pipeline run.
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
