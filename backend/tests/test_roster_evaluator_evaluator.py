"""
tests/test_roster_evaluator_evaluator.py — Phase 4 evaluator tests.

Covers evaluate_roster() orchestration:
  - normalize_player fills gaps
  - compute_player_traces returns expected keys
  - live mode caps notes at 7
  - final mode includes strength notes (no cap)
  - debug=False omits traces
  - debug=True populates traces
  - notes sorted by severity (critical → warning → tip → strength)

Helper: p(name, skills, height=None) → player dict
"""

import pytest
from services.roster_evaluator.evaluator import (
    evaluate_roster,
    normalize_player,
    compute_player_traces,
)
from services.roster_evaluator.types import Note, RosterEvaluation


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def p(name: str, skills: dict, height: str | None = None) -> dict:
    return {"name": name, "height": height, "skills": skills}


def minimal_player(name: str) -> dict:
    """Player with no skills — triggers all critical/warning rules."""
    return p(name, {})


def elite_player(name: str) -> dict:
    """Player with strong all-around skills — suppresses most negative rules."""
    return p(name, {
        "off_dribble_shooter":   "Elite",
        "spot_up_shooter":       "Elite",
        "movement_shooter":      "Elite",
        "passer":                "Elite",
        "perimeter_disruptor":   "Elite",
        "versatile_defender":    "Elite",
        "rim_protector":         "Elite",
        "driver":                "Elite",
        "pnr_ball_handler":      "Elite",
        "pnr_finisher":          "Elite",
        "screen_setter":         "Elite",
        "cutter":                "Elite",
        "vertical_spacer":       "Elite",
        "high_flyer":            "Elite",
        "rebounder":             "Elite",
        "isolation_scorer":      "Elite",
        "low_post_player":       "Elite",
        "mid_post_player":       "Elite",
        "crafty_finisher":       "Elite",
        "transition_threat":     "Elite",
    }, height="6-7")


# ---------------------------------------------------------------------------
# normalize_player
# ---------------------------------------------------------------------------

class TestNormalizePlayer:
    def test_passes_through_valid_player(self):
        player = p("Alice", {"passer": "Elite"}, "6-2")
        result = normalize_player(player)
        assert result["name"] == "Alice"
        assert result["skills"]["passer"] == "Elite"
        assert result["height"] == "6-2"

    def test_replaces_none_skill_values_with_string_none(self):
        player = p("Bob", {"passer": None, "driver": "Capable"})
        result = normalize_player(player)
        assert result["skills"]["passer"] == "None"
        assert result["skills"]["driver"] == "Capable"

    def test_missing_skills_dict_defaults_to_empty(self):
        player = {"name": "Carol", "height": None}
        result = normalize_player(player)
        assert result["skills"] == {}

    def test_missing_height_defaults_to_none(self):
        player = {"name": "Dave", "skills": {}}
        result = normalize_player(player)
        assert result["height"] is None

    def test_does_not_mutate_original(self):
        original_skills = {"passer": None}
        player = p("Eve", original_skills)
        normalize_player(player)
        assert original_skills["passer"] is None


# ---------------------------------------------------------------------------
# compute_player_traces
# ---------------------------------------------------------------------------

class TestComputePlayerTraces:
    def test_returns_expected_trace_keys(self):
        player = normalize_player(elite_player("Alice"))
        traces = compute_player_traces(player)
        assert "size_modifier" in traces
        assert "on_ball_scoring_threat" in traces
        assert "off_ball_gravity" in traces
        assert "effective_on_ball_threat" in traces

    def test_boolean_classifiers_present(self):
        player = normalize_player(elite_player("Alice"))
        traces = compute_player_traces(player)
        assert "is_exclusively_onball" in traces
        assert "is_twoway" in traces
        assert "is_offensive_blackhole" in traces

    def test_scoretrace_values_have_score(self):
        player = normalize_player(elite_player("Alice"))
        traces = compute_player_traces(player)
        from services.roster_evaluator.types import ScoreTrace
        assert isinstance(traces["size_modifier"], ScoreTrace)
        assert isinstance(traces["on_ball_scoring_threat"], ScoreTrace)

    def test_empty_player_does_not_raise(self):
        player = normalize_player(minimal_player("Ghost"))
        traces = compute_player_traces(player)
        assert traces["on_ball_scoring_threat"].score == 0.0


