# Real Rules Foundation -> Audit RuleSet Implementation Handoff

DO NOT PROCEED WITH IMPLEMENTATION YET. First acknowledge this handoff, read the referenced files, inspect the current repo state, and report the audit findings with file/line references before changing code.

## Context Snapshot

- Project: Cornerstone in `/Users/cdbrooks/Development/Software/Repositories/cornerstone`.
- Date: 2026-05-12.
- Requested task: audit the rules implementation so far after the first two real-domain slices.
- Source of truth read for this handoff: `CONTEXT.md`.
- ADR source checked: `docs/adr/` was requested by the handoff skill, but no ADR files were present.
- Active plan: `feature_requests/real-rulesets-saved-teams-domain-plan.md`.
- Relevant commits:
  - `34c9071 feat(saved-teams): persist rulesets and historical evals`
  - `48b745e fix(profile): expand saved eval description width`

## Lexicon Guardrails

Use these terms exactly when discussing the audit:

- `RuleSet`: published configuration defining Lab constraints.
- `Rule`: one enforceable constraint inside a RuleSet.
- `RuleSet Version`: immutable published form of a RuleSet at a point in time.
- `Lab`: lifecycle selecting RuleSet, picking Cornerstone, assembling Build, evaluating.
- `Build`: in-progress, pre-persistence Team assembled in Lab.
- `Team`: any group of 5+ Players submitted for evaluation.
- `Player`: universal individual unit, active or legendary.
- `Legend`: Player with manually curated Skill Profile.
- `Cornerstone`: Player in first slot of Team; Standard RuleSet requires Legend.
- `Saved Team`: persisted user-owned Team tied to RuleSet Version and Snapshot Release.
- `Snapshot Release`: published user-visible PlayerPool, metadata, salaries, Snapshots, Skill Profiles for building/evaluating Teams.
- `Snapshot Player`: Player as existed in one Snapshot Release.
- `Canonical Player`: stable Player identity across Snapshot Releases.
- `Evaluation Version`: scoring engine/weights/evaluation rules version used for Team.
- `User Profile`: account display data/preferences for `/profile`, distinct from Player Profile.
- `See Eval`: Profile action that reads historical Saved Team evaluation data.
- `Rebuild`: starting new editable Build from Saved Team.

Per `AGENTS.md`, define Lexicon terms when using them in conversation until the user says definitions can stop.

## Current Implementation Status

The first two slices are implemented and committed. The implementation now has a real database foundation and a mostly real frontend/backend flow for RuleSets, Saved Teams, Snapshot Releases, User Profiles, and historical Saved Team evaluation display.

### Database

Migration `supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql` adds or updates:

- `rulesets`, `rules`, `ruleset_versions`
- `canonical_players`, `snapshot_players`
- `snapshot_releases`
- `saved_teams`, `saved_team_players`
- `saved_team_evaluations`
- `user_profiles`
- Seed data for Standard, Free For All, and Budget RuleSets.
- Seed data for Standard Rules and Standard v1 RuleSet Version.
- Seed data for a `2025-26 Current` Snapshot Release.
- Backfill paths for existing Saved Teams and thin Saved Team Evaluations.
- RLS policies for the new domain tables.

### Backend

- `backend/api/rulesets.py` exposes `GET /api/rulesets`.
- `backend/api/saved_teams.py` persists real Saved Teams and historical Saved Team Evaluations.
- `backend/api/profile.py` exposes minimal User Profile data.
- `backend/app.py` registers the new routes.
- Focused tests exist for the new API areas, including `backend/tests/test_rulesets_api.py`, `backend/tests/test_saved_teams_api.py`, and `backend/tests/test_profile_api.py`.

### Frontend

- `/lab` calls `listRuleSets()` and renders real RuleSet summaries.
- Final Eval saves a Team through the real Saved Team API and sends evaluation payload.
- `/profile` uses real User Profile data and real Saved Teams.
- `/profile/saved-teams/[saved_team_id]` renders See Eval from historical Saved Team data.
- Several UX fixes are committed:
  - Save success Team name links to See Eval.
  - Profile top card label changes by sort/filter context.
  - See Eval score box is top-right instead of full-height.
  - RuleSet Version ID displays the id.
  - Ordered Players show portraits and the panel ends with content height.
  - Evaluation Version icon is a gear.
  - See Eval description spans the header width.

## Audit Focus

Start in code-review/audit stance. Do not patch first.

Primary audit question: does the current RuleSet implementation match the user decisions and plan well enough to build the next slice on it?

Known areas to inspect:

1. RuleSet Version immutability and hashing
   - Current migration uses `md5(rules_json::text)` for `rules_hash`.
   - Confirm whether this is stable enough for immutable RuleSet Version identity, especially if JSON key order or frozen Rules shape changes.
   - Check whether id/hash is used anywhere meaningful beyond display/storage.

