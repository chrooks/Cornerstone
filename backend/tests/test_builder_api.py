"""
tests/test_builder_api.py — Integration tests for POST /api/builder/evaluate.

Uses Flask test client. No Supabase — endpoint is pure computation.

Test shapes:
  - Valid body returns 200 + RosterEvaluation JSON with scores block
  - All 9 scores present and 0–100
  - Missing/invalid fields return 400
  - live mode caps notes at LIVE_NOTE_LIMIT
  - final mode returns strength notes and no cap
  - ABSENCE notes suppressed in live mode with < 6 supporting players
  - debug=True populates traces, debug=False does not
  - Cornerstone player (is_cornerstone=True, slot=0) does not contribute to dimension scores
"""

import json
import pytest
from app import create_app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

def minimal_supporting_player(name: str, slot: int) -> dict:
    """A minimal supporting player with no skills."""
    return {"name": name, "slot": slot, "is_cornerstone": False, "height": None, "skills": {}}


def elite_supporting_player(name: str, slot: int) -> dict:
    """A supporting player with elite skills across all dimensions."""
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": False,
        "height": "6-7",
        "skills": {
            "spot_up_shooter":    "Elite",
            "movement_shooter":   "Elite",
            "passer":             "Elite",
            "versatile_defender": "Elite",
            "rim_protector":      "Elite",
            "driver":             "Elite",
            "pnr_ball_handler":   "Elite",
            "pnr_finisher":       "Elite",
            "rebounder":          "Elite",
            "transition_threat":  "Elite",
            "vertical_spacer":    "Elite",
        },
    }


def minimal_cornerstone(name: str = "Legend") -> dict:
    """A minimal cornerstone player (slot=0, is_cornerstone=True)."""
    return {
        "name": name,
        "slot": 0,
        "is_cornerstone": True,
        "height": "6-6",
        "skills": {},
    }


def atg_cornerstone(name: str = "Legend") -> dict:
    """A cornerstone with All-Time Great skills across every dimension."""
    return {
        "name": name,
        "slot": 0,
        "is_cornerstone": True,
        "height": "6-6",
        "skills": {
            "spot_up_shooter":    "All-Time Great",
            "movement_shooter":   "All-Time Great",
            "passer":             "All-Time Great",
            "versatile_defender": "All-Time Great",
            "rim_protector":      "All-Time Great",
            "driver":             "All-Time Great",
            "pnr_ball_handler":   "All-Time Great",
            "pnr_finisher":       "All-Time Great",
            "rebounder":          "All-Time Great",
            "transition_threat":  "All-Time Great",
        },
    }


def post_evaluate(client, body: dict) -> tuple:
    resp = client.post(
        "/api/builder/evaluate",
        data=json.dumps(body),
        content_type="application/json",
    )
    return resp, resp.get_json()


# ---------------------------------------------------------------------------
# Success path — basic structure
# ---------------------------------------------------------------------------