# ---------------------------------------------------------------------------
# evaluate_roster — return type
# ---------------------------------------------------------------------------

class TestEvaluateRosterReturnType:
    def test_returns_roster_evaluation(self):
        roster = [minimal_player("A"), minimal_player("B")]
        result = evaluate_roster(roster)
        assert isinstance(result, RosterEvaluation)

    def test_notes_are_note_instances(self):
        roster = [minimal_player("A")]
        result = evaluate_roster(roster)
        for note in result.notes:
            assert isinstance(note, Note)


# ---------------------------------------------------------------------------
# evaluate_roster — live mode (default)
# ---------------------------------------------------------------------------

class TestEvaluateRosterLiveMode:
    def test_caps_notes_at_7(self):
        # All-minimal roster maximises rule triggers
        roster = [minimal_player(f"P{i}") for i in range(8)]
        result = evaluate_roster(roster, mode="live")
        assert len(result.notes) <= 7

    def test_debug_false_omits_traces(self):
        roster = [minimal_player("A")]
        result = evaluate_roster(roster, mode="live", debug=False)
        assert result.player_traces is None
        assert result.aggregate_traces is None

    def test_no_strength_notes_in_live_mode(self):
        # Strong roster in live mode — strength notes must not appear
        roster = [elite_player(f"P{i}") for i in range(5)]
        result = evaluate_roster(roster, mode="live")
        assert all(n.severity != "strength" for n in result.notes)


# ---------------------------------------------------------------------------
# evaluate_roster — final mode
# ---------------------------------------------------------------------------

class TestEvaluateRosterFinalMode:
    def test_final_mode_no_note_cap(self):
        # Minimal roster may produce more than 7 notes in final mode
        roster = [minimal_player(f"P{i}") for i in range(8)]
        result_live = evaluate_roster(roster, mode="live")
        result_final = evaluate_roster(roster, mode="final")
        assert len(result_final.notes) >= len(result_live.notes)

    def test_strength_notes_appear_in_final_mode(self):
        # Good roster should generate at least one strength note
        roster = [elite_player(f"P{i}") for i in range(5)]
        result = evaluate_roster(roster, mode="final")
        severities = [n.severity for n in result.notes]
        assert "strength" in severities

    def test_final_mode_debug_false_omits_traces(self):
        roster = [minimal_player("A")]
        result = evaluate_roster(roster, mode="final", debug=False)
        assert result.player_traces is None
        assert result.aggregate_traces is None


# ---------------------------------------------------------------------------
# evaluate_roster — debug mode
# ---------------------------------------------------------------------------

class TestEvaluateRosterDebug:
    def test_debug_true_populates_player_traces(self):
        roster = [p("Alice", {"passer": "Elite"}, "6-2")]
        result = evaluate_roster(roster, debug=True)
        assert result.player_traces is not None
        assert "Alice" in result.player_traces

    def test_debug_true_populates_aggregate_traces(self):
        roster = [p("Alice", {"passer": "Elite"}, "6-2")]
        result = evaluate_roster(roster, debug=True)
        assert result.aggregate_traces is not None
        assert "spacing_score" in result.aggregate_traces

    def test_debug_player_traces_keyed_by_player_name(self):
        roster = [p("Alice", {}), p("Bob", {})]
        result = evaluate_roster(roster, debug=True)
        assert "Alice" in result.player_traces
        assert "Bob" in result.player_traces


# ---------------------------------------------------------------------------
# evaluate_roster — note ordering
# ---------------------------------------------------------------------------

class TestNoteOrdering:
    def test_critical_before_warning_before_tip(self):
        roster = [minimal_player(f"P{i}") for i in range(4)]
        result = evaluate_roster(roster, mode="final")
        order = {"critical": 0, "warning": 1, "tip": 2, "strength": 3}
        severities = [order[n.severity] for n in result.notes]
        assert severities == sorted(severities)

    def test_empty_roster_produces_critical_notes(self):
        result = evaluate_roster([])
        criticals = [n for n in result.notes if n.severity == "critical"]
        assert len(criticals) > 0
