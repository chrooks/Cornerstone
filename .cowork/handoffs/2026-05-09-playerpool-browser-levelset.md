<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: PlayerPoolBrowser Extraction — Levelset

## Context

Cornerstone's Lab lifecycle pages are built: Legends picker (`/lab/[ruleset]/legends`), Build (`/lab/[ruleset]/build`), and Eval (`/lab/[ruleset]/eval`) are all committed and functional. The next major milestone is extracting a reusable **PlayerPoolBrowser** component from the three surfaces that currently duplicate FilterBar + SortControls + PlayerTable/Cards wiring.

See [CONTEXT.md](../../CONTEXT.md) for domain vocabulary — **PlayerPool**, **PlayerView**, and **PlayerPoolBrowser** are defined there.

## Current State — Three Consumer Surfaces

All three surfaces import and wire the same trio manually: `FilterBar`, `SortControls`, `PlayerTable`. Each duplicates ~80 lines of filter/sort/pagination state, derived data (`filtered → sorted → paginated`), and view-mode switching.

### 1. Players Explorer — [`frontend/app/players/page.tsx`](frontend/app/players/page.tsx)
- Full admin PlayerPool: all active Players from current Snapshot
- All columns visible by default (no `initialHiddenColumns`)
- `onSkillOverride` for right-click tier editing (admin only)
- `onRemoveManualPlayer` for manually included Players
- `SortControls` with no `hiddenColumns` filtering (all sort options shown)
- View modes: table + cards

### 2. Legends Picker — [`frontend/app/lab/[ruleset]/legends/page.tsx`](frontend/app/lab/[ruleset]/legends/page.tsx)
- Legend-only PlayerPool (`is_legend: true`)
- No `initialHiddenColumns` passed (note #1 says GP, MPG, Legend toggle should be omitted — not yet done)
- `onRowClick` selects Cornerstone → navigates to Build
- `SortControls` with no `hiddenColumns` filtering
- View modes: table + scouting report cards

### 3. Builder Picker — [`frontend/components/builder/PlayerPickerPanel.tsx`](frontend/components/builder/PlayerPickerPanel.tsx)
- Active Players (minus rostered) as PlayerPool
- Tier-based column visibility: T1 always visible (Name, Pos, Salary), T2 high-value (Cap+/Pro+/Elite+/ATG+, Era, Team), T3 hidden by default (Age, GP, Ht, Wt), T4 skills shown in profile category order
- `hiddenColumns` state **lifted to parent** — shared between `PlayerTable` (controlled mode) and `SortControls`
- `disabledPlayerIds` for over-budget and already-rostered Players
- `onRowHover`/`onRowHoverEnd` for SalaryCap gauge preview
- `highlightedPlayerId` for CourtStrip face hover cross-highlight
- `onRowDragStart` for drag-to-slot
- View modes: table + cards

## Completed This Session

1. **Column tier system** — `META_COLUMNS` reordered by visibility tier (T1→T4). Skill columns follow `PROFILE_SKILL_ORDER` from `PUBLIC_SKILL_CATEGORIES` (profile display grouping, not confidence grouping).
2. **Controlled `hiddenColumns`** — `PlayerTable` now supports controlled mode via `hiddenColumns` + `onHiddenColumnsChange` props (uncontrolled mode with `initialHiddenColumns` still works for other consumers).
3. **Sort-column sync** — `SortControls` accepts optional `hiddenColumns` prop, filters dropdown to only visible columns. Builder picker passes lifted state.
4. **Eval route migration** — `/lab/[ruleset]/eval` created. `EvaluatePage` reads ruleset from `useParams()`, back links route to `/lab/[ruleset]/build`. Legacy `/builder/evaluate` still works.

## What the PlayerPoolBrowser Needs to Encapsulate

The shared component should own:
- **State**: `filterEntries`, `sortKeys`, `page`, `pageSize`, `viewMode`, `hiddenColumns`
- **Derived data pipeline**: `players → filtered → sorted → paginated`
- **Composition**: `FilterBar` + `SortControls` + `PlayerTable` (row density) or card grid (card density)
- **Configuration props** (per-surface customization):
  - `players: PlayerWithSkills[]` — the PlayerPool data
  - `defaultHiddenColumns: string[]` — initial column visibility tier
  - `defaultSortKeys: SortKey[]` — initial sort
  - `defaultPageSize: number` — view-appropriate page size
  - `viewModes: ("table" | "cards")[]` — which densities to offer
  - Row interaction callbacks: `onRowClick`, `onRowDragStart`, `onRowContextMenu`, `onRowHover`, `onRowHoverEnd`
  - `disabledPlayerIds`, `highlightedPlayerId` — builder-specific visual state
  - `onSkillOverride` — admin-only tier editing
  - `isAdmin` — route prefix for profile links
  - `filterConfig` — which filter fields to expose (salary? position? era? skill tier?)

## Extraction Order (from note #2)

1. ~~Finish Legends picker~~ — done
2. ~~Finish remaining Lab pages (Build, Eval)~~ — done (Saved Teams deferred)
3. **Extract PlayerView** — 3 densities (row, card, report). Currently: `PlayerTable` row rendering is inline in `renderCell()`, card rendering is inline in each page, report rendering is in Legends picker scouting cards.
4. **Extract PlayerPoolBrowser** — FilterBar + SortControls + PlayerView collection with configurable columns/filters
5. **Rewire consumers** — Players page, Builder picker, Legends picker all use PlayerPoolBrowser

## Key Files

| File | Role |
|---|---|
| [`frontend/components/players/PlayerTable.tsx`](frontend/components/players/PlayerTable.tsx) | Row-density PlayerView + column toggle + pagination + context menu |
| [`frontend/components/players/SortControls.tsx`](frontend/components/players/SortControls.tsx) | Multi-key sort UI with hiddenColumns filtering |
| [`frontend/components/players/FilterBar.tsx`](frontend/components/players/FilterBar.tsx) | Compound filter builder (field + op + value, AND/OR connectors) |
| [`frontend/components/builder/PlayerPickerPanel.tsx`](frontend/components/builder/PlayerPickerPanel.tsx) | Builder's PlayerPool surface — most complete wiring example |
| [`frontend/app/players/page.tsx`](frontend/app/players/page.tsx) | Admin PlayerPool surface |
| [`frontend/app/lab/[ruleset]/legends/page.tsx`](frontend/app/lab/[ruleset]/legends/page.tsx) | Legend-only PlayerPool surface |
| [`frontend/lib/skills.ts`](frontend/lib/skills.ts) | `PROFILE_SKILL_ORDER`, `PUBLIC_SKILL_CATEGORIES`, `ALL_SKILL_NAMES` |

## Important Working Instructions

1. Use CONTEXT.md domain language strictly — PlayerPool, PlayerView, PlayerPoolBrowser, Build, Rotation
2. User-facing text: "Rule Set" (two words); code: `RuleSet` (PascalCase)
3. Never kill the user's dev server
4. All React/HTML elements need human-communicatable `id` tags
5. Do this work interactively, not via subagent
6. Note #1 still open: Legends picker should omit GP, MPG, Legend toggle columns/filters

## Verification Baseline

```bash
cd frontend && npx tsc --noEmit  # should pass clean
npm run build                     # production build should succeed
```

Visually verify: `/lab/standard/legends`, `/lab/standard/build`, `/players`
