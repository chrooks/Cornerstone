"""
Unit tests for Phase 2 player composite computation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.cohesion_engine import composites
from backend.services.cohesion_engine.types import PlayerComposites
from backend.services.snapshot_versions import distribution_cache


def _bootstrap_values() -> dict:
    seed_path = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "data" / "evaluation_version_v1_seed.json"
    with open(seed_path) as f:
        data = json.load(f)
    return data["payload"]["values"]


VALUES = _bootstrap_values()


@pytest.fixture(autouse=True)
def clear_distribution_cache():
    """Each test starts in theoretical-max fallback mode unless it opts in.

    Uses force_clear_distributions: the public clear_distributions() is gated
    by the draft-pin guard, which queries the live DB — test isolation must not
    depend on whether a Snapshot draft happens to be open in production.
    """
    distribution_cache.force_clear_distributions()
    yield
    distribution_cache.force_clear_distributions()


def sample_skills() -> dict[str, str]:
    return {
        "movement_shooter": "Elite",
        "spot_up_shooter": "Proficient",
        "off_dribble_shooter": "Capable",
        "high_flyer": "Capable",
        "crafty_finisher": "Elite",
        "rebounder": "Proficient",
        "offensive_rebounder": "Capable",
        "driver": "Elite",
        "vertical_spacer": "Proficient",
        "low_post_player": "Capable",
        "mid_post_player": "Elite",
        "rim_protector": "Elite",
        "perimeter_disruptor": "Proficient",
        "versatile_defender": "Capable",
        "screen_setter": "Capable",
        "pnr_finisher": "Proficient",
        "passer": "All-Time Great",
        "cutter": "Proficient",
        "transition_threat": "Elite",
        "pnr_ball_handler": "Capable",
        "isolation_scorer": "Proficient",
    }


def test_compute_raw_composites_matches_validated_formula_order():
    raw = composites.compute_raw_composites(sample_skills(), VALUES)

    assert raw["spacing"] == pytest.approx(12.5)
    assert raw["finishing"] == pytest.approx(9.0)
    assert raw["defensive_rebounding"] == pytest.approx(4.0)
    assert raw["offensive_rebounding"] == pytest.approx(1.0)
    # paint_touch: floor changed 1.0→0.9, offensive_rebounder term added
    assert raw["paint_touch"] == pytest.approx(27.54)
    assert raw["post_game"] == pytest.approx(6.6)
    assert raw["pnr_screener"] == pytest.approx(9.8)
    # transition: passer_mult dropped; flat additive transition_passer + transition_off_dribble added
    assert raw["transition"] == pytest.approx(11.9)
    assert raw["perimeter_defense"] == pytest.approx(4.7)
    assert raw["interior_defense"] == pytest.approx(9.45)
    assert raw["off_ball_impact"] == pytest.approx(24.18)
    # shot_creation: iso now explicit, paint_touch changed
    assert raw["shot_creation"] == pytest.approx(35.26)
    # ball_security: expanded to 3 skills (passer=ATG gives same value since no pnr/driver)
    assert raw["ball_security"] == pytest.approx(16.0)


def test_compute_raw_composites_accepts_numeric_synergy_values():
    raw = composites.compute_raw_composites(
        {
            "movement_shooter": 7.0,
            "spot_up_shooter": "Proficient",
            "off_dribble_shooter": "None",
        },
        VALUES,
    )

    assert raw["spacing"] == pytest.approx(11.0)


def test_normalize_composites_uses_theoretical_max_when_cache_empty():
    normalized = composites.normalize_composites(
        {
            "spacing": 12.5,
            "finishing": 10.0,
            "paint_touch": 42.9,
            "post_game": 8.5,
            "pnr_screener": 25.0,
            "off_ball_impact": 30.5,
            "shot_creation": 30.0,
            "ball_security": 5.0,
            "defensive_rebounding": 5.0,
            "offensive_rebounding": 5.0,
            "transition": 21.0,
            "perimeter_defense": 8.5,
            "interior_defense": 9.0,
        },
        VALUES,
    )

    assert normalized == {
        "spacing": 3.1,
        "finishing": 3.1,
        "paint_touch": 2.3,
        "post_game": 3.1,
        "pnr_screener": 2.3,
        "off_ball_impact": 3.0,
        "shot_creation": 1.9,
        "ball_security": 3.1,
        "defensive_rebounding": 3.1,
        "offensive_rebounding": 3.1,
        "transition": 2.4,
        "perimeter_defense": 3.1,
        "interior_defense": 3.6,
    }


def test_percentile_normalize_uses_sixtieth_percentile_breakpoint():
    distribution = [float(value) for value in range(20)]

    assert composites._percentile_normalize(6.0, distribution, 0.6, 6.0) == 3.3
    assert composites._percentile_normalize(12.0, distribution, 0.6, 6.0) == 6.0
    assert composites._percentile_normalize(19.0, distribution, 0.6, 6.0) == 10.0


def test_percentile_normalize_scores_a_zero_by_how_common_zeros_are():
    """A raw 0 means "doesn't do this", not "worst in the NBA" (#114).

    It takes its true tie-percentile like any other value, so the score it earns
    is set by how unusual it is to be a zero on that axis. Where almost everyone
    can do the thing, a zero is damning; where most of the league can't either,
    it barely costs anything.
    """
    # 60% of the league at zero (defensive_rebounding's real shape).
    # tie-percentile = (0 below + 60/2 equal) / 100 = 0.30 -> 0.30/0.6 * 6.0 = 3.0
    common = [0.0] * 60 + [float(v) for v in range(1, 41)]
    assert composites._percentile_normalize(0.0, common, 0.6, 6.0) == 3.0

    # 4% of the league at zero (off_ball_impact's real shape).
    # tie-percentile = (0 + 4/2) / 100 = 0.02 -> 0.02/0.6 * 6.0 = 0.2
    rare = [0.0] * 4 + [float(v) for v in range(1, 97)]
    assert composites._percentile_normalize(0.0, rare, 0.6, 6.0) == 0.2


def test_percentile_normalize_keeps_a_zero_below_every_positive_value():
    """Tie-ranking a zero must not let it outrank a player who actually does the thing."""
    distribution = [0.0] * 60 + [float(v) for v in range(1, 41)]

    zero = composites._percentile_normalize(0.0, distribution, 0.6, 6.0)
    smallest_positive = composites._percentile_normalize(1.0, distribution, 0.6, 6.0)

    assert zero < smallest_positive


def test_percentile_normalize_floors_at_zero_without_a_distribution():
    """No population to rank against, and a negative raw, still bottom out at 0.0."""
    assert composites._percentile_normalize(0.0, [], 0.6, 6.0) == 0.0
    assert composites._percentile_normalize(-1.0, [0.0] * 60 + [1.0] * 40, 0.6, 6.0) == 0.0


def test_pnr_gate_reads_raw_not_normalized_when_nobody_screens():
    """No screener means no pick-and-roll — even though tie-ranking hands a
    non-screener a healthy normalized score (#114).

    This is the trap tie-ranking sets: a normalized 0.0 used to mean "absent",
    and the PnR gate relied on that. It no longer does — two thirds of the league
    never screens, so a non-screener tie-ranks around 3.3. The gate has to ask
    the raw composite, where absent is still literally 0.0.
    """
    from backend.services.cohesion_engine.cohesion import _pnr_pairing_details

    def _pc(name: str, raw: dict[str, float]) -> PlayerComposites:
        # Normalized pnr_screener is deliberately HIGH while raw is 0 — exactly
        # the state tie-ranking produces for a lineup of non-screeners.
        return PlayerComposites(
            player_id=name, name=name,
            **{key: 3.3 for key in composites.COMPOSITE_NAMES},
            bell_amplitude=1.0, bell_peak=78, bell_range_down=4, bell_range_up=4,
            bell_flat_down=1, bell_flat_up=1,
            raw=raw,
        )

    handler_only = [
        _pc("Handler", {"pnr_orchestration": 8.0, "pnr_screener": 0.0}),
        *(_pc(f"Shooter{i}", {"pnr_orchestration": 0.0, "pnr_screener": 0.0}) for i in range(4)),
    ]
    assert _pnr_pairing_details(handler_only, handler_only, VALUES)["score"] == 0.0

    # Add one real screener and the pairing scores.
    with_screener = [
        *handler_only[:4],
        _pc("Screener", {"pnr_orchestration": 0.0, "pnr_screener": 9.0}),
    ]
    assert _pnr_pairing_details(with_screener, with_screener, VALUES)["score"] > 0.0


def test_normalize_composites_uses_explicit_distributions_when_large_enough():
    distributions = {name: [float(value) for value in range(20)] for name in composites.COMPOSITE_NAMES}

    normalized = composites.normalize_composites(
        {name: 12.0 for name in composites.COMPOSITE_NAMES}, VALUES, distributions
    )

    assert all(value == 6.0 for value in normalized.values())


def test_normalize_composites_falls_back_when_distributions_too_small():
    """Below MIN_DISTRIBUTION_SIZE, the explicit distributions are ignored in
    favor of the theoretical-max fallback."""
    distributions = {name: [1.0, 2.0] for name in composites.COMPOSITE_NAMES}

    with_small = composites.normalize_composites(
        {name: 12.0 for name in composites.COMPOSITE_NAMES}, VALUES, distributions
    )
    with_none = composites.normalize_composites(
        {name: 12.0 for name in composites.COMPOSITE_NAMES}, VALUES
    )

    assert with_small == with_none


def test_compute_player_composites_returns_dataclass_with_bell_params():
    player = composites.compute_player_composites(
        sample_skills(),
        player_id="p1",
        name="Example",
        values=VALUES,
        height_inches=80,
    )

    assert isinstance(player, PlayerComposites)
    assert player.player_id == "p1"
    assert player.name == "Example"
    assert player.spacing == 3.1
    assert player.perimeter_defense == 1.7
    assert player.interior_defense == 3.8
    assert player.ball_security == 10.0
    assert player.defensive_rebounding == 2.5
    assert player.offensive_rebounding == 0.6
    assert player.bell_amplitude == 3.5
    assert player.bell_peak == 80
    assert player.bell_range_down == 7
    assert player.bell_range_up == 8


def test_compute_player_composites_populates_all_composite_names():
    player = composites.compute_player_composites(
        sample_skills(),
        player_id="p1",
        name="Example",
        values=VALUES,
        height_inches=80,
    )

    for composite_name in composites.COMPOSITE_NAMES:
        assert getattr(player, composite_name) >= 0


def test_normalize_composites_guards_zero_theoretical_max():
    """A zero theoretical_max for a composite must not crash with ZeroDivisionError."""
    import copy

    broken_values = copy.deepcopy(VALUES)
    broken_values["theoretical_max"]["spacing"] = 0

    normalized = composites.normalize_composites(
        {"spacing": 5.0, "finishing": 10.0, **{name: 1.0 for name in composites.COMPOSITE_NAMES if name not in ("spacing", "finishing")}},
        broken_values,
    )

    assert normalized["spacing"] == 0.0  # graceful fallback, not crash
    assert normalized["finishing"] > 0.0  # other composites still compute


def test_build_distributions_reads_current_and_legend_profiles(monkeypatch):
    """After M3: build_distributions reads released_players.skill_profile_snapshot,
    not draft_skill_profiles.profile. The release id is now an explicit argument
    (no internal active-release resolution) and no cache state is mutated.
    """
    FAKE_RELEASE_ID = "fake-release-id"

    class FakeResult:
        def __init__(self, data):
            self.data = data

    class FakeQuery:
        def __init__(self):
            self.filters = {}

        def select(self, _columns):
            return self

        def eq(self, key, value):
            self.filters[key] = value
            return self

        def execute(self):
            # Return skill_profile_snapshot (released_players column, not profile)
            assert self.filters.get("snapshot_release_id") == FAKE_RELEASE_ID
            if self.filters.get("is_legend") is True:
                return FakeResult(
                    [{"skill_profile_snapshot": {"movement_shooter": {"final_tier": "Capable"}}}]
                )
            return FakeResult(
                [{"skill_profile_snapshot": {"spot_up_shooter": {"final_tier": "Elite"}}}]
            )

    class FakeClient:
        def table(self, _name):
            return FakeQuery()

    monkeypatch.setattr(composites, "_get_supabase_client", lambda: FakeClient())
    monkeypatch.setattr(composites, "_run_query", lambda query: query())

    distributions = composites.build_distributions("2025-26", VALUES, FAKE_RELEASE_ID)

    assert distributions["spacing"] == [1.0, 8.0]
    assert distributions["finishing"] == [0.0, 0.0]
    assert distributions["perimeter_defense"] == [0.0, 0.0]
    assert distributions["interior_defense"] == [0.0, 0.0]
    # Pure mechanics: building does NOT swap the production cache
    assert distribution_cache.get_state().distributions == {}


class _FlippableReleaseFixture:
    """Fake DB where the active release id can flip mid-process (#61).

    release-a rows are spot_up_shooter Elite (spacing raw 8.0 each);
    release-b rows are crafty_finisher Elite (finishing raw 8.0, spacing 0.0).
    Row counts exceed MIN_DISTRIBUTION_SIZE so distributions_ready() is True
    and the cache-hit path actually engages.
    """

    ROWS = composites.MIN_DISTRIBUTION_SIZE + 5

    def __init__(self):
        self.active_release_id = "release-a"
        self.build_query_count = 0
        self._rows = {
            "release-a": [
                {"skill_profile_snapshot": {"spot_up_shooter": {"final_tier": "Elite"}}}
            ]
            * self.ROWS,
            "release-b": [
                {"skill_profile_snapshot": {"crafty_finisher": {"final_tier": "Elite"}}}
            ]
            * self.ROWS,
        }

    def install(self, monkeypatch):
        # Patch the `services.`-prefixed module instances: distribution_cache
        # imports `services.cohesion_engine.composites`, NOT this test module's
        # `backend.`-prefixed import — patching the latter would let the ensure
        # path fall through to the live DB.
        import services.cohesion_engine.composites as composites_mod
        import services.snapshot_versions.active as snapshots_active_mod

        fixture = self

        class FakeResult:
            def __init__(self, data):
                self.data = data

        class FakeQuery:
            def __init__(self):
                self.filters = {}

            def select(self, _columns):
                return self

            def eq(self, key, value):
                self.filters[key] = value
                return self

            def execute(self):
                fixture.build_query_count += 1
                if self.filters.get("is_legend") is True:
                    return FakeResult([])
                release_id = self.filters.get("snapshot_release_id")
                return FakeResult(fixture._rows.get(release_id, []))

        class FakeClient:
            def table(self, _name):
                return FakeQuery()

        monkeypatch.setattr(composites_mod, "_get_supabase_client", lambda: FakeClient())
        monkeypatch.setattr(composites_mod, "_run_query", lambda query: query())
        monkeypatch.setattr(
            snapshots_active_mod,
            "_query_active_release_id",
            lambda client=None: fixture.active_release_id,
        )


def test_ensure_distributions_rebuilds_when_active_release_flips(monkeypatch):
    """A publish/reactivate that flips the active release inside one process
    must invalidate the season-keyed cache: normalization has to come from the
    NEW release's released_players rows, not the prior cache (#61)."""
    fixture = _FlippableReleaseFixture()
    fixture.install(monkeypatch)

    # Warm from release-a
    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True
    assert distribution_cache.get_state().distributions["spacing"] == [8.0] * fixture.ROWS
    queries_after_warm = fixture.build_query_count

    # Same season, same active release: cache hit, no rebuild queries
    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True
    assert fixture.build_query_count == queries_after_warm

    # Flip the active release without a restart (publish/reactivate effect)
    fixture.active_release_id = "release-b"

    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True
    assert fixture.build_query_count > queries_after_warm
    # Distributions now reflect release-b rows (finishing-heavy, no spacing)
    state = distribution_cache.get_state()
    assert state.distributions["spacing"] == [0.0] * fixture.ROWS
    assert state.distributions["finishing"] == [8.0] * fixture.ROWS
    assert state.key == ("2025-26", "release-b")


def test_ensure_distributions_cache_hit_on_same_release(monkeypatch):
    """Sanity inverse of the flip test: while the active release is unchanged,
    repeated ensure_distributions calls never re-query the DB."""
    fixture = _FlippableReleaseFixture()
    fixture.install(monkeypatch)

    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True
    queries_after_warm = fixture.build_query_count

    for _ in range(3):
        assert distribution_cache.ensure_distributions("2025-26", VALUES) is True

    assert fixture.build_query_count == queries_after_warm


def test_reader_holding_state_is_unaffected_by_concurrent_swap(monkeypatch):
    """The TOCTOU fix: a reader that grabbed the state reference keeps a
    consistent (key, distributions) pair even when a publish/reactivate swaps
    the cache mid-evaluation. Normalization against the held state must use
    release-a's distributions, not release-b's."""
    fixture = _FlippableReleaseFixture()
    fixture.install(monkeypatch)

    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True
    reader_state = distribution_cache.get_state()
    assert reader_state.key == ("2025-26", "release-a")

    # Concurrent flip: force-clear + rewarm from release-b (publish effect)
    fixture.active_release_id = "release-b"
    distribution_cache.force_clear_distributions()
    assert distribution_cache.ensure_distributions("2025-26", VALUES) is True

    # The held reference still pairs release-a's key with release-a's rows
    assert reader_state.key == ("2025-26", "release-a")
    assert reader_state.distributions["spacing"] == [8.0] * fixture.ROWS
    # And normalization against the held state is internally consistent:
    # raw 8.0 against release-a's all-8.0 distribution sits at the median
    # (5.0); release-b's all-0.0 distribution would max it out at 10.0.
    held = composites.normalize_composites(
        {"spacing": 8.0}, VALUES, reader_state.distributions
    )
    assert held["spacing"] == 5.0
    # The production cache itself has moved on to release-b
    new_state = distribution_cache.get_state()
    assert new_state.key == ("2025-26", "release-b")
    flipped = composites.normalize_composites(
        {"spacing": 8.0}, VALUES, new_state.distributions
    )
    assert flipped["spacing"] == 10.0


def test_distribution_cache_instances_are_injectable():
    """Singleton-as-default-instance: a test-local DistributionCache works in
    isolation without touching the production module-level cache."""
    local = distribution_cache.DistributionCache()
    distributions = {
        name: [float(v) for v in range(20)] for name in composites.COMPOSITE_NAMES
    }
    local.set_distributions(distributions, key=("2025-26", "release-x"))

    assert local.ready() is True
    assert local.get_state().key == ("2025-26", "release-x")
    # Production default cache untouched
    assert distribution_cache.get_state().distributions == {}

    local.force_clear()
    assert local.ready() is False
    assert local.get_state().distributions == {}
