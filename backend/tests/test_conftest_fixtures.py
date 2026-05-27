"""
test_conftest_fixtures.py — Smoke test verifying conftest live-DB helper signatures.

Imports helpers from conftest via importlib (conftest is not a normal Python package
module — pytest loads it specially). Asserts signatures are intact after the
refactor from test_m1_schema_invariants.py.

No live DB required — the tests are unit-level signature checks only.
"""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path


def _load_conftest():
    """Load the tests/conftest.py module by file path (pytest doesn't put it on sys.path)."""
    conftest_path = Path(__file__).parent / "conftest.py"
    spec = importlib.util.spec_from_file_location("_conftest", conftest_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# Helper-signature smoke tests (no live DB needed)
# ---------------------------------------------------------------------------


def test_insert_run_has_expected_signature():
    """_insert_run must accept (sb, *, pipeline_name, status, snapshot_release_id)."""
    mod = _load_conftest()
    assert hasattr(mod, "_insert_run"), "_insert_run missing from conftest"

    sig = inspect.signature(mod._insert_run)
    params = sig.parameters
    assert "sb" in params, "_insert_run must accept 'sb' as first positional param"
    assert "pipeline_name" in params, "_insert_run must accept 'pipeline_name' kwarg"
    assert "status" in params, "_insert_run must accept 'status' kwarg"
    assert "snapshot_release_id" in params, "_insert_run must accept 'snapshot_release_id' kwarg"


def test_delete_run_has_expected_signature():
    """_delete_run must accept (sb, run_id)."""
    mod = _load_conftest()
    assert hasattr(mod, "_delete_run"), "_delete_run missing from conftest"

    sig = inspect.signature(mod._delete_run)
    params = sig.parameters
    assert "sb" in params, "_delete_run must accept 'sb' param"
    assert "run_id" in params, "_delete_run must accept 'run_id' param"


def test_needs_live_db_is_callable():
    """_needs_live_db must exist in conftest and be callable."""
    mod = _load_conftest()
    assert hasattr(mod, "_needs_live_db"), "_needs_live_db missing from conftest"
    assert callable(mod._needs_live_db), "_needs_live_db must be callable"
    # Return type must be bool
    result = mod._needs_live_db()
    assert isinstance(result, bool), "_needs_live_db must return bool"
