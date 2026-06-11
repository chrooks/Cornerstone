"""
services/positions.py — canonical basketball position vocabulary.

A single source of truth so positions are consistent everywhere they are
ingested, stored, diffed, and displayed. Raw values arrive in several shapes:

- nba_api returns dashed / reverse-ordered duals: "G-F", "F-G", "F-C", "C-F".
- Manual legend entry uses the clean enum: "PG", "SG", "GF", "FC", ...
- Occasional full-word outliers slip in: "Guard-Forward".

``normalize_position`` folds all of those onto the 9-value canonical enum.
"""

from __future__ import annotations

# Canonical positions, ordered guard → center. Duals are guard-first / forward-first
# (GF not FG, FC not CF).
CANONICAL_POSITIONS: tuple[str, ...] = (
    "PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C",
)

# Every known raw spelling → canonical. Keys are matched case-insensitively with
# surrounding whitespace stripped.
_ALIASES: dict[str, str] = {
    # already canonical
    "PG": "PG", "G": "G", "SG": "SG", "GF": "GF", "SF": "SF",
    "F": "F", "PF": "PF", "FC": "FC", "C": "C",
    # guard-forward duals (dashed + reversed + full word)
    "G-F": "GF", "F-G": "GF", "G/F": "GF", "F/G": "GF",
    "GUARD-FORWARD": "GF", "FORWARD-GUARD": "GF",
    # forward-center duals
    "F-C": "FC", "C-F": "FC", "F/C": "FC", "C/F": "FC",
    "FORWARD-CENTER": "FC", "CENTER-FORWARD": "FC",
    # full single words
    "GUARD": "G", "FORWARD": "F", "CENTER": "C",
    "POINT GUARD": "PG", "SHOOTING GUARD": "SG",
    "SMALL FORWARD": "SF", "POWER FORWARD": "PF",
}


def normalize_position(raw: str | None) -> str | None:
    """Fold a raw position string onto the canonical enum.

    Returns the canonical value when recognized, None for empty input, and the
    cleaned (uppercased, stripped) original for anything unrecognized — callers
    never silently lose a value, and an unmapped spelling stays visible so it can
    be added to ``_ALIASES`` rather than disappearing.
    """
    if raw is None:
        return None
    cleaned = raw.strip().upper()
    if not cleaned:
        return None
    return _ALIASES.get(cleaned, cleaned)


def is_canonical(value: str | None) -> bool:
    """True when ``value`` is already one of the canonical positions."""
    return value in CANONICAL_POSITIONS
