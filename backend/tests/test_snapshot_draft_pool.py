"""
Tests for the draft composite player pool (Player Pool tab).

- Pure shaping tests for services/snapshot_versions/draft_pool helpers (no DB).
- Orchestration tests for _collect_pool_rows / get_draft_player_pool with
  patched fetchers.
- API tests for GET /api/snapshots/draft/player-pool (auth + draft gate +
  delegation + error map).

All DB access is mocked — the linked Supabase is production.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.skills import ALL_SKILLS
from services.snapshot_versions import draft_pool


def _profile(**tiers):
    """Build a JSONB-shaped skill profile from {skill: final_tier}."""
    return {skill: {"final_tier": tier} for skill, tier in tiers.items()}


# ---------------------------------------------------------------------------
# Pure shaping
# ---------------------------------------------------------------------------


class TestSkillMap:
    def test_skill_map_is_total_over_all_skills(self):
        result = draft_pool._skill_map(_profile(passer="Elite"))
        assert set(result.keys()) == set(ALL_SKILLS)
        assert result["passer"] == "Elite"
        # Every other skill is unrated → None
        assert all(
            result[s] is None for s in ALL_SKILLS if s != "passer"
        )

    def test_literal_none_string_counts_as_unrated(self):
        result = draft_pool._skill_map(_profile(passer="None"))
        assert result["passer"] is None

    def test_data_missing_lists_only_unrated_skills(self):
        full = {s: "Capable" for s in ALL_SKILLS}
        result = draft_pool._skill_map(_profile(**full))
        assert draft_pool._data_missing(result) == []

    def test_data_missing_populated_when_partial(self):
        skill_map = draft_pool._skill_map(_profile(passer="Elite", driver="Capable"))
        missing = draft_pool._data_missing(skill_map)
        assert "passer" not in missing
        assert "driver" not in missing
        assert len(missing) == len(ALL_SKILLS) - 2

    def test_empty_profile_is_all_missing(self):
        skill_map = draft_pool._skill_map(None)
        assert draft_pool._data_missing(skill_map) == ALL_SKILLS


# ---------------------------------------------------------------------------
# Orchestration — fetchers patched
# ---------------------------------------------------------------------------


class TestCollectPoolRows:
    def _patches(self, *, players, legends, canonical, regular, legend_profiles, flags):
        client = MagicMock()

        def fake_table(name):
            tbl = MagicMock()
            data = {"players": players, "legends": legends}.get(name, [])
            tbl.select.return_value.eq.return_value.execute.return_value.data = data
            tbl.select.return_value.execute.return_value.data = data
            return tbl

        client.table.side_effect = fake_table
        return client, [
            patch.object(
                draft_pool.release_diff, "_fetch_canonical_map", return_value=canonical
            ),
            patch.object(
                draft_pool.release_diff,
                "_fetch_regular_profiles",
                return_value=regular,
            ),
            patch.object(
                draft_pool.release_diff,
                "_fetch_legend_profiles",
                return_value=legend_profiles,
            ),
            patch.object(draft_pool, "_fetch_flag_counts", return_value=flags),
        ]

    def test_full_skills_player(self):
        players = [
            {
                "id": "p1",
                "nba_api_id": 100,
                "name": "Alpha",
                "team": "BOS",
                "position": "G",
                "age": 28,
                "height": "6-3",
                "weight": 195,
                "salary": 30_000_000,
            }
        ]
        full = {s: "Capable" for s in ALL_SKILLS}
        client, patches = self._patches(
            players=players,
            legends=[],
            canonical={100: "c1"},
            regular={"p1": _profile(**full)},
            legend_profiles={},
            flags={"p1": {"total": 2, "unresolved": 1}},
        )
        with patches[0], patches[1], patches[2], patches[3]:
            rows = draft_pool._collect_pool_rows("2025-26", client)

        assert len(rows) == 1
        row = rows[0]
        assert row["id"] == "p1"
        assert row["name"] == "Alpha"
        assert row["age"] == 28
        assert row["season"] == "2025-26"
        assert row["is_legend"] is False
        assert row["data_missing_skills"] == []
        assert row["flag_summary"] == {"total": 2, "unresolved": 1}

    def test_partial_skills_player_marks_data_missing(self):
        players = [
            {
                "id": "p2",
                "nba_api_id": 200,
                "name": "Beta",
                "team": "LAL",
                "position": "F",
                "age": 24,
                "height": "6-8",
                "weight": 220,
                "salary": None,
            }
        ]
        client, patches = self._patches(
            players=players,
            legends=[],
            canonical={200: "c2"},
            regular={"p2": _profile(passer="Elite")},
            legend_profiles={},
            flags={},
        )
        with patches[0], patches[1], patches[2], patches[3]:
            rows = draft_pool._collect_pool_rows("2025-26", client)

        row = rows[0]
        assert row["salary"] == 0  # COALESCE
        assert row["skills"]["passer"] == "Elite"
        assert "passer" not in row["data_missing_skills"]
        assert len(row["data_missing_skills"]) == len(ALL_SKILLS) - 1
        assert row["flag_summary"] == {"total": 0, "unresolved": 0}

    def test_legend_row_included(self):
        legends = [
            {
                "id": "l1",
                "nba_api_id": 900,
                "name": "Legend Z",
                "team": None,
                "position": "C",
                "age": None,
                "height": "7-0",
                "weight": 250,
            }
        ]
        client, patches = self._patches(
            players=[],
            legends=legends,
            canonical={900: "c9"},
            regular={},
            legend_profiles={"l1": _profile(low_post_player="Elite")},
            flags={},
        )
        with patches[0], patches[1], patches[2], patches[3]:
            rows = draft_pool._collect_pool_rows("2025-26", client)

        assert len(rows) == 1
        row = rows[0]
        assert row["is_legend"] is True
        assert row["salary"] == 0
        assert row["skills"]["low_post_player"] == "Elite"

    def test_unlinked_player_skipped(self):
        players = [
            {"id": "p3", "nba_api_id": 300, "name": "Gamma", "salary": 1},
        ]
        client, patches = self._patches(
            players=players,
            legends=[],
            canonical={},  # no canonical link → freeze skips it
            regular={},
            legend_profiles={},
            flags={},
        )
        with patches[0], patches[1], patches[2], patches[3]:
            rows = draft_pool._collect_pool_rows("2025-26", client)
        assert rows == []


class TestGetDraftPlayerPool:
    def test_raises_no_open_draft(self):
        with patch.object(
            draft_pool.repo, "get_draft", return_value=None
        ), patch.object(draft_pool, "_get_client", return_value=MagicMock()):
            with pytest.raises(ValueError, match="no_open_draft"):
                draft_pool.get_draft_player_pool()

    def test_delegates_with_draft_season(self):
        draft = MagicMock()
        draft.season = "2024-25"
        with patch.object(
            draft_pool.repo, "get_draft", return_value=draft
        ), patch.object(
            draft_pool, "_get_client", return_value=MagicMock()
        ), patch.object(
            draft_pool, "_collect_pool_rows", return_value=[{"id": "p1"}]
        ) as collect:
            rows = draft_pool.get_draft_player_pool()
        assert rows == [{"id": "p1"}]
        assert collect.call_args[0][0] == "2024-25"


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def _bypass_admin_auth(monkeypatch):
    import api.auth as auth_mod

    monkeypatch.setattr(
        auth_mod, "_verify_jwt", lambda _token: {"sub": "test-admin-user"}
    )
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


@pytest.fixture()
def admin_client(monkeypatch):
    from app import create_app

    _bypass_admin_auth(monkeypatch)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        c.auth_header = {"Authorization": "Bearer fake-admin-token"}
        yield c


@pytest.fixture()
def anon_client():
    from app import create_app

    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestPlayerPoolEndpoint:
    def test_requires_admin(self, anon_client):
        resp = anon_client.get("/api/snapshots/draft/player-pool")
        assert resp.status_code == 401

    def test_no_open_draft_maps_to_409(self, admin_client):
        import api.auth as auth_mod

        with patch.object(auth_mod.snap_repo, "get_draft", return_value=None):
            resp = admin_client.get(
                "/api/snapshots/draft/player-pool",
                headers=admin_client.auth_header,
            )
        assert resp.status_code == 409
        assert resp.get_json()["error"] == "no_open_draft"

    def test_returns_pool_envelope(self, admin_client):
        import api.auth as auth_mod

        draft = MagicMock()
        draft.id = "d1"
        with patch.object(
            auth_mod.snap_repo, "get_draft", return_value=draft
        ), patch(
            "services.snapshot_versions.draft_pool.get_draft_player_pool",
            return_value=[{"id": "p1", "name": "Alpha", "data_missing_skills": []}],
        ):
            resp = admin_client.get(
                "/api/snapshots/draft/player-pool",
                headers=admin_client.auth_header,
            )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"][0]["name"] == "Alpha"

    def test_unexpected_error_maps_to_500(self, admin_client):
        import api.auth as auth_mod

        draft = MagicMock()
        draft.id = "d1"
        with patch.object(
            auth_mod.snap_repo, "get_draft", return_value=draft
        ), patch(
            "services.snapshot_versions.draft_pool.get_draft_player_pool",
            side_effect=RuntimeError("boom"),
        ):
            resp = admin_client.get(
                "/api/snapshots/draft/player-pool",
                headers=admin_client.auth_header,
            )
        assert resp.status_code == 500
        assert resp.get_json()["success"] is False
