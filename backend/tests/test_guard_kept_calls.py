"""
test_guard_kept_calls.py — issue #177.

The #120 guard keeps a human composite entry verbatim through a recompute and
raises human_decision_contradicted when the fresh tier disagrees. A reviewer who
already resolved that exact disagreement — kept the call against the same stats
tier — must not be asked again. Any other change (a new stats tier, or a call
changed since the resolution) still flags as before.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

SEASON = "2025-26"
SKILL = "rim_protector"
HUMAN_ENTRY = {"final_tier": "Elite", "stat_tier": "Proficient", "source": "resolved"}
RECOMPUTED = {"final_tier": "Proficient", "stat_tier": "Proficient",
              "source": "stats_only", "flagged": False}


def _merge(kept_calls, stats_tier="Proficient", entry=HUMAN_ENTRY):
    """_merge_composite_for_skills for one human entry, composite_skill stubbed."""
    from services.skill_engine.evaluation_only import _merge_composite_for_skills

    with patch("services.skill_engine.evaluation_only.composite_skill", return_value=RECOMPUTED):
        merged, flags = _merge_composite_for_skills(
            {SKILL: {"tier": stats_tier, "stat_confidence": "high"}}, [SKILL],
            {SKILL: entry}, 80, "p1", SEASON, kept_calls=kept_calls,
        )
    assert merged[SKILL] == entry  # the guard keeps the entry verbatim either way
    return flags


def test_call_kept_against_the_same_stats_tier_is_not_asked_again():
    assert _merge({("p1", SKILL, "Proficient", "None", "Elite")}) == []


def test_flags_when_the_stats_tier_moved_since_the_resolution():
    flags = _merge({("p1", SKILL, "Capable", "None", "Elite")})
    assert [f.flag_reason for f in flags] == ["human_decision_contradicted:resolved:Elite"]


def test_flags_when_the_call_changed_after_the_resolution():
    # The reviewer kept Proficient against Proficient stats, then overrode it to Elite.
    flags = _merge({("p1", SKILL, "Proficient", "None", "Proficient")})
    assert len(flags) == 1


def test_flags_when_claude_changed_its_opinion_since_the_resolution():
    # Kept Elite against Proficient stats and a Claude Elite; Claude now says None.
    from services.skill_engine.evaluation_only import _merge_composite_for_skills

    entry = {**HUMAN_ENTRY, "claude_tier": "Elite"}
    with patch("services.skill_engine.evaluation_only.composite_skill", return_value=RECOMPUTED):
        _, flags = _merge_composite_for_skills(
            {"passer": {"tier": "Proficient", "stat_confidence": "moderate"}}, ["passer"],
            {"passer": entry}, 80, "p1", SEASON,
            fresh_claude={"passer": {"tier": "None", "confidence": "high", "justification": "j"}},
            kept_calls={("p1", "passer", "Proficient", "Elite", "Elite")},
        )
    assert len(flags) == 1 and flags[0].claude_tier == "None"


def test_flags_as_before_without_history():
    assert len(_merge(None)) == 1
    assert len(_merge(set())) == 1
    # Another player's or another Skill's kept call is not this one.
    assert len(_merge({("p2", SKILL, "Proficient", "None", "Elite"), ("p1", "rebounder", "Proficient", "None", "Elite")})) == 1


# ---------------------------------------------------------------------------
# evaluate_skills_for_run reads the history once and hands it to the guard
# ---------------------------------------------------------------------------


class _FakeTable:
    """Enough of the PostgREST builder for the recompute path; honors its filters."""

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._eq: dict = {}
        self._in: list[tuple] = []
        self._not = False
        self._is: list[tuple] = []

    def select(self, *_a, **_kw):
        return self

    def order(self, *_a, **_kw):
        return self

    def range(self, *_a, **_kw):
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def in_(self, col, vals):
        self._in.append((col, list(vals)))
        return self

    @property
    def not_(self):
        self._not = True
        return self

    def is_(self, col, _null):
        self._is.append((col, self._not))
        self._not = False
        return self

    def execute(self):
        rows = [r for r in self._rows
                if all(r.get(k) == v for k, v in self._eq.items())
                and all(r.get(c) in vals for c, vals in self._in)
                and all((r.get(c) is not None) == negated for c, negated in self._is)]
        return SimpleNamespace(data=rows)


class _FakeClient:
    def __init__(self, rows_by_table: dict[str, list[dict]]):
        self.rows_by_table = rows_by_table

    def table(self, name: str):
        return _FakeTable(self.rows_by_table.get(name, []))


def _flag(profile_id, stat_rating, resolved_value, resolution="manual_override", skill=SKILL,
          claude_rating=None, flag_reason="human_decision_contradicted:resolved:Elite"):
    return {"skill_profile_id": profile_id, "skill_name": skill, "stat_rating": stat_rating,
            "claude_rating": claude_rating, "resolved_value": resolved_value, "resolution": resolution,
            "flag_reason": flag_reason}


def _run(flags: list[dict]):
    from services.skill_engine.evaluation_only import evaluate_skills_for_run

    # p1 was kept against Proficient; p2 against Capable; p3 has no history.
    client = _FakeClient({
        "player_stats": [{"player_id": pid, "season": SEASON, "stats": {"x": 1},
                          "fetched_at": "2026-09-01T00:00:00"} for pid in ("p1", "p2", "p3")],
        "draft_skill_profiles": [{"id": f"cp-{pid}", "player_id": pid, "season": SEASON,
                                  "source": "composite", "profile": {SKILL: HUMAN_ENTRY}}
                                 for pid in ("p1", "p2", "p3")],
        "draft_skill_flags": flags,
    })
    fake_skills = {SKILL: {"tier": "Proficient", "stat_confidence": "high"}}
    with patch("services.skill_engine.evaluation_only.get_thresholds", return_value={}), \
         patch("services.skill_engine.evaluation_only.get_league_averages", return_value={}), \
         patch("services.skill_engine.evaluation_only.evaluate_all_skills", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.apply_auto_promotions", return_value=fake_skills), \
         patch("services.skill_engine.evaluation_only.get_notability_score", return_value=80), \
         patch("services.skill_engine.evaluation_only.composite_skill", return_value=RECOMPUTED), \
         patch("services.skill_engine.evaluation_only._get_client", return_value=client), \
         patch("services.skill_engine.evaluation_only.stage_profile_rows") as mock_stage, \
         patch("services.skill_engine.evaluation_only.stage_flag_rows") as mock_flags:
        evaluate_skills_for_run(run_id="run-177", player_ids=["p1", "p2", "p3"], season=SEASON,
                                skill_filter=[SKILL], recompute_composite=True)
    assert len(mock_stage.call_args[0][1]) == 3  # every player still staged, entries verbatim
    return sorted(f.player_id for f in mock_flags.call_args[0][1]) if mock_flags.called else []


def test_run_reads_resolved_flags_and_skips_only_the_kept_call():
    flags = [
        _flag("cp-p1", "Proficient", "Elite"),
        _flag("cp-p2", "Capable", "Elite"),
        # Open, or on another Skill: not a kept call.
        _flag("cp-p3", "Proficient", "Elite", resolution=None),
        _flag("cp-p3", "Proficient", "Elite", skill="rebounder"),
    ]
    assert _run(flags) == ["p2", "p3"]


def test_run_without_history_flags_every_contradiction():
    assert _run([]) == ["p1", "p2", "p3"]


def test_a_data_missing_resolution_is_not_a_kept_call():
    # "None" on a data_missing flag is not a stats verdict; a real None later still asks.
    flags = [_flag("cp-p1", "Proficient", "Elite", flag_reason="data_missing")]
    assert _run(flags) == ["p1", "p2", "p3"]
