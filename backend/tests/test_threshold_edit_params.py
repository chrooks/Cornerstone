"""
test_threshold_edit_params.py — Unit tests for ThresholdEditParams dataclass.

Locks the Contract that ThresholdEditParams serializes to a specific JSONB shape
that the commit_pipeline_run RPC reads as params->>'skill_name' and params->'thresholds'.
"""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# Case 1: ThresholdEditParams exists in pipeline_runs repo
# ---------------------------------------------------------------------------


def test_threshold_edit_params_importable():
    """ThresholdEditParams must be importable from services.pipeline_runs.repo."""
    from services.pipeline_runs.repo import ThresholdEditParams  # noqa: F401


# ---------------------------------------------------------------------------
# Case 2: ThresholdEditParams serializes to expected JSONB shape
# ---------------------------------------------------------------------------


def test_threshold_edit_params_serializes_to_expected_jsonb_shape():
    """asdict(ThresholdEditParams(...)) produces {'skill_name': str, 'thresholds': dict}.

    This shape is what the RPC reads from params->>'skill_name' and
    params->'thresholds'. Any rename or extra field breaks the DB Contract.
    """
    from dataclasses import asdict
    from services.pipeline_runs.repo import ThresholdEditParams

    params = ThresholdEditParams(
        skill_name="post_scorer",
        thresholds={"tiers": {"Elite": {"logic": "AND", "conditions": []}}},
    )
    serialized = asdict(params)

    assert serialized == {
        "skill_name": "post_scorer",
        "thresholds": {"tiers": {"Elite": {"logic": "AND", "conditions": []}}},
    }, f"Unexpected serialization: {serialized}"

    # Field names must be exactly these two — no extras
    assert set(serialized.keys()) == {"skill_name", "thresholds"}, (
        f"ThresholdEditParams must have exactly skill_name and thresholds fields, got: {set(serialized.keys())}"
    )


# ---------------------------------------------------------------------------
# Case 3: ThresholdEditParams is frozen (immutable)
# ---------------------------------------------------------------------------


def test_threshold_edit_params_is_frozen():
    """ThresholdEditParams must be frozen — mutation must raise."""
    from services.pipeline_runs.repo import ThresholdEditParams

    params = ThresholdEditParams(skill_name="post_scorer", thresholds={})
    with pytest.raises((AttributeError, TypeError)):
        params.skill_name = "mutated"  # type: ignore


# ---------------------------------------------------------------------------
# Case 4: skill_name must be a str; thresholds must be a dict
# ---------------------------------------------------------------------------


def test_threshold_edit_params_type_annotations():
    """ThresholdEditParams fields must have the expected type annotations."""
    import inspect
    from services.pipeline_runs.repo import ThresholdEditParams

    hints = ThresholdEditParams.__dataclass_fields__
    assert "skill_name" in hints, "skill_name field missing"
    assert "thresholds" in hints, "thresholds field missing"


# ---------------------------------------------------------------------------
# Case 5: save_threshold_edit route uses ThresholdEditParams for start_run params
# ---------------------------------------------------------------------------


def test_save_threshold_edit_uses_threshold_edit_params(monkeypatch):
    """The calibration save route must pass asdict(ThresholdEditParams(...)) to start_run.

    This ensures the params JSONB stored in pipeline_runs always has the
    canonical shape — not an ad-hoc dict that could diverge from the dataclass.
    """
    from unittest.mock import MagicMock, patch, call
    from dataclasses import asdict
    from app import create_app
    import api.auth as auth_mod
    import api.calibration as cal_mod
    from services.snapshot_versions.repo import SnapshotRelease
    from services.pipeline_runs.repo import ThresholdEditParams

    _TEST_CAL_KEY = "test-cal-key"

    monkeypatch.setattr(auth_mod, "_verify_jwt", lambda _t: {"sub": "admin"})
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

    app = create_app()
    app.config["TESTING"] = True

    from services.skills import ALL_SKILLS
    test_skill = ALL_SKILLS[0]

    thresholds_body = {
        "tiers": {
            "Elite": {"logic": "AND", "conditions": []},
            "Proficient": {"logic": "AND", "conditions": []},
            "Capable": {"logic": "AND", "conditions": []},
        }
    }

    captured_params = []

    def mock_start_run(name, scope, snapshot_release_id, player_id=None, params=None, client=None):
        captured_params.append(params)
        return "run-uuid-test"

    with patch("services.pipeline_runs.repo.start_run", side_effect=mock_start_run):
        with patch("services.skill_engine.evaluation_only.evaluate_skills_for_run"):
            import threading
            monkeypatch.setattr(threading.Thread, "start", lambda self: None)
            with app.test_client() as client:
                resp = client.post(
                    f"/api/skills/thresholds/{test_skill}/save",
                    json=thresholds_body,
                    headers={
                        "Authorization": "Bearer fake-token",
                        "X-Calibration-Key": _TEST_CAL_KEY,
                    },
                )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_json()}"
    assert len(captured_params) == 1, "start_run must be called exactly once"

    params = captured_params[0]
    expected = asdict(ThresholdEditParams(skill_name=test_skill, thresholds=thresholds_body))
    assert params == expected, (
        f"start_run params did not match ThresholdEditParams shape.\n"
        f"Expected: {expected}\n"
        f"Got:      {params}"
    )
