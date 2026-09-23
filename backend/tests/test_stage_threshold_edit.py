"""scripts/stage_threshold_edit.py stays dev-only and stage-only (#119 plan, M5.2-M5.4).

No real network: the HTTP layer is a fake that records every call it is asked to make.
"""

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "stage_threshold_edit.py"

DEV_ENV = (
    "NEXT_PUBLIC_API_URL=https://cornerstone-dev.hestia.chrooks.com\n"
    "NEXT_PUBLIC_SUPABASE_URL=https://cornerstone-dev-db.hestia.chrooks.com\n"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=anon-not-a-real-key\n"
    "CALIBRATION_API_KEY=not-a-real-key\n"
)
BACKEND_ENV = "SUPABASE_URL=http://127.0.0.1:8092\n"
E2E_ENV = "E2E_ADMIN_EMAIL=dev-admin@example.test\nE2E_ADMIN_PASSWORD=not-a-real-password\n"
RULE = {"tiers": {"Elite": {"logic": "AND", "conditions": []}}}


def _load():
    spec = importlib.util.spec_from_file_location("stage_threshold_edit", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._payload


class _FakeRequests:
    """Records every request; answers the four endpoints this script speaks to."""

    def __init__(self, run_status="success"):
        self.calls = []
        self.run_status = run_status

    def request(self, method, url, **kwargs):
        self.calls.append((method, url))
        if "/auth/v1/token" in url:
            return _FakeResponse({"access_token": "fake-jwt"})
        if url.endswith("/save"):
            return _ok({"run_id": "run-1"})
        if url.endswith("/commit"):
            return _ok({"committed_at": "2026-09-23T00:00:00Z"})
        if url.endswith("/diff"):
            return _ok({
                "run_id": "run-1",
                "summary": {"per_skill": {"versatile_defender": {"promotions": 2, "demotions": 1, "new": 0, "unchanged": 3}}},
                "changes": [
                    {"player_id": "p1", "old_tier": "None", "new_tier": "Capable", "change_type": "promotion"},
                    {"player_id": "p2", "old_tier": "Elite", "new_tier": "Proficient", "change_type": "demotion"},
                    {"player_id": "p3", "old_tier": "Capable", "new_tier": "Capable", "change_type": "unchanged"},
                ],
            })
        if "/pipeline-runs/" in url:
            return _ok({"id": "run-1", "status": self.run_status, "rows_processed": 401, "error_tail": None})
        raise AssertionError(f"unexpected request: {method} {url}")


def _ok(data):
    return _FakeResponse({"success": True, "data": data, "error": None})


@pytest.fixture
def harness(tmp_path, monkeypatch):
    """The script with its env files, credentials, HTTP layer and flag read faked out."""
    mod = _load()
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text(BACKEND_ENV)
    (tmp_path / "dev.env").write_text(DEV_ENV)
    (tmp_path / ".env.e2e.local").write_text(E2E_ENV)
    (tmp_path / "rule.json").write_text(json.dumps(RULE))

    fake = _FakeRequests()
    monkeypatch.setattr(mod, "BACKEND_DIR", backend)
    monkeypatch.setattr(mod, "E2E_ENV_FILE", tmp_path / ".env.e2e.local")
    monkeypatch.setattr(mod, "requests", fake)
    monkeypatch.setattr(mod, "staged_flags_by_reason", lambda run_id: {("versatile_defender", "always_flag_for_review"): 219})
    monkeypatch.setattr(mod.time, "sleep", lambda _s: None)

    def run(*argv):
        return mod.main(["--env-file", str(tmp_path / "dev.env"), *argv])

    return mod, fake, run, tmp_path


def _rule_args(tmp_path, skill="versatile_defender"):
    return ["--skill", skill, "--rule", str(tmp_path / "rule.json")]


def test_refuses_a_production_supabase_target(harness, tmp_path):
    _, fake, run, _ = harness
    (tmp_path / "dev.env").write_text(DEV_ENV.replace(
        "https://cornerstone-dev-db.hestia.chrooks.com", "https://ojtncdjioiafhiiyzcyd.supabase.co"))

    with pytest.raises(SystemExit) as exc:
        run(*_rule_args(tmp_path))

    assert "supabase.co" in str(exc.value)
    assert fake.calls == [], "aborted before any request left the machine"


def test_refuses_an_api_base_that_is_not_the_dev_host(harness, tmp_path):
    _, fake, run, _ = harness
    (tmp_path / "dev.env").write_text(DEV_ENV.replace(
        "https://cornerstone-dev.hestia.chrooks.com", "https://cornerstone.chrooks.com"))

    with pytest.raises(SystemExit) as exc:
        run(*_rule_args(tmp_path))

    assert "expected the dev host" in str(exc.value)
    assert fake.calls == []


def test_rejects_a_skill_outside_the_server_allowlist(harness, tmp_path):
    _, fake, run, _ = harness

    with pytest.raises(SystemExit) as exc:
        run(*_rule_args(tmp_path, skill="versatile_defendor"))

    assert "unknown skill 'versatile_defendor'" in str(exc.value)
    assert fake.calls == [], "a typo never reaches the API"


def test_commit_is_off_by_default(harness, tmp_path, capsys):
    _, fake, run, _ = harness

    run(*_rule_args(tmp_path), "--wait")

    assert any(url.endswith("/save") for _m, url in fake.calls), "it staged the edit"
    assert not any(url.endswith("/commit") for _m, url in fake.calls), "stage-only unless --commit"

    out = capsys.readouterr().out
    assert "None -> Capable: 1" in out and "Elite -> Proficient: 1" in out, "tier moves are readable"
    assert "versatile_defender / always_flag_for_review: 219" in out
    assert "not committed (default)" in out


def test_flag_rows_count_by_skill_and_base_reason(harness):
    mod, _fake, _run, _ = harness

    counts = mod.count_flag_rows([
        {"skill_name": "versatile_defender", "flag_reason": "low_confidence:stat"},
        {"skill_name": "versatile_defender", "flag_reason": "low_confidence:claude"},
        {"skill_name": "off_ball_disruptor", "flag_reason": "data_missing"},
    ])

    assert counts == {("versatile_defender", "low_confidence"): 2, ("off_ball_disruptor", "data_missing"): 1}


def test_commit_flag_commits_the_staged_run(harness, tmp_path):
    _, fake, run, _ = harness

    run(*_rule_args(tmp_path), "--commit")

    assert ("POST", "https://cornerstone-dev.hestia.chrooks.com/api/pipeline-runs/run-1/commit") in fake.calls


def test_dry_run_authenticates_but_stages_nothing(harness, tmp_path):
    _, fake, run, _ = harness

    run(*_rule_args(tmp_path), "--dry-run")

    assert any("/auth/v1/token" in url for _m, url in fake.calls)
    assert not any(url.endswith("/save") for _m, url in fake.calls)
