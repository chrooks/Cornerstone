"""
Integration tests for community leaderboard endpoints.
"""

from __future__ import annotations

import pytest

from app import create_app
from api import community, saved_teams


LEGEND_ID_HAKEEM = "33333333-3333-3333-3333-333333333333"
LEGEND_ID_JORDAN = "44444444-4444-4444-4444-444444444444"
STANDARD_RULESET_ID = "55555555-5555-5555-5555-555555555555"
FFA_RULESET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, db, table_name: str):
        self.db = db
        self.table_name = table_name
        self._filters: dict[str, object] = {}
        self._in_filters: dict[str, list] = {}
        self._order_key: str | None = None
        self._order_desc: bool = False
        self._limit = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def in_(self, key, values):
        self._in_filters[key] = list(values)
        return self

    def order(self, key, *, desc: bool = False, **_kwargs):
        self._order_key = key
        self._order_desc = desc
        return self

    def limit(self, value):
        self._limit = value
        return self

    def execute(self):
        rows = self.db.select(self.table_name, self._filters, self._in_filters)
        if self._order_key is not None:
            rows = sorted(
                rows,
                key=lambda r: r.get(self._order_key, ""),  # type: ignore[arg-type]
                reverse=self._order_desc,
            )
        if self._limit is not None:
            rows = rows[: self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {
            "rulesets": [
                {"id": STANDARD_RULESET_ID, "slug": "standard", "name": "Standard"},
                {"id": FFA_RULESET_ID, "slug": "ffa", "name": "Free For All"},
            ],
            "legends": [
                {"id": LEGEND_ID_HAKEEM, "name": "Hakeem Olajuwon", "nba_api_id": 165},
                {"id": LEGEND_ID_JORDAN, "name": "Michael Jordan", "nba_api_id": 893},
            ],
            "players": [
                {"id": "player-1", "nba_api_id": 201935},
                {"id": "player-2", "nba_api_id": 203932},
            ],
            "saved_teams": [],
            "saved_team_evaluations": [],
            "saved_team_players": [],
        }

    def table(self, name: str):
        return _FakeQuery(self, name)

    def select(self, table_name: str, filters: dict, in_filters: dict | None = None):
        rows = list(self.rows.get(table_name, []))
        for key, value in filters.items():
            rows = [row for row in rows if row.get(key) == value]
        for key, values in (in_filters or {}).items():
            rows = [row for row in rows if row.get(key) in values]
        return rows


def _make_saved_team(
    *,
    team_id: str = "team-1",
    ruleset_id: str = STANDARD_RULESET_ID,
    ruleset_slug: str = "standard",
    visibility: str = "public",
    cornerstone_legend_id: str | None = LEGEND_ID_HAKEEM,
    team_size: int = 9,
    name: str = "Test Team",
) -> dict:
    return {
        "id": team_id,
        "ruleset_id": ruleset_id,
        "ruleset_slug": ruleset_slug,
        "visibility": visibility,
        "cornerstone_legend_id": cornerstone_legend_id,
        "team_size": team_size,
        "name": name,
        "created_at": "2026-05-13T12:00:00Z",
    }


def _make_saved_team_player(
    *,
    saved_team_id: str = "team-1",
    slot: int = 1,
    is_cornerstone: bool = False,
    player_name_snapshot: str = "Player",
    position_snapshot: str | None = "G",
    player_id: str | None = None,
    legend_id: str | None = None,
) -> dict:
    return {
        "saved_team_id": saved_team_id,
        "slot": slot,
        "is_cornerstone": is_cornerstone,
        "player_name_snapshot": player_name_snapshot,
        "position_snapshot": position_snapshot,
        "player_id": player_id,
        "legend_id": legend_id,
    }


def _make_evaluation(
    *,
    saved_team_id: str = "team-1",
    star_rating: float = 3.5,
    starting_lineup_score: float = 80.0,
) -> dict:
    return {
        "id": f"eval-{saved_team_id}",
        "saved_team_id": saved_team_id,
        "evaluation_version": "cohesion-v1",
        "star_rating": star_rating,
        "starting_lineup_score": starting_lineup_score,
        "created_at": "2026-05-13T12:00:00Z",
    }


@pytest.fixture()
def fake_supabase(monkeypatch):
    db = _FakeSupabase()
    monkeypatch.setattr(community, "get_supabase", lambda: db)
    return db


@pytest.fixture()
def client(fake_supabase):
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── GET /api/community/stats ──


class TestCommunityStats:
    def test_returns_aggregates_for_public_teams(self, client, fake_supabase):
        """Stats endpoint returns team count, avg score, and top cornerstone per RuleSet."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", cornerstone_legend_id=LEGEND_ID_HAKEEM),
            _make_saved_team(team_id="t2", cornerstone_legend_id=LEGEND_ID_HAKEEM),
            _make_saved_team(team_id="t3", cornerstone_legend_id=LEGEND_ID_JORDAN),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=3.0),
            _make_evaluation(saved_team_id="t2", star_rating=4.0),
            _make_evaluation(saved_team_id="t3", star_rating=5.0),
        ]

        resp = client.get("/api/community/stats")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        stats = body["data"]["standard"]
        assert stats["team_count"] == 3
        assert stats["avg_score"] == pytest.approx(4.0, abs=0.01)
        assert stats["top_cornerstone"] == "Hakeem Olajuwon"

    def test_excludes_private_teams(self, client, fake_supabase):
        """Private teams are not included in community stats."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", visibility="public"),
            _make_saved_team(team_id="t2", visibility="private"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=4.0),
            _make_evaluation(saved_team_id="t2", star_rating=5.0),
        ]

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        stats = body["data"]["standard"]
        assert stats["team_count"] == 1
        assert stats["avg_score"] == 4.0

    def test_includes_unlisted_teams(self, client, fake_supabase):
        """Unlisted teams are included in community stats."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", visibility="unlisted"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=3.0),
        ]

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        assert "standard" in body["data"]
        assert body["data"]["standard"]["team_count"] == 1

    def test_empty_when_no_public_teams(self, client, fake_supabase):
        """Returns empty object when no public/unlisted teams exist."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(visibility="private"),
        ]

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"] == {}

    def test_handles_null_cornerstone(self, client, fake_supabase):
        """RuleSets where all teams have null cornerstone show '-' for top cornerstone."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(
                team_id="t1",
                ruleset_id=FFA_RULESET_ID,
                ruleset_slug="ffa",
                cornerstone_legend_id=None,
            ),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=3.0),
        ]

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        assert body["data"]["ffa"]["top_cornerstone"] == "-"

    def test_avg_score_null_when_no_evaluations(self, client, fake_supabase):
        """avg_score is None when teams have no evaluations, not 0."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        # No evaluations seeded

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        assert body["data"]["standard"]["avg_score"] is None

    def test_multiple_rulesets(self, client, fake_supabase):
        """Stats are grouped separately per RuleSet."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", ruleset_slug="standard", ruleset_id=STANDARD_RULESET_ID),
            _make_saved_team(team_id="t2", ruleset_slug="ffa", ruleset_id=FFA_RULESET_ID,
                             cornerstone_legend_id=LEGEND_ID_JORDAN),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=3.0),
            _make_evaluation(saved_team_id="t2", star_rating=5.0),
        ]

        resp = client.get("/api/community/stats")
        body = resp.get_json()
        assert "standard" in body["data"]
        assert "ffa" in body["data"]
        assert body["data"]["standard"]["team_count"] == 1
        assert body["data"]["ffa"]["team_count"] == 1
        assert body["data"]["ffa"]["avg_score"] == 5.0


# ── GET /api/community/teams ──


class TestCommunityTeams:
    def test_returns_public_teams_sorted_by_score(self, client, fake_supabase):
        """Teams endpoint returns public teams sorted by star rating descending."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", name="Low Team"),
            _make_saved_team(team_id="t2", name="High Team"),
            _make_saved_team(team_id="t3", name="Mid Team"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1", star_rating=2.0),
            _make_evaluation(saved_team_id="t2", star_rating=5.0),
            _make_evaluation(saved_team_id="t3", star_rating=3.5),
        ]

        resp = client.get("/api/community/teams")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["success"] is True

        teams = body["data"]["teams"]
        assert len(teams) == 3
        assert teams[0]["name"] == "High Team"
        assert teams[0]["star_rating"] == 5.0
        assert teams[1]["name"] == "Mid Team"
        assert teams[2]["name"] == "Low Team"

        assert body["data"]["total"] == 3
        assert body["data"]["page"] == 1
        assert body["data"]["per_page"] == 20

    def test_excludes_private_teams(self, client, fake_supabase):
        """Private teams do not appear in the list."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", visibility="public", name="Visible"),
            _make_saved_team(team_id="t2", visibility="private", name="Hidden"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        assert body["data"]["total"] == 1
        assert body["data"]["teams"][0]["name"] == "Visible"

    def test_filters_by_ruleset_slug(self, client, fake_supabase):
        """Teams can be filtered by ruleset_slug query param."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", ruleset_slug="standard"),
            _make_saved_team(team_id="t2", ruleset_slug="ffa", ruleset_id=FFA_RULESET_ID),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
            _make_evaluation(saved_team_id="t2"),
        ]

        resp = client.get("/api/community/teams?ruleset_slug=standard")
        body = resp.get_json()
        assert body["data"]["total"] == 1
        assert body["data"]["teams"][0]["ruleset_slug"] == "standard"

    def test_filters_by_team_size(self, client, fake_supabase):
        """Teams can be filtered by team_size query param."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", team_size=5),
            _make_saved_team(team_id="t2", team_size=9),
            _make_saved_team(team_id="t3", team_size=12),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
            _make_evaluation(saved_team_id="t2"),
            _make_evaluation(saved_team_id="t3"),
        ]

        resp = client.get("/api/community/teams?team_size=9")
        body = resp.get_json()
        assert body["data"]["total"] == 1
        assert body["data"]["teams"][0]["team_size"] == 9

    def test_pagination(self, client, fake_supabase):
        """Results are paginated with page and per_page params."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id=f"t{i}", name=f"Team {i}")
            for i in range(5)
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id=f"t{i}", star_rating=float(5 - i))
            for i in range(5)
        ]

        resp = client.get("/api/community/teams?per_page=2&page=2")
        body = resp.get_json()
        assert body["data"]["total"] == 5
        assert body["data"]["page"] == 2
        assert body["data"]["per_page"] == 2
        assert len(body["data"]["teams"]) == 2

    def test_sort_by_date(self, client, fake_supabase):
        """Teams can be sorted by creation date."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", name="Old"),
            _make_saved_team(team_id="t2", name="New"),
        ]
        # Override created_at to control sort order
        fake_supabase.rows["saved_teams"][0]["created_at"] = "2026-05-01T00:00:00Z"
        fake_supabase.rows["saved_teams"][1]["created_at"] = "2026-05-13T00:00:00Z"
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
            _make_evaluation(saved_team_id="t2"),
        ]

        resp = client.get("/api/community/teams?sort=date")
        body = resp.get_json()
        assert body["data"]["teams"][0]["name"] == "New"
        assert body["data"]["teams"][1]["name"] == "Old"

    def test_empty_results(self, client, fake_supabase):
        """Returns empty list when no public teams exist."""
        resp = client.get("/api/community/teams")
        body = resp.get_json()
        assert body["success"] is True
        assert body["data"]["teams"] == []
        assert body["data"]["total"] == 0

    def test_cornerstone_name_resolved(self, client, fake_supabase):
        """Team entries include the resolved cornerstone legend name."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", cornerstone_legend_id=LEGEND_ID_JORDAN),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        assert body["data"]["teams"][0]["cornerstone_name"] == "Michael Jordan"

    def test_null_cornerstone_shows_dash(self, client, fake_supabase):
        """Teams without a cornerstone show '-' for the name."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1", cornerstone_legend_id=None),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        assert body["data"]["teams"][0]["cornerstone_name"] == "-"

    def test_per_page_capped_at_max(self, client, fake_supabase):
        """per_page is silently clamped to MAX_PER_PAGE (50)."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]

        resp = client.get("/api/community/teams?per_page=1000")
        body = resp.get_json()
        assert body["data"]["per_page"] == 50

    def test_invalid_team_size_returns_400(self, client, fake_supabase):
        """Non-integer team_size returns 400, not 500."""
        resp = client.get("/api/community/teams?team_size=abc")
        assert resp.status_code == 400
        body = resp.get_json()
        assert body["success"] is False
        assert "team_size" in body["error"]

    def test_invalid_page_returns_400(self, client, fake_supabase):
        """Non-integer page returns 400."""
        resp = client.get("/api/community/teams?page=xyz")
        assert resp.status_code == 400
        body = resp.get_json()
        assert "page" in body["error"]

    def test_invalid_per_page_returns_400(self, client, fake_supabase):
        """Non-integer per_page returns 400."""
        resp = client.get("/api/community/teams?per_page=notanumber")
        assert resp.status_code == 400
        body = resp.get_json()
        assert "per_page" in body["error"]

    def test_invalid_sort_returns_400(self, client, fake_supabase):
        """Unknown sort value returns 400."""
        resp = client.get("/api/community/teams?sort=name")
        assert resp.status_code == 400
        body = resp.get_json()
        assert "sort" in body["error"]

    def test_multiple_evals_uses_latest(self, client, fake_supabase):
        """When a team has multiple evaluations, the most recent one wins."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            {
                "id": "eval-old",
                "saved_team_id": "t1",
                "star_rating": 2.0,
                "starting_lineup_score": 60.0,
                "created_at": "2026-05-01T00:00:00Z",
            },
            {
                "id": "eval-new",
                "saved_team_id": "t1",
                "star_rating": 4.5,
                "starting_lineup_score": 90.0,
                "created_at": "2026-05-13T00:00:00Z",
            },
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        team = body["data"]["teams"][0]
        # Fake now sorts by created_at desc, so the newer eval (4.5) wins
        assert team["star_rating"] == 4.5

    def test_includes_player_snapshots(self, client, fake_supabase):
        """Teams include player snapshot data with names and positions."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]
        fake_supabase.rows["saved_team_players"] = [
            _make_saved_team_player(
                saved_team_id="t1", slot=1, is_cornerstone=True,
                player_name_snapshot="Hakeem Olajuwon", position_snapshot="C",
                legend_id=LEGEND_ID_HAKEEM,
            ),
            _make_saved_team_player(
                saved_team_id="t1", slot=2,
                player_name_snapshot="Aaron Gordon", position_snapshot="F",
                player_id="player-2",
            ),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        players = body["data"]["teams"][0]["players"]
        assert len(players) == 2
        assert players[0]["name"] == "Hakeem Olajuwon"
        assert players[0]["is_cornerstone"] is True
        assert players[0]["position"] == "C"
        assert players[1]["name"] == "Aaron Gordon"
        assert players[1]["is_cornerstone"] is False

    def test_resolves_nba_api_id_from_players_table(self, client, fake_supabase):
        """nba_api_id is resolved from the players table for non-legend players."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]
        fake_supabase.rows["saved_team_players"] = [
            _make_saved_team_player(
                saved_team_id="t1", slot=1,
                player_name_snapshot="Test Player",
                player_id="player-1",
            ),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        player = body["data"]["teams"][0]["players"][0]
        assert player["nba_api_id"] == 201935

    def test_resolves_nba_api_id_from_legends_table(self, client, fake_supabase):
        """nba_api_id is resolved from the legends table for legend players."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]
        fake_supabase.rows["saved_team_players"] = [
            _make_saved_team_player(
                saved_team_id="t1", slot=1, is_cornerstone=True,
                player_name_snapshot="Hakeem Olajuwon",
                legend_id=LEGEND_ID_HAKEEM,
            ),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        player = body["data"]["teams"][0]["players"][0]
        assert player["nba_api_id"] == 165

    def test_empty_players_when_no_slots(self, client, fake_supabase):
        """Teams with no saved_team_players return empty players array."""
        fake_supabase.rows["saved_teams"] = [
            _make_saved_team(team_id="t1"),
        ]
        fake_supabase.rows["saved_team_evaluations"] = [
            _make_evaluation(saved_team_id="t1"),
        ]

        resp = client.get("/api/community/teams")
        body = resp.get_json()
        assert body["data"]["teams"][0]["players"] == []
