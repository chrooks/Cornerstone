# Builder Feedback Read -> Preview Honesty Handoff

## Context
Read `CONTEXT.md` first and keep the builder language precise: **Skill Profile** is a Player's complete dictionary of Skills at evaluated Tier; **Impact Trait** is the normalized player-level effect derived from that Skill Profile; **Lineup Subscore** is a lower-level Lineup fit measurement; **Lineup Combination** is one five-player Lineup generated from the current Team.

The current thread focused on redesigning the builder Feedback panel so the user can understand the path from Player skills to contribution: Skill Profile -> Impact Trait -> Lineup Subscore -> Score Factors -> Overall Team Score.

## Current Implementation Status
- Completed the first builder Feedback slice:
  - Added ranked current-state `lineup_combinations` to `POST /api/builder/evaluate`.
  - Added the new builder Feedback read tab with Skill Profile -> Impact Trait -> Lineup Effects trace.
  - Added Build-level default state when no Player is selected.
  - Moved Score Factors near the Cohesion Score and added score-shape/tooltips.
  - Added Skill, Impact Trait, and Lineup Subscore descriptions for hover tooltips.
  - Added Best/Median With Player cards using last names and aligned headings.
- Added/updated:
  - `backend/api/builder.py`
  - `backend/tests/test_builder_api_cohesion.py`
  - `frontend/components/builder/AssistantGmNotes.tsx`
  - `frontend/components/builder/BuilderFeedbackPanel.tsx`
  - `frontend/components/builder/CohesionScoreDisplay.tsx`
  - `frontend/lib/cohesion-constants.ts`
  - `frontend/lib/skills.ts`
  - `frontend/lib/types.ts`
- Focused verification from this session:
  - `cd frontend && npm run lint` passed.
  - `cd backend && source venv/bin/activate && python -m pytest tests/test_builder_api_cohesion.py -q` passed.

## Important Working Instructions
- Keep React/HTML elements named with human-communicatable `id` tags.
- Continue using the repo Lexicon. Avoid "composite" in user-facing builder copy; use **Impact Trait**.
- Do not commit unrelated Saved Team/profile/auth work unless the next user request explicitly includes it.
- The frontend dev server is expected on port `3000`.
- Current full frontend build has an unrelated `/profile` prerender failure; use lint and focused tests as the baseline until that is fixed.

## Outstanding Builder TODOs
- Responsiveness desperately needs tuning. See `.cowork/Screenshot 2026-05-10 at 10-33-58 Cornerstone.png`.
- Rename `New Feedback` to `Feedback`; remove the old Feedback tab.
- Audit whether the `Skill Profile` tab is still necessary. Define what purpose it serves if it stays.
- Leaving PlayerPool PlayerView hover dismisses the right panel eval, making it impossible to inspect Potential Contribution without adding the Player to the Build.
- Update UI to say `Contribution Preview` when the panel is in PlayerPool hover mode.
- Starting/Best/Median Lineup selector: show one Lineup card at a time, switch with tabs on one card.
- Revisit Next Search filtering. Consider detecting degree of need, then applying a minimum Skill Tier filter.
- Make hover mode more honest about preview state.

## Best First Tackles
- Easiest: update PlayerPool hover mode copy to `Contribution Preview` and mark preview-only sections clearly. This is mostly frontend state/copy once hover provenance is passed into the panel.
- Most Impact: fix PlayerPool hover persistence so the user can inspect Potential Contribution without adding the Player to the Build. This directly supports the core loop: get Feedback -> pick Player -> get new eval.

## Next 3 Steps
1. Add explicit hover provenance to the builder Feedback panel so it can distinguish Build Player contribution from PlayerPool Contribution Preview.
2. Rename/remove Feedback tabs once the new read owns the primary Feedback surface.
3. Do the responsiveness pass against `.cowork/Screenshot 2026-05-10 at 10-33-58 Cornerstone.png`, then tighten the Lineup selector and Next Search behavior.

## Expectations For This Conversation
1. Start by validating current builder Feedback behavior in the browser on port `3000`.
2. Keep changes scoped to builder Feedback unless asked otherwise.
3. Preserve focused tests and lint before committing.

## Verification Baseline
Use the repo-local backend venv and the frontend npm scripts:
- `cd frontend && npm run lint`
- `cd backend && source venv/bin/activate && python -m pytest tests/test_builder_api_cohesion.py -q`

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
