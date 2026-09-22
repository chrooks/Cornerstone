"""
test_legacy_skill_keys.py — the #152 alias shim (M3.5) and the legacy fill on
the Lab's released reads (M3.5a).

Parity is the acceptance bar for the Perimeter Disruptor split: a pre-split
release, a Legend profile and a saved team must score exactly as they did
before the split. Old rows carry `perimeter_disruptor`; the code now reads
`point_of_attack_defender`. These tests pin both directions of that alias and
pin that the retired key never reaches the Lab's reads.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app import create_app
from services.cohesion_engine.composites import compute_raw_composites
from services.skills import (
    ALL_SKILLS,
    SKILL_DEFINITIONS,
    SKILL_LABELS,
    with_legacy_skill_keys,
)
from services.snapshot_versions import released_repo

ACTIVE_RELEASE_ID = "aaaaaaaa-0000-0000-0000-000000000001"
PLAYER_ID = "bbbbbbbb-0000-0000-0000-000000000001"
SEASON = "2025-26"


# ---------------------------------------------------------------------------
# M3.2 — the split taxonomy
# ---------------------------------------------------------------------------


class TestSplitTaxonomy:
    def test_the_retired_key_is_gone_from_the_taxonomy(self):
        assert "perimeter_disruptor" not in ALL_SKILLS
        assert "perimeter_disruptor" not in SKILL_DEFINITIONS
        assert "perimeter_disruptor" not in SKILL_LABELS

    def test_both_split_keys_are_in_the_taxonomy(self):
        assert "point_of_attack_defender" in ALL_SKILLS
        assert "off_ball_disruptor" in ALL_SKILLS

    def test_every_skill_has_a_label(self):
        """The archetype why-lines (M7.5) read SKILL_LABELS by key."""
        assert set(SKILL_LABELS) == set(ALL_SKILLS)

    def test_every_skill_has_a_definition(self):
        """Claude prompts index SKILL_DEFINITIONS by key — a gap is a KeyError."""
        assert set(SKILL_DEFINITIONS) == set(ALL_SKILLS)


# ---------------------------------------------------------------------------
# M3.5 — the alias shim itself
# ---------------------------------------------------------------------------


class TestWithLegacySkillKeys:
    def test_old_key_only_fills_the_on_ball_key(self):
        out = with_legacy_skill_keys({"perimeter_disruptor": "Elite"})

        assert out["point_of_attack_defender"] == "Elite"
        assert out["perimeter_disruptor"] == "Elite"

    def test_new_key_only_fills_the_legacy_key(self):
        out = with_legacy_skill_keys({"point_of_attack_defender": "Proficient"})

        assert out["perimeter_disruptor"] == "Proficient"
        assert out["point_of_attack_defender"] == "Proficient"

    def test_both_keys_present_keeps_each_value(self):
        out = with_legacy_skill_keys({
            "perimeter_disruptor": "Capable",
            "point_of_attack_defender": "Elite",
        })

        assert out["perimeter_disruptor"] == "Capable"
        assert out["point_of_attack_defender"] == "Elite"

    def test_neither_key_present_is_unchanged(self):
        skills = {"versatile_defender": "Capable", "rim_protector": "None"}

        assert with_legacy_skill_keys(skills) == skills

    def test_returns_a_copy_and_never_mutates_the_caller(self):
        skills = {"perimeter_disruptor": "Elite"}

        out = with_legacy_skill_keys(skills)
        out["rim_protector"] = "Elite"

        assert skills == {"perimeter_disruptor": "Elite"}

    def test_an_entry_dict_is_carried_by_reference_not_copied_wrong(self):
        """Composite profiles hold entry dicts, not bare tiers — both ends of
        the alias must be the same entry."""
        entry = {"final_tier": "Elite", "source": "resolved"}

        out = with_legacy_skill_keys({"perimeter_disruptor": entry})

        assert out["point_of_attack_defender"] == entry

    def test_a_present_but_unrated_old_key_stays_unrated(self):
        out = with_legacy_skill_keys({"perimeter_disruptor": None})

        assert out["point_of_attack_defender"] is None

    def test_an_empty_profile_is_empty(self):
        assert with_legacy_skill_keys({}) == {}


# ---------------------------------------------------------------------------
# M3.5 — an old-key profile scores exactly like its new-key twin
# ---------------------------------------------------------------------------


def _bootstrap_values() -> dict:
    seed_path = (
        Path(__file__).resolve().parents[2]
        / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    )
    with open(seed_path) as f:
        return json.load(f)["payload"]["values"]


VALUES = _bootstrap_values()


class TestOldKeyProfileParity:
    """The acceptance bar: a pre-split profile must score identically."""

    @pytest.mark.parametrize("tier", ["Elite", "Proficient", "Capable", "None"])
    def test_old_key_profile_scores_like_the_new_key_profile(self, tier):
        old = with_legacy_skill_keys({
            "perimeter_disruptor": tier, "versatile_defender": "Capable",
        })
        new = with_legacy_skill_keys({
            "point_of_attack_defender": tier, "versatile_defender": "Capable",
        })

        assert (
            compute_raw_composites(old, VALUES)["perimeter_defense"]
            == compute_raw_composites(new, VALUES)["perimeter_defense"]
        )

    def test_the_parity_score_is_not_trivially_zero(self):
        skills = with_legacy_skill_keys({
            "perimeter_disruptor": "Elite", "versatile_defender": "Capable",
        })

        assert compute_raw_composites(skills, VALUES)["perimeter_defense"] > 0


# ---------------------------------------------------------------------------
# M3.5a — the Lab's released reads
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._eq: dict[str, object] = {}
        self._in: dict[str, list] = {}

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self._eq[key] = value
        return self

    def in_(self, key, values):
        self._in[key] = list(values)
        return self

    def limit(self, _value):
        return self

    def execute(self):
        rows = [
            r for r in self._rows
            if all(r.get(k) == v for k, v in self._eq.items())
            and all(r.get(k) in vals for k, vals in self._in.items())
        ]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str):
        return _FakeQuery(self._tables.get(name, []))


def _released_row(profile: dict, **extra) -> dict:
    return {
        "source_player_id": PLAYER_ID,
        "snapshot_release_id": ACTIVE_RELEASE_ID,
        "is_legend": False,
        "skill_profile_snapshot": profile,
        **extra,
    }


class TestReleasedPlayerReads:
    def test_a_pre_split_row_reads_back_under_the_on_ball_key(self):
        db = _FakeSupabase({"released_players": [
            _released_row({"perimeter_disruptor": {"final_tier": "Elite"}}),
        ]})

        out = released_repo.fetch_profiles_by_source_player_ids(
            [PLAYER_ID], ACTIVE_RELEASE_ID, client=db,
        )

        assert out[PLAYER_ID]["point_of_attack_defender"] == {"final_tier": "Elite"}
        assert "perimeter_disruptor" not in out[PLAYER_ID]

    def test_a_post_split_row_is_unchanged(self):
        profile = {
            "point_of_attack_defender": {"final_tier": "Proficient"},
            "off_ball_disruptor": {"final_tier": "Capable"},
        }
        db = _FakeSupabase({"released_players": [_released_row(profile)]})

        out = released_repo.fetch_profiles_by_source_player_ids(
            [PLAYER_ID], ACTIVE_RELEASE_ID, client=db,
        )

        assert out[PLAYER_ID] == profile

    def test_a_post_split_row_keeps_its_own_on_ball_tier(self):
        """A row holding both keys must never let the retired one win."""
        db = _FakeSupabase({"released_players": [_released_row({
            "perimeter_disruptor": {"final_tier": "None"},
            "point_of_attack_defender": {"final_tier": "Elite"},
        })]})

        out = released_repo.fetch_profiles_by_source_player_ids(
            [PLAYER_ID], ACTIVE_RELEASE_ID, client=db,
        )

        assert out[PLAYER_ID]["point_of_attack_defender"] == {"final_tier": "Elite"}
        assert "perimeter_disruptor" not in out[PLAYER_ID]


class TestReleasedLegendReads:
    def test_a_pre_split_legend_reads_back_under_the_on_ball_key(self):
        """Legend snapshots hold bare tier strings, not entry dicts."""
        db = _FakeSupabase({
            "released_players": [{
                "canonical_player_id": "cp-1",
                "snapshot_release_id": ACTIVE_RELEASE_ID,
                "is_legend": True,
                "skill_profile_snapshot": {"perimeter_disruptor": "All-Time Great"},
            }],
            "canonical_players": [{"id": "cp-1", "nba_api_id": 893}],
        })

        out = released_repo.fetch_legend_profiles_by_nba_api_ids(
            [893], ACTIVE_RELEASE_ID, client=db,
        )

        assert out["893"]["point_of_attack_defender"] == "All-Time Great"
        assert "perimeter_disruptor" not in out["893"]


# ---------------------------------------------------------------------------
# M3.5a — the Profile endpoint
# ---------------------------------------------------------------------------


def _player_row() -> dict:
    return {
        "id": PLAYER_ID,
        "name": "Pre-Split Player",
        "team": "LAL",
        "position": "SF",
        "age": 28,
        "games_played": 70,
        "minutes_per_game": 34.0,
        "salary": 10_000_000,
        "height": 79,
        "weight": 220,
        "season": SEASON,
        "nba_api_id": 1234567,
        "manually_included": False,
    }


def _profile_supabase(released_rows: list[dict]) -> MagicMock:
    supabase = MagicMock()

    def table_side_effect(name: str):
        q = MagicMock()
        for method in ("select", "eq", "in_", "or_", "order", "limit", "single"):
            getattr(q, method).return_value = q
        if name == "players":
            q.execute.return_value = _FakeResult([_player_row()])
        elif name == "released_players":
            q.execute.return_value = _FakeResult(released_rows)
        else:
            q.execute.return_value = _FakeResult([])
        return q

    supabase.table.side_effect = table_side_effect
    return supabase


@pytest.fixture()
def app():
    flask_app = create_app()
    flask_app.config["TESTING"] = True
    return flask_app


def test_profile_endpoint_serves_a_pre_split_tier_under_the_on_ball_key(app):
    supabase = _profile_supabase([{
        "source_player_id": PLAYER_ID,
        "skill_profile_snapshot": {"perimeter_disruptor": {"final_tier": "Elite"}},
    }])

    with (
        patch("api.players.get_supabase", return_value=supabase),
        patch("api.players.get_active_release_id", return_value=ACTIVE_RELEASE_ID),
    ):
        with app.test_client() as client:
            resp = client.get(
                f"/api/players/{PLAYER_ID}/profile", query_string={"season": SEASON},
            )

    assert resp.status_code == 200, resp.get_json()
    skills = resp.get_json()["data"]["skills"]
    assert skills["point_of_attack_defender"] == {"final_tier": "Elite"}
    assert "perimeter_disruptor" not in skills


# ---------------------------------------------------------------------------
# M3.5a (review) — the reads the first pass missed
#
# Three Lab reads served a released snapshot without the alias: the frozen
# skill trace, the saved-team rebuild report, and the attribution ledger's
# driving-skill labels. None of them moves a score, but each puts the retired
# key (or a hole where the carried tier should be) on a Surface.
# ---------------------------------------------------------------------------


def _trace_row(trace: dict | None) -> dict:
    return {
        "source_player_id": PLAYER_ID,
        "snapshot_release_id": ACTIVE_RELEASE_ID,
        "is_legend": False,
        "skill_trace_snapshot": trace,
    }


class TestReleasedSkillTraceReads:
    """A frozen trace is keyed by ALL_SKILLS at publish time, so a pre-split
    release holds the retired key and no on-ball entry. Without the alias the
    Profile's "why" panel opens empty for every released player."""

    def test_a_pre_split_trace_reads_back_under_the_on_ball_key(self):
        db = _FakeSupabase({"released_players": [_trace_row({
            "computed": True,
            "skills": {"perimeter_disruptor": {"condition_results": [], "override": None}},
        })]})

        out = released_repo.fetch_skill_trace_by_source_player_id(
            PLAYER_ID, ACTIVE_RELEASE_ID, client=db,
        )

        assert out["skills"]["point_of_attack_defender"] == {
            "condition_results": [], "override": None,
        }
        assert "perimeter_disruptor" not in out["skills"]
        assert out["computed"] is True

    def test_a_post_split_trace_is_unchanged(self):
        skills = {
            "point_of_attack_defender": {"condition_results": [], "override": None},
            "off_ball_disruptor": {"condition_results": [], "override": None},
        }
        db = _FakeSupabase({"released_players": [_trace_row({"computed": True, "skills": skills})]})

        out = released_repo.fetch_skill_trace_by_source_player_id(
            PLAYER_ID, ACTIVE_RELEASE_ID, client=db,
        )

        assert out["skills"] == skills

    def test_a_trace_with_no_skills_map_survives(self):
        db = _FakeSupabase({"released_players": [_trace_row({"computed": False})]})

        out = released_repo.fetch_skill_trace_by_source_player_id(
            PLAYER_ID, ACTIVE_RELEASE_ID, client=db,
        )

        assert out == {"computed": False, "skills": {}}

    def test_no_row_still_returns_none(self):
        db = _FakeSupabase({"released_players": []})

        assert released_repo.fetch_skill_trace_by_source_player_id(
            PLAYER_ID, ACTIVE_RELEASE_ID, client=db,
        ) is None


