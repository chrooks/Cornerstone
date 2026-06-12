"""
CohesionEngine — runtime container for versioned evaluation.

The engine holds a loaded Evaluation Version (taxonomy + values + formula_refs)
and a class-level handler registry. Formula modules register themselves via the
@CohesionEngine.handler decorator at import time. At request time, the API
creates CohesionEngine(version=active_version()) and dispatches subscore
computation through the registry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, ClassVar, TYPE_CHECKING

if TYPE_CHECKING:
    from .types import PlayerComposites


@dataclass(frozen=True)
class LineupContext:
    """Data available to a Formula Handler during lineup evaluation."""

    composites: list[PlayerComposites]
    lineup: list[dict[str, Any]]


@dataclass(frozen=True)
class EvaluationVersion:
    """Immutable snapshot of one Evaluation Version row."""

    id: str
    slug: str
    status: str
    payload: dict[str, Any]
    # Publish metadata — present on published rows, None on drafts. Defaulted so
    # existing constructors (and tests) that omit them keep working.
    changelog_note: str | None = None
    published_at: str | None = None

    @property
    def values(self) -> dict[str, Any]:
        return self.payload["values"]

    @property
    def taxonomy(self) -> dict[str, Any]:
        return self.payload["taxonomy"]

    @property
    def formula_refs(self) -> dict[str, str]:
        return self.payload["formula_refs"]


class CohesionEngine:
    """
    Runtime that joins an Evaluation Version blob with registered Formula Handlers.

    Handlers register at module import time via the @handler decorator.
    Each request creates a fresh CohesionEngine instance bound to the active
    (or draft) Evaluation Version, then calls dispatch() to run subscore formulas.
    """

    _registry: ClassVar[dict[str, Callable]] = {}

    @classmethod
    def handler(cls, name: str) -> Callable:
        """Register a Formula Handler by stable name.

        Idempotent: re-registering the same name is a no-op. This handles
        dual-path imports (``backend.services.cohesion_engine`` vs
        ``services.cohesion_engine``) where Python treats the same source
        file as two different modules, creating distinct function objects.
        """
        def deco(fn: Callable) -> Callable:
            if name in cls._registry:
                return fn  # idempotent — dual-path or re-import
            cls._registry[name] = fn
            return fn
        return deco

    @classmethod
    def registered_handlers(cls) -> dict[str, Callable]:
        """Return a copy of the handler registry (for publish gate validation)."""
        return dict(cls._registry)

    def __init__(self, version: EvaluationVersion) -> None:
        self.version = version

    def dispatch(self, handler_name: str, *args: Any, **kwargs: Any) -> Any:
        """Look up and call a registered Formula Handler by name."""
        try:
            fn = self._registry[handler_name]
        except KeyError as exc:
            raise RuntimeError(
                f"No Formula Handler registered for name {handler_name!r}"
            ) from exc
        return fn(self, *args, **kwargs)
