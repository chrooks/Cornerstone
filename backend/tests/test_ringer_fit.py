"""scripts/ringer_fit.py — the Ringer 100 fit harness (#119 plan, M4.6).

`measure()` is pure: it takes an already-priced pool and returns the #119 pass
line. These tests drive it on a synthetic pool of 15 players with the real-DB
guard on (conftest blanks the Supabase credentials), so a database import at
module level would fail the very first test.

The three cases the plan names:
  - an anchor 16 ranks off fails (15 off still passes);
  - a gated wing at 0.79 of the ladder price fails clause C;
  - a Ringer player missing from the pool is reported, never raised.
Plus the Spearman helper under ties, which is why it averages tied ranks and
takes a Pearson correlation instead of the d-squared shortcut.
"""

from __future__ import annotations

import json

import pytest

import scripts.ringer_fit as rf


# ---------------------------------------------------------------------------
# A synthetic pool of 15 players
# ---------------------------------------------------------------------------
# ids are "p01".."p15", nba_api_ids are "101".."115". Overall descends with the
# index, so our rank IS the index: p01 is rank 1, p15 is rank 15.
#
# Ringer ranks: the ten top-10 names sit on our 1-10, Dillon Brooks (gated) is
# Ringer 12 against our 15, and the three anchors carry their real Ringer ranks
# (Barnes 17, OG 21, Mobley 24) against our 11, 12 and 13.

_NAMES = [
    "Alpha One", "Bravo Two", "Charlie Three", "Delta Four", "Echo Five",
    "Foxtrot Six", "Golf Seven", "Hotel Eight", "India Nine", "Juliet Ten",
    "Scottie Barnes", "OG Anunoby", "Evan Mobley", "Kilo Fourteen", "Dillon Brooks",
]
_RINGER_RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 17, 21, 24, 40, 12]

# 14 fixed prices, high to low; Dillon Brooks (p15) always holds the lowest, so
# moving his price never reorders the ladder above him.
_OTHER_PRICES_M = [60, 55, 50, 45, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22]

PID = [f"p{i:02d}" for i in range(1, 16)]
NBA = [str(100 + i) for i in range(1, 16)]
BROOKS = PID[14]


def _pool(brooks_price_m: float, *, overalls: dict[str, float] | None = None):
    """(active_overalls, prices, ringer_rows, pid_by_nba) for the synthetic pool."""
    base_overalls = {pid: 90.0 - i for i, pid in enumerate(PID)}
    active_overalls = {**base_overalls, **(overalls or {})}
    prices = {pid: int(_OTHER_PRICES_M[i] * 1e6) for i, pid in enumerate(PID[:14])}
    prices[BROOKS] = int(round(brooks_price_m * 1e6))
    ringer_rows = [
        {"rank": _RINGER_RANKS[i], "name": _NAMES[i], "nba_api_id": NBA[i]}
        for i in range(15)
    ]
    pid_by_nba = dict(zip(NBA, PID))
    return active_overalls, prices, ringer_rows, pid_by_nba


def _measure(brooks_price_m: float = 21.5, *, overalls=None, wings=("Dillon Brooks",),
             ringer_rows=None, pid_by_nba=None):
    a, p, rows, by_nba = _pool(brooks_price_m, overalls=overalls)
    return rf.measure(
        a, p,
        ringer_rows if ringer_rows is not None else rows,
        pid_by_nba if pid_by_nba is not None else by_nba,
        wings,
    )


# ---------------------------------------------------------------------------
# The module itself must not touch a database
# ---------------------------------------------------------------------------


def test_module_imports_with_the_db_guard_on():
    """Importing the harness must not build a Supabase client.

    conftest blanks SUPABASE_URL/SUPABASE_SERVICE_KEY, so get_supabase() raises.
    A database import at module level would blow up this import.
    """
    assert callable(rf.measure)
    assert callable(rf.spearman)


# ---------------------------------------------------------------------------
# The passing baseline
# ---------------------------------------------------------------------------


def test_synthetic_baseline_passes_every_clause():
    r = _measure()

    assert r["top10_in_top15"] == 10
    assert r["top10_floor_8"] is True
    assert [a["ok"] for a in r["anchors"].values()] == [True, True, True]
    assert r["wing_ratios"]["Dillon Brooks"]["price_ratio"] == pytest.approx(21.5 / 26, abs=1e-4)
    assert r["wing_ratios"]["Dillon Brooks"]["ok"] is True
    assert r["missing"] == []
    assert r["passes"] is True


def test_our_rank_is_the_overall_order_and_anchor_bands_are_plus_minus_15():
    r = _measure()

    assert r["anchors"]["OG Anunoby"] == {
        "ringer": 21, "ours": 12, "low": 6, "high": 36, "ok": True,
    }
    assert r["anchors"]["Scottie Barnes"]["ours"] == 11
    assert r["anchors"]["Evan Mobley"]["ours"] == 13


