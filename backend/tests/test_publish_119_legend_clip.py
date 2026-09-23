"""publish_119_legend_clip.py builds the EV v11 legend-clip patch (#119, M4.11).

The script publishes one values key: the axes on which a Legend's raw composite
is clipped at the best active player's raw value. A typo in that list is silent
— `build_distributions` would clip nothing and the ladder would look untouched —
so the axes are checked against the engine's own COMPOSITE_NAMES here, not
against a literal copy of them.

The prod guard is the other thing worth a test: this is the one script in the
#119 plan that writes, and it must refuse the cloud project before it builds a
client.
"""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "publish_119_legend_clip.py"


def _load():
    spec = importlib.util.spec_from_file_location("publish_119_legend_clip", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def script():
    return _load()


def _payload(clip_axes=None) -> dict:
    """A payload shaped like a published EV, with or without the clip key."""
    values: dict = {"composite_names": ["spacing", "perimeter_defense", "interior_defense"]}
    if clip_axes is not None:
        values["normalization_legend_clip_axes"] = clip_axes
    return {"taxonomy": {"skills": []}, "values": values}


class TestPatch:
    def test_emits_one_add_op_carrying_the_defense_axes(self, script):
        ops = script.build_patch_ops(_payload())

        assert len(ops) == 1
        assert ops[0]["op"] == "add"
        assert ops[0]["path"] == "/values/normalization_legend_clip_axes"
        assert ops[0]["value"] == ["perimeter_defense", "interior_defense"]

    def test_axes_are_composites_the_engine_actually_builds(self, script):
        from services.cohesion_engine.weights import COMPOSITE_NAMES

        assert set(script.CLIP_AXES) <= set(COMPOSITE_NAMES)

    def test_refuses_an_axis_the_engine_has_no_distribution_for(self, script, monkeypatch):
        monkeypatch.setattr(script, "CLIP_AXES", ("perimeter_defense", "rim_protection"))
        with pytest.raises(ValueError, match="rim_protection"):
            script.build_patch_ops(_payload())

    def test_no_ops_when_the_payload_already_carries_the_axes(self, script):
        assert script.build_patch_ops(_payload(["perimeter_defense", "interior_defense"])) == []

    def test_a_different_axis_list_is_still_patched(self, script):
        ops = script.build_patch_ops(_payload(["spacing"]))
        assert ops[0]["value"] == ["perimeter_defense", "interior_defense"]

    def test_dry_run_preview_matches_the_op_it_prints(self, script):
        payload = _payload()
        ops = script.build_patch_ops(payload)
        patched = script._patched(payload)

        assert patched["values"]["normalization_legend_clip_axes"] == ops[0]["value"]
        assert patched["values"]["composite_names"] == payload["values"]["composite_names"]
        assert "normalization_legend_clip_axes" not in payload["values"]  # no mutation


class TestChangelog:
    """The changelog is frozen onto the immutable Version record at publish.

    Measured on dev 2026-09-23 (EV cohesion-v10-perimeter-split, release
    8602ece7, defense-only clip): 18 of 36 Legend `overall`s move by up to 2.40
    and 13 of 36 Legend prices shift rank. A clipped Legend does still
    normalize to 10.0 — but the clip lowers the axis's empirical_max for
    everyone, and _percentile_normalize divides by (empirical_max - p_break),
    so every Legend above the breakpoint rises, including the 33 never clipped.
    """

    def test_does_not_claim_legend_ratings_are_unchanged(self, script):
        text = script.CHANGELOG.lower()

        assert "no legend rating" not in text
        assert "empirical max" in text
        assert "18 of 36" in text

    def test_the_module_docstring_carries_the_same_correction(self, script):
        doc = (script.__doc__ or "").lower()

        assert "nothing about a legend's own rating changes" not in doc
        assert "empirical max" in doc


class TestSlug:
    def test_takes_the_planned_slug_when_it_is_free(self, script):
        assert script.next_free_slug({"cohesion-v10-perimeter-split"}) == "cohesion-v11-legend-clip"

    def test_steps_past_a_taken_slug(self, script):
        taken = {"cohesion-v11-legend-clip", "cohesion-v11-legend-clip-2"}
        assert script.next_free_slug(taken) == "cohesion-v11-legend-clip-3"


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
