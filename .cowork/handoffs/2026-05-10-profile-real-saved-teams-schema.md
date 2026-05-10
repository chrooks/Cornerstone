# Profile Mock -> Real Saved Teams Schema Handoff

## Context
Read and follow `CONTEXT.md` for the project Lexicon. The most relevant source-of-truth plan is `feature_requests/save-team-workflow-plan.md`, especially its sections on Saved Team persistence, Snapshot Release, deferred evaluation history, and legacy `rosters` avoidance. The active next scope from the user is: connect the mocked `/profile` frontend to backend real data, evaluate how Player/Profile data is stored, and design schema for Saved Teams, evaluations, rules, and RuleSets.

Relevant committed work from the previous session:
- `2ebc55c feat(profile): add saved teams profile screen`
- `51cf8a8 feat(profile): wire saved team rebuild actions`

## Current Implementation Status
- Completed a mocked `/profile` screen that shows user identity, Saved Teams, filter/sort controls, Player headshots, SalaryCap context, and score affordances.
- Added a reusable `CohesionScoreBadge` for star-filled Cohesion score display, used by the Profile page and the Eval Cohesion display.
- Split Saved Team actions into `See Eval` and `Rebuild`. `See Eval` is disabled until real saved evaluation storage exists. `Rebuild` currently resolves mocked Saved Team Player NBA IDs/names against the current PlayerPool and opens Builder through the existing `cornerstone` + `s1..s9` URL format.
- Added local notes to ignored `TODO.md` about Saved Team Rebuild semantics. Because `TODO.md` is ignored, those notes are not committed unless force-added.
- Added/updated in committed Profile scope:
  - `frontend/app/profile/page.tsx`
  - `frontend/components/cohesion/CohesionScoreBadge.tsx`
  - `frontend/components/builder/CohesionScoreDisplay.tsx`
- Focused checks passed during the session:
  - `cd frontend && npx tsc --noEmit`
  - `cd frontend && npm run lint -- --file app/profile/page.tsx`
  - `cd frontend && npm run lint -- --file app/profile/page.tsx --file components/cohesion/CohesionScoreBadge.tsx --file components/builder/CohesionScoreDisplay.tsx`

## Important Working Instructions
- Use the Lexicon exactly. Key terms for this next step: Team, Lineup, Rotation, Roster, Player, Legend, Cornerstone, PlayerPool, SalaryCap, Lab, Build, RuleSet, Snapshot, Snapshot Release, Canonical Player, Snapshot Player, Saved Team, Evaluation Version, Skill Profile, Impact Trait.
- Do not use legacy `rosters` as the model for new persistence. It is not user-owned, not RuleSet-aware, not Snapshot Release-aware, and does not match current Rotation size.
- Treat backend/API/storage as the next source of truth. The frontend Profile page is allowed to stay mocked until the schema and read APIs are coherent.
- Keep `See Eval` and `Rebuild` separate:
  - `See Eval` should show the historical saved evaluation.
  - `Rebuild` should create a Builder draft from a Saved Team under the current RuleSet/Snapshot Release context, with compatibility checks.
- A Saved Team must not silently mutate when a RuleSet or Snapshot Release changes. Rebuild should be explicit and non-destructive.
- The user previously asked not to run `npm run build` for these UI passes. Ask before running a production build unless the next task clearly requires it.
- Preserve unrelated dirty work. The repo currently has many unrelated modified/untracked files from other work; stage only the files needed for the current task.

## Next 3 Steps
1. Audit the current backend and database state for Player/Profile storage:
   - Inspect `frontend/lib/types.ts`, `backend/api/players.py`, `backend/services/players_service.py`, skill profile tables/usages, and any uncommitted `backend/api/saved_teams.py`, `backend/tests/test_saved_teams_api.py`, and `supabase/migrations/20260509000000_saved_teams.sql` files before deciding what to keep.
2. Draft the real data model for Saved Teams, saved evaluations, RuleSets, rules, Snapshot Releases, Canonical Players, and Snapshot Players:
   - Decide whether this should update `feature_requests/save-team-workflow-plan.md`, create a new ExecPlan, and/or add an ADR under `docs/adr/`.
   - Include explicit RuleSet version/hash or rules hash for Rebuild compatibility.
   - Include an evaluation history model that can support saved historical Eval, later re-score, and comparison against a newer Snapshot Release or Evaluation Version.
3. Implement the first narrow backend/read API slice after schema agreement:
   - Add or refine migrations.
   - Add Flask endpoints for listing the current user's Saved Teams and fetching one Saved Team with saved evaluation detail.
   - Replace the Profile mock data with real API data only after the API contract is stable.

## Expectations For This Conversation
1. Start by acknowledging this handoff, then inspect the repo and current dirty files before editing anything.
2. Propose the schema/API shape before implementing. The next work is architecture-sensitive and should not jump straight into UI wiring.
3. Use TDD for backend/API work where practical: write focused tests around RuleSet validation, Saved Team ownership, Snapshot Release association, and Saved Eval retrieval.
4. Keep the Profile page behavior honest: mocked data can remain until the backend read model is ready.

## Verification Baseline
Use the repo-local backend virtual environment when running backend tests:
- `cd backend && source venv/bin/activate && PYTHONPATH=.. python -m pytest tests/test_saved_teams_api.py`

Preserve focused frontend checks when touching Profile or shared Cohesion score UI:
- `cd frontend && npx tsc --noEmit`
- `cd frontend && npm run lint -- --file app/profile/page.tsx`
- `cd frontend && npm run lint -- --file components/cohesion/CohesionScoreBadge.tsx --file components/builder/CohesionScoreDisplay.tsx`

Known baseline caveats from prior Save Team work:
- `cd backend && source venv/bin/activate && python -m pytest tests/` may fail during collection for pre-existing `backend.services...` import issues.
- `PYTHONPATH=.. python -m pytest tests/` previously got past collection but exposed unrelated pre-existing cohesion and skill mapping assertion failures.

**DO NOT PROCEED WITH IMPLEMENTING ANY NEXT STEPS YET**
Acknowledge the receipt of this handoff, explore the repo for relevant context, propose a direction, and wait for further instruction.
