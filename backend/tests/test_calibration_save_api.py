"""
test_calibration_save_api.py — Tests for POST /api/skills/thresholds/<skill_name>/save.

Currently covers Skill allowlist enforcement (the threshold_edit run must reject
unknown Skill names before any pipeline_runs row is created).
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from app import create_app


# ---------------------------------------------------------------------------
# Auth bypass mirroring test_pipeline_runs_commit_api.py
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin-user"})
    mock_role_result = MagicMock()
    mock_role_result.data = {"role": "admin"}
    mock_client = MagicMock()
    (
        mock_client
        .table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = mock_role_result
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: mock_client)


def _stub_open_draft(monkeypatch):
    """Ensure require_open_draft passes so the handler body runs."""
    from services.snapshot_versions.repo import SnapshotRelease
    import api.auth as auth_mod

    draft = SnapshotRelease(
        id="draft-uuid",
        label="draft-test",
        season="2025-26",
        status="draft",
        is_active=False,
        published_at=None,
        created_at="2026-01-01T00:00:00Z",
    )
    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", lambda client=None: draft)


_TEST_CAL_KEY = "test-calibration-key"


@pytest.fixture()
def admin_client(monkeypatch):
    # Configure a known calibration write key and force the module-level
    # constant to match so require_write_key accepts our header.
    monkeypatch.setenv("CALIBRATION_API_KEY", _TEST_CAL_KEY)
    import api.calibration as cal_mod
    monkeypatch.setattr(cal_mod, "_CALIBRATION_API_KEY", _TEST_CAL_KEY)

    _bypass_admin_auth(monkeypatch)
    _stub_open_draft(monkeypatch)

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


AUTH = {
    "Authorization": "Bearer fake-admin-token",
    "X-Calibration-Key": _TEST_CAL_KEY,
}


def test_save_threshold_edit_returns_400_for_unknown_skill(admin_client):
    """Unknown skill_name short-circuits before any pipeline_runs row is created.

    The Skill taxonomy is a closed 21-item set defined in services/skills.py.
    Any skill_name outside ALL_SKILLS must be rejected with 400 unknown_skill
    so threshold_edit runs cannot stage rows that will never land in
    draft_skill_thresholds on commit.
    """
    body = {
        "volume_gate": {"all": []},
        "tiers": {"Elite": {"all": []}, "Proficient": {"all": []}, "Capable": {"all": []}},
    }

    with patch("services.pipeline_runs.repo.start_run") as mock_start:
        resp = admin_client.post(
            "/api/skills/thresholds/not_a_real_skill/save",
            json=body,
            headers=AUTH,
        )

    assert resp.status_code == 400
    payload = resp.get_json()
    assert payload["success"] is False
    assert payload["error"] == "unknown_skill"
    # Critical: handler must short-circuit before calling start_run, so no
    # orphan pipeline_runs row is left behind.
    mock_start.assert_not_called()


# ---------------------------------------------------------------------------
# Concern 3: PUT /api/skills/thresholds/<skill>/force=true bypass — escape Seam
# ---------------------------------------------------------------------------


def test_put_thresholds_force_true_bypasses_draft_gate_with_explicit_intent(monkeypatch):
    """PUT thresholds?force=true writes directly even when no draft is open.

    This locks the intentional escape Seam into the test Contract so future
    refactors cannot accidentally close it. The route has NO @require_open_draft —
    ?force=true is the documented emergency direct-write path.
    """
    import api.auth as auth_mod
    import api.calibration as cal_mod

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin-user"})
    mock_role_result = MagicMock()
    mock_role_result.data = {"role": "admin"}
    mock_auth_client = MagicMock()
    (
        mock_auth_client
        .table.return_value
        .select.return_value
        .eq.return_value
        .maybe_single.return_value
        .execute.return_value
    ) = mock_role_result
    monkeypatch.setattr(auth_mod, "get_supabase", lambda: mock_auth_client)
    monkeypatch.setattr(cal_mod, "_CALIBRATION_API_KEY", _TEST_CAL_KEY)

    # Explicitly NO open draft — get_draft returns None
    monkeypatch.setattr(auth_mod.snap_repo, "get_draft", lambda client=None: None)

    app = create_app()
    app.config["TESTING"] = True

    valid_body = {
        "tiers": {
            "Elite": {"logic": "AND", "conditions": []},
            "Proficient": {"logic": "AND", "conditions": []},
            "Capable": {"logic": "AND", "conditions": []},
        }
    }

    # Mock the Supabase upsert so the handler does not hit the DB
    mock_sb = MagicMock()
    mock_sb.table.return_value.upsert.return_value.execute.return_value = MagicMock(data=[])
    with patch("api.calibration.get_supabase", return_value=mock_sb):
        with patch("api.calibration.get_thresholds", return_value={}):
            with app.test_client() as client:
                resp = client.put(
                    "/api/skills/thresholds/Scorer?force=true",
                    json=valid_body,
                    headers={
                        "Authorization": "Bearer fake-admin-token",
                        "X-Calibration-Key": _TEST_CAL_KEY,
                    },
                )

    # Must succeed — NOT 409 from require_open_draft (that decorator is absent)
    assert resp.status_code == 200, (
        f"Expected 200 with force=true and no draft, got {resp.status_code}: "
        f"{resp.get_json()}"
    )
    body = resp.get_json()
    assert body["success"] is True


def test_save_threshold_edit_accepts_known_skill(admin_client):
    """A skill_name inside ALL_SKILLS reaches start_run (smoke test)."""
    from services.skills import ALL_SKILLS

    body = {
        "volume_gate": {"all": []},
        "tiers": {"Elite": {"all": []}, "Proficient": {"all": []}, "Capable": {"all": []}},
    }
    known_skill = ALL_SKILLS[0]

    with patch("services.pipeline_runs.repo.start_run", return_value="run-uuid-1") as mock_start:
        # Patch the background worker so the test does not actually evaluate.
        with patch("services.skill_engine.evaluation_only.evaluate_skills_for_run"):
            resp = admin_client.post(
                f"/api/skills/thresholds/{known_skill}/save",
                json=body,
                headers=AUTH,
            )

    # The threshold rule validator may reject our minimal body — that's fine,
    # we only need to confirm we got past the allowlist check.
    assert resp.status_code != 400 or resp.get_json()["error"] != "unknown_skill"
    if resp.status_code == 200:
        mock_start.assert_called_once()