# ---------------------------------------------------------------------------
# Case 1 — an anchor 16 ranks off fails (15 off still passes)
# ---------------------------------------------------------------------------


def test_anchor_sixteen_ranks_off_fails():
    # Lift OG (p12, Ringer 21) to our rank 5 → 16 ranks off, outside the band.
    r = _measure(overalls={PID[11]: 86.5})

    og = r["anchors"]["OG Anunoby"]
    assert og["ours"] == 5
    assert abs(og["ours"] - og["ringer"]) == 16
    assert og["ok"] is False
    assert r["passes"] is False


def test_anchor_fifteen_ranks_off_still_passes():
    # One rank lower — our rank 6 against Ringer 21 is exactly the ±15 bar.
    r = _measure(overalls={PID[11]: 85.5})

    og = r["anchors"]["OG Anunoby"]
    assert og["ours"] == 6
    assert abs(og["ours"] - og["ringer"]) == 15
    assert og["ok"] is True
    assert r["passes"] is True


# ---------------------------------------------------------------------------
# Case 2 — a gated wing at 0.79 of the ladder price fails clause C
# ---------------------------------------------------------------------------


def test_gated_wing_below_the_080_bar_fails_clause_c():
    # Brooks is Ringer 12, so his ladder price is the 12th-highest salary, $26M.
    r = _measure(0.79 * 26)

    wing = r["wing_ratios"]["Dillon Brooks"]
    assert wing["ladder_price"] == 26_000_000
    assert wing["price_ratio"] == pytest.approx(0.79, abs=1e-4)
    assert wing["ok"] is False
    assert r["passes"] is False
    # Clause C only — the other two clauses still hold.
    assert r["top10_in_top15"] == 10
    assert all(a["ok"] for a in r["anchors"].values())


def test_clause_c_bar_reads_the_unrounded_ratio():
    """0.7996 of the ladder price fails, though it displays as 0.8.

    The bar is a money gate: rounding to three places before comparing would
    let a player 0.04% under the 0.80 bar pass on a display artefact.
    """
    r = _measure(0.7996 * 26)

    wing = r["wing_ratios"]["Dillon Brooks"]
    assert wing["price_ratio"] == 0.8  # what the table prints
    assert wing["ok"] is False  # what the clause decides
    assert r["passes"] is False


def test_only_the_named_wings_are_gated():
    """An ungated player under the bar never fails the run."""
    r = _measure(0.79 * 26, wings=())

    assert r["wing_ratios"] == {}
    assert r["passes"] is True


def test_peer_ratio_is_information_only():
    """peer_ratio prints when salaries and ages are supplied; it never gates."""
    a, p, rows, by_nba = _pool(0.79 * 26)
    salary_by_id = {pid: int(_OTHER_PRICES_M[min(i, 13)] * 1e6) for i, pid in enumerate(PID)}
    age_by_id = {pid: 28 for pid in PID}

    r = rf.measure(a, p, rows, by_nba, ("Dillon Brooks",),
                   salary_by_id=salary_by_id, age_by_id=age_by_id)

    assert r["wing_ratios"]["Dillon Brooks"]["peer_ratio"] is not None
    assert r["passes"] is False  # still only price_ratio gates


# ---------------------------------------------------------------------------
# Case 3 — a missing Ringer player is reported, not raised
# ---------------------------------------------------------------------------


def test_missing_ringer_player_is_reported_not_raised():
    a, p, rows, by_nba = _pool(21.5)
    rows = rows + [{"rank": 99, "name": "Ghost Player", "nba_api_id": "999"}]

    r = rf.measure(a, p, rows, by_nba, ("Dillon Brooks",))

    assert r["missing"] == [{"rank": 99, "name": "Ghost Player", "nba_api_id": "999"}]
    assert r["passes"] is True  # a player we cannot see is reported, not a failure


def test_missing_anchor_fails_its_clause():
    """An anchor we cannot find is never silently ok."""
    a, p, rows, by_nba = _pool(21.5)
    by_nba = {k: v for k, v in by_nba.items() if v != PID[11]}  # drop OG

    r = rf.measure(a, p, rows, by_nba, ("Dillon Brooks",))

    assert r["anchors"]["OG Anunoby"]["ours"] is None
    assert r["anchors"]["OG Anunoby"]["ok"] is False
    assert [m["name"] for m in r["missing"]] == ["OG Anunoby"]
    assert r["passes"] is False


def test_report_renders_an_anchor_the_ringer_file_does_not_carry():
    """An anchor absent from ringer100.json prints FAIL; it must not crash.

    measure() already handles it (ringer/ours both None), but format_report
    formatted the None with ``:>3``, which raises. The trigger is a later
    Ringer edition that drops an anchor, or any edit to ANCHORS.
    """
    a, p, rows, by_nba = _pool(21.5)
    rows = [r for r in rows if r["name"] != "OG Anunoby"]

    r = rf.measure(a, p, rows, by_nba, ("Dillon Brooks",))

    assert r["anchors"]["OG Anunoby"]["ringer"] is None
    assert r["anchors"]["OG Anunoby"]["ok"] is False
    line = next(ln for ln in rf.format_report(r).splitlines() if "OG Anunoby" in ln)
    assert "FAIL" in line


