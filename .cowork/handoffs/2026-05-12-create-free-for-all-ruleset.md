# Handoff: Create Free-For-All RuleSet

**Date:** 2026-05-12
**Branch:** main
**Scope:** Publish a Free For All RuleSet version with appropriate rules_json, activate it, and verify the builder works under its constraints

---

## Context

The admin RuleSet CRUD system is complete (`/admin/rulesets`). The builder reads live `rules_json` from the resolved RuleSet (team_size, salary_cap, cornerstone_salary, rookie_deal_limit). RookieDeal enforcement is fully wired end-to-end: derivation, display ("RD" annotation), builder-side gating, save-time validation, and a counter in the CourtStrip.

A `free-for-all` RuleSet row already exists in the database (seeded in [`supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql:185`](supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql)) with status `coming_soon` and no published version. Per [`CONTEXT.md:196`](CONTEXT.md), it is "planned as the second option."

The Free For All RuleSet concept from CONTEXT.md: **"No SalaryCap. No Cornerstone requirement. Pure best-of."** This is a different game from Standard — the interesting design questions are:

1. **No SalaryCap** — `salary_cap` should be absent or null in `rules_json`. The builder conditionally hides the SalaryGauge when no cap exists.
2. **No mandatory Legend Cornerstone** — any Player (active or Legend) can be the Cornerstone, or there may be no Cornerstone slot at all. This changes the Legends picker step and the builder's slot 1 behavior.
3. **No RookieDeal limit** — `rookie_deal_limit` absent from `rules_json`. Counter and gating hidden.
4. **Team size** — likely 5 (Lineup) since the format is "pure best-of", but confirm with the user.

---

## Current Implementation Status

### RuleSet Admin (complete)
- [`backend/api/rulesets.py`](backend/api/rulesets.py) — 5 admin CRUD endpoints + 2 public read endpoints
- [`frontend/app/admin/rulesets/page.tsx`](frontend/app/admin/rulesets/page.tsx) — Two-panel admin page with Monaco JSON editor, publish flow
- 17 backend tests in [`backend/tests/test_rulesets_api.py`](backend/tests/test_rulesets_api.py)

### Builder Rules Wiring (complete)
- [`frontend/components/builder/BuilderPage.tsx`](frontend/components/builder/BuilderPage.tsx) — Fetches RuleSet by slug, extracts rules from `rules_json`, threads into hooks and child components
- SalaryCap, team_size, cornerstone_salary, rookie_deal_limit all read from live `rules_json`
- Builder conditionally renders SalaryGauge based on `salaryCap` presence
- RookieDeal counter and picker gating conditional on `rookieDealLimit` presence

### RookieDeal Enforcement (complete)
- `draft_round` + `season_exp` columns on players table, populated from PlayerIndex bulk endpoint
- `is_rookie_deal` derived at query time (`draft_round == 1 AND season_exp <= 3`)
- "RD" annotation on salary cells, counter in CourtStrip, picker disables at limit
- Save payload includes `is_rookie_deal` for backend validation

### What needs design decisions
- **Cornerstone optionality** — the Lab flow currently requires `?cornerstone=<id>` and redirects to `/lab/[ruleset]/legends` if missing. Free For All may skip this step or make it optional.
- **PlayerPool composition** — Standard includes all active Players + all Legends. Free For All might include only active Players (no Legends needed if no mandatory Cornerstone).
- **SalaryCap absence** — verify the builder handles `salaryCap === undefined` gracefully (SalaryGauge hidden, salary filter disabled, all players affordable).

---

## Important Working Instructions

- Use `/tdd` for backend endpoints, `/verification-loop` after implementation, `/commit` to persist
- All admin write endpoints must use `@require_admin` from `api/auth.py`
- "Rule Set" in UI text, "RuleSet" in code (see memory: `feedback_ruleset_user_facing.md`)
- Don't run `npm run build` after frontend changes (see memory: `feedback_no_npm_build.md`)
- `team_size` is an Invariant: only {5, 9, 12} are valid. `team_label` derived server-side.
- `rules_hash` is computed server-side as MD5 of canonicalized `rules_json` — never trust from client

---

## Next Scope: Create Free For All RuleSet

### Step 1 — Design the rules_json

Confirm with user what "Free For All" means concretely:
- Team size: 5 (Lineup)? 9 (Rotation)? 12 (Roster)?
- SalaryCap: none (null/absent)
- Cornerstone: mandatory Legend, optional Legend, any Player, or no Cornerstone concept?
- RookieDeal limit: none (absent)
- Any other constraints?

### Step 2 — Publish via admin API or migration

Either:
- Use the admin page at `/admin/rulesets` to create a draft version with the agreed `rules_json`, then publish it
- Or add a migration that inserts a published version directly

Also change the RuleSet status from `coming_soon` to `active`.

### Step 3 — Handle builder edge cases for cap-less / cornerstone-optional play

Audit [`BuilderPage.tsx`](frontend/components/builder/BuilderPage.tsx) for assumptions:
- Line ~76: redirects to Legends picker if no `cornerstoneId` — needs conditional bypass for Free For All
- SalaryGauge: verify it hides cleanly when `salaryCap` is undefined
- Salary-based unavailability check in PlayerPickerPanel: verify no-op when no cap
- EvaluatePage: verify save payload works without a Legend Cornerstone

---

## Verification Baseline

**Backend:**
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_rulesets_api.py tests/test_saved_teams_api.py tests/test_rookie_deal.py -v
```
Expected: 54 passed.
