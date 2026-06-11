"""Tests for the canonical position vocabulary (services/positions.py)."""

from __future__ import annotations

import pytest

from services.positions import (
    CANONICAL_POSITIONS,
    is_canonical,
    normalize_position,
)


@pytest.mark.parametrize(
    "raw,expected",
    [
        # guard-forward folds (dashed, reversed, slashed, full word)
        ("G-F", "GF"), ("F-G", "GF"), ("G/F", "GF"), ("Guard-Forward", "GF"),
        # forward-center folds
        ("F-C", "FC"), ("C-F", "FC"), ("Forward-Center", "FC"),
        # already canonical, untouched
        ("PG", "PG"), ("G", "G"), ("SG", "SG"), ("GF", "GF"), ("SF", "SF"),
        ("F", "F"), ("PF", "PF"), ("FC", "FC"), ("C", "C"),
        # full single words
        ("Guard", "G"), ("forward", "F"), ("CENTER", "C"),
        ("Point Guard", "PG"), ("Power Forward", "PF"),
        # whitespace + case
        ("  g-f ", "GF"), ("f-c", "FC"),
    ],
)
def test_normalize_known_variants(raw, expected):
    assert normalize_position(raw) == expected


def test_normalize_none_and_empty():
    assert normalize_position(None) is None
    assert normalize_position("") is None
    assert normalize_position("   ") is None


def test_unrecognized_value_is_cleaned_not_dropped():
    # Unknown spellings survive (uppercased) so they stay visible, not silently lost.
    assert normalize_position("Wing") == "WING"


def test_all_canonical_values_are_stable():
    for pos in CANONICAL_POSITIONS:
        assert normalize_position(pos) == pos
        assert is_canonical(pos)


def test_is_canonical_rejects_raw_forms():
    assert not is_canonical("G-F")
    assert not is_canonical("Guard-Forward")
    assert not is_canonical(None)
