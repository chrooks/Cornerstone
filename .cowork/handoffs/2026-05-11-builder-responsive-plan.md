# Builder Feedback Read -> Builder Responsive Plan Handoff

## Context
Read `CONTEXT.md` first and keep the Lexicon precise. Key terms for this work:
- **Team**: any group of 5 or more Players submitted for evaluation.
- **Build**: the in-progress Team configuration in the Lab before saving.
- **Lab**: the full lifecycle of selecting a RuleSet, picking a Cornerstone, assembling a Build, and evaluating it.
- **Player**: the universal individual unit.
- **PlayerPool**: the browsable collection of selectable Players.
- **PlayerView**: one Player rendered as Row, Card, Panel, or Profile.
- **Feedback**: the builder panel explaining the current Build read.
- **Lineup Combination**: one five-Player Lineup generated from the current Team.

No relevant `docs/adr/` files exist in this checkout. Design context is in `PRODUCT.md` and `DESIGN.md`; use `/impeccable` for the responsive UI pass.

Primary scope: make `/lab/[ruleset]/build` responsive without changing builder evaluation semantics.

Useful visual reference: `.cowork/Screenshot 2026-05-10 at 10-33-58 Cornerstone.png`.

## Current Implementation Status
- Completed and committed the builder Feedback read and Player inspection work in `9f7b6d5 feat(builder): refine feedback read and inspection flow`.
- Current Build page ownership:
  - `frontend/components/builder/BuilderPage.tsx` owns the full route shell, the PlayerPool / Feedback split, resize handle, selected Player focus, and Profile modal wiring.
  - `frontend/components/builder/CourtStrip.tsx` owns the SalaryCap gauge plus 9-slot strip.
  - `frontend/components/builder/PlayerPickerPanel.tsx` owns the builder PlayerPool, view toggle, hint, filtering, and Player add behavior.
  - `frontend/components/builder/BuilderFeedbackPanel.tsx` owns the Feedback panel shell and scroll container.
  - `frontend/components/builder/feedback-read/*` owns reusable read sections for Skill Profile, Impact Traits, and Lineup reach.
  - `frontend/components/players/PlayerPoolBrowser.tsx` and `frontend/components/players/PlayerTable.tsx` own shared PlayerPool layout and table behavior.
- Known responsive risk points from code inspection:
  - `BuilderPage.tsx` uses `h-[calc(100vh-3rem)] flex flex-col`, so shorter viewports can squeeze the CourtStrip and workspace instead of allowing a natural page scroll.
  - `BuilderPage.tsx` keeps PlayerPool and Feedback as a horizontal split with `feedbackFrac` at all widths; there is no mobile or tablet layout mode.
  - `CourtStrip.tsx` uses fixed slot sizes, fixed gap/margins, and `overflow-hidden`; the 9-slot row can crowd or clip on narrow widths.
  - `PlayerPickerPanel.tsx` hard-codes Card view to `grid grid-cols-4 gap-3`, which is too rigid for tablet and mobile widths.
  - `BuilderFeedbackPanel.tsx` uses dense cards and several fixed/max-height sections; the panel itself scrolls, but nested sections can still feel cramped.
- Working tree after the commit currently has two unrelated untracked handoffs:
  - `.cowork/handoffs/2026-05-09-builder-feedback-refresh.md`
  - `.cowork/handoffs/2026-05-09-playerpool-browser-levelset.md`

## Important Working Instructions
- Keep changes scoped to builder responsiveness unless the user expands scope.
- Preserve recent builder behavior:
  - Clicking a filled Build slot selects that Player for Feedback.
  - Dragging a filled Build slot onto another slot swaps the Players.
  - Right-clicking a Player in the Build opens Profile.
  - Left-clicking a PlayerView Row/Card from the PlayerPool adds the Player to the Build.
  - Panel mode click does nothing.
