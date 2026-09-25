"""publish_185_anchor_finishing.py builds the EV v12 anchor + finishing patch (#185, M2).

Four values keys move: the normalization anchor, the finishing formula's
factors, and the explicit overall weights and blend. A factor key that is not
a Skill is silent — `tier_value` reads a missing Skill as zero and the route
prices nothing — so the keys are checked against the engine's own ALL_SKILLS
here, not against a literal copy of them.

The prod guard is the other thing worth a test: this is the one script in the
#185 plan that writes, and it must refuse the cloud project before it builds a
client.
"""

import copy
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "publish_185_anchor_finishing.py"

# The live finishing formula on dev (EV cohesion-v11-legend-clip), byte-for-byte.
LIVE_FINISHING = {
    "factors": [
        {"key": "crafty_finisher", "type": "skill", "coefficient": 1.3},
        {"key": "high_flyer", "type": "skill", "coefficient": 1.0},
    ],
    "amplifiers": [],
    "depends_on": [],
}


def _load():
    spec = importlib.util.spec_from_file_location("publish_185_anchor_finishing", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def script():
    return _load()


def _payload(finishing=LIVE_FINISHING, **extra) -> dict:
    """A payload shaped like the live EV: formulas present, none of the new keys.

    `overall_params_from_values` falls back to the weights.py constants when the
    blob carries neither weights key, so composite_formulas alone is enough.
    """
    values: dict = {"composite_formulas": {"finishing": copy.deepcopy(finishing)}}
    values.update(extra)
    return {"taxonomy": {"skills": []}, "values": values}


def _patched_payload(script) -> dict:
    """A payload that already reads every target value."""
    weights, blend = script.overall_params_from_values({})
    finishing = {**LIVE_FINISHING, "factors": list(script.FINISHING_FACTORS)}
    return _payload(
        finishing,
        normalization_top_percentile=0.98,
        overall_composite_weights=dict(weights),
        overall_mean_peak_blend=blend,
    )


class TestPatch:
    def test_emits_four_ops_on_the_live_shape(self, script):
        ops = script.build_patch_ops(_payload())

        assert [(o["op"], o["path"]) for o in ops] == [
            ("add", "/values/normalization_top_percentile"),
            ("replace", "/values/composite_formulas/finishing"),
            ("add", "/values/overall_composite_weights"),
            ("add", "/values/overall_mean_peak_blend"),
        ]
        assert ops[0]["value"] == 0.98
        assert ops[1]["value"] == {**LIVE_FINISHING, "factors": list(script.FINISHING_FACTORS)}
        weights, blend = script.overall_params_from_values({})
        assert ops[2]["value"] == dict(weights)
        assert ops[3]["value"] == blend

    def test_finishing_factors_are_skills_the_engine_knows(self, script):
        from services.skills import ALL_SKILLS

        assert {f["key"] for f in script.FINISHING_FACTORS} <= set(ALL_SKILLS)
        assert [f["key"] for f in script.FINISHING_FACTORS] == [
            "crafty_finisher", "high_flyer", "vertical_spacer", "pnr_finisher",
        ]

    def test_refuses_a_factor_key_that_is_not_a_skill(self, script, monkeypatch):
        bad = [*script.FINISHING_FACTORS, {"key": "dunk_wizard", "type": "skill", "coefficient": 1.0}]
        monkeypatch.setattr(script, "FINISHING_FACTORS", bad)
        with pytest.raises(ValueError, match="dunk_wizard"):
            script.build_patch_ops(_payload())

    def test_refuses_a_payload_without_a_finishing_formula(self, script):
        payload = {"taxonomy": {"skills": []}, "values": {"composite_formulas": {}}}
        with pytest.raises(ValueError, match="finishing"):
            script.build_patch_ops(payload)

    def test_no_ops_when_the_payload_already_reads_every_target(self, script):
        assert script.build_patch_ops(_patched_payload(script)) == []

    def test_skips_only_the_anchor_when_it_already_reads_the_target(self, script):
        ops = script.build_patch_ops(_payload(normalization_top_percentile=0.98))

        assert [o["path"] for o in ops] == [
            "/values/composite_formulas/finishing",
            "/values/overall_composite_weights",
            "/values/overall_mean_peak_blend",
        ]

    def test_dry_run_preview_matches_the_ops_it_prints(self, script):
        payload = _payload()
        before = copy.deepcopy(payload)
        ops = script.build_patch_ops(payload)
        patched = script._patched(payload)

        for op in ops:
            key = op["path"].split("/")[-1]
            parent = patched["values"]
            if "composite_formulas" in op["path"]:
                parent = patched["values"]["composite_formulas"]
            assert parent[key] == op["value"]
        assert payload == before  # no mutation
        assert script.build_patch_ops(patched) == []  # applying the ops reaches the target


class TestChangelog:
    """The changelog is frozen onto the immutable Version record at publish.

    Measured on dev 2026-09-25 (EV cohesion-v11-legend-clip, release 020cbc9e).
    """

    def test_names_the_anchor_the_route_and_the_measured_moves(self, script):
        text = script.CHANGELOG

        assert "0.98" in text
        assert "Gobert" in text
        assert "133" in text
        assert "#185" in text
        assert "vertical_spacer" in text and "pnr_finisher" in text
        assert "0.730" in text


class TestSlug:
    def test_takes_the_planned_slug_when_it_is_free(self, script):
        assert script.next_free_slug({"cohesion-v11-legend-clip"}) == "cohesion-v12-anchor-finishing"

    def test_steps_past_a_taken_slug(self, script):
        taken = {"cohesion-v12-anchor-finishing", "cohesion-v12-anchor-finishing-2"}
        assert script.next_free_slug(taken) == "cohesion-v12-anchor-finishing-3"


class TestGuards:
    def test_main_refuses_a_production_url_before_it_reads_anything(self, script, monkeypatch):
        def boom():
            raise AssertionError("touched the database behind the prod guard")

        monkeypatch.setenv("SUPABASE_URL", "https://abcdefgh.supabase.co")
        monkeypatch.setattr(script.repo, "get_draft", boom)
        monkeypatch.setattr(script.repo, "get_active", boom)

        assert script.main([]) == 2

    def test_publish_is_off_by_default(self, script):
        assert script.build_parser().parse_args([]).publish is False
