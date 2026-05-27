"""Test import bootstrap for backend package and legacy service imports.

Also provides shared live-DB fixtures used by test_m1_schema_invariants.py
and any future test modules that require a Supabase service-role client.
"""

from pathlib import Path
import sys
import os
import uuid
from typing import Any

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

for path in (REPO_ROOT, BACKEND_DIR):
    path_string = str(path)
    if path_string not in sys.path:
        sys.path.insert(0, path_string)


# ---------------------------------------------------------------------------
# Live-DB detection
# ---------------------------------------------------------------------------


def _needs_live_db() -> bool:
    """Return True if environment has real Supabase credentials."""
    # Load .env first so env vars are present at module evaluation time
    from dotenv import load_dotenv
    env_file = BACKEND_DIR / ".env"
    if env_file.exists():
        load_dotenv(env_file)
    return bool(os.environ.get("SUPABASE_URL")) and bool(
        os.environ.get("SUPABASE_SERVICE_KEY")
    )


# ---------------------------------------------------------------------------
# Shared live-DB fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def sb():
    """Return a live Supabase service-role client for invariant assertions."""
    from services.supabase_client import get_supabase
    return get_supabase()


@pytest.fixture(scope="module")
def real_release_id(sb):
    """Return a real snapshot_release_id from the DB for FK-compliant tests.

    Uses the active release (is_active=true) so we don't need to create/delete
    snapshot_releases rows. All inserted pipeline_run test rows reference this
    existing release and are cleaned up by each test.
    """
    result = sb.table("snapshot_releases").select("id").eq("is_active", True).limit(1).execute()
    if not result.data:
        pytest.skip("No active snapshot_release found — cannot test partial unique index")
    return str(result.data[0]["id"])


# ---------------------------------------------------------------------------
# Live-DB helper functions (callable from test modules directly)
# ---------------------------------------------------------------------------


def _insert_run(
    sb,
    *,
    pipeline_name: str = "skill_evaluation",
    status: str = "running",
    snapshot_release_id: str | None = None,
) -> str:
    """Insert a pipeline_run row and return its id. Caller responsible for cleanup."""
    payload: dict[str, Any] = {
        "pipeline_name": pipeline_name,
        "scope": "bulk",
        "status": status,
    }
    if snapshot_release_id:
        payload["snapshot_release_id"] = snapshot_release_id

    result = sb.table("pipeline_runs").insert(payload).execute()
    return str(result.data[0]["id"])


def _delete_run(sb, run_id: str) -> None:
    """Delete a test pipeline_run row (and its staged rows via cascade)."""
    sb.table("pipeline_runs").delete().eq("id", run_id).execute()
