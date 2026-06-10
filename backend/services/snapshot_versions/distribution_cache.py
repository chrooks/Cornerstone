"""
Distribution-cache flip policy for cohesion composite normalization.

This module owns WHEN the percentile-normalization distributions are rebuilt:

- the (season, active snapshot_release_id) cache key and its staleness
  comparison (#61: a publish/reactivate that flips the active release must
  invalidate the cache without a Flask restart),
- the draft-pin invalidation guard (the cache must stay pinned to the
  previously published Snapshot while a draft/review is open),
- the clear / force-clear / ensure entry points used by the publish and
  reactivate flows in services.snapshot_versions.repo.

The cohesion engine's composites module keeps the pure mechanics — raw
composite math, building distributions from a release's frozen rows, and
percentile normalization. The dependency arrow points one way: this module
imports composites; composites never imports snapshot_versions.

Concurrency: the cache is ONE immutable DistributionState (key +
distributions) held in a single reference and replaced wholesale. The swap is
atomic under the GIL, so a reader that grabs the state once per evaluation via
get_state() can never observe distributions from release A paired with release
B's key (the publish-flip TOCTOU). This subsumes the old key-before-visibility
write ordering (commit e1e4541): key and distributions become visible
together.

The module-level _default_cache is the production singleton; tests may
instantiate their own DistributionCache and exercise it in isolation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Mapping

from services.cohesion_engine import composites
from services.cohesion_engine.weights import COMPOSITE_NAMES

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DistributionState:
    """Immutable snapshot of the distribution cache.

    key is (season, active snapshot_release_id) — release_id is None when no
    release was active at build time; key is None for the empty state.
    The inner lists are owned by this state and must not be mutated.
    """

    key: tuple[str, str | None] | None = None
    distributions: Mapping[str, list[float]] = field(default_factory=dict)

    def ready(self) -> bool:
        """True when every composite has enough values for percentile use."""
        return composites.distributions_ready(self.distributions)


_EMPTY_STATE = DistributionState()


def _invalidation_allowed() -> bool:
    """
    Return False while a Snapshot draft/review is open.

    Invariant: the distribution cache must not be cleared mid-draft so that
    production cohesion reads remain stable against the previously published
    Snapshot. Only the publish/reactivate flows (which explicitly call
    force_clear_distributions) are exempt from this guard.

    Lazy import: repo imports this module at load time, so importing repo here
    at module level would be circular.
    """
    try:
        from services.snapshot_versions.repo import get_draft

        return get_draft() is None
    except Exception:
        # If the draft check fails, allow invalidation (safe default)
        return True


class DistributionCache:
    """Holds the atomic state reference and the rebuild/staleness policy."""

    def __init__(self) -> None:
        self._state: DistributionState = _EMPTY_STATE

    # -- readers ------------------------------------------------------------

    def get_state(self) -> DistributionState:
        """Return the current immutable state.

        Grab this ONCE per evaluation and use it consistently — never re-read
        mid-computation, or a concurrent publish flip can tear the read.
        """
        return self._state

    def ready(self) -> bool:
        return self._state.ready()

    # -- writers ------------------------------------------------------------

    def set_state(self, state: DistributionState) -> None:
        """Replace the whole state atomically."""
        self._state = state

    def set_distributions(
        self,
        distributions: Mapping[str, list[float]] | None,
        key: tuple[str, str | None] | None = None,
    ) -> None:
        """Replace cached distributions wholesale; tests use this hook."""
        if not distributions:
            self._state = _EMPTY_STATE
            return
        self._state = DistributionState(
            key=key,
            distributions={name: sorted(vals) for name, vals in distributions.items()},
        )

    def clear(self) -> None:
        """
        Clear cached distributions — gated by the draft-pin Invariant.

        No-ops while a Snapshot draft or review is open. Call force_clear()
        to bypass the guard (publish/reactivate flows only).
        """
        if not _invalidation_allowed():
            logger.debug(
                "clear_distributions skipped: draft in progress (distribution cache pinned)"
            )
            return
        self._state = _EMPTY_STATE

    def force_clear(self) -> None:
        """
        Unconditionally clear the distribution cache.

        Bypass for the publish/reactivate flows (and test isolation). Do not
        call from any other production code path.
        """
        self._state = _EMPTY_STATE

    # -- rebuild policy -----------------------------------------------------

    def ensure(self, season: str, values: dict[str, Any], force: bool = False) -> bool:
        """
        Build percentile normalization distributions when missing or stale.

        The cache is keyed by (season, active snapshot_release_id): when a
        publish or reactivate flips the active release, the key mismatch
        forces a rebuild from the new release's released_players rows (#61).

        Returns True when percentile normalization is ready. Failures are
        logged and leave theoretical fallback available, so request handling
        can continue.
        """
        state = self._state
        if not force and state.ready():
            try:
                if state.key == (season, _resolve_active_release_id()):
                    return True
            except Exception as exc:
                logger.warning(
                    "Unable to resolve active Snapshot Release for distribution "
                    "cache check; rebuilding (%s)",
                    exc,
                )

        try:
            self.rebuild(season, values)
        except Exception as exc:
            logger.warning(
                "Unable to build cohesion composite distributions; using theoretical fallback (%s)",
                exc,
            )
            return False

        return self._state.ready()

    def rebuild(self, season: str, values: dict[str, Any]) -> DistributionState:
        """Rebuild distributions from the active release and swap them in.

        If no active release exists, logs and degrades gracefully to an empty
        distribution (the MIN_DISTRIBUTION_SIZE check keeps normalization on
        the theoretical-max fallback path).
        """
        from services.snapshot_versions.active import (
            ActiveReleaseMissingError,
            get_active_release_id,
        )

        try:
            active_release_id = get_active_release_id()
        except ActiveReleaseMissingError:
            logger.warning(
                "distribution rebuild: no active Snapshot Release — "
                "returning empty distributions (theoretical fallback will be used)"
            )
            empty = DistributionState(
                key=(season, None),
                distributions={name: [] for name in COMPOSITE_NAMES},
            )
            self._state = empty
            return empty

        distributions = composites.build_distributions(season, values, active_release_id)
        state = DistributionState(key=(season, active_release_id), distributions=distributions)
        # Single-reference swap: key + distributions become visible together.
        self._state = state
        return state


def _resolve_active_release_id() -> str | None:
    """Return the active Snapshot Release id, or None when no release is active.

    Memoized per request via snapshot_versions.active, so the cache-key check
    in ensure_distributions costs at most one DB lookup per request.
    """
    from services.snapshot_versions.active import (
        ActiveReleaseMissingError,
        get_active_release_id,
    )

    try:
        return get_active_release_id()
    except ActiveReleaseMissingError:
        return None


# ---------------------------------------------------------------------------
# Default instance + module-level entry points (singleton-as-default-instance)
# ---------------------------------------------------------------------------

_default_cache = DistributionCache()


def get_state() -> DistributionState:
    """Atomic read of the production cache state — grab once per evaluation."""
    return _default_cache.get_state()


def ensure_distributions(season: str, values: dict[str, Any], force: bool = False) -> bool:
    """Ensure the production cache is warm for (season, active release)."""
    return _default_cache.ensure(season, values, force=force)


def clear_distributions() -> None:
    """Draft-pin-gated clear of the production cache."""
    _default_cache.clear()


def force_clear_distributions() -> None:
    """Unconditional clear of the production cache (publish/reactivate only)."""
    _default_cache.force_clear()


def set_distributions(
    distributions: Mapping[str, list[float]] | None,
    key: tuple[str, str | None] | None = None,
) -> None:
    """Replace the production cache's distributions; tests use this hook."""
    _default_cache.set_distributions(distributions, key=key)


def distributions_ready() -> bool:
    """True when the production cache can serve percentile normalization."""
    return _default_cache.ready()
