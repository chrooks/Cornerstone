# Final Eval Refresh -> Save Team Workflow Handoff

## Context
Read and follow `CONTEXT.md` as the source of truth for domain vocabulary. There is no `docs/adr/` directory in this checkout. Relevant docs for the next scope:
- `docs/evaluator-api-contract.md` documents `POST /api/builder/evaluate`, which the final Eval page already uses.
- `docs/team-building-heuristics.md` may help shape saved Team metadata or summary copy.
- `docs/agents/domain.md` points to domain documentation conventions.

Use the latest completed commit `6732c01 feat(eval): refresh final evaluation report` as the implementation baseline.

## Current Implementation Status
- Final Eval page refresh is complete and committed in `6732c01`.
- Completed behavior in the final Eval refresh:
  - Final Eval score Surface now reads like a scouting report with Rotation cohesion, `3.90 / 5` score formatting, Starting Lineup score, viable Lineup Combinations, and median Lineup Combination.
  - Subscores now render as scouting grade tiles with Starting Lineup score, Rotation Median, and Durability delta instead of paired progress bars.
  - Team identity narrative takes the full container width and uses Title Case section headings.
  - Rotation summary PlayerViews are centered, use the same Starting Lineup / bench Boundary pattern as `CourtStrip`, and request sharper headshot images.
  - Score factor labels/explainers are shared between Builder Feedback and final Eval via `frontend/lib/cohesionScoreExplainers.ts`.
- Added/updated in the completed Eval scope:
  - `frontend/components/PlayerHeadshot.tsx`
  - `frontend/components/builder/AssistantGmNotes.tsx`
  - `frontend/components/builder/BuilderFeedbackPanel.tsx`
  - `frontend/components/builder/CohesionScoreDisplay.tsx`
  - `frontend/components/builder/EvaluatePage.tsx`
  - `frontend/components/builder/NotesList.tsx`
  - `frontend/lib/cohesionScoreExplainers.ts`
- Focused verification passed before commit:
  - `cd frontend && npx tsc --noEmit --pretty false`
  - `cd frontend && npm run lint`
  - `git diff --check`
  - `cd frontend && npm run build` passed with existing Node 18 Supabase deprecation warnings.
- Current repo status at handoff creation:
  - No tracked product-code changes after `6732c01`.
  - `.cowork/` handoff plumbing may be dirty or untracked. Do not revert unrelated `.cowork` files.

## Important Working Instructions
- Next requested scope: **Save Team workflow** from the final Eval page.
- Use Lexicon terms from `CONTEXT.md` strictly:
  - Team is the universal evaluated group of 5 or more Players.
  - Rotation is the 9-player Team in the Standard RuleSet.
  - Starting Lineup is the first five selected slots in a Rotation or Roster.
  - Build is the in-progress Team assembly state in the Lab before saving.
  - RuleSet defines constraints for a Lab session.
  - PlayerView is one visual representation of one Player at Row, Card, Panel, or Profile size.
- Keep using stable, human-communicatable React/HTML `id` attributes.
- Use `$impeccable` for frontend/design work, `$tdd` for testable behavior, `$verification-loop` after implementation, and `$commit` when ready to commit.
- Preserve existing final Eval API call behavior and Team description cache unless Save Team requires a small compatibility change.
- The current `Save Team` button in `frontend/components/builder/EvaluatePage.tsx` is disabled and only shown for logged-in users.
- Existing backend persistence lives in `backend/api/rosters.py`, but it uses older Roster terminology and supports `1 cornerstone + 7 supporting` in comments/constants. The current Standard RuleSet Build is a 9-player Rotation (`1 Cornerstone + 8 supporting`). Verify the persistence Contract before wiring the UI.
- All API responses follow `{ success, data, error }`. Frontend calls should go through `frontend/lib/api.ts`.
- If Next output looks stale, remove `frontend/.next` and run the existing dev server workflow. Do not start an extra server if the user says one is already running.

## Next 3 Steps
1. Analyze current persistence ownership: inspect `backend/api/rosters.py`, Supabase tables/migrations if present, `frontend/lib/types.ts`, `frontend/lib/api.ts`, and `frontend/components/builder/EvaluatePage.tsx` to determine whether Save Team should use existing `/api/rosters` endpoints or needs a new Team/RuleSet-aware Contract.
2. Propose the narrow first Save Team slice before editing. Recommended first slice: enable the final Eval `Save Team` button for logged-in users, persist the current Build as a saved Team under the active RuleSet, and show inline loading/success/error Feedback without leaving the Eval page.
3. Implement the agreed slice with focused TDD where practical: add typed API helpers, wire `EvaluatePage`, handle auth/error states, and keep the saved Team payload aligned with the current URL-derived Build and Rotation slot order.

## Expectations For This Conversation
1. Start by explaining the existing save/persistence Contract and any mismatch with the current Lab/RuleSet/Rotation model before editing.
2. Keep the implementation narrow: final Eval Save Team workflow only, unless a backend Contract adjustment is necessary for the Standard RuleSet Rotation size.
3. Do not re-polish Builder or Eval visuals unless Save Team states require it.
4. If backend persistence needs schema or Contract changes, call that out clearly and keep the first Vertical Slice small.
5. Use Playwright or browser checks after UI changes when possible, especially for Save Team loading, success, error, and unauthenticated states.
6. Commit only after verification passes and the user confirms the commit message.

## Verification Baseline
Run before finalizing:
- `cd frontend && npx tsc --noEmit --pretty false`
- `cd frontend && npm run lint`
- `git diff --check`

If backend code changes:
- `cd backend && source venv/bin/activate && python -m pytest tests/`

If frontend production behavior changes materially:
- `cd frontend && npm run build`

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
