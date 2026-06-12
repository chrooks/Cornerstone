"""
test_commit_run_diff_persist.py — commit_run persists the staged diff at commit time.

Why this exists:
  The diff endpoint recomputes the staged-vs-current diff live. The commit RPC
  deletes staged rows, so after a commit the live recomputation is always empty
  ("No tier changes in this run"), which misleads admins into thinking their
  edit did nothing. commit_run must snapshot the diff BEFORE the RPC runs and
  persist it to pipeline_runs.committed_diff so committed runs can still show
  what they changed.

All Supabase access is mocked — no live DB.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import services.pipeline_run_results.commit as commit_mod


_SAMPLE_DIFF = {
    "run_id": "run-1",
    "summary": {
        "per_skill": {"rebounder": {"promotions": 1, "demotions": 0, "new": 0, "unchanged": 0}},
        "total_changed": 1,
    },
    "changes": [
        {
            "player_id": "p1",
            "player_name": "Mitchell Robinson",
            "season": "2023-24",
            "source": "stats",
            "skill_name": "rebounder",
            "old_tier": "Proficient",
            "new_tier": "Elite",
            "change_type": "promotion",
        }
    ],
}


def _rpc_ok(committed_at: str = "2026-06-12T16:23:53Z"):
    """A client whose .rpc(...).execute() returns a canonical committed_at."""
    client = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock(data=committed_at)
    return client


def test_commit_run_persists_diff_before_rpc():
    """commit_run computes the live diff and saves it to pipeline_runs.committed_diff."""
    client = _rpc_ok()

    with patch.object(commit_mod, "_get_client", return_value=client), \
         patch.object(commit_mod.prr_repo, "get_diff", return_value=_SAMPLE_DIFF) as mock_diff, \
         patch.object(commit_mod.runs_repo, "save_committed_diff") as mock_save, \
         patch.object(commit_mod.runs_repo, "get_run", return_value={"pipeline_name": "threshold_edit"}):
        committed_at = commit_mod.commit_run("run-1")

    assert committed_at == "2026-06-12T16:23:53Z"
    mock_diff.assert_called_once_with("run-1")
    mock_save.assert_called_once()
    # Saved diff is the computed snapshot, keyed to the run.
    args, kwargs = mock_save.call_args
    saved_run_id = args[0] if args else kwargs.get("run_id")
    saved_diff = args[1] if len(args) > 1 else kwargs.get("diff")
    assert saved_run_id == "run-1"
    assert saved_diff == _SAMPLE_DIFF


def test_commit_run_snapshots_diff_before_staged_rows_deleted():
    """The diff must be computed BEFORE the commit RPC (which deletes staged rows).

    Enforced by call ordering: get_diff must be invoked before client.rpc.
    """
    client = _rpc_ok()
    order: list[str] = []

    def _record_diff(_run_id):
        order.append("get_diff")
        return _SAMPLE_DIFF

    def _record_save(*_a, **_k):
        order.append("save_committed_diff")

    client.rpc.side_effect = lambda *a, **k: (order.append("rpc"), MagicMock(
        execute=MagicMock(return_value=MagicMock(data="2026-06-12T16:23:53Z"))
    ))[1]

    with patch.object(commit_mod, "_get_client", return_value=client), \
         patch.object(commit_mod.prr_repo, "get_diff", side_effect=_record_diff), \
         patch.object(commit_mod.runs_repo, "save_committed_diff", side_effect=_record_save), \
         patch.object(commit_mod.runs_repo, "get_run", return_value={"pipeline_name": "skill_evaluation"}):
        commit_mod.commit_run("run-1")

    assert order.index("get_diff") < order.index("rpc"), (
        f"diff must be snapshotted before the RPC deletes staged rows; got order={order}"
    )
    assert order.index("save_committed_diff") < order.index("rpc"), (
        f"persisted diff must be written before the RPC runs; got order={order}"
    )


def test_commit_run_still_commits_when_diff_persist_fails():
    """A failure to persist the diff must not block the commit itself.

    The diff snapshot is a UX convenience; the commit is the load-bearing
    operation. If save_committed_diff raises, commit_run still calls the RPC
    and returns the canonical committed_at.
    """
    client = _rpc_ok()

    with patch.object(commit_mod, "_get_client", return_value=client), \
         patch.object(commit_mod.prr_repo, "get_diff", return_value=_SAMPLE_DIFF), \
         patch.object(commit_mod.runs_repo, "save_committed_diff", side_effect=RuntimeError("write failed")), \
         patch.object(commit_mod.runs_repo, "get_run", return_value={"pipeline_name": "threshold_edit"}):
        committed_at = commit_mod.commit_run("run-1")

    assert committed_at == "2026-06-12T16:23:53Z"
    client.rpc.assert_called_once()
