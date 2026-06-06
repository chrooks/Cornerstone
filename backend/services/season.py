"""Canonical NBA season parsing and validation.

One definition of "what a valid NBA stat season looks like", shared by the
publish API boundary, the Snapshot Release validator, and any future caller.

An NBA stat season is the string ``YYYY-YY`` where the two-digit tail is the
first year + 1, modulo 100 (e.g. ``2025-26``, ``1999-00``). This is the key
``nba_api`` expects and the value the freeze + gates scope against, so the
guard is deliberately strict: it stops fat-finger errors before they can set a
draft's season to something the stat fetch and freeze cannot honor.

International play (Olympics/FIBA, e.g. a future ``2024-OLY``) is intentionally
NOT accepted here — it is not an NBA stat season. That extension is deferred
(see issue #72 and the ExecPlan Decision Log); loosening this format now would
weaken the guard with no near-term payoff. A future extension point would add a
separate validator rather than relaxing this one.
"""

from __future__ import annotations

import re

# Reusable, user-facing error string so the API boundary and the validator
# surface the same message.
SEASON_FORMAT_MESSAGE = (
    "Season must be an NBA stat season in YYYY-YY format where the two-digit "
    "tail is the first year plus one (for example 2025-26)."
)

_SEASON_RE = re.compile(r"^(\d{4})-(\d{2})$")


def validate_nba_season(season: str) -> str:
    """Return ``season`` unchanged if it is a valid NBA ``YYYY-YY`` string.

    Valid means: four-digit head, a literal hyphen, a two-digit tail, and the
    tail equals ``(head + 1) mod 100`` (so ``2025-26`` passes, ``2025-27`` and
    ``2025`` fail; ``1999-00`` passes via the century rollover).

    Raises ``ValueError`` with :data:`SEASON_FORMAT_MESSAGE` on any malformed
    input (including ``None``, empty, or surrounding whitespace).
    """
    if not isinstance(season, str):
        raise ValueError(SEASON_FORMAT_MESSAGE)

    match = _SEASON_RE.match(season)
    if not match:
        raise ValueError(SEASON_FORMAT_MESSAGE)

    head = int(match.group(1))
    tail = int(match.group(2))
    if tail != (head + 1) % 100:
        raise ValueError(SEASON_FORMAT_MESSAGE)

    return season
