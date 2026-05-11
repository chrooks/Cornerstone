# Make Lab Build Responsive

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows the ExecPlan requirements in `~/.codex/PLAN.md`. It is self-contained for a future contributor who only has the repository working tree and this file.

## Purpose / Big Picture

The Lab Build page currently works as a dense desktop builder, but it relies on a fixed viewport shell and a permanent horizontal split between the PlayerPool and Feedback. On shorter laptops, tablets, and phones, that structure can squeeze the CourtStrip, trap scrolling inside nested panels, clip Build slots, and make PlayerPool controls hard to use.

After this plan is implemented, a user can open `/lab/standard/build` on desktop, tablet, or mobile and still assemble a Build, inspect Players, read Feedback, and evaluate the Team without losing any existing builder behavior. The visible outcome is responsive layout and scroll behavior only. Evaluation semantics, scoring data, and backend API behavior must remain unchanged.

Definitions used in this plan:

Team means any group of five or more Players submitted for evaluation. Player means the universal individual unit in Cornerstone. Lab means the full lifecycle of selecting a RuleSet, picking a Cornerstone, assembling a Build, and evaluating it. RuleSet means a published configuration that defines the constraints of a Lab session. Cornerstone means the Player in the first slot of a Team that the rest of the Team is built around. Build means the in-progress Team configuration in the Lab before saving. PlayerPool means the browsable collection of selectable Players. PlayerView means one Player rendered as Row, Card, Panel, or Profile. Row, Card, Panel, and Profile are the four PlayerView sizes. Feedback means the builder panel explaining the current Build read. Lineup means a five-Player Team. Lineup Combination means one five-Player Lineup generated from the current Team. Starting Lineup means the first five selected slots in a Team larger than five. Impact Trait means a normalized player-level basketball effect produced from a Player's Skill Profile. Boundary means the line separating responsibilities between components or pieces of code.

## Progress

- [x] (2026-05-11 19:37Z) Created this ExecPlan from the builder responsive handoff and current source inspection.
- [x] (2026-05-11 19:48Z) Added a Playwright TDD tracer for mobile responsive behavior; confirmed RED because `#builder-workspace-resize-handle` stayed visible at `390x844`.
- [x] (2026-05-11 19:48Z) Audited the current Build page in the browser at desktop, short laptop, tablet landscape, tablet portrait, and mobile viewport sizes.
- [x] (2026-05-11 19:48Z) Recorded concrete visual failures in `Surprises & Discoveries` before editing layout code.
- [x] (2026-05-11 19:48Z) Implemented the responsive page shell and desktop-only resize behavior in `frontend/components/builder/BuilderPage.tsx`.
- [x] (2026-05-11 19:48Z) Implemented responsive CourtStrip behavior in `frontend/components/builder/CourtStrip.tsx` and `frontend/components/builder/SalaryGauge.tsx`.
- [x] (2026-05-11 19:48Z) Tuned PlayerPool Card view in `frontend/components/builder/PlayerPickerPanel.tsx`.
- [x] (2026-05-11 19:48Z) Tuned Feedback scroll and section reflow in `frontend/components/builder/BuilderFeedbackPanel.tsx` and `frontend/components/builder/feedback-read/*`.
- [x] (2026-05-11 19:48Z) Ran TypeScript, lint, focused backend tests, Playwright responsive tests, browser audit, and whitespace checks.
- [x] (2026-05-11 19:48Z) Updated this ExecPlan with final outcomes, verification evidence, and remaining follow-up.
- [x] (2026-05-11 20:09Z) Added smaller-screen workspace tabs so PlayerPool and Feedback are adjacent modes below desktop instead of placing full Feedback after the full PlayerPool.
- [x] (2026-05-11 20:09Z) Re-ran the focused Playwright responsive tests, TypeScript, lint, focused backend tests, and whitespace checks after the workspace tab change.

## Surprises & Discoveries

- Observation: no `docs/adr/` files exist in this checkout, so there is no ADR that constrains the responsive design.
  Evidence: `find docs -maxdepth 2 -type d -name adr -print -o -path 'docs/adr/*' -print` returned no output.

- Observation: current latest commit for this workstream is the Feedback read and Player inspection commit.
  Evidence: `git log -1 --oneline` returned `9f7b6d5 feat(builder): refine feedback read and inspection flow`.

- Observation: the working tree already contains unrelated `.cowork` changes before this plan.
  Evidence: `git status --short` showed `.cowork/index.md` modified and three untracked `.cowork/handoffs/*.md` files.

