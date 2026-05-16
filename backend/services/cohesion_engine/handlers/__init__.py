"""
Handler registration package.

Importing this package triggers all handler modules to register their
Formula Handlers with the CohesionEngine class-level registry.
"""

from __future__ import annotations

from . import composites_v1  # noqa: F401 — eager-load for handler registration
