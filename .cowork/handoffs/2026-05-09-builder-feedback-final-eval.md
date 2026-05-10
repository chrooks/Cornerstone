# Builder Feedback Done -> Final Eval Page Handoff

## Context

Read and follow `CONTEXT.md` as the source of truth for domain vocabulary. There is no `docs/adr/` directory in this checkout.

Relevant language:
- **Team** is the universal evaluated group of 5 or more Players.
- **Lineup** is a 5-player Team and the atomic evaluation unit.
- **Rotation** is the 9-player Team in the Standard RuleSet.
- **Starting Lineup** is the first five selected slots in a Rotation or Roster.
- **Lineup Combination** is one five-player Lineup generated from a Rotation.
- **Versatility** is the rotation-level variety of viable lineup archetypes.
- **Lab** is the full lifecycle: RuleSet selection, Cornerstone selection, Build assembly, and Eval.
- **Build** is the in-progress Team assembly state in the Lab before saving.
- **RuleSet** defines constraints for a Lab session.
- **PlayerPool** is the browsable/selectable collection of Players available in a context.
- **PlayerView** is one visual representation of one Player at Row, Card, Panel, or Profile size.
- **Skill Profile** is a Player's complete dictionary of Skills at their evaluated Tier.

Useful docs for the next scope:
- `docs/evaluator-api-contract.md` documents `POST /api/builder/evaluate`.
- `docs/team-building-heuristics.md` may help shape the final Eval page narrative and scoring emphasis.
- `docs/agents/domain.md` points to domain documentation conventions.

The latest completed commit is `9ee2a2a fix(builder): wire feedback panel updates`.

## Current Implementation Status

- Builder Feedback right-panel wiring is done and committed.
- Completed behavior in commit `9ee2a2a`:
  - Live Feedback remains mounted while the right panel is collapsed or another tab is active.
  - Collapsed Feedback rail glows when a new eval arrives and clears when expanded.
  - Focused Player empty state now says there are no Player-specific pressure points instead of implying the full Rotation has no pressure points.
  - Visible Feedback update history is limited to Player add, Player remove, or movement across the Starting Lineup / bench split.
  - Score factor tooltips now explain Starting Lineup, Depth, Versatility, and Floor.
  - Build slot URL sync preserves the active `/lab/<ruleset>/build` route instead of jumping to legacy `/builder`.
- Added/updated in the completed Builder scope:
  - `frontend/components/builder/AssistantGmNotes.tsx`
  - `frontend/components/builder/BuilderFeedbackPanel.tsx`
  - `frontend/components/builder/BuilderPage.tsx`
  - `frontend/lib/hooks/useRosterSlots.ts`
- Focused verification passed in the previous session:
  - `cd frontend && npx tsc --noEmit --pretty false`
  - `cd frontend && npm run lint`
  - `git diff --check`
  - `cd frontend && npm run build` passed with existing Node 18 Supabase deprecation warnings.
  - Playwright checks verified collapsed Feedback glow, eval 200 responses, `/lab/standard/build` route preservation, Skill Profile sections, PlayerPool Row horizontal scrolling, focused Player empty copy, visible update filtering, and descriptive score tooltips.

Current git status at handoff creation:
- No tracked changes after commit `9ee2a2a`.
- `.cowork/` files are local handoff plumbing and may be dirty/ignored depending on the caller's git configuration. Do not revert or overwrite unrelated `.cowork` files unless explicitly asked.
- `feature_requests/feedback-right-panel-wiring-glow-plan.md` was created during the Builder work, but `feature_requests/` is ignored by `.gitignore`, so it may not appear in `git status`.

## Important Working Instructions

- The user explicitly said: "Alright were done w the builder for now. I want to move onto the final eval page."
- Do not continue Builder polishing unless the final Eval page work directly requires a small compatibility fix.
- Use `$impeccable` for design/frontend work.
- Use `$tdd` when implementing feature behavior, especially testable logic.
- Use `$verification-loop` after implementing.
- Use `$commit` when it is time to commit.
- Keep React/HTML elements human-communicatable with stable `id` attributes.
- Use Lexicon terms from `CONTEXT.md`. The user said not to redefine Player, Rotation, or Cornerstone in casual replies, but the next session should still use the terms correctly.
- Preserve existing behavior unless the user changes Product direction.
- If Next output looks stale, remove `frontend/.next` and run `npm run dev`.

## Next 3 Steps

1. Analyze the final Eval page hierarchy around `frontend/components/builder/EvaluatePage.tsx`, `frontend/components/builder/CohesionScoreDisplay.tsx`, `frontend/components/builder/NotesList.tsx`, `frontend/components/builder/CohesionDebugPanel.tsx`, `frontend/app/lab/[ruleset]/eval/page.tsx`, and `frontend/app/builder/evaluate/page.tsx`; document current ownership of data loading, final eval execution, Team description cache, score display, notes, debug, and navigation.
2. Compare the final Eval page UI and information architecture against the completed Builder Feedback panel. Identify what should be reused, adapted, or intentionally different for final mode: score factor explanations, Rotation identity, Lineup Combination visibility, notes/pressure points, Team identity narrative, admin debug, and back-to-Build route handling.
3. Propose a narrow direction for the first final Eval page refresh slice before editing. Recommended first slice: bring the final Eval page scoring/notes explanation up to the new Builder Feedback clarity while preserving the existing final-mode API call and Team description cache.

## Expectations For This Conversation

1. Start by reading the relevant Eval page components and explaining the current hierarchy before editing.
2. Keep the implementation narrow: final Eval page only, unless a shared helper is the safest way to avoid duplicating Builder score explanatory copy.
3. Use Playwright screenshots after visual changes before calling them done.
4. Run focused frontend verification commands before finalizing.
5. Commit only after verification passes and the user confirms the commit message.

## Verification Baseline

Run:

```bash
cd frontend && npx tsc --noEmit --pretty false
cd frontend && npm run lint
git diff --check
```

For substantial final Eval page UI changes, also run:

```bash
cd frontend && npm run build
```

Manual / Playwright checks:
- Open `/lab/standard/eval?cornerstone=<id>&s1=<cornerstone-id>&s2=...` with a complete Rotation.
- Confirm final eval calls `POST /api/builder/evaluate` in final mode when no Team description cache exists.
- Confirm cached Team description behavior still avoids duplicate final narrative calls for the exact same Team fingerprint.
- Confirm score, breakdown, Team identity narrative, notes, and admin debug render correctly.
- Confirm "Back to Build" preserves the active RuleSet route and current Build query params.
- Confirm responsive layout and text fit at desktop and mobile widths.

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