- Observation: pre-change mobile kept the desktop split and exposed a visible resize handle.
  Evidence: `npx playwright test tests/builder-responsive.spec.ts --reporter=line` failed with `Expected: hidden Received: visible` for `#builder-workspace-resize-handle` at `390x844`.

- Observation: pre-change mobile had document-level horizontal overflow and unusably narrow Card PlayerViews.
  Evidence: the browser audit at `390x844` reported `pageOverflow: 77`, `workspaceStyle.flexDirection: "row"`, `resizeHandleVisible: true`, `court.scrollWidth: 546` inside a `342px` CourtStrip, and first Card widths of `39px`.

- Observation: after the first responsive slice, the viewport matrix no longer has document-level horizontal overflow.
  Evidence: the browser audit reported `pageOverflow: 0` for `1440x900`, `1280x720`, `1024x768`, `768x1024`, and `390x844`.

- Observation: after the first responsive slice, the CourtStrip uses intentional internal horizontal scroll on narrow screens instead of pushing the page wider.
  Evidence: at `390x844`, `#builder-court-strip-scroll` reported `clientWidth: 364`, `scrollWidth: 720`, and page overflow stayed `0`.

- Observation: after the first responsive slice, mobile Feedback could still feel buried because the full PlayerPool rendered before the full Feedback panel.
  Evidence: the mobile audit placed `#builder-notes-panel` around `y: 9107` after a PlayerPool with `height: 8688`.

- Observation: after adding smaller-screen workspace tabs, Feedback is immediately reachable below the CourtStrip without first scrolling through the PlayerPool.
  Evidence: the mobile Feedback-tab audit at `390x844` reported `#builder-narrow-workspace-tabs` at `y: 407.1875`, `#builder-playerpool-panel` as `display: "none"`, and `#builder-notes-panel` as `display: "flex"` at `y: 460.6875`.

## Decision Log

- Decision: Keep this as one responsive pass unless browser audit reveals a large hidden dependency.
  Rationale: The requested scope is layout, scrolling, and responsive behavior. A single focused pass is easier to review than splitting every component into separate commits, as long as evaluation behavior does not change.
  Date/Author: 2026-05-11 / Codex

- Decision: Preserve desktop behavior and make smaller breakpoints adapt around it.
  Rationale: Desktop is the currently working source context. The safest path is to keep the existing two-pane PlayerPool and Feedback split at `lg` and wider, then stack or simplify below that width.
  Date/Author: 2026-05-11 / Codex

- Decision: Treat the resize handle as desktop-only.
  Rationale: Touch and narrow-width layouts should not expose a thin drag affordance when stacked scrolling is clearer and less error-prone.
  Date/Author: 2026-05-11 / Codex

- Decision: Do not redesign Feedback information architecture in this pass.
  Rationale: The previous commit already refined the Feedback read. This plan exists to make that read usable across screen sizes without changing the read itself.
  Date/Author: 2026-05-11 / Codex

- Decision: Add a focused Playwright test instead of adding a broad E2E harness.
  Rationale: The frontend already has `@playwright/test` installed but no E2E suite. A narrow public-interface test protects the responsive contracts without introducing unrelated infrastructure.
  Date/Author: 2026-05-11 / Codex

- Decision: Use internal horizontal scroll for the CourtStrip on narrow widths.
  Rationale: Keeping all nine Build slots in one strip preserves the Starting Lineup and bench grouping, while internal scroll prevents page-level overflow and keeps drag/drop slot targets intact.
  Date/Author: 2026-05-11 / Codex

- Decision: Use smaller-screen workspace tabs for PlayerPool and Feedback below `lg`.
  Rationale: Stacking full PlayerPool above full Feedback made the Feedback read technically reachable but practically buried. Tabs preserve the desktop split, avoid duplicating Feedback content, avoid a bottom-sheet interaction layer, and keep the PlayerPool and Feedback as peer workspace modes on smaller screens.
  Date/Author: 2026-05-11 / Codex

- Decision: Automatically switch to the Feedback tab when a filled Build slot is clicked or a Player is sent to Feedback, and switch back to Players when a Feedback suggestion filter is used.
  Rationale: The tabs should follow the user's active task instead of forcing extra navigation after common builder actions.
  Date/Author: 2026-05-11 / Codex

## Outcomes & Retrospective

