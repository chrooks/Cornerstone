# Engine v2 — Hybrid evaluator with versioned taxonomy

**Status:** accepted
**Date:** 2026-05-15
**Related issue:** #9 Evaluation Version publishing
**Related memory:** `engine-v2-thesis`, `eval-version-editor-scope`

## Context

The v1 cohesion engine fused **what is being scored** (Skill list, Impact Trait list, Subscore Tree, scoring rules) with **how scoring works** (formula math) inside Python modules under `backend/services/cohesion_engine/` (3,417 LOC). Weights live as Python constants in `weights.py` and `services/skills.py`. Calibration edits persist only to a process-memory dict (`_WEIGHT_OVERRIDES`), lost on restart. Saved Teams reference an `evaluation_version` text slug defaulting to `'cohesion-v1'` but no `evaluation_versions` table exists.

This blocks every scoring-math change behind a code release: #16 Skill Tier retune, #25 Subscore Tree restructure, #24 PnR Impact Trait, #18 public changelog. The thesis: separate **WHAT** is scored (taxonomy as data, versioned) from **HOW** scoring works (formula handlers as code, registered by name). The Editor becomes the representation layer for the engine itself.

## Decision

Adopt **Shape 2 — Hybrid evaluator**:

1. **Evaluation Version = graph snapshot.** Each Version stores `{ taxonomy, values, formula_refs, metadata }` as a single JSONB blob on `evaluation_versions(payload jsonb)`. Taxonomy mutations (rename, reorder, eventually add/remove) are data changes. New math primitives still require a code release.

2. **`CohesionEngine` class as runtime injection Surface.** Per-request `engine = CohesionEngine(version=load_active_version())` holds the blob. Scoring entry points become methods on the engine.

3. **Formula Handler registry via `@CohesionEngine.handler("name_v1")` decorator.** Co-located with implementation. `cohesion_engine/__init__.py` eagerly imports all handler modules at app startup to populate the registry.

4. **Bootstrap migration writes Evaluation Version `cohesion-v1`** from current `weights.py` + `services/skills.py` constants. Constants kept as historical reference with a header comment; deleted in a later cleanup PR after a couple Versions ship.

5. **Single global active Version.** Partial unique index `WHERE is_active = true` enforces one. Calibration page scores against the active draft locally via a separate `CohesionEngine(version=draft_blob)` instance.

## Considered Alternatives

- **Shape 1: shallow versioning** — version weight values only, structural changes still need code release. Rejected: leaves #25 and #24 stuck; defeats #9's purpose.
- **Shape 3: fully data-driven** — formulas serialized as DAG/expressions, interpreted at runtime. Rejected: multi-month rewrite of 3,417 LOC; solo operator does not need runtime formula authoring, only runtime taxonomy authoring.
- **Normalized child tables instead of JSONB blob** — rejected because Version is read whole every eval, taxonomy growth (new Subscore types, restructured trees) would force per-class table migrations.
- **`contextvars` for active Version injection** — rejected as too implicit; `CohesionEngine` instance is the natural home for the registry plus the data, matches the thesis cleanly, and enables `CohesionEngine(version=fake_blob)` in tests.

## Consequences

- Every formula module under `cohesion_engine/` gains an `engine` parameter and reads values from `engine.version.values` instead of importing constants. Mechanical refactor; bodies stay nearly identical.
- A new `evaluation_versions` table and bootstrap migration land in one slice; existing `saved_team_evaluations.evaluation_version` text becomes an `evaluation_version_id` FK (see ADR-0002).
- Tests of formula handlers gain a fixture that builds a fake `CohesionEngine` from a partial blob.
- v2 work (visual Formula Handler picker, taxonomy add/remove) is additive — no schema migration. v3 (Saved Team Build reopen with taxonomy migration UI) is independent.
