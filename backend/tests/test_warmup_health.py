"""
Tests for cohesion warmup health surfacing.

Covers two layers:
  1. services.warmup_state — the module-level process state that records the
     outcome of cohesion distribution warmup at boot.
  2. GET /api/health — the externally-visible Surface that reports
     {status, reasons} so synthetic monitoring can page on a degraded boot.

No live DB is required: the warmup dependencies are lazily imported inside
_warm_cohesion_distributions, so they are monkeypatched per test.
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Layer 1 — services.warmup_state process state
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_warmup_state():
    """Each test starts from a clean warmup-state slate."""
    from services import warmup_state

    warmup_state.reset()
    yield
    warmup_state.reset()


def test_default_state_is_unknown_until_warmup_records():
    """Before any warmup runs the health is degraded with a pending reason."""
    from services import warmup_state

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert "cohesion_warmup_pending" in health["reasons"]


def test_record_ok_yields_ok_status_with_no_reasons():
    from services import warmup_state

    warmup_state.record_warmup_ok()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "ok"
    assert health["reasons"] == []


def test_record_degraded_yields_degraded_status_with_reason():
    from services import warmup_state

    warmup_state.record_warmup_degraded("cohesion_warmup_no_active_release")

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert health["reasons"] == ["cohesion_warmup_no_active_release"]


def test_reset_returns_to_pending():
    from services import warmup_state

    warmup_state.record_warmup_ok()
    warmup_state.reset()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert "cohesion_warmup_pending" in health["reasons"]


# ---------------------------------------------------------------------------
# Layer 2 — _warm_cohesion_distributions records the right outcome
# ---------------------------------------------------------------------------


class _FakeVersion:
    values = {"some": "values"}


def test_warmup_records_ok_when_distributions_load(monkeypatch):
    """Active release present and distributions ready -> ok."""
    import app as app_module
    from services import warmup_state
    from services.evaluation_versions import repo as ev_repo
    from services.snapshot_versions import distribution_cache
    from services.snapshot_versions import active as active_module

    monkeypatch.setattr(ev_repo, "get_active", lambda: _FakeVersion())
    monkeypatch.setattr(
        active_module, "get_active_release_id", lambda client=None: "release-123"
    )
    monkeypatch.setattr(
        distribution_cache, "ensure_distributions", lambda *a, **k: True
    )

    app_module._warm_cohesion_distributions()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "ok"
    assert health["reasons"] == []


def test_warmup_records_no_active_release(monkeypatch):
    """No active Snapshot Release -> degraded with the documented reason."""
    import app as app_module
    from services import warmup_state
    from services.evaluation_versions import repo as ev_repo
    from services.snapshot_versions import active as active_module

    def _raise_missing(client=None):
        raise active_module.ActiveReleaseMissingError("no active release")

    monkeypatch.setattr(ev_repo, "get_active", lambda: _FakeVersion())
    monkeypatch.setattr(active_module, "get_active_release_id", _raise_missing)

    app_module._warm_cohesion_distributions()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert "cohesion_warmup_no_active_release" in health["reasons"]


def test_warmup_records_distributions_unavailable(monkeypatch):
    """Active release present but distributions could not build -> degraded."""
    import app as app_module
    from services import warmup_state
    from services.evaluation_versions import repo as ev_repo
    from services.snapshot_versions import distribution_cache
    from services.snapshot_versions import active as active_module

    monkeypatch.setattr(ev_repo, "get_active", lambda: _FakeVersion())
    monkeypatch.setattr(
        active_module, "get_active_release_id", lambda client=None: "release-123"
    )
    monkeypatch.setattr(
        distribution_cache, "ensure_distributions", lambda *a, **k: False
    )

    app_module._warm_cohesion_distributions()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert "cohesion_warmup_distributions_unavailable" in health["reasons"]


def test_warmup_records_error_on_unexpected_exception(monkeypatch):
    """Any unexpected failure -> degraded, never a raised exception at boot."""
    import app as app_module
    from services import warmup_state
    from services.evaluation_versions import repo as ev_repo

    def _boom():
        raise RuntimeError("supabase down")

    monkeypatch.setattr(ev_repo, "get_active", _boom)

    # Must not raise — boot continues even when warmup fails.
    app_module._warm_cohesion_distributions()

    health = warmup_state.get_warmup_health()
    assert health["status"] == "degraded"
    assert "cohesion_warmup_error" in health["reasons"]


# ---------------------------------------------------------------------------
# Layer 3 — GET /api/health reflects warmup state
# ---------------------------------------------------------------------------


def _client():
    from app import create_app

    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


def test_health_reports_ok_when_warmup_ok(monkeypatch):
    """With a release, /health returns status:ok."""
    import app as app_module
    from services import warmup_state

    # Neutralize the boot-time warmup so create_app() doesn't hit the live DB,
    # then assert the endpoint reflects whatever warmup recorded.
    monkeypatch.setattr(app_module, "_warm_cohesion_distributions", lambda: None)

    client = _client()
    warmup_state.reset()
    warmup_state.record_warmup_ok()

    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "ok"
    assert body["reasons"] == []


def test_health_reports_degraded_when_no_active_release(monkeypatch):
    """With no active release, /health returns status:degraded with the reason."""
    import app as app_module
    from services import warmup_state

    monkeypatch.setattr(app_module, "_warm_cohesion_distributions", lambda: None)

    client = _client()
    warmup_state.reset()
    warmup_state.record_warmup_degraded("cohesion_warmup_no_active_release")

    resp = client.get("/api/health")
    # Degraded is still a reachable backend — 200 keeps liveness green while
    # the body carries the readiness signal for dashboards.
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] == "degraded"
    assert "cohesion_warmup_no_active_release" in body["reasons"]
