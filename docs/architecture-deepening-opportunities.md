# Architecture Deepening Opportunities

_Generated: 2026-05-04_

---

## ~~1. Modifier Pipeline~~ — RESOLVED

Removed with `roster_evaluator/` deletion (2026-05-04). Cohesion engine replaced this system entirely.

## ~~2. Two Parallel Evaluation Systems~~ — RESOLVED

Removed `roster_evaluator/`, deleted `EVAL_ENGINE` switch, unified frontend types. Cohesion engine is now the only evaluation path (2026-05-04).

---

## ~~3. skill_mapping_service.py — Pass-Through Layer~~ — RESOLVED

Deleted `skill_mapping_service.py`. Orchestration functions moved to `skill_engine/pipeline.py`, 20 re-exports removed. Callers now import from `skill_engine` directly (2026-05-05).

---

## ~~4. compositing.py — Complex Decision Matrix as Nested Conditionals~~ — RESOLVED

Replaced 170 lines of nested `if/elif` with a declarative `_COMPOSITING_RULES` table — 8 priority-ordered rows mapping predicates to outcomes. Adding a rule = adding a row. All 88 existing tests pass unchanged (2026-05-05).

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