Implemented the responsive Build pass. Desktop, short laptop, and tablet landscape keep the two-pane PlayerPool and Feedback split with the resize handle. Tablet portrait and mobile switch to smaller-screen workspace tabs: Players by default, Feedback as a peer tab immediately below the CourtStrip. The CourtStrip now scrolls internally on narrow widths rather than widening the page. Card PlayerViews now reflow from one column on mobile to two, three, or four columns as width allows. Feedback keeps desktop panel scrolling, and on smaller screens it is reachable through the Feedback tab instead of being buried below the full PlayerPool.

Verification completed:

    cd frontend && npx tsc --noEmit
    cd frontend && npm run lint
    cd frontend && npx playwright test tests/builder-responsive.spec.ts --reporter=line
    cd backend && source venv/bin/activate && python -m pytest tests/test_builder_api_cohesion.py -q
    git diff --check

The Playwright responsive test suite passed with `2 passed`. The focused backend test passed with `3 passed, 1 warning`; the warning is the existing Supabase `gotrue` deprecation warning from the backend venv.

Browser audit screenshots were written outside the repository under `/tmp/cornerstone-builder-responsive-audit-before` and `/tmp/cornerstone-builder-responsive-audit-after`. They show the before/after viewport matrix without adding generated artifacts to the repo.

The earlier follow-up about Feedback being buried below a long mobile PlayerPool was addressed with the smaller-screen workspace tabs. A later product pass could still add a compact Build read above the tabs, but it is no longer required for basic smaller-screen reachability.

## Code Review Findings

Populated after code review. Leave blank until review is complete.

### High Risk

### Medium Risk

### Low Risk

## Context and Orientation

The route under active work is `/lab/[ruleset]/build`. The relevant rendered URL for manual testing is `http://localhost:3000/lab/standard/build?cornerstone=<valid Legend id>`. The exact `cornerstone` id can be copied from the current browser URL, from a previously working Build URL, or from the Legends picker flow at `/lab/standard/legends`.

The current Build page ownership is:

`frontend/components/builder/BuilderPage.tsx` owns the full route shell. It loads Players, derives the Cornerstone from the route, owns the PlayerPool and Feedback split, owns the resize handle, tracks selected Player focus for Feedback, and wires the Profile modal opened from Build slots.

`frontend/components/builder/BuilderHeader.tsx` owns the Lab breadcrumb and top header controls. The breadcrumb should continue to express `Lab / Standard / Pick Your Cornerstone / Build Your Rotation`; the existing breadcrumb is not the target of this responsive pass unless visual audit shows it wraps badly.

`frontend/components/builder/CourtStrip.tsx` owns the SalaryCap gauge and the nine Build slots. The first slot is the Cornerstone. Slots 1 through 5 are the Starting Lineup. Slots 6 through 9 are bench slots under the Standard RuleSet. The component currently uses fixed slot sizes and a single horizontal row, which is the main likely clipping risk.

`frontend/components/builder/PlayerPickerPanel.tsx` owns the builder PlayerPool. It renders filters, sorting, view-size toggle, Row/Card/Panel views, Player add behavior, salary hover preview, and builder-specific Player fit content.

`frontend/components/players/PlayerPoolBrowser.tsx` owns shared PlayerPool filtering, sorting, pagination, collection rendering, and Profile modal state.

`frontend/components/players/PlayerTable.tsx` owns Row view table behavior. It already uses horizontal overflow for its table wrapper, which should be preserved on narrow screens instead of squeezing columns into unreadable text.

`frontend/components/builder/BuilderFeedbackPanel.tsx` owns the Feedback panel shell, collapse behavior, tabs, scroll container, Score Factors, Build Notes, Skill Matrix tab, Debug tab, and the new Feedback read.

`frontend/components/builder/feedback-read/*` owns reusable read sections for Skill Profile, Impact Traits, and Lineup reach. These components should remain reusable and keep their caller-provided `idBase` values.

Design context lives in `PRODUCT.md` and `DESIGN.md`. The important design constraints are: use the scouting-report palette, warm paper tones, sharp geometry, flat surfaces, compact data density, and real skill data as visual interest. Do not introduce decorative gradients, large rounded cards, generic SaaS patterns, or a new color system.

The useful visual reference is `.cowork/Screenshot 2026-05-10 at 10-33-58 Cornerstone.png`. It shows the desired dense desktop posture: CourtStrip above, PlayerPool cards on the left, Feedback on the right, and Feedback content expanded.

## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Desktop layout | Keep two-pane PlayerPool and Feedback split at `lg` and wider | Preserves the current productive desktop workflow. |
| Tablet layout | Prefer content-driven stacking when pane widths become too narrow | Tablet portrait cannot reliably support a dense PlayerPool and Feedback side by side. |
| Mobile layout | Single-column shell with smaller-screen PlayerPool / Feedback workspace tabs | Avoids nested scroll traps and keeps Feedback near the Build instead of below the full PlayerPool. |
| Resize handle | Hide below desktop | A thin separator is a poor touch target and meaningless when sections stack. |
| CourtStrip | Use responsive sizing plus horizontal scroll or wrapping before clipping | Drag and slot affordances must remain usable even when all nine slots cannot fit. |
| PlayerPool cards | Replace fixed four-column grid with responsive grid tracks | Card width should be determined by available space, not a fixed desktop count. |
| Row view | Preserve horizontal table scroll | The shared table has many useful columns; forced compression would reduce readability. |
| Feedback scroll | Prefer page-level scroll on narrow screens, panel scroll on desktop | Desktop benefits from fixed panes; mobile suffers when every panel has its own scroll area. |

## File Changes

### New Files

- `feature_requests/builder-responsive-layout-plan.md` - this ExecPlan.
- `frontend/tests/builder-responsive.spec.ts` - Playwright public-interface coverage for mobile stacking, Card PlayerView reflow, desktop split preservation, and the viewport overflow matrix.

### Modified Files

- `frontend/components/builder/BuilderPage.tsx` - planned changes for breakpoint-aware shell height, stacked narrow layout, desktop-only split sizing, desktop-only resize handle, and smaller-screen PlayerPool / Feedback workspace tabs.
- `frontend/components/builder/CourtStrip.tsx` - planned changes for responsive slot sizing, row behavior, spacing, and overflow handling.
- `frontend/components/builder/BuilderHeader.tsx` - planned changes for wrapping the Lab breadcrumb and header action row on narrow screens.
- `frontend/components/builder/SalaryGauge.tsx` - planned changes for wrapping the SalaryCap gauge labels and bar on narrow screens.
- `frontend/components/builder/PlayerPickerPanel.tsx` - planned changes for responsive Card grid and narrow-friendly view behavior.
- `frontend/components/players/PlayerPoolBrowser.tsx` - possible changes only if the shared collection wrapper needs class hooks to support responsive Card or Panel behavior.
- `frontend/components/players/PlayerTable.tsx` - possible changes only if browser audit shows pagination or column controls break on narrow widths.
- `frontend/components/builder/BuilderFeedbackPanel.tsx` - planned changes for scroll behavior, narrow layout, and dense section reflow.
- `frontend/components/builder/feedback-read/*` - possible changes for responsive read-section grids or nested scroll removal.

### Deleted Files

- None planned.

## Data & API Changes

No data or API changes. This pass must not alter backend endpoints, request shapes, response shapes, scoring formulas, evaluation triggers, or persisted data. The existing builder evaluation behavior from `POST /api/builder/evaluate` remains the source of Feedback data.

## Invariants to Preserve

Clicking a filled Build slot selects that Player for Feedback.

Dragging a filled Build slot onto another slot swaps the Players.

Right-clicking a Player in the Build opens Profile.

Left-clicking a PlayerView Row or Card from the PlayerPool adds the Player to the Build when the Player is available.

Panel mode click does not add the Player to the Build.

SalaryCap hover preview remains layout-stable and describes already committed salary usage.

Feedback suggestion filter links continue to inject PlayerPool filters.

The text in builder copy uses Impact Trait, not composite.

Existing human-communicatable `id` attributes are preserved where possible, and any new React or HTML element receives a human-communicatable id.

## Plan of Work

Milestone 1 audits the current UI without editing code. Start the frontend on port 3000 and the backend on port 5001 if they are not already running. Open a Build with at least five Players so that Feedback has a real read and Lineup Combinations exist. Capture screenshots or browser observations at these viewport sizes: desktop `1440x900`, short laptop `1280x720`, tablet landscape `1024x768`, tablet portrait `768x1024`, and mobile `390x844`. Record failures in `Surprises & Discoveries`, grouped by component. Look specifically for clipped Build slots, unreachable controls, horizontal overflow outside intentional Row table scroll, dead scroll areas, nested scroll traps, clipped Feedback text, broken tab controls, and touch targets below roughly 44 by 44 pixels.