2. Rule rows versus frozen RuleSet Version JSON
   - Standard Rules are seeded into `rules`.
   - Standard RuleSet Version also stores `rules_json`.
   - Saved Team validation appears to use Python constants rather than the frozen `rules_json`.
   - Audit whether the source of truth is ambiguous.

3. API surface
   - The plan listed `GET /api/rulesets/<slug>`, but only `GET /api/rulesets` appears implemented.
   - Audit whether that missing endpoint blocks near-term Lab work or is acceptable for now.
   - `GET /api/rulesets` currently lists all RuleSet rows ordered by `display_order`; inspect whether coming-soon RuleSets should be returned to the UI or filtered.

4. Saved Team RuleSet contract
   - `backend/api/saved_teams.py` hard-codes Standard constants:
     - `STANDARD_RULESET = "standard"`
     - `STANDARD_ROTATION_SIZE = 9`
     - `STANDARD_SALARY_CAP = 195_000_000`
     - `EVALUATION_VERSION = "cohesion-v1"`
   - `POST /api/saved-teams` resolves the latest published Standard RuleSet Version internally and appears to ignore client-provided RuleSet Version id/hash.
   - Audit this against the decision: immutable version id/hash, slug for display.

5. Rule completeness
   - Standard validation covers rotation size, Cornerstone, and SalaryCap.
   - Audit whether RookieDeal max-2 validation is still missing and whether it matters before admin publishing.

6. Snapshot linkage
   - `saved_team_players` can store `snapshot_player_id` and `canonical_player_id`.
   - Frontend currently does not populate those ids.
   - Audit whether this weakens historical See Eval or Rebuild behavior.

7. Security and RLS
   - `ruleset_versions` read policy appears limited to published versions plus service role.
   - `rules` read policy is open for all rows.
   - Audit whether that is acceptable before admin publishing or needs a draft/public boundary.

8. Test coverage
   - Focused tests verify the happy path.
   - Missing likely tests: rule-driven validation contracts, rules hash behavior, RuleSet detail endpoint if added, status filtering, RookieDeal validation, and client RuleSet Version mismatch behavior.

## Important Working Instructions

- Do not edit already-applied migrations if the linked Supabase project may have received them. Add a forward migration for schema/data corrections.
- Do not reset the linked Supabase database.
- Do not stage unrelated dirty files:
  - `.cowork/handoffs/2026-05-09-builder-feedback-refresh.md`
  - `.cowork/handoffs/2026-05-09-playerpool-browser-levelset.md`
  - `.cowork/handoffs/2026-05-11-builder-responsive-plan.md`
- `.cowork/index.md` was already dirty before this handoff; preserve existing entries and only append/update intentionally.
- Keep See Eval historical behavior separate from Rebuild latest-compatible behavior.
- If implementation follows the audit, use `/tdd` first, `/verification-loop` after, and `/commit` when committing.
- For frontend changes, also use the `/impeccable` family per repo instructions.

## Suggested Next Steps

1. Read `CONTEXT.md`, `feature_requests/real-rulesets-saved-teams-domain-plan.md`, `supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql`, `backend/api/rulesets.py`, `backend/api/saved_teams.py`, and the relevant tests.
2. Produce audit findings first, ordered by severity, with file/line references and explicit “patch now” versus “plan later” recommendations.
3. If the user approves patching, add focused tests before code changes for the accepted fixes, then implement minimal changes.

## Verification Baseline

Recent focused verification before commit `34c9071` passed:

```bash
source backend/venv/bin/activate
PYTHONPATH=. python -m pytest backend/tests/test_rulesets_api.py backend/tests/test_profile_api.py backend/tests/test_saved_teams_api.py backend/tests/test_cohesion_engine/test_team_description.py -q
cd frontend && npx tsc --noEmit --pretty false
cd frontend && npx next lint --quiet
cd frontend && npm run build
```

Recent verification before commit `48b745e` passed:

```bash
cd frontend && npx tsc --noEmit --pretty false
cd frontend && npx next lint --quiet
```

The broader backend suite previously had unrelated existing failures around cohesion formulas and skill threshold expectations. Do not use that as the first signal for this audit unless those failures become directly relevant.

Before any future commit, also run:

```bash
git diff --check
git diff --cached --check
```

## Expected Output For The Next Agent

Begin with findings, not a generic summary. The useful shape is:

1. Critical/high findings with file/line references.
2. Medium/low findings.
3. Open questions or assumptions.
4. Recommendation: patch now, defer, or update ExecPlan.

Do not proceed into implementation until the user accepts the audit direction.
