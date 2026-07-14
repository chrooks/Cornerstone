"""
Value-price ladder cache (#109) — the (season, active release) flip policy for
skill-derived player prices.

This mirrors distribution_cache: it owns WHEN the price ladder is rebuilt (keyed
by (season, active snapshot_release_id), so a publish/reactivate that flips the
active release rebuilds without a Flask restart), and it holds ONE immutable
ValueLadder swapped in atomically under the GIL.

The pure rank-pair + legend-extrapolation mechanics live in
cohesion_engine.value_price. This module does the DB reads (released pool + real
salaries), computes each player's `overall` against the warm distribution cache,
and hands the numbers to build_ladder. The dependency arrow: this imports
value_price and composites/overall; they never import snapshot_versions.

The ladder is derived from RELEASED data only — it never reads the open draft.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from services.cohesion_engine import value_price
from services.cohesion_engine.composites import (
    _extract_skills,
    compute_raw_composites,
    normalize_composites,
)
from services.cohesion_engine.overall import compute_overall, overall_params_from_values
from services.cohesion_engine.value_price import ValueLadder

logger = logging.getLogger(__name__)

_PAGE = 1000  # PostgREST silently caps a read at 1000 rows — paginate past it.


@dataclass(frozen=True)
class LadderState:
    """Immutable snapshot: the (season, release) key plus the resolved ladder."""

    key: tuple[str, str | None] | None = None
    ladder: ValueLadder = ValueLadder(active_prices={}, legend_prices={})

    def ready(self) -> bool:
        return bool(self.ladder.active_prices)


_EMPTY_STATE = LadderState()


def _paginate(build_query):
    """Yield every row for a query, 1000 at a time (silent-cap safe)."""
    start = 0
    while True:
        rows = build_query().range(start, start + _PAGE - 1).execute().data or []
        yield from rows
        if len(rows) < _PAGE:
            break
        start += _PAGE


def _overall_for(profile: dict | None, values: dict, distributions, weights, blend) -> float:
    """Skill profile → league-percentile composites → one 0-100 `overall`."""
    skills = _extract_skills(profile or {})
    raw = compute_raw_composites(skills, values)
    normalized = normalize_composites(raw, values, distributions)
    return compute_overall(normalized, weights, blend)


def build_ladder_from_release(
    season: str, values: dict[str, Any], release_id: str, distributions
) -> ValueLadder:
    """Read the released pool + real salaries and build the value price ladder.

    Pure-ish: the release id and warm distributions are supplied by the caller
    (the cache policy owns resolving them). Paginates every read.
    """
    from services.supabase_client import get_supabase

    client = get_supabase()
    weights, blend = overall_params_from_values(values)

    # --- Actives: released skill profiles + their real salary from players ---
    released_actives = list(
        _paginate(
            lambda: client.table("released_players")
            .select("source_player_id, skill_profile_snapshot")
            .eq("snapshot_release_id", release_id)
            .eq("is_legend", False)
        )
    )
    salary_by_id = {
        row["id"]: row.get("salary")
        for row in _paginate(
            lambda: client.table("players")
            .select("id, salary")
            .eq("season", season)
        )
    }

    active_overalls: dict[str, float] = {}
    active_salaries: list[int] = []
    for row in released_actives:
        pid = row.get("source_player_id")
        salary = salary_by_id.get(pid)
        if not pid or not salary:
            # No real salary → can't rank-pair this player into the dollar ladder.
            continue
        active_overalls[pid] = _overall_for(
            row.get("skill_profile_snapshot"), values, distributions, weights, blend
        )
        active_salaries.append(int(salary))

    # --- Legends: released profiles keyed by nba_api_id via canonical_players ---
    released_legends = list(
        _paginate(
            lambda: client.table("released_players")
            .select("canonical_player_id, skill_profile_snapshot")
            .eq("snapshot_release_id", release_id)
            .eq("is_legend", True)
        )
    )
    canonical_ids = [
        r["canonical_player_id"] for r in released_legends if r.get("canonical_player_id")
    ]
    nba_api_id_by_canonical: dict[str, int] = {}
    for i in range(0, len(canonical_ids), _PAGE):
        batch = canonical_ids[i : i + _PAGE]
        rows = (
            client.table("canonical_players")
            .select("id, nba_api_id")
            .in_("id", batch)
            .limit(_PAGE)
            .execute()
            .data
            or []
        )
        for row in rows:
            if row.get("nba_api_id") is not None:
                nba_api_id_by_canonical[row["id"]] = row["nba_api_id"]

    legend_overalls: dict[str, float] = {}
    for row in released_legends:
        nba_api_id = nba_api_id_by_canonical.get(row.get("canonical_player_id"))
        if nba_api_id is None:
            continue
        legend_overalls[str(nba_api_id)] = _overall_for(
            row.get("skill_profile_snapshot"), values, distributions, weights, blend
        )

    return value_price.build_ladder(active_overalls, active_salaries, legend_overalls)


class ValueLadderCache:
    """Holds the atomic ladder state and the rebuild/staleness policy."""

    def __init__(self) -> None:
        self._state: LadderState = _EMPTY_STATE

    def get_state(self) -> LadderState:
        """Atomic read of the current ladder — grab once per request."""
        return self._state

    def set_state(self, state: LadderState) -> None:
        self._state = state

    def force_clear(self) -> None:
        """Unconditional clear (publish/reactivate flows and test isolation)."""
        self._state = _EMPTY_STATE

    def ensure(self, season: str, force: bool = False) -> bool:
        """Build the ladder when missing or when the active release flipped.

        Returns True when a usable ladder is cached. Failures degrade to an empty
        ladder (reads simply omit value_price) rather than breaking the request.
        Resolves the Evaluation Version values lazily — only a real rebuild pays
        the get_active() query, so a warm hit stays a single release-id lookup.
        """
        state = self._state
        if not force and state.ready():
            try:
                if state.key == (season, _resolve_active_release_id()):
                    return True
            except Exception as exc:
                logger.warning(
                    "value ladder: unable to resolve active release for cache check; "
                    "rebuilding (%s)",
                    exc,
                )
        try:
            self.rebuild(season)
        except Exception as exc:
            logger.warning("value ladder: rebuild failed, prices unavailable (%s)", exc)
            return False
        return self._state.ready()

    def rebuild(self, season: str) -> LadderState:
        """Rebuild from the active release; warm the distributions first."""
        from services.evaluation_versions.repo import get_active
        from services.snapshot_versions.active import (
            ActiveReleaseMissingError,
            get_active_release_id,
        )
        from services.snapshot_versions.distribution_cache import (
            ensure_distributions,
            get_state as get_distribution_state,
        )

        try:
            release_id = get_active_release_id()
        except ActiveReleaseMissingError:
            logger.warning("value ladder: no active release — empty ladder")
            self._state = LadderState(key=(season, None))
            return self._state

        values = get_active().values
        # The ladder ranks on percentile-normalized composites — warm them first.
        ensure_distributions(season, values)
        distributions = get_distribution_state().distributions

        ladder = build_ladder_from_release(season, values, release_id, distributions)
        self._state = LadderState(key=(season, release_id), ladder=ladder)
        return self._state


def _resolve_active_release_id() -> str | None:
    from services.snapshot_versions.active import (
        ActiveReleaseMissingError,
        get_active_release_id,
    )

    try:
        return get_active_release_id()
    except ActiveReleaseMissingError:
        return None


# ---------------------------------------------------------------------------
# Default instance + module-level entry points (mirrors distribution_cache)
# ---------------------------------------------------------------------------

_default_cache = ValueLadderCache()


def get_ladder() -> ValueLadder:
    """Atomic read of the production ladder — grab once per request."""
    return _default_cache.get_state().ladder


def ensure_ladder(season: str, force: bool = False) -> bool:
    """Ensure the production ladder is warm for (season, active release)."""
    return _default_cache.ensure(season, force=force)


def force_clear_ladder() -> None:
    """Unconditional clear of the production ladder (publish/reactivate only)."""
    _default_cache.force_clear()


def set_ladder(ladder: ValueLadder, key: tuple[str, str | None] | None = None) -> None:
    """Replace the production ladder wholesale; tests use this hook."""
    _default_cache.set_state(LadderState(key=key, ladder=ladder))
