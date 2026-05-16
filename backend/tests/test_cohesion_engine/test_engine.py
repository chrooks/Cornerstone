"""Tests for CohesionEngine class and handler registry."""

from __future__ import annotations

import pytest

from services.cohesion_engine.engine import CohesionEngine, EvaluationVersion


def _make_version(**overrides) -> EvaluationVersion:
    defaults = {
        "id": "test-id",
        "slug": "cohesion-test",
        "status": "draft",
        "payload": {"values": {}, "taxonomy": {}, "formula_refs": {}},
    }
    defaults.update(overrides)
    return EvaluationVersion(**defaults)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Remove only test-registered handlers after each test.

    Production handlers (registered at module import time) must survive
    because Python caches modules — re-importing won't re-run decorators
    after the registry is cleared.
    """
    before = set(CohesionEngine._registry.keys())
    yield
    added = set(CohesionEngine._registry.keys()) - before
    for key in added:
        CohesionEngine._registry.pop(key, None)


class TestHandlerRegistry:
    def test_register_and_dispatch(self):
        @CohesionEngine.handler("test_multiply_v1")
        def multiply(engine, x):
            return x * engine.version.values["coef"]

        version = _make_version(payload={
            "values": {"coef": 3},
            "taxonomy": {},
            "formula_refs": {},
        })
        engine = CohesionEngine(version)
        assert engine.dispatch("test_multiply_v1", 5) == 15

    def test_duplicate_registration_is_idempotent(self):
        """Re-registering the same name is a no-op (dual-path import safety)."""
        @CohesionEngine.handler("test_dup_v1")
        def first(engine):
            return "first"

        @CohesionEngine.handler("test_dup_v1")
        def second(engine):
            return "second"

        # First registration wins
        engine = CohesionEngine(_make_version())
        assert engine.dispatch("test_dup_v1") == "first"

    def test_dispatch_unknown_raises(self):
        engine = CohesionEngine(_make_version())
        with pytest.raises(RuntimeError, match="No Formula Handler"):
            engine.dispatch("nonexistent_v1")

    def test_registered_handlers_returns_copy(self):
        @CohesionEngine.handler("test_copy_v1")
        def handler(engine):
            pass

        handlers = CohesionEngine.registered_handlers()
        assert "test_copy_v1" in handlers
        # Modifying the copy should not affect the registry
        handlers.pop("test_copy_v1")
        assert "test_copy_v1" in CohesionEngine._registry


class TestEvaluationVersion:
    def test_properties(self):
        version = _make_version(payload={
            "values": {"tier_values": {"Elite": 6.0}},
            "taxonomy": {"skills": []},
            "formula_refs": {"spacing": "spacing_v1"},
        })
        assert version.values["tier_values"]["Elite"] == 6.0
        assert version.taxonomy["skills"] == []
        assert version.formula_refs["spacing"] == "spacing_v1"

    def test_frozen(self):
        version = _make_version()
        with pytest.raises(AttributeError):
            version.slug = "changed"