- Keep React/HTML elements named with human-communicatable `id` tags.
- Use the Lexicon in user-facing copy. Avoid “composite” in builder copy; use **Impact Trait**.
- Use `/impeccable` for frontend design, `/tdd` for feature behavior where testable, `/verification-loop` before commit, and `/commit` when committing.
- Frontend dev server is expected on port `3000`; backend on `5001`.
- Current full frontend build has had an unrelated `/profile` prerender failure in this workstream. Use `npx tsc --noEmit`, `npm run lint`, focused tests, and browser smoke as the baseline unless that failure is fixed.

## Responsive Plan
1. Audit the current layout in browser before editing:
   - Desktop: `1440x900`.
   - Short laptop: `1280x720`.
   - Tablet landscape: `1024x768`.
   - Tablet portrait: `768x1024`.
   - Mobile: `390x844`.
   - Capture screenshots for the Build with 5+ Players and the Feedback panel expanded. Note overlap, clipped text, dead scroll areas, inaccessible controls, and whether the CourtStrip remains usable.
2. Define breakpoint behavior before implementation:
   - Desktop (`lg` and up): keep the current two-pane PlayerPool / Feedback split and resize handle.
   - Tablet: keep two panes only if each pane has enough width for the active PlayerPool view; otherwise stack PlayerPool above Feedback and hide the resize handle.
   - Mobile: use a single-column flow: header, CourtStrip, compact Feedback summary, PlayerPool, then full Feedback. Avoid nested scroll traps.
3. Make the page shell responsive:
   - Replace the always-fixed viewport shell with breakpoint-specific height rules, e.g. desktop keeps a controlled viewport workspace, smaller screens use `min-h-[calc(100vh-3rem)]` and page-level scrolling.
   - Gate `feedbackFrac` and `builder-workspace-resize-handle` to desktop widths only.
   - Ensure collapsed Feedback still has a useful affordance on narrow screens.
4. Make `CourtStrip.tsx` adapt:
   - Allow horizontal scrolling or a two-row compact slot layout before clipping.
   - Reduce slot size and gaps at narrow widths while keeping the Cornerstone, Starting Lineup, and bench boundary legible.
   - Preserve drag-to-swap and right-click Profile behavior.
5. Make PlayerPool views responsive:
   - Replace hard-coded `grid-cols-4` with responsive grid tracks, likely `grid-cols-[repeat(auto-fit,minmax(220px,1fr))]` or explicit breakpoint columns.
   - Confirm Row view keeps table horizontal scroll instead of squeezing columns into unreadable text.
   - Confirm Panel view gets a narrow-friendly layout or is hidden/disabled on mobile if it cannot be made useful.
6. Make Feedback sections responsive:
   - Keep Build Notes visible early.
   - Keep Score Factors and Rotation Reach readable without horizontal overflow.
   - Ensure Skill Profile, Impact Traits, and Lineup Reach sections can scroll internally only when that helps, not as nested scroll traps on mobile.

## Next 3 Steps
1. Start with a browser audit on port `3000`, capture screenshots for the five viewport sizes above, and list concrete failures by component.
2. Implement the page-shell breakpoint behavior in `BuilderPage.tsx` and `CourtStrip.tsx` first, because those control the worst clipping and scroll issues.
3. Then tune `PlayerPickerPanel.tsx`, `PlayerPoolBrowser.tsx`, and `BuilderFeedbackPanel.tsx` for responsive grids, panel stacking, and nested scroll cleanup.

## Expectations For This Conversation
1. Do not start by redesigning the Feedback information architecture again; this pass is layout, scroll, and responsive behavior.
2. Validate visually in the browser after each meaningful responsive slice, not only with lint.
3. Keep changes small enough to review and commit as one responsive pass if possible.

## Verification Baseline
Use the repo-local backend venv and frontend npm scripts:
- `cd frontend && npx tsc --noEmit`
- `cd frontend && npm run lint`
- `cd backend && source venv/bin/activate && python -m pytest tests/test_builder_api_cohesion.py -q`
- Browser smoke on `http://localhost:3000/lab/standard/build?...` with the viewport matrix listed above.

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
