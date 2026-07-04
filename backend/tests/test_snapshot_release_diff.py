"""
Tests for the draft-vs-published diff (#8).

- Pure-core tests for services/snapshot_versions/release_diff.build_diff and
  its normalization helpers (no DB).
- Orchestration tests for compute_release_diff with patched fetchers.
- API tests for GET /api/snapshots/diff (auth gate + delegation + error map).

All DB access is mocked — the linked Supabase is production.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.snapshot_versions import release_diff


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _entity(
    canonical_id: str,
    *,
    name: str = "Player One",
    team: str | None = "BOS",
    position: str | None = "G",
    salary=10_000_000,
    is_legend: bool = False,
    skills: dict[str, str] | None = None,
):
    return {
        "canonical_player_id": canonical_id,
        "name": name,
        "team": team,
        "position": position,
        "salary": salary,
        "is_legend": is_legend,
        "skills": skills or {},
    }


# ---------------------------------------------------------------------------
# build_diff — pure core
# ---------------------------------------------------------------------------


class TestBuildDiff:
    def test_empty_diff_when_sides_match(self):
        skills = {"passer": "Elite", "driver": "Capable"}
        draft = {("c1", False): _entity("c1", skills=dict(skills))}
        released = {("c1", False): _entity("c1", skills=dict(skills))}

        result = release_diff.build_diff(draft, released)

        assert result["summary"] == {
            "added": 0,
            "removed": 0,
            "changed": 0,
            "unchanged": 1,
        }
        assert result["players_added"] == []
        assert result["players_removed"] == []
        assert result["players_changed"] == []

    def test_player_added(self):
        draft = {
            ("c1", False): _entity("c1", name="New Guy"),
        }
        result = release_diff.build_diff(draft, {})

        assert result["summary"]["added"] == 1
        row = result["players_added"][0]
        assert row["canonical_player_id"] == "c1"
        assert row["name"] == "New Guy"
        assert row["is_legend"] is False
        # The skills map is internal — not leaked in added/removed rows.
        assert "skills" not in row

    def test_player_removed(self):
        released = {
            ("c9", False): _entity("c9", name="Departed"),
        }
        result = release_diff.build_diff({}, released)

        assert result["summary"]["removed"] == 1
        assert result["players_removed"][0]["name"] == "Departed"

    def test_skill_tier_changed(self):
        draft = {
            ("c1", False): _entity("c1", skills={"passer": "Elite"}),
        }
        released = {
            ("c1", False): _entity("c1", skills={"passer": "Proficient"}),
        }

        result = release_diff.build_diff(draft, released)

        assert result["summary"]["changed"] == 1
        changed = result["players_changed"][0]
        assert changed["skill_changes"] == [
            {"skill": "passer", "old_tier": "Proficient", "new_tier": "Elite"}
        ]
        assert changed["contract_changes"] == []

    def test_skill_added_and_dropped_report_null_sides(self):
        draft = {
            ("c1", False): _entity("c1", skills={"driver": "Capable"}),
        }
        released = {
            ("c1", False): _entity("c1", skills={"passer": "Elite"}),
        }

        result = release_diff.build_diff(draft, released)
        changes = result["players_changed"][0]["skill_changes"]

        # Sorted by skill key
        assert changes == [
            {"skill": "driver", "old_tier": None, "new_tier": "Capable"},
            {"skill": "passer", "old_tier": "Elite", "new_tier": None},
        ]

    def test_contract_changed(self):
        draft = {
            ("c1", False): _entity("c1", team="LAL", salary=12_000_000),
        }
        released = {
            ("c1", False): _entity("c1", team="BOS", salary=10_000_000),
        }

        result = release_diff.build_diff(draft, released)
        changed = result["players_changed"][0]

        assert changed["skill_changes"] == []
        assert {"field": "team", "old": "BOS", "new": "LAL"} in changed["contract_changes"]
        assert {"field": "salary", "old": 10_000_000, "new": 12_000_000} in changed[
            "contract_changes"
        ]

    def test_legend_profile_changed(self):
        draft = {
            ("c5", True): _entity(
                "c5",
                name="Hakeem Olajuwon",
                is_legend=True,
                salary=0,
                skills={"low_post_player": "All-Time Great"},
            ),
        }
        released = {
            ("c5", True): _entity(
                "c5",
                name="Hakeem Olajuwon",
                is_legend=True,
                salary=0,
                skills={"low_post_player": "Elite"},
            ),
        }

        result = release_diff.build_diff(draft, released)
        changed = result["players_changed"][0]

        assert changed["is_legend"] is True
        assert changed["skill_changes"] == [
            {
                "skill": "low_post_player",
                "old_tier": "Elite",
                "new_tier": "All-Time Great",
            }
        ]

    def test_same_canonical_id_legend_and_regular_are_independent(self):
        """A person who is both a current Player and a Legend diffs as two
        entities — the freeze identity is (canonical_player_id, is_legend)."""
        draft = {
            ("c1", False): _entity("c1", name="LeBron James"),
            ("c1", True): _entity(
                "c1", name="LeBron James", is_legend=True, salary=0
            ),
        }
        released = {
            ("c1", False): _entity("c1", name="LeBron James"),
        }

        result = release_diff.build_diff(draft, released)

        assert result["summary"] == {
            "added": 1,
            "removed": 0,
            "changed": 0,
            "unchanged": 1,
        }
        assert result["players_added"][0]["is_legend"] is True

    def test_lists_sorted_by_name(self):
        draft = {
            ("c1", False): _entity("c1", name="Zion"),
            ("c2", False): _entity("c2", name="Anthony"),
        }
        result = release_diff.build_diff(draft, {})

        assert [r["name"] for r in result["players_added"]] == ["Anthony", "Zion"]


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------


class TestNormalization:
    def test_normalize_profile_extracts_final_tier(self):
        profile = {
            "passer": {"final_tier": "Elite", "stat_tier": "Proficient"},
            "driver": {"final_tier": "None"},
            "cutter": {"no_tier_here": True},
            "junk": "not-a-dict",
        }
        assert release_diff._normalize_profile(profile) == {
            "passer": "Elite",
            "driver": "None",
        }

    def test_normalize_profile_handles_none_and_empty(self):
        assert release_diff._normalize_profile(None) == {}
        assert release_diff._normalize_profile({}) == {}

    def test_latest_profiles_mirrors_distinct_on_ordering(self):
        rows = [
            {
                "player_id": "p1",
                "profile": {"old": True},
                "updated_at": "2026-01-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
            },
            {
                "player_id": "p1",
                "profile": {"new": True},
                "updated_at": "2026-03-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
            },
            # NULLS LAST: a row without updated_at loses to any row with one.
            {
                "player_id": "p2",
                "profile": {"null_updated": True},
                "updated_at": None,
                "created_at": "2026-05-01T00:00:00Z",
            },
            {
                "player_id": "p2",
                "profile": {"has_updated": True},
                "updated_at": "2026-02-01T00:00:00Z",
                "created_at": "2026-01-01T00:00:00Z",
            },
        ]
        latest = release_diff._latest_profiles(rows, "player_id")

        assert latest["p1"] == {"new": True}
        assert latest["p2"] == {"has_updated": True}


# ---------------------------------------------------------------------------
# compute_release_diff orchestration (fetchers patched)
# ---------------------------------------------------------------------------


def _fake_draft(season="2025-26"):
    d = MagicMock()
    d.id = "draft-id"
    d.label = "draft-abc12345"
    d.season = season
    d.status = "review"
    return d


class TestComputeReleaseDiff:
    def test_raises_no_open_draft(self):
        with patch(
            "services.snapshot_versions.repo.get_draft", return_value=None
        ), patch.object(release_diff, "_get_client", return_value=MagicMock()):
            with pytest.raises(ValueError, match="no_open_draft"):
                release_diff.compute_release_diff()

    def test_raises_no_active_release(self):
        client = MagicMock()
        empty = MagicMock()
        empty.data = []
        (
            client.table.return_value.select.return_value.eq.return_value.execute
        ).return_value = empty

        with patch(
            "services.snapshot_versions.repo.get_draft",
            return_value=_fake_draft(),
        ):
            with pytest.raises(ValueError, match="no_active_release"):
                release_diff.compute_release_diff(client=client)

    def test_full_flow_envelope(self):
        client = MagicMock()
        active_row = {
            "id": "release-id",
            "label": "2025-26 v3",
            "season": "2025-26",
            "status": "published",
            "is_active": True,
            "published_at": "2026-05-01T00:00:00Z",
            "created_at": "2026-04-01T00:00:00Z",
        }
        active_result = MagicMock()
        active_result.data = [active_row]
        (
            client.table.return_value.select.return_value.eq.return_value.execute
        ).return_value = active_result

        draft_entities = {
            ("c1", False): _entity("c1", name="Changed Guy", skills={"passer": "Elite"}),
        }
        released_entities = {
            ("c1", False): _entity(
                "c1", name="Changed Guy", skills={"passer": "Capable"}
            ),
        }

        with patch(
            "services.snapshot_versions.repo.get_draft",
            return_value=_fake_draft(),
        ), patch.object(
            release_diff, "_collect_draft_entities", return_value=draft_entities
        ) as collect_draft, patch.object(
            release_diff,
            "_collect_released_entities",
            return_value=released_entities,
        ) as collect_released:
            result = release_diff.compute_release_diff(client=client)

        collect_draft.assert_called_once_with("2025-26", client)
        collect_released.assert_called_once_with("release-id", client)

        assert result["draft"]["id"] == "draft-id"
        assert result["active_release"]["label"] == "2025-26 v3"
        assert result["skill_renames"] == []
        assert result["summary"]["changed"] == 1
        assert result["players_changed"][0]["name"] == "Changed Guy"


# ---------------------------------------------------------------------------
# API surface — GET /api/snapshots/diff
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


class TestDiffEndpoint:
    def test_requires_admin(self, anon_client):
        resp = anon_client.get("/api/snapshots/diff")
        assert resp.status_code == 401

    def test_returns_diff_envelope(self, admin_client):
        payload = {
            "draft": {"id": "d1"},
            "active_release": {"id": "r1"},
            "summary": {"added": 0, "removed": 0, "changed": 0, "unchanged": 5},
            "players_added": [],
            "players_removed": [],
            "players_changed": [],
        }
        with patch(
            "services.snapshot_versions.release_diff.compute_release_diff",
            return_value=payload,
        ):
            resp = admin_client.get(
                "/api/snapshots/diff", headers=admin_client.auth_header
            )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["summary"]["unchanged"] == 5

    def test_no_open_draft_maps_to_409(self, admin_client):
        with patch(
            "services.snapshot_versions.release_diff.compute_release_diff",
            side_effect=ValueError("no_open_draft"),
        ):
            resp = admin_client.get(
                "/api/snapshots/diff", headers=admin_client.auth_header
            )
        assert resp.status_code == 409
        assert resp.get_json()["error"] == "no_open_draft"

    def test_no_active_release_maps_to_409(self, admin_client):
        with patch(
            "services.snapshot_versions.release_diff.compute_release_diff",
            side_effect=ValueError("no_active_release"),
        ):
            resp = admin_client.get(
                "/api/snapshots/diff", headers=admin_client.auth_header
            )
        assert resp.status_code == 409
        assert resp.get_json()["error"] == "no_active_release"

    def test_unexpected_error_maps_to_500(self, admin_client):
        with patch(
            "services.snapshot_versions.release_diff.compute_release_diff",
            side_effect=RuntimeError("boom"),
        ):
            resp = admin_client.get(
                "/api/snapshots/diff", headers=admin_client.auth_header
            )
        assert resp.status_code == 500
        assert resp.get_json()["success"] is False


# ---------------------------------------------------------------------------
# compute_published_release_diff — release vs previous published release
# ---------------------------------------------------------------------------


def _published_row(**overrides):
    row = {
        "id": "rel-2",
        "label": "2025-26 v2",
        "season": "2025-26",
        "status": "published",
        "is_active": True,
        "published_at": "2026-07-03T11:09:26Z",
        "created_at": "2026-07-03T09:06:45Z",
    }
    row.update(overrides)
    return row


class TestComputePublishedReleaseDiff:
    def test_unknown_id_raises_not_found(self):
        client = MagicMock()
        empty = MagicMock()
        empty.data = []
        (
            client.table.return_value.select.return_value.eq.return_value.execute
        ).return_value = empty

        with pytest.raises(ValueError, match="not_found"):
            release_diff.compute_published_release_diff("nope", client=client)

    def test_draft_row_raises_not_found(self):
        client = MagicMock()
        result = MagicMock()
        result.data = [_published_row(status="draft", published_at=None)]
        (
            client.table.return_value.select.return_value.eq.return_value.execute
        ).return_value = result

        with pytest.raises(ValueError, match="not_found"):
            release_diff.compute_published_release_diff("rel-2", client=client)

    def test_first_release_returns_null_previous_and_empty_diff(self):
        from services.snapshot_versions.repo import _row_to_release

        release = _row_to_release(_published_row(id="rel-1"))
        entities = {
            ("c1", False): _entity("c1"),
            ("c2", False): _entity("c2", name="Player Two"),
        }

        with patch.object(
            release_diff, "_get_published_release", return_value=release
        ), patch.object(
            release_diff, "_get_previous_published", return_value=None
        ), patch.object(
            release_diff, "_collect_released_entities", return_value=entities
        ) as collect:
            result = release_diff.compute_published_release_diff(
                "rel-1", client=MagicMock()
            )

        collect.assert_called_once()
        assert result["previous"] is None
        assert result["release"]["id"] == "rel-1"
        assert "is_active" not in result["release"]
        assert result["summary"] == {
            "added": 0, "removed": 0, "changed": 0, "unchanged": 2,
        }
        assert result["players_added"] == []
        assert result["players_removed"] == []
        assert result["players_changed"] == []
        assert result["skill_renames"] == []

    def test_envelope_vs_previous_release(self):
        from services.snapshot_versions.repo import _row_to_release

        release = _row_to_release(_published_row(id="rel-2"))
        previous = _row_to_release(
            _published_row(
                id="rel-1",
                label="2025-26 v1",
                is_active=False,
                published_at="2026-06-12T09:00:00Z",
            )
        )
        current_entities = {
            ("c1", False): _entity("c1", name="Changed Guy", skills={"passer": "Elite"}),
            ("c2", False): _entity("c2", name="New Guy"),
        }
        previous_entities = {
            ("c1", False): _entity("c1", name="Changed Guy", skills={"passer": "Capable"}),
        }

        with patch.object(
            release_diff, "_get_published_release", return_value=release
        ), patch.object(
            release_diff, "_get_previous_published", return_value=previous
        ) as prev_lookup, patch.object(
            release_diff,
            "_collect_released_entities",
            side_effect=[current_entities, previous_entities],
        ) as collect:
            client = MagicMock()
            result = release_diff.compute_published_release_diff(
                "rel-2", client=client
            )

        prev_lookup.assert_called_once_with(release.created_at, client)
        assert collect.call_args_list == [
            (("rel-2", client),),
            (("rel-1", client),),
        ]
        assert result["release"]["label"] == "2025-26 v2"
        assert result["previous"] == {
            "id": "rel-1",
            "label": "2025-26 v1",
            "season": "2025-26",
            "published_at": "2026-06-12T09:00:00Z",
        }
        assert result["summary"] == {
            "added": 1, "removed": 0, "changed": 1, "unchanged": 0,
        }
        assert result["players_added"][0]["name"] == "New Guy"
        assert result["players_changed"][0]["skill_changes"] == [
            {"skill": "passer", "old_tier": "Capable", "new_tier": "Elite"}
        ]
        assert result["skill_renames"] == []

    def test_previous_lookup_filters_published_before_by_created_at(self):
        # created_at, NOT published_at: the reactivate RPC bumps published_at
        # to now() (supabase/migrations/20260526000003), so publish-date order
        # reshuffles on reactivation. created_at is never rewritten.
        client = MagicMock()
        chain = client.table.return_value.select.return_value
        result = MagicMock()
        result.data = [
            _published_row(
                id="rel-1", is_active=False, published_at="2026-06-12T09:00:00Z"
            )
        ]
        (
            chain.eq.return_value.lt.return_value.order.return_value
            .limit.return_value.execute
        ).return_value = result

        previous = release_diff._get_previous_published(
            "2026-07-03T09:06:45Z", client
        )

        assert previous is not None and previous.id == "rel-1"
        chain.eq.assert_called_once_with("status", "published")
        chain.eq.return_value.lt.assert_called_once_with(
            "created_at", "2026-07-03T09:06:45Z"
        )
        chain.eq.return_value.lt.return_value.order.assert_called_once_with(
            "created_at", desc=True
        )


_UUID_A = "11111111-1111-4111-8111-111111111111"
_UUID_B = "22222222-2222-4222-8222-222222222222"
_UUID_C = "33333333-3333-4333-8333-333333333333"
_UUID_D = "44444444-4444-4444-8444-444444444444"


@pytest.fixture()
def _clear_diff_cache():
    import api.snapshots as snapshots_mod

    snapshots_mod._release_diff_cache.clear()
    yield
    snapshots_mod._release_diff_cache.clear()


class TestPublicReleaseDiffEndpoint:
    """GET /api/snapshots/releases/<id>/diff — public, no auth required."""

    def test_returns_envelope_without_auth(self, anon_client, _clear_diff_cache):
        payload = {
            "release": {"id": _UUID_A, "label": "2025-26 v2"},
            "previous": {"id": _UUID_B, "label": "2025-26 v1"},
            "summary": {"added": 1, "removed": 0, "changed": 1, "unchanged": 3},
            "players_added": [],
            "players_removed": [],
            "players_changed": [],
        }
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
            return_value=payload,
        ):
            resp = anon_client.get(f"/api/snapshots/releases/{_UUID_A}/diff")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["previous"]["id"] == _UUID_B
        assert "max-age=86400" in resp.headers.get("Cache-Control", "")

    def test_repeat_request_is_served_from_cache(self, anon_client, _clear_diff_cache):
        payload = {
            "release": {"id": _UUID_C, "label": "2025-26 v2"},
            "previous": None,
            "summary": {"added": 0, "removed": 0, "changed": 0, "unchanged": 5},
            "players_added": [],
            "players_removed": [],
            "players_changed": [],
        }
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
            return_value=payload,
        ) as compute:
            first = anon_client.get(f"/api/snapshots/releases/{_UUID_C}/diff")
            second = anon_client.get(f"/api/snapshots/releases/{_UUID_C}/diff")
        assert first.status_code == 200 and second.status_code == 200
        assert second.get_json()["data"]["release"]["id"] == _UUID_C
        # The diff of two published releases is immutable — computed once.
        compute.assert_called_once()

    def test_malformed_id_maps_to_404_without_touching_service(
        self, anon_client, _clear_diff_cache
    ):
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
        ) as compute:
            resp = anon_client.get("/api/snapshots/releases/not-a-uuid/diff")
        assert resp.status_code == 404
        assert resp.get_json()["error"] == "not_found"
        compute.assert_not_called()

    def test_not_found_maps_to_404(self, anon_client, _clear_diff_cache):
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
            side_effect=ValueError("not_found"),
        ):
            resp = anon_client.get(f"/api/snapshots/releases/{_UUID_D}/diff")
        assert resp.status_code == 404
        assert resp.get_json()["error"] == "not_found"

    def test_unexpected_value_error_does_not_leak_message(
        self, anon_client, _clear_diff_cache
    ):
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
            side_effect=ValueError("internal detail"),
        ):
            resp = anon_client.get(f"/api/snapshots/releases/{_UUID_D}/diff")
        assert resp.status_code == 500
        assert "internal detail" not in resp.get_data(as_text=True)

    def test_unexpected_error_maps_to_500(self, anon_client, _clear_diff_cache):
        with patch(
            "services.snapshot_versions.release_diff.compute_published_release_diff",
            side_effect=RuntimeError("boom"),
        ):
            resp = anon_client.get(f"/api/snapshots/releases/{_UUID_D}/diff")
        assert resp.status_code == 500
        assert resp.get_json()["success"] is False


# ---------------------------------------------------------------------------
# collapse_skill_renames — taxonomy rename collapse (#84 follow-up)
# ---------------------------------------------------------------------------


def _rename_changed_player(i: int, extra_skill_changes=None):
    """A player whose diff is the secure_handler -> possession_protector rename."""
    changes = [
        {"skill": "possession_protector", "old_tier": None, "new_tier": "Elite"},
        {"skill": "secure_handler", "old_tier": "Elite", "new_tier": None},
    ]
    if extra_skill_changes:
        changes = changes + extra_skill_changes
    return {
        "canonical_player_id": f"c{i}",
        "name": f"Player {i}",
        "is_legend": False,
        "team": "BOS",
        "position": "G",
        "skill_changes": changes,
        "contract_changes": [],
    }


class TestCollapseSkillRenames:
    def test_below_threshold_diff_is_untouched(self):
        diff = {
            "summary": {"added": 0, "removed": 0, "changed": 2, "unchanged": 5},
            "players_added": [],
            "players_removed": [],
            "players_changed": [_rename_changed_player(1), _rename_changed_player(2)],
        }
        result = release_diff.collapse_skill_renames(diff)
        assert result["skill_renames"] == []
        assert result["players_changed"] == diff["players_changed"]
        assert result["summary"]["changed"] == 2

    def test_widespread_rename_is_collapsed(self):
        players = [_rename_changed_player(i) for i in range(25)]
        # One player has a real tier change on top of the rename.
        players.append(
            _rename_changed_player(
                99,
                extra_skill_changes=[
                    {"skill": "scorer", "old_tier": "Capable", "new_tier": "Elite"}
                ],
            )
        )
        diff = {
            "summary": {"added": 0, "removed": 0, "changed": 26, "unchanged": 500},
            "players_added": [],
            "players_removed": [],
            "players_changed": players,
        }
        result = release_diff.collapse_skill_renames(diff)

        assert result["skill_renames"] == [
            {
                "from_skill": "secure_handler",
                "to_skill": "possession_protector",
                "count": 26,
            }
        ]
        # Rename-only players are hidden; the one real change remains,
        # stripped of its rename pair.
        assert len(result["players_changed"]) == 1
        remaining = result["players_changed"][0]
        assert remaining["name"] == "Player 99"
        assert remaining["skill_changes"] == [
            {"skill": "scorer", "old_tier": "Capable", "new_tier": "Elite"}
        ]
        assert result["summary"]["changed"] == 1
        # Untouched fields carry through; input was not mutated.
        assert result["summary"]["unchanged"] == 500
        assert len(diff["players_changed"]) == 26
        assert len(diff["players_changed"][0]["skill_changes"]) == 2

    def test_tier_mismatch_is_not_a_rename(self):
        # Dropped Elite but appeared Capable — a real change, not a rename.
        players = [
            {
                "canonical_player_id": f"c{i}",
                "name": f"Player {i}",
                "is_legend": False,
                "team": "BOS",
                "position": "G",
                "skill_changes": [
                    {"skill": "possession_protector", "old_tier": None, "new_tier": "Capable"},
                    {"skill": "secure_handler", "old_tier": "Elite", "new_tier": None},
                ],
                "contract_changes": [],
            }
            for i in range(25)
        ]
        diff = {
            "summary": {"added": 0, "removed": 0, "changed": 25, "unchanged": 0},
            "players_added": [],
            "players_removed": [],
            "players_changed": players,
        }
        result = release_diff.collapse_skill_renames(diff)
        assert result["skill_renames"] == []
        assert len(result["players_changed"]) == 25

    def test_contract_change_keeps_player_visible(self):
        players = [_rename_changed_player(i) for i in range(24)]
        traded = _rename_changed_player(50)
        traded = {
            **traded,
            "contract_changes": [{"field": "team", "old": "BOS", "new": "NYK"}],
        }
        players.append(traded)
        diff = {
            "summary": {"added": 0, "removed": 0, "changed": 25, "unchanged": 0},
            "players_added": [],
            "players_removed": [],
            "players_changed": players,
        }
        result = release_diff.collapse_skill_renames(diff)
        assert len(result["players_changed"]) == 1
        assert result["players_changed"][0]["contract_changes"] == [
            {"field": "team", "old": "BOS", "new": "NYK"}
        ]
        assert result["players_changed"][0]["skill_changes"] == []
