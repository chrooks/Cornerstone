"""scripts/dev_checks.py stays read-only (#119 plan, M1.28a).

The guarded client lets only table(...).select(...) through, and the script
refuses the production cloud project before it builds any client.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "dev_checks.py"


def _load_dev_checks():
    spec = importlib.util.spec_from_file_location("dev_checks", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeTable:
    def select(self, *columns, **kwargs):
        return "select-builder"

    def insert(self, *a, **k):
        raise AssertionError("insert reached the real client")

    upsert = update = delete = insert


class _FakeClient:
    def table(self, name):
        return _FakeTable()

    def rpc(self, *a, **k):
        raise AssertionError("rpc reached the real client")


def test_guarded_client_blocks_every_write():
    dc = _load_dev_checks()
    ro = dc.ReadOnlyClient(_FakeClient())

    assert ro.table("player_stats").select("id") == "select-builder"
    for verb in ("insert", "upsert", "update", "delete"):
        with pytest.raises(dc.ReadOnlyViolation):
            getattr(ro.table("player_stats"), verb)({"stats": {}})
    with pytest.raises(dc.ReadOnlyViolation):
        ro.rpc("commit_pipeline_run", {})


def test_refuses_the_production_cloud_url():
    env = {**os.environ, "SUPABASE_URL": "https://abcdefghij.supabase.co", "SUPABASE_SERVICE_KEY": "not-a-key"}
    result = subprocess.run([sys.executable, str(SCRIPT), "ev"], env=env, capture_output=True, text=True, timeout=60)

    assert result.returncode != 0
    assert "supabase.co" in result.stderr


def test_never_loads_players_service_or_notability():
    # Those modules fetch from NBA.com and insert career rows (the 2026-09-21 incident).
    code = (
        "import importlib.util, sys\n"
        f"spec = importlib.util.spec_from_file_location('dev_checks', {str(SCRIPT)!r})\n"
        "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
        "import services.snapshot_versions.repo, services.snapshot_versions.validator\n"
        "print(sorted(k for k in ('services.players_service', 'services.notability') if k in sys.modules))\n"
    )
    env = {**os.environ, "SUPABASE_URL": "", "SUPABASE_SERVICE_KEY": ""}
    result = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=60)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[]"


def test_read_only_client_also_guards_the_shared_singleton(monkeypatch):
    # Library code that calls get_supabase() directly must get the guarded
    # client too, and reset_client() must not rebuild an unguarded one.
    import services.supabase_client as sc

    dc = _load_dev_checks()
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:8092")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "not-a-key")
    monkeypatch.setattr(sc, "_client", _FakeClient())
    monkeypatch.setattr(sc, "create_client", sc.create_client)  # restored after the test

    dc.read_only_client()

    with pytest.raises(dc.ReadOnlyViolation):
        sc.get_supabase().table("player_stats").insert({"stats": {}})
    sc.reset_client()
    with pytest.raises(dc.ReadOnlyViolation):
        sc.get_supabase()


def test_sim_blocks_the_career_path_imported_by_name():
    # notability.py does `from services.players_service import get_or_fetch_career`,
    # so blocking players_service alone leaves notability's copy live.
    scripts = SCRIPT.parent
    code = (
        "import sys\n"
        f"sys.path.insert(0, {str(scripts)!r})\n"
        "import sim_threshold_candidate as sim\n"
        "sim.block_side_effect_paths()\n"
        "from services import notability\n"
        "try:\n"
        "    notability.get_or_fetch_career('p', None)\n"
        "    print('live')\n"
        "except sim.ReadOnlyViolation:\n"
        "    print('blocked')\n"
    )
    env = {**os.environ, "SUPABASE_URL": "", "SUPABASE_SERVICE_KEY": ""}
    result = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=60,
                            cwd=str(SCRIPT.parents[1]))

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip().splitlines()[-1] == "blocked"
