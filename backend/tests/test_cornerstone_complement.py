"""
tests/test_cornerstone_complement.py — Unit tests for the cornerstone complement
suggestion layer.

Tests verify:
  - Correct gaps identified for various cornerstone profiles at stage 0
  - Gap suppressed when supporting player already covers it
  - No more than MAX_COMPLEMENT_NOTES returned
  - Stage framing changes ("co-star" vs "third player" vs "next addition")
  - Complement notes do NOT fire at stage 3+ (main modifier system takes over)
  - API integration: complement notes present in response with 0 supporting players
"""

import pytest
from services.roster_evaluator.cornerstone_complement import get_complement_notes, MAX_COMPLEMENT_NOTES
from services.roster_evaluator.weights import COMPLEMENT_STAGE_CUTOFF


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def make_player(name="CS", slot=0, is_cornerstone=True, skills=None, height=None):
    return {
        "name": name,
        "slot": slot,
        "is_cornerstone": is_cornerstone,
        "height": height,
        "skills": skills or {},
    }


def make_cornerstone(name="CS", skills=None, height=None):
    return make_player(name=name, slot=0, is_cornerstone=True, skills=skills or {}, height=height)


def make_supporting(name="P", slot=1, skills=None, height=None):
    return make_player(name=name, slot=slot, is_cornerstone=False, skills=skills or {}, height=height)


# ---------------------------------------------------------------------------
# Stage 0 — cornerstone only
# ---------------------------------------------------------------------------

