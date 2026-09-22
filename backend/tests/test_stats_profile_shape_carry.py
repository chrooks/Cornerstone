"""
The stats profile has two shapes, and the low-confidence carry reads both.

`_build_stats_source_profile` (the direct compositing path) stores a bare tier
string per Skill; a staged run stores the evaluator's dict. M2.15's merge now
puts both shapes in ONE row, and `_upsert_skill_profile` carries low-confidence
entries forward from that row into `skills_result`, which every reader below it
treats as dicts.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from services.skill_engine.pipeline import _upsert_skill_profile


def _client_with_existing(profile: dict) -> MagicMock:
    client = MagicMock()
    (
        client.table.return_value.select.return_value
        .eq.return_value.eq.return_value.eq.return_value
        .maybe_single.return_value.execute.return_value
    ) = SimpleNamespace(data={"profile": profile})
    return client


def test_carrying_a_bare_tier_string_does_not_crash_the_persist():
    """A string entry has no .get(), so the review_required scan raised."""
    client = _client_with_existing({"high_flyer": "Proficient"})
    skills_result = {
        "high_flyer": {"tier": "None", "review_recommended": False},
        "passer": {"tier": "Elite", "review_recommended": False},
    }

    _upsert_skill_profile(
        "p1", "2025-26", skills_result, client,
        thresholds={"high_flyer": {"stat_confidence": "low"}},
    )

    assert skills_result["high_flyer"]["tier"] == "Proficient"


def test_carrying_a_dict_entry_keeps_it_verbatim():
    client = _client_with_existing(
        {"high_flyer": {"tier": "Proficient", "review_recommended": True}}
    )
    skills_result = {"high_flyer": {"tier": "None", "review_recommended": False}}

    _upsert_skill_profile(
        "p1", "2025-26", skills_result, client,
        thresholds={"high_flyer": {"stat_confidence": "low"}},
    )

    assert skills_result["high_flyer"] == {
        "tier": "Proficient", "review_recommended": True,
    }