Milestone 2 changes the page shell in `BuilderPage.tsx`. Replace the always-fixed `h-[calc(100vh-3rem)] flex flex-col` behavior with breakpoint-specific classes. Desktop can keep a controlled viewport with `h-[calc(100vh-3rem)]` and `min-h-0` children. Smaller screens should use `min-h-[calc(100vh-3rem)]` and natural page scroll. Change `builder-workspace` from a permanent row into a responsive layout: desktop row, smaller screens stacked column. Apply `feedbackFrac` inline flex styles only when the desktop split is active. Hide `builder-workspace-resize-handle` below desktop. Add smaller-screen workspace tabs so PlayerPool and Feedback are adjacent modes rather than a long stacked page.

Milestone 3 changes `CourtStrip.tsx`. Keep the SalaryCap gauge at the top. Make the slot strip resilient by combining smaller slot sizes on narrow screens with either horizontal scrolling or a two-row compact layout. The chosen behavior should be based on browser audit: if horizontal scroll keeps drag targets clear and labels readable, prefer it because it preserves the Starting Lineup and bench grouping. If the whole strip still feels cramped on mobile, use a two-row layout with Cornerstone and Starting Lineup first, bench second. Preserve `data-builder-slot-index`, `builder-slot-*` ids, click handling, pointer drag swap, drop handling, hover preview, and right-click Profile behavior.

Milestone 4 changes PlayerPool views. In `PlayerPickerPanel.tsx`, replace `cardGridClassName="grid grid-cols-4 gap-3"` with responsive grid tracks such as `grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3`, adjusted after visual audit. Keep Row view as the default and preserve the shared table's horizontal scroll. Confirm Panel view on narrow screens either reflows acceptably or is hidden from the narrow view toggle only if it cannot be made useful without a larger redesign. If Panel is hidden on mobile, document the decision here and ensure Profile remains reachable.

Milestone 5 changes Feedback responsiveness. In `BuilderFeedbackPanel.tsx`, keep the desktop panel scroll behavior, but let the expanded Feedback panel participate in normal page height on narrow screens. Remove or breakpoint-limit nested `max-h` scroll regions when they create scroll traps. Keep Build Notes visible early. Make Score Factors, Skill Profile, Impact Traits, Lineup Reach, and Lineup Effects reflow into one column when narrow. Preserve the Feedback tabs and collapse button ids.

Milestone 6 validates the full responsive pass. Run static checks and the focused backend test. Then repeat the browser viewport matrix with a Build containing five or more Players and Feedback expanded. Confirm all preserved interactions still work.

## Concrete Steps

Before editing, inspect current source from repository root:

    sed -n '1,360p' frontend/components/builder/BuilderPage.tsx
    sed -n '1,360p' frontend/components/builder/CourtStrip.tsx
    sed -n '1,260p' frontend/components/builder/PlayerPickerPanel.tsx
    sed -n '1330,1465p' frontend/components/builder/BuilderFeedbackPanel.tsx

Start or confirm servers:

    cd backend
    source venv/bin/activate
    python -m flask run --port=5001

In another terminal:

    cd frontend
    npm run dev

Open the Build route:

    http://localhost:3000/lab/standard/build?cornerstone=<valid Legend id>

After each meaningful responsive slice, run:

    cd frontend
    npx tsc --noEmit
    npm run lint

After the full pass, run:

    cd backend
    source venv/bin/activate
    python -m pytest tests/test_builder_api_cohesion.py -q

Then run:

    git diff --check

Expected results are: TypeScript exits with no errors; lint exits with no errors; the focused backend test file passes; `git diff --check` prints no whitespace errors.

Do not require `npm run build` as the baseline while the known unrelated `/profile` prerender failure exists. If that failure is fixed before this plan is completed, add `cd frontend && npm run build` as an optional final check and document the result in `Outcomes & Retrospective`.

## Validation and Acceptance

Desktop acceptance at `1440x900`: the Build page keeps the current two-pane workflow. The CourtStrip is fully visible. The resize handle appears between PlayerPool and Feedback and can resize Feedback within the existing min and max fractions. PlayerPool Row, Card, and Panel views remain usable. Feedback can be collapsed and expanded. No content overlaps incoherently.

Short laptop acceptance at `1280x720`: the CourtStrip remains usable without clipping. The workspace does not squeeze the CourtStrip into unreadable content. Feedback content can be reached without dead scroll areas. The Evaluate action remains visible or naturally reachable.

Tablet landscape acceptance at `1024x768`: the layout either keeps two panes with adequate readable width or stacks the PlayerPool and Feedback. If stacked, the resize handle is hidden. PlayerPool controls wrap without overlapping. Row view uses intentional horizontal table scroll.