class TestSavedTeamRebuildReads:
    """ADR-0002 rebuild diffs the saved snapshot against the current release by
    key. Both sides must speak the current taxonomy, or a rename reads as a
    Skill change on a team the user built."""

    def _saved_player(self, profile: dict) -> dict:
        return {
            "slot": 1,
            "player_name_snapshot": "OG Anunoby",
            "salary_snapshot": 39,
            "skill_profile_snapshot": profile,
            "canonical_player_id": "cccccccc-0000-0000-0000-000000000001",
        }

    def _released(self, profile: dict) -> dict:
        return {
            "snapshot_release_id": ACTIVE_RELEASE_ID,
            "canonical_player_id": "cccccccc-0000-0000-0000-000000000001",
            "source_player_id": PLAYER_ID,
            "name": "OG Anunoby",
            "team": "TOR",
            "position": "SF",
            "salary": 39,
            "skill_profile_snapshot": profile,
        }

    def test_both_sides_of_the_diff_speak_the_current_taxonomy(self):
        from api.saved_teams import _resolve_players_for_rebuild

        db = _FakeSupabase({"released_players": [
            self._released({"perimeter_disruptor": {"final_tier": "Elite"}}),
        ]})

        reports = _resolve_players_for_rebuild(
            db,
            [self._saved_player({"perimeter_disruptor": {"final_tier": "Elite"}})],
            ACTIVE_RELEASE_ID,
        )

        saved = reports[0]["saved"]["skill_profile_snapshot"]
        current = reports[0]["current"]["skill_profile_snapshot"]
        assert saved.keys() == current.keys()
        assert "perimeter_disruptor" not in saved
        assert "perimeter_disruptor" not in current
        assert saved["point_of_attack_defender"] == {"final_tier": "Elite"}

    def test_a_legend_supporting_player_snapshot_is_aliased_too(self):
        from api.saved_teams import _resolve_players_for_rebuild

        db = _FakeSupabase({"legends": [
            {"id": "legend-1", "name": "Scottie Pippen", "is_active": True},
        ]})
        player = {
            "slot": 2,
            "player_name_snapshot": "Scottie Pippen",
            "salary_snapshot": 20,
            "skill_profile_snapshot": {"perimeter_disruptor": "Elite"},
            "legend_id": "legend-1",
        }

        reports = _resolve_players_for_rebuild(db, [player], ACTIVE_RELEASE_ID)

        saved = reports[0]["saved"]["skill_profile_snapshot"]
        assert "perimeter_disruptor" not in saved
        assert saved["point_of_attack_defender"] == "Elite"


class TestAttributionDrivingSkills:
    """/api/builder/evaluate takes Skills from the client, so a stale tab can
    still post the retired key. The score is shimmed; the ledger's labels were
    not, and the on-ball line vanished from the explanation."""

    def test_a_client_posted_legacy_key_still_names_the_on_ball_skill(self):
        from services.cohesion_engine import attribution
        from services.cohesion_engine.weights import TIER_VALUES

        player = {"skills": {"perimeter_disruptor": "Elite", "versatile_defender": "Capable"}}

        driving = attribution._driving_skills(
            player, "perimeter_defense", {"tier_values": TIER_VALUES},
        )

        assert driving[0] == "point_of_attack_defender"