def test_missing_gated_wing_is_reported_and_has_no_ratio():
    a, p, rows, by_nba = _pool(21.5)
    by_nba = {k: v for k, v in by_nba.items() if v != BROOKS}

    r = rf.measure(a, p, rows, by_nba, ("Dillon Brooks",))

    assert "Dillon Brooks" not in r["wing_ratios"]
    assert [m["name"] for m in r["missing"]] == ["Dillon Brooks"]


# ---------------------------------------------------------------------------
# Spearman, including ties
# ---------------------------------------------------------------------------


def test_spearman_is_one_for_a_perfect_match():
    assert rf.spearman([1, 2, 3, 4], [10, 20, 30, 40]) == pytest.approx(1.0)
    assert rf.spearman([1, 2, 3, 4], [40, 30, 20, 10]) == pytest.approx(-1.0)


def test_spearman_averages_tied_ranks():
    """Ties get the average of the ranks they span, then Pearson over the ranks.

    The d-squared shortcut is wrong here: it returns 0.90, the correct value is
    sqrt(0.9) = 0.9487.
    """
    assert rf.spearman([1, 2, 3, 4], [1, 2, 2, 4]) == pytest.approx(0.9486833, abs=1e-6)
    assert rf.spearman([1, 1, 1], [5, 6, 7]) == pytest.approx(0.0)


def test_measure_reports_spearman_and_the_holdout():
    r = _measure()

    # 15 Ringer rows found → the full-list correlation over all of them.
    assert r["spearman100"] == round(rf.spearman(_RINGER_RANKS, list(range(1, 16))), 3)
    assert r["found"] == 15
    assert r["within15"] == 14  # Kilo Fourteen: Ringer 40 against our 14
    # Holdout = everyone outside the Ringer top 10 and the three anchors.
    assert r["holdout"]["n"] == 2
    assert set(r["holdout"]["names"]) == {"Kilo Fourteen", "Dillon Brooks"}
    assert r["holdout"]["median_abs_error"] == pytest.approx((26 + 3) / 2)


# ---------------------------------------------------------------------------
# What the run says about itself
# ---------------------------------------------------------------------------


class _FakeResponse:
    """Minimal stand-in for urlopen's context manager (json.load calls read())."""

    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return json.dumps(self._payload).encode()


def test_parity_counts_only_the_players_it_compared(monkeypatch):
    """`checked` is a Signifier for "the Lab serves what I measured".

    A Ringer player the harness has no price for is compared against nothing —
    counting him would over-claim exactly when the released pool has moved.
    """
    payload = {"data": [
        {"id": "p01", "is_legend": False, "value_price": 10_000_000},
        {"id": "p02", "is_legend": False, "value_price": 9_000_000},
    ]}
    monkeypatch.setattr(
        rf.urllib.request, "urlopen", lambda *_a, **_k: _FakeResponse(payload)
    )

    parity = rf._parity_check(
        {"p01": 10_000_000},  # p02 is in the release but carries no price
        {"Priced": "p01", "No price": "p02"},
    )

    assert parity["ok"] is True
    assert parity["checked"] == 1


def test_report_names_a_release_that_does_not_exercise_the_m3_split():
    """#152's split keys are absent from a pre-split release, so the legacy
    perimeter_disruptor path runs and the split weighting is untested.

    Measured on dev 2026-09-23 (EV cohesion-v10-perimeter-split, release
    8602ece7): 0 of 437 released profiles carry either new key. Without this
    line a reproduced baseline reads as "the split is clean" when it is
    arithmetically forced to reproduce.
    """
    absent = rf.split_coverage([
        {"perimeter_disruptor": {"final_tier": "Elite"}},
        {"perimeter_disruptor": {"final_tier": "None"}},
    ])
    assert absent == {
        "total": 2,
        "counts": {"point_of_attack_defender": 0, "off_ball_disruptor": 0},
        "exercises_split": False,
    }

    present = rf.split_coverage([
        {"point_of_attack_defender": {"final_tier": "Elite"},
         "off_ball_disruptor": {"final_tier": "Capable"}},
    ])
    assert present["exercises_split"] is True

    r = _measure()
    r["split_coverage"] = absent
    text = rf.format_report(r)
    assert "does not exercise" in text
    assert "0/2" in text
    r["split_coverage"] = present
    assert "does not exercise" not in rf.format_report(r)


# ---------------------------------------------------------------------------
# The production guard (a trust boundary, not a convenience)
# ---------------------------------------------------------------------------


def test_read_only_client_refuses_the_production_project(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://abcdefgh.supabase.co")

    with pytest.raises(SystemExit) as exc:
        rf._read_only_client(allow_prod=False)

    assert "supabase.co" in str(exc.value)
