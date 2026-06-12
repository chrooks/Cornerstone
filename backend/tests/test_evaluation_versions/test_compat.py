"""
Unit tests for the Evaluation Version taxonomy compat-check service.

The compat check compares a Saved Team's stored Evaluation Version taxonomy
footprint against the active Version's footprint and classifies the difference
into renamed / removed / added entries per taxonomy dimension (Skills, Impact
Traits, Subscores). Per ADR-0002 the check runs at Lab open time so the user
can resolve taxonomy drift before re-evaluating.
"""

from __future__ import annotations

from services.evaluation_versions.compat import diff_taxonomy


def _payload(*, skills=None, impact_traits=None, subscore_tree=None, values=None):
    return {
        "taxonomy": {
            "skills": skills or [],
            "impact_traits": impact_traits or [],
            "subscore_tree": subscore_tree or [],
        },
        "values": values or {},
    }


def test_identical_taxonomy_needs_no_resolution():
    skills = [{"key": "passer", "label": "Passer", "order": 0}]
    traits = [{"key": "spacing", "label": "Spacing", "order": 0}]
    tree = [
        {
            "category_key": "offense",
            "category_label": "Offense",
            "subscores": [{"key": "pnr_pairing", "label": "PnR Pairing", "order": 0}],
        }
    ]
    stored = _payload(skills=skills, impact_traits=traits, subscore_tree=tree)
    active = _payload(skills=skills, impact_traits=traits, subscore_tree=tree)

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is False


def test_summary_counts_each_dimension_change():
    stored = _payload(
        skills=[{"key": "passer", "label": "Passer", "order": 0}],
        impact_traits=[
            {"key": "spacing", "label": "Spacing", "order": 0},
            {"key": "rebounding", "label": "Rebounding", "order": 1},
        ],
    )
    active = _payload(
        skills=[
            {"key": "passer", "label": "Passer", "order": 0},
            {"key": "rim_protector", "label": "Rim Protector", "order": 1},
        ],
        impact_traits=[{"key": "spacing", "label": "Spacing", "order": 0}],
    )

    result = diff_taxonomy(stored, active)

    assert result["summary"] == {"added": 1, "removed": 1, "renamed": 0}


def test_removed_impact_trait_is_surfaced():
    stored = _payload(impact_traits=[
        {"key": "spacing", "label": "Spacing", "order": 0},
        {"key": "rebounding", "label": "Rebounding", "order": 1},
    ])
    active = _payload(impact_traits=[
        {"key": "spacing", "label": "Spacing", "order": 0},
    ])

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is True
    traits = result["impact_traits"]
    assert [r["key"] for r in traits["removed"]] == ["rebounding"]
    assert traits["added"] == []
    assert traits["renamed"] == []


def test_renamed_skill_is_surfaced_with_both_labels():
    stored = _payload(skills=[
        {"key": "pnr_ball_handler", "label": "PnR Ball Handler", "order": 0},
    ])
    active = _payload(skills=[
        {"key": "pnr_ball_handler", "label": "PnR Orchestrator", "order": 0},
    ])

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is True
    skills = result["skills"]
    assert skills["renamed"] == [
        {"key": "pnr_ball_handler", "from_label": "PnR Ball Handler", "to_label": "PnR Orchestrator"},
    ]
    assert skills["added"] == []
    assert skills["removed"] == []


def test_added_skill_is_surfaced():
    stored = _payload(skills=[{"key": "passer", "label": "Passer", "order": 0}])
    active = _payload(skills=[
        {"key": "passer", "label": "Passer", "order": 0},
        {"key": "rim_protector", "label": "Rim Protector", "order": 1},
    ])

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is True
    assert [a["key"] for a in result["skills"]["added"]] == ["rim_protector"]


def test_added_subscore_in_nested_subcategory_is_surfaced():
    stored_tree = [
        {
            "category_key": "offense",
            "category_label": "Offense",
            "subcategories": [
                {
                    "key": "quality",
                    "label": "Quality",
                    "subscores": [{"key": "spacing", "label": "Spacing", "order": 0}],
                }
            ],
        }
    ]
    active_tree = [
        {
            "category_key": "offense",
            "category_label": "Offense",
            "subcategories": [
                {
                    "key": "quality",
                    "label": "Quality",
                    "subscores": [
                        {"key": "spacing", "label": "Spacing", "order": 0},
                        {"key": "ball_security", "label": "Ball Security", "order": 1},
                    ],
                }
            ],
        }
    ]
    stored = _payload(subscore_tree=stored_tree)
    active = _payload(subscore_tree=active_tree)

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is True
    assert [a["key"] for a in result["subscores"]["added"]] == ["ball_security"]
    assert result["subscores"]["removed"] == []


def test_value_only_change_needs_no_resolution():
    traits = [{"key": "spacing", "label": "Spacing", "order": 0}]
    stored = _payload(impact_traits=traits, values={"tier_values": {"Elite": 6.0}})
    active = _payload(impact_traits=traits, values={"tier_values": {"Elite": 7.0}})

    result = diff_taxonomy(stored, active)

    assert result["needs_resolution"] is False
