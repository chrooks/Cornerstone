# Architecture Deepening Opportunities

_Generated: 2026-05-04_

---

## ~~1. Modifier Pipeline~~ — RESOLVED

Removed with `roster_evaluator/` deletion (2026-05-04). Cohesion engine replaced this system entirely.

## ~~2. Two Parallel Evaluation Systems~~ — RESOLVED

Removed `roster_evaluator/`, deleted `EVAL_ENGINE` switch, unified frontend types. Cohesion engine is now the only evaluation path (2026-05-04).

---

## 3. skill_mapping_service.py — Pass-Through Layer

**Files:** `backend/services/skill_mapping_service.py` (266 lines), `backend/services/skill_engine/__init__.py`

**Problem:** Deletion test fails. `skill_mapping_service.py` re-exports functions from `skill_engine/` and orchestrates fetch→cache→evaluate. But the "orchestration" is just sequential calls — no deep logic. The 6 callers could import `skill_engine` directly with identical behavior. The layer adds naming indirection without hiding complexity.

**Solution:** Collapse into `skill_engine` as a proper deep module with a clean `evaluate_player(player_id) → SkillProfile` interface that owns fetching, caching, and evaluation internally.

**Benefits:** Locality — tracing skill evaluation no longer requires 3 module hops. The interface shrinks (one call vs. manually orchestrating cache + thresholds + evaluate).

---

## 4. compositing.py — Complex Decision Matrix as Nested Conditionals

**Files:** `backend/services/compositing.py` (478 lines)

**Problem:** A 4×3 compositing matrix (confidence level × agreement level) is implemented as deeply nested `if/elif` blocks (lines 86–253). Side-effects depend on check order. Low-notability override happens *before* the agreement check — an invariant invisible at the top of the function. Adding a new case requires reading the entire function to find the insertion point.

**Solution:** Make the matrix declarative — a data structure mapping `(confidence, agreement, modifiers)` → `outcome`. The execution engine becomes a simple lookup + override application. Each cell is independently testable.

**Benefits:** Leverage — adding a new compositing rule is adding a row, not tracing 170 lines of conditionals. Locality — each decision cell is self-documenting. Tests become exhaustive matrix coverage instead of path-specific.

---

## 5. BuilderPage.tsx — 867 Lines, 10+ Concerns

**Files:** `frontend/components/builder/BuilderPage.tsx` (867 lines)

**Problem:** URL parsing, 8-slot state, resizable layout, tab switching, salary calculations, drag-drop, legend fetching, filter propagation, mobile toggle — all in one component. Duplicates `buildPlayerPayload` and `readSlotsFromParams` with `EvaluatePage.tsx`. Can't test roster logic without rendering the entire layout.

**Solution:** Extract domain logic (roster slot management, payload construction, URL sync) into a custom hook or utility module. Split layout concerns (resize panels, tabs) from data concerns (slots, evaluation triggers).

**Benefits:** Locality — roster state bugs isolated from layout bugs. Leverage — shared `buildPlayerPayload` eliminates divergence risk. Testable without rendering 867 lines of UI.

---

## 6. Frontend: Zero Test Infrastructure

**Files:** Entire `frontend/` directory

**Problem:** No unit tests, no integration tests, no E2E tests. No test framework configured. Complex logic (type guards, payload construction, cohesion mapping, URL parsing) runs untested in production.

**Solution:** Add vitest + testing-library for unit/component tests. Start with the shared utilities (`cohesionHelpers`, `noteFilters`, payload builders) where logic is pure and testable through interfaces.

**Benefits:** Any deepening of frontend modules becomes verifiable. Currently, refactoring is high-risk because nothing catches regressions.

---

## Supporting Observations

### Weight Architecture — Central Coupling Point

- `skill_engine/` uses inline magic numbers instead of a weights file

### Test Coverage Gaps

| Area | Coverage | Risk |
|------|----------|------|
| Backend services (core evaluation) | ~60% | Medium |
| Backend services (data layer) | 0% | High |
| API endpoints | 3/13 | High |
| Frontend | 0% | Critical |
| E2E | None | Critical |

### Backend Tests: Implementation-Coupled

- Tests import private functions (`_blend_blobs`, `_tier_index`, `_lower_tier`)
- Tests reference internal weight constants directly
- Refactoring internals breaks tests even when public behavior is unchanged

### Duplicate Code

| What | Where |
|------|-------|
| `buildPlayerPayload()` | `AssistantGmNotes.tsx`, `EvaluatePage.tsx` |
| `readSlotsFromParams()` | `BuilderPage.tsx`, `EvaluatePage.tsx` |