class TestEvaluateEndpointSuccess:
    def test_returns_200_with_cornerstone_and_supporting_players(self, client):
        """Valid payload with one cornerstone + 3 supporting players returns 200."""
        players = [
            minimal_cornerstone(),
            minimal_supporting_player("Alice", 1),
            minimal_supporting_player("Bob", 2),
            minimal_supporting_player("Carol", 3),
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert resp.status_code == 200
        assert data["success"] is True

    def test_response_contains_scores_block(self, client):
        """scores block is present in the response."""
        players = [
            minimal_cornerstone(),
            minimal_supporting_player("Alice", 1),
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert "scores" in data["data"]

    def test_all_nine_scores_present(self, client):
        """All 9 dimension scores are present in the scores block."""
        players = [
            minimal_cornerstone(),
            minimal_supporting_player("Alice", 1),
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        scores = data["data"]["scores"]
        for key in ("overall", "offense", "defense", "spacing", "creation", "paint", "transition", "optionality", "robustness"):
            assert key in scores, f"Missing score key: {key}"

    def test_all_nine_scores_are_zero_to_100(self, client):
        """All 9 dimension scores are in the 0–100 range."""
        players = [
            minimal_cornerstone(),
            minimal_supporting_player("Alice", 1),
            minimal_supporting_player("Bob", 2),
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        scores = data["data"]["scores"]
        for key, val in scores.items():
            assert 0 <= val <= 100, f"Score {key}={val} out of 0–100 range"

    def test_notes_list_present(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert "notes" in data["data"]
        assert isinstance(data["data"]["notes"], list)

    def test_each_note_has_required_fields_including_presence_type(self, client):
        """Notes must include the new presence_type field."""
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "final", "debug": False})
        for note in data["data"]["notes"]:
            assert "severity" in note
            assert "category" in note
            assert "text" in note
            assert "trace_key" in note
            assert "presence_type" in note
            assert note["presence_type"] in ("presence", "absence")

    def test_debug_false_omits_traces(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert data["data"]["player_traces"] is None
        assert data["data"]["aggregate_traces"] is None

    def test_debug_true_populates_traces(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": True})
        assert data["data"]["player_traces"] is not None
        assert data["data"]["aggregate_traces"] is not None

    def test_mode_defaults_to_live_when_omitted(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players})
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# live mode behaviour
# ---------------------------------------------------------------------------

class TestLiveModeEndpoint:
    def test_live_mode_caps_notes_at_limit(self, client):
        """Live mode must return at most LIVE_NOTE_LIMIT notes."""
        from services.roster_evaluator.weights import LIVE_NOTE_LIMIT
        players = [minimal_cornerstone()] + [
            minimal_supporting_player(f"P{i}", i) for i in range(1, 8)
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert resp.status_code == 200
        assert len(data["data"]["notes"]) <= LIVE_NOTE_LIMIT

    def test_live_mode_no_strength_notes(self, client):
        """Live mode must never return strength-severity notes."""
        players = [atg_cornerstone()] + [
            elite_supporting_player(f"P{i}", i) for i in range(1, 6)
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        for note in data["data"]["notes"]:
            assert note["severity"] != "strength"

    def test_live_mode_absence_notes_suppressed_below_6_supporting(self, client):
        """ABSENCE notes are suppressed in live mode when fewer than 6 supporting players."""
        # Only 3 supporting players (below threshold of 6)
        players = [minimal_cornerstone()] + [
            minimal_supporting_player(f"P{i}", i) for i in range(1, 4)
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        assert resp.status_code == 200
        for note in data["data"]["notes"]:
            # All notes in live mode with < 6 supporting players must be presence-based
            assert note["presence_type"] == "presence", (
                f"Absence note appeared in live mode with < 6 supporting players: {note}"
            )


# ---------------------------------------------------------------------------
# final mode behaviour
# ---------------------------------------------------------------------------

class TestFinalModeEndpoint:
    def test_final_mode_returns_strength_notes_for_strong_roster(self, client):
        """Final mode with an elite roster should include strength notes."""
        players = [atg_cornerstone()] + [
            elite_supporting_player(f"P{i}", i) for i in range(1, 6)
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "final", "debug": False})
        severities = [n["severity"] for n in data["data"]["notes"]]
        assert "strength" in severities

    def test_final_mode_notes_not_capped_at_7(self, client):
        """Final mode should return more notes than live mode for the same roster."""
        players = [minimal_cornerstone()] + [
            minimal_supporting_player(f"P{i}", i) for i in range(1, 8)
        ]
        _, data_live = post_evaluate(client, {"players": players, "mode": "live", "debug": False})
        _, data_final = post_evaluate(client, {"players": players, "mode": "final", "debug": False})
        # Final should have >= notes than live (live is capped at 7)
        assert len(data_final["data"]["notes"]) >= len(data_live["data"]["notes"])

    def test_final_mode_includes_absence_notes_regardless_of_roster_size(self, client):
        """ABSENCE notes appear in final mode even with fewer than 6 supporting players."""
        # 2 supporting players — would suppress ABSENCE in live mode
        players = [minimal_cornerstone()] + [
            minimal_supporting_player(f"P{i}", i) for i in range(1, 3)
        ]
        resp, data = post_evaluate(client, {"players": players, "mode": "final", "debug": False})
        absence_notes = [n for n in data["data"]["notes"] if n["presence_type"] == "absence"]
        # There should be at least some absence notes for a minimal/incomplete roster
        assert len(absence_notes) > 0


# ---------------------------------------------------------------------------
# Cornerstone isolation — slot=0 player must NOT affect dimension scores
# ---------------------------------------------------------------------------

class TestCornerstoneIsolation:
    def test_cornerstone_skills_do_not_spike_scores(self, client):
        """
        An ATG cornerstone with all skills should NOT cause the supporting-cast
        dimension scores to change dramatically versus a minimal cornerstone,
        because the cornerstone's skills are context-only (not aggregated into
        dimension scores directly). Modifiers and hard checks may fire differently
        based on cornerstone context — this is expected and desired behavior.

        The key invariant: ATG cornerstone does NOT cause scores to be HIGHER
        than minimal cornerstone for spacing and paint (no positive contributions).
        """
        supporting = [minimal_supporting_player(f"P{i}", i) for i in range(1, 4)]

        # Roster A: ATG cornerstone (all skills)
        players_atg = [atg_cornerstone()] + supporting
        _, data_atg = post_evaluate(client, {"players": players_atg, "mode": "live", "debug": False})

        # Roster B: empty-skills cornerstone
        players_minimal = [minimal_cornerstone()] + supporting
        _, data_minimal = post_evaluate(client, {"players": players_minimal, "mode": "live", "debug": False})

        scores_atg = data_atg["data"]["scores"]
        scores_minimal = data_minimal["data"]["scores"]

        # Spacing and paint should not spike when supporting cast has no skills.
        # The ATG cornerstone has no supporting cast to amplify.
        for dim in ("spacing", "paint", "transition"):
            diff = abs(scores_atg[dim] - scores_minimal[dim])
            assert diff <= 30, (
                f"Dimension {dim}: ATG cornerstone={scores_atg[dim]}, "
                f"minimal cornerstone={scores_minimal[dim]}, diff={diff}"
            )

        # Verify both have the same raw supporting-cast contribution to spacing
        # (since no supporting player has any skills, spacing should be ~0 before modifiers)
        assert scores_atg["spacing"] == scores_minimal["spacing"], (
            "Spacing should be identical since supporting cast has no skills — "
            "cornerstone does not contribute directly to dimension scores."
        )


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

class TestEvaluateEndpointValidation:
    def test_missing_players_field_returns_400(self, client):
        resp, data = post_evaluate(client, {"mode": "live"})
        assert resp.status_code == 400

    def test_players_not_a_list_returns_400(self, client):
        resp, data = post_evaluate(client, {"players": "not-a-list", "mode": "live"})
        assert resp.status_code == 400

    def test_slot_missing_returns_400(self, client):
        """slot is now required on every player."""
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "is_cornerstone": False, "height": None, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_is_cornerstone_missing_returns_400(self, client):
        """is_cornerstone is now required on every player."""
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": 1, "height": None, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_zero_cornerstones_returns_400(self, client):
        """Exactly one player must have is_cornerstone=True."""
        resp, data = post_evaluate(client, {
            "players": [
                {"name": "Alice", "slot": 1, "is_cornerstone": False, "skills": {}},
                {"name": "Bob",   "slot": 2, "is_cornerstone": False, "skills": {}},
            ],
            "mode": "live",
        })
        assert resp.status_code == 400
        assert "exactly one player must have is_cornerstone: true" in data["error"].lower()

    def test_two_cornerstones_returns_400(self, client):
        """Exactly one player must have is_cornerstone=True."""
        resp, data = post_evaluate(client, {
            "players": [
                {"name": "Alice", "slot": 0, "is_cornerstone": True, "skills": {}},
                {"name": "Bob",   "slot": 1, "is_cornerstone": True, "skills": {}},
            ],
            "mode": "live",
        })
        assert resp.status_code == 400
        assert "exactly one player must have is_cornerstone: true" in data["error"].lower()

    def test_invalid_mode_returns_400(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "turbo"})
        assert resp.status_code == 400

    def test_player_missing_name_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"slot": 1, "is_cornerstone": False, "height": "6-2", "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_player_skills_not_dict_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": 1, "is_cornerstone": False, "skills": "bad"}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_too_many_players_returns_400(self, client):
        roster = [minimal_supporting_player(f"P{i}", i % 10) for i in range(21)]
        resp, data = post_evaluate(client, {"players": roster, "mode": "live"})
        assert resp.status_code == 400

    def test_player_name_too_long_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "A" * 101, "slot": 1, "is_cornerstone": False, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_too_many_skills_returns_400(self, client):
        skills = {f"skill_{i}": "Capable" for i in range(31)}
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": 1, "is_cornerstone": False, "skills": skills}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_non_boolean_debug_returns_400(self, client):
        players = [minimal_cornerstone(), minimal_supporting_player("Alice", 1)]
        resp, data = post_evaluate(client, {"players": players, "mode": "live", "debug": 1})
        assert resp.status_code == 400

    def test_slot_out_of_range_returns_400(self, client):
        """slot must be 0–9."""
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": 10, "is_cornerstone": False, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_slot_not_integer_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": "one", "is_cornerstone": False, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400

    def test_is_cornerstone_not_boolean_returns_400(self, client):
        resp, data = post_evaluate(client, {
            "players": [{"name": "Alice", "slot": 1, "is_cornerstone": 1, "skills": {}}],
            "mode": "live",
        })
        assert resp.status_code == 400
