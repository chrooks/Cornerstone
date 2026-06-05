"""
Unit tests for backend/services/legend_canonical.py

Mock-based — patches the Supabase client so nothing touches the live DB.
Covers the issue #75 Contract:
  (a) saving a Legend with a non-null nba_api_id triggers the canonical upsert,
  (b) a null nba_api_id is a no-op,
  (c) the helper is idempotent — the conflict path does not raise.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from services.legend_canonical import ensure_canonical_player


def _make_client():
    """Mock Supabase client whose .table().upsert().execute() chain is recorded."""
    client = MagicMock()
    upsert_builder = MagicMock()
    client.table.return_value.upsert.return_value = upsert_builder
    upsert_builder.execute.return_value = MagicMock(data=[])
    return client, upsert_builder


def test_non_null_nba_api_id_triggers_canonical_upsert():
    # Arrange
    client, upsert_builder = _make_client()

    # Act
    result = ensure_canonical_player(977, "Kobe Bryant", client=client)

    # Assert — returned True and issued an upsert against canonical_players
    assert result is True
    client.table.assert_called_once_with("canonical_players")
    client.table.return_value.upsert.assert_called_once()
    args, kwargs = client.table.return_value.upsert.call_args
    assert args[0] == {"nba_api_id": 977, "display_name": "Kobe Bryant"}
    # insert-on-conflict-do-nothing semantics against the UNIQUE nba_api_id
    assert kwargs["on_conflict"] == "nba_api_id"
    assert kwargs["ignore_duplicates"] is True
    upsert_builder.execute.assert_called_once()


def test_null_nba_api_id_is_a_noop():
    # Arrange
    client, _ = _make_client()

    # Act
    result = ensure_canonical_player(None, "Unmatched Legend", client=client)

    # Assert — no DB interaction at all, returns False
    assert result is False
    client.table.assert_not_called()


def test_idempotent_conflict_path_does_not_raise():
    """Even if the driver surfaces a UNIQUE conflict, the helper must not blow up
    the caller. ignore_duplicates should swallow it at the DB level, but we also
    guard that a re-save with the same id behaves consistently."""
    # Arrange — first call succeeds, model a re-save returning no new rows
    client, upsert_builder = _make_client()
    upsert_builder.execute.return_value = MagicMock(data=[])

    # Act — call twice with the same identity (idempotent re-save)
    first = ensure_canonical_player(201939, "Stephen Curry", client=client)
    second = ensure_canonical_player(201939, "Stephen Curry", client=client)

    # Assert — both calls succeed, neither raises, upsert invoked each time
    assert first is True
    assert second is True
    assert client.table.return_value.upsert.call_count == 2


def test_default_client_resolves_via_get_supabase(monkeypatch):
    """When no client is injected, the helper resolves the shared singleton —
    patched here so the test never opens a live connection."""
    # Arrange
    client, upsert_builder = _make_client()
    import services.legend_canonical as mod
    monkeypatch.setattr(
        "services.supabase_client.get_supabase", lambda: client, raising=True
    )

    # Act
    result = mod.ensure_canonical_player(2544, "LeBron James")

    # Assert
    assert result is True
    client.table.assert_called_once_with("canonical_players")
    upsert_builder.execute.assert_called_once()
