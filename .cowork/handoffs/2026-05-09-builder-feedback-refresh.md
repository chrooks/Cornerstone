# Handoff: Fix Outdated Feedback Section In Build

## Context

The next focused task is refreshing the outdated Feedback section on the Build page.

Use `CONTEXT.md` vocabulary strictly:
- **Build** means the Lab step where the user assembles a Team around a Cornerstone.
- **Rotation** means the nine-player Team the user is constructing.
- **PlayerPoolBrowser** means the shared browser that owns filtering, sorting, pagination, PlayerView size, and column visibility for a PlayerPool.
- **PlayerView** means one visual representation of one Player at a given size: Row, Card, Panel, or Profile.

The PlayerView size system is committed in `e488907 feat: add PlayerView size system`. The current Build page uses PlayerPoolBrowser with Row/Card/Panel, Profile modal support, and a tightened CourtStrip.

## Current State

The Feedback section is likely implemented across:

| File | Role |
|---|---|
| [`frontend/components/builder/AssistantGmNotes.tsx`](../../frontend/components/builder/AssistantGmNotes.tsx) | Main Feedback panel UI, currently headed "Assistant GM Feedback" |
| [`frontend/components/builder/NotesList.tsx`](../../frontend/components/builder/NotesList.tsx) | Renders notes and suggestion links |
| [`frontend/components/builder/BuilderPage.tsx`](../../frontend/components/builder/BuilderPage.tsx) | Feedback panel call site and PlayerPoolBrowser filter interactions |
| [`frontend/components/builder/CourtStrip.tsx`](../../frontend/components/builder/CourtStrip.tsx) | Recent flat/tight Build surface polish; do not regress |

Known uncommitted unrelated changes at handoff time:
- `.cowork/index.md`
- `frontend/components/builder/BuilderHeader.tsx`
- `frontend/components/builder/BuilderPage.tsx`
- `.cowork/handoffs/2026-05-09-playerpool-browser-levelset.md`

Do not revert or overwrite unrelated user/worktree changes.

## Problem To Solve

The Feedback section visually and conceptually lags behind the new Build experience. It still reads like an older assistant panel, while the surrounding page now has:
- A flatter, tighter CourtStrip surface
- PlayerPoolBrowser with Row/Card/Panel PlayerView sizes
- More compact, data-forward controls
- DESIGN.md constraints against nested card-heavy composition, decorative gradients, and loose spacing

The goal is to make Feedback feel native to the current Build screen, not bolted on.

## Implementation Direction

1. Inspect `AssistantGmNotes.tsx`, `NotesList.tsx`, and the `BuilderPage.tsx` call site before editing.
2. Keep existing behavior unless the user asks otherwise:
   - Feedback can still be dismissed if currently dismissible.
   - Suggestion/action links should still filter or steer the PlayerPoolBrowser.
   - Slot/player-specific note interactions should continue working.
3. Refresh the IA and UI language:
   - Consider whether "Assistant GM Feedback" should become simpler product language like "Feedback" or "Rotation Feedback".
   - Keep labels aligned to Build and Rotation language.
   - Remove outdated assistant/chat-like feel if present.
4. Apply DESIGN.md:
   - Flat warm-paper surfaces.
   - Tight spacing.
   - No gradients.
   - No heavy shadows.
   - Avoid cards inside cards.
   - Keep border radius small.
5. Add or preserve human-communicatable `id` attributes on React/HTML elements.

## Skills / Process

Use `$impeccable` for the frontend/design pass. If the work expands into behavior changes, use `$tdd` for testable logic and `$verification-loop` before committing.

## Verification

Run:

```bash
cd frontend && npx tsc --noEmit --pretty false
cd frontend && npm run lint
git diff --check
```

Manual check:
- Open `/lab/standard/build`.
- Verify the Feedback section visually matches the current Build page.
- Verify suggestion links still affect PlayerPoolBrowser filters.
- Verify dismiss/close behavior still works if present.
- Verify the PlayerPoolBrowser Row/Card/Panel controls and CourtStrip are not regressed.

## Important

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET.** This handoff is only a restart point for the next focused task.
