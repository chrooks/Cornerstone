# Feedback Refresh -> Right Panel Wiring Handoff

## Context

Read and follow `CONTEXT.md` as the source of truth for domain vocabulary. There is no `docs/adr/` directory in this checkout.

Relevant language:
- **Build** is the Lab step where the user assembles a Team around a Cornerstone.
- **Rotation** is the 9-player Team in the Standard RuleSet.
- **PlayerPool** is the browsable/selectable collection of Players available in a context.
- **PlayerView** is one visual representation of one Player at Row, Card, Panel, or Profile size.
- **Skill Profile** is a Player's complete dictionary of Skills at their evaluated Tier.

The latest completed commit is `89d04d9 feat(builder): refresh feedback diagnostics panel`.

## Current Implementation Status

- Completed the first Feedback right-panel refresh and committed it in `89d04d9`.
- Added/updated:
  - `frontend/components/builder/BuilderFeedbackPanel.tsx`
  - `frontend/components/builder/FeedbackTooltip.tsx`
  - `frontend/components/builder/AssistantGmNotes.tsx`
  - `frontend/components/builder/BuilderPage.tsx`
  - `frontend/components/builder/BuilderHeader.tsx`
  - `frontend/components/builder/NotesList.tsx`
  - `frontend/components/builder/PlayerPickerPanel.tsx`
  - `frontend/components/builder/SkillGrid.tsx`
  - `frontend/components/players/PlayerPoolBrowser.tsx`
  - `frontend/components/players/PlayerTable.tsx`
- The new right panel currently has tabs for `Feedback`, `Skill Profile`, and admin-only `Debug`.
- The `Skill Profile` tab now includes `Roster Composite Averages`, selected/hovered Player contribution diagnostics, a composite formula index, Lineup Impact, and the full Skill Profile matrix.
- Tooltips now portal to `document.body` via `FeedbackTooltip` so they escape the right panel scroll Boundary.
- Builder PlayerPool horizontal scrolling was fixed by giving the embedded `PlayerTable` wrapper ownership of both x/y scrolling.
- Focused verification passed during the prior session:
  - `cd frontend && npx tsc --noEmit --pretty false`
  - `cd frontend && npm run lint`
  - `git diff --check`
  - Playwright screenshot/checks for the `Skill Profile` visual Surface.

Current dirty worktree after the commit:
- `.cowork/index.md`
- `.cowork/handoffs/2026-05-09-builder-feedback-refresh.md`
- `.cowork/handoffs/2026-05-09-playerpool-browser-levelset.md`
- this handoff file

Do not revert or overwrite `.cowork` files unless the user explicitly asks.

## Important Working Instructions

- The user's requested next scope: "Analyze component hierarchy and fix wiring to new Feedback right panel. Also implement notification glow when Feedback is dismissed."
- Use `$impeccable` for design/frontend work.
- Use Playwright screenshots after visual changes before calling them done.
- Preserve existing behavior unless the user explicitly changes the Product direction.
- Keep React/HTML elements human-communicatable with stable `id` attributes.
- Do not redefine **Player**, **Rotation**, or **Cornerstone** for the user in conversational replies; they said they know those.
- When using Lexicon terms in conversation, define them in context until the user says to stop.
- If Next output looks stale, remove `frontend/.next` and run `npm run dev`.
- Avoid touching unrelated dirty Builder or `.cowork` changes.

## Next 3 Steps

1. Analyze the component hierarchy around `BuilderPage`, `BuilderFeedbackPanel`, `AssistantGmNotes`, `PlayerPickerPanel`, `PlayerPoolBrowser`, and `PlayerTable`; document the current ownership Boundary for eval state, focused Player state, hover inspection state, dismissal/collapse state, and notification state.
2. Fix wiring to the new Feedback right panel so data and interactions flow through `BuilderFeedbackPanel` deliberately: latest eval, focused Player, inspected Player, suggestion filters, close/collapse, and tab state should have clear ownership and no stale legacy "GM Notes" wiring.
3. Implement notification glow when Feedback is dismissed: when the right panel is collapsed and a new eval or relevant Feedback change arrives, the collapsed control should glow/pulse until the user expands Feedback again.

## Expectations For This Conversation

1. Start by reading the relevant components and explaining the current hierarchy before editing.
2. Keep the implementation narrow: fix wiring and dismissed Feedback notification glow only.
3. Use Playwright to capture a screenshot after visual changes and inspect the result.
4. Run the focused frontend verification commands before finalizing.

## Verification Baseline

Run:

```bash
cd frontend && npx tsc --noEmit --pretty false
cd frontend && npm run lint
git diff --check
```

Manual / Playwright checks:
- Open `/lab/standard/build?cornerstone=<id>`.
- Confirm the right panel `Feedback` tab receives live eval data.
- Collapse/dismiss Feedback, change the Build enough to trigger a new eval, and verify the collapsed control glows.
- Expand Feedback and verify the notification glow clears.
- Confirm the `Skill Profile` tab still shows `Roster Composite Averages`, Player contribution, formula index, Lineup Impact, and full Skill Profile.
- Confirm PlayerPool horizontal scrolling still works in Row view.

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