Tablet portrait acceptance at `768x1024`: the layout should stack. CourtStrip slots remain selectable, removable, draggable where supported, and right-click or context behavior remains available for pointer devices. Feedback should read as a normal section rather than a cramped side rail.

Mobile acceptance at `390x844`: the page uses a single-column shell with smaller-screen workspace tabs. Header, CourtStrip, PlayerPool, and Feedback are all reachable without horizontal page overflow. Feedback is reachable through the Feedback tab without scrolling through the full PlayerPool. Card grid becomes one column. Row view table scroll is horizontal only inside the table wrapper. Panel mode is either useful or unavailable from the mobile toggle with Profile inspection still available.

Interaction acceptance across breakpoints: add at least five Players from the PlayerPool to the Build; click a filled Build slot and see Feedback focus that Player; drag a filled Build slot onto another filled slot and see the Players swap; right-click a filled Build slot and see Profile open; left-click a PlayerView Row or Card in PlayerPool and see the Player added when available; choose Panel mode and confirm plain panel click does not add the Player.

## Testing Plan

### Unit Tests

No new unit tests are required for CSS-only responsive changes unless implementation introduces new pure helper logic. If any new helper function decides layout mode or view availability, add focused tests for that helper near existing frontend test infrastructure if such infrastructure exists. If no frontend test script exists, keep the logic simple enough to verify through TypeScript and browser smoke.

### Integration Tests

Run the existing focused backend integration test:

    cd backend
    source venv/bin/activate
    python -m pytest tests/test_builder_api_cohesion.py -q

This test is not expected to change, but it protects against accidental evaluation behavior changes if any frontend API wiring is touched.

### E2E Tests

No committed E2E test is required for this pass unless the project already has a stable E2E harness available during implementation. Browser smoke is required. The smoke must cover the viewport matrix and the preserved interactions listed in Validation and Acceptance.

## Idempotence and Recovery

All planned changes are frontend layout changes plus this ExecPlan. They can be applied and reverted file-by-file without database migrations or destructive operations.

Do not modify unrelated `.cowork` files. If they appear in `git status`, leave them alone unless the user explicitly asks to manage handoff files.

If the responsive pass causes TypeScript or lint failures, fix the failures instead of disabling checks. If three attempted approaches fail, stop and update `Surprises & Discoveries` with what failed, then reassess the layout strategy before continuing.

If browser smoke cannot run because the backend or frontend server fails to start, document the exact error in `Surprises & Discoveries` and still run static verification. Do not treat missing browser smoke as success.

## Artifacts and Notes

Useful audit matrix:

    1440x900  desktop
    1280x720  short laptop
    1024x768  tablet landscape
    768x1024  tablet portrait
    390x844   mobile

Useful visual reference:

    .cowork/Screenshot 2026-05-10 at 10-33-58 Cornerstone.png

Baseline verification:

    cd frontend && npx tsc --noEmit
    cd frontend && npm run lint
    cd backend && source venv/bin/activate && python -m pytest tests/test_builder_api_cohesion.py -q
    git diff --check

Known baseline caveat:

    Full frontend build has had an unrelated /profile prerender failure in this workstream. Do not make npm run build the required gate unless that issue is fixed or this responsive pass touches the failing route.

## Interfaces and Dependencies

Use existing React, Next.js, TypeScript, Tailwind, and local components. Do not introduce new packages for responsive behavior.

Preserve the current component interfaces unless a small prop is clearly needed. If a new prop is added, name it by behavior rather than viewport, and document it in this plan. Examples of acceptable additions include className hooks for shared PlayerPool wrappers or a boolean that disables Panel view on small containers. Avoid adding global resize listeners unless CSS cannot express the layout.

Existing DOM ids are part of the human conversation contract for this project. Keep ids such as `builder-page`, `builder-court-strip`, `builder-workspace`, `builder-playerpool-panel`, `builder-workspace-resize-handle`, `builder-notes-panel`, `builder-feedback-panel`, and `builder-slot-*` stable unless there is a strong reason to change them and the change is documented in the Decision Log.

## Change Notes

- 2026-05-11 / Codex: Created the initial ExecPlan so the responsive Build pass has a self-contained source of record before implementation begins. The plan intentionally limits scope to layout, scroll, and responsive behavior while preserving builder evaluation semantics.
- 2026-05-11 / Codex: Updated the plan after adding smaller-screen workspace tabs for PlayerPool and Feedback. This records the product decision that Feedback should not sit below the full PlayerPool on mobile and tablet portrait.