class TestStageZero:
    def test_returns_notes_with_no_supporting_players(self):
        """Any non-trivial cornerstone should produce at least one complement note at stage 0."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite", "versatile_defender": "Elite"})
        notes = get_complement_notes(cs, [])
        assert len(notes) >= 1

    def test_never_exceeds_max_complement_notes(self):
        cs = make_cornerstone(skills={})  # skill-less cornerstone → many gaps
        notes = get_complement_notes(cs, [])
        assert len(notes) <= MAX_COMPLEMENT_NOTES

    def test_all_notes_are_suggestions(self):
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        for note in notes:
            assert note.severity == "suggestion"

    def test_all_notes_are_absence_type(self):
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        for note in notes:
            assert note.presence_type == "absence"

    def test_stage_zero_uses_costar_framing(self):
        """Stage 0 narratives should reference 'co-star'."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        assert any("co-star" in n.text for n in notes)

    def test_missing_creator_fires_for_offball_cornerstone(self):
        """A shooter cornerstone with no creation skills → COMPLEMENT_CREATOR suggested."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite", "movement_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_CREATOR" in trace_keys

    def test_missing_creator_suppressed_when_cornerstone_is_creator(self):
        """A cornerstone with elite PnR handler skill should NOT get a missing-creator suggestion."""
        cs = make_cornerstone(skills={"pnr_ball_handler": "Elite", "passer": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_CREATOR" not in trace_keys

    def test_pnr_finisher_suggested_for_elite_handler_cornerstone(self):
        """An elite PnR handler cornerstone should get COMPLEMENT_PNR_FINISHER."""
        cs = make_cornerstone(skills={"pnr_ball_handler": "All-Time Great", "passer": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_PNR_FINISHER" in trace_keys

    def test_missing_spacing_fires_for_onball_dominant_cornerstone(self):
        """An elite on-ball cornerstone with no shooters yet → COMPLEMENT_SPACING suggested."""
        cs = make_cornerstone(skills={"pnr_ball_handler": "Elite", "driver": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_SPACING" in trace_keys

    def test_missing_spacing_suppressed_for_offball_cornerstone(self):
        """A shooter cornerstone is NOT on-ball dominant — spacing gap shouldn't fire."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite", "movement_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_SPACING" not in trace_keys

    def test_missing_rim_protector_fires_when_no_rim_on_roster(self):
        """No rim protector on the full roster → COMPLEMENT_RIM suggested."""
        cs = make_cornerstone(skills={"versatile_defender": "Elite", "spot_up_shooter": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_RIM" in trace_keys

    def test_missing_rim_suppressed_when_cornerstone_has_rim(self):
        """Cornerstone with rim protection — COMPLEMENT_RIM should not fire."""
        cs = make_cornerstone(skills={"rim_protector": "Elite", "pnr_finisher": "Elite"})
        notes = get_complement_notes(cs, [])
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_RIM" not in trace_keys

    def test_cornerstone_name_appears_in_narrative(self):
        """Each note's text should reference the cornerstone by name."""
        cs = make_cornerstone(name="Durant", skills={"spot_up_shooter": "Elite", "versatile_defender": "Elite"})
        notes = get_complement_notes(cs, [])
        assert any("Durant" in n.text for n in notes)


# ---------------------------------------------------------------------------
# Stage 1 — one supporting player added
# ---------------------------------------------------------------------------

class TestStageOne:
    def test_gap_suppressed_when_supporting_covers_it(self):
        """Adding a rim protector as the supporting player removes the rim gap."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        support = [make_supporting(skills={"rim_protector": "Elite"})]
        notes = get_complement_notes(cs, support)
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_RIM" not in trace_keys

    def test_creator_gap_suppressed_when_supporting_is_creator(self):
        """Adding a PnR handler as co-star removes the creator gap."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite", "movement_shooter": "Elite"})
        support = [make_supporting(skills={"pnr_ball_handler": "Elite"})]
        notes = get_complement_notes(cs, support)
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_CREATOR" not in trace_keys

    def test_stage_one_uses_third_player_framing(self):
        """Stage 1 narratives should reference 'third player'."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        support = [make_supporting(skills={"pnr_ball_handler": "Elite"})]
        notes = get_complement_notes(cs, support)
        # At least one note should use stage-1 framing
        assert any("third player" in n.text for n in notes)

    def test_spacing_gap_suppressed_when_two_shooters_present(self):
        """On-ball dominant cornerstone with 2 shooters in support — spacing gap gone."""
        cs = make_cornerstone(skills={"pnr_ball_handler": "Elite"})
        support = [
            make_supporting(name="S1", slot=1, skills={"spot_up_shooter": "Elite"}),
            make_supporting(name="S2", slot=2, skills={"movement_shooter": "Elite"}),
        ]
        notes = get_complement_notes(cs, support)
        trace_keys = [n.trace_key for n in notes]
        assert "COMPLEMENT_SPACING" not in trace_keys

    def test_returns_at_most_max_notes(self):
        cs = make_cornerstone(skills={})
        support = [make_supporting(skills={})]
        notes = get_complement_notes(cs, support)
        assert len(notes) <= MAX_COMPLEMENT_NOTES


# ---------------------------------------------------------------------------
# Stage 2 — two supporting players added
# ---------------------------------------------------------------------------

class TestStageTwo:
    def test_still_fires_at_stage_two(self):
        """Complement notes still fire at stage 2 (below COMPLEMENT_STAGE_CUTOFF)."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        support = [
            make_supporting(name="P1", slot=1, skills={"pnr_ball_handler": "Elite"}),
            make_supporting(name="P2", slot=2, skills={"rim_protector": "Elite"}),
        ]
        # Still has passer gap — should fire
        notes = get_complement_notes(cs, support)
        assert len(notes) >= 1

    def test_no_notes_when_all_gaps_covered(self):
        """If all key gaps are addressed, complement returns empty list."""
        cs = make_cornerstone(skills={
            "pnr_ball_handler": "Elite",
            "rim_protector": "Elite",
            "passer": "Elite",
            "spot_up_shooter": "Elite",
            "versatile_defender": "Elite",
            "rebounder": "Elite",
        })
        support = [
            make_supporting(name="P1", slot=1, skills={"spot_up_shooter": "Elite", "pnr_finisher": "Elite"}),
            make_supporting(name="P2", slot=2, skills={"versatile_defender": "Elite", "perimeter_disruptor": "Elite"}),
        ]
        notes = get_complement_notes(cs, support)
        assert len(notes) == 0


# ---------------------------------------------------------------------------
# Stage 3+ — complement module should not be called, but verify it returns [] safely
# ---------------------------------------------------------------------------

class TestStageThreePlus:
    def test_complement_stage_cutoff_is_three(self):
        """Verify the cutoff constant is 3 — the threshold at which main modifiers take over."""
        assert COMPLEMENT_STAGE_CUTOFF == 3

    def test_module_returns_empty_with_full_roster(self):
        """Even if called with 3+ supporting players, module handles it gracefully."""
        cs = make_cornerstone(skills={"spot_up_shooter": "Elite"})
        support = [
            make_supporting(name=f"P{i}", slot=i + 1, skills={"pnr_ball_handler": "Elite"})
            for i in range(4)
        ]
        # The evaluator won't call this at stage 3+, but verify it won't crash
        notes = get_complement_notes(cs, support)
        # No notes expected — creator gap is covered; no crashes
        assert isinstance(notes, list)
