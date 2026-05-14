# Handoff: Admin RuleSet Creator and Builder Rules Wiring

**Date:** 2026-05-12
**Branch:** main
**Scope:** Admin RuleSet CRUD page complete; builder now reads live rules_json; RookieDeal enforcement next

---

## Context

RuleSets (the configuration governing a Lab session — Team size, SalaryCap, Cornerstone rules, PlayerPool source, RookieDeal limit) now have a full admin CRUD Surface at `/admin/rulesets`. Admins can create RuleSets, edit metadata, draft RuleSet Versions with a Monaco JSON editor, and publish versions (which auto-retires the previous published version). The builder reads live `rules_json` from the resolved RuleSet instead of hardcoded constants.

The `team_size` field is an Invariant: only 5 (Lineup), 9 (Rotation), or 12 (Roster) are valid. `team_label` is derived server-side from `team_size` — admins never set it manually.

---

## Current Implementation Status

### Backend (complete)
- [`backend/api/rulesets.py`](backend/api/rulesets.py) — 5 new endpoints, all `@require_admin`:
  - `POST /api/rulesets` — create RuleSet (slug validation, status validation)
  - `PATCH /api/rulesets/<slug>` — update metadata
  - `GET /api/rulesets/<slug>/versions` — list all versions (admin)
  - `POST /api/rulesets/<slug>/versions` — create draft version (server-computed `rules_hash`, `team_size` validated to {5,9,12}, `team_label` auto-derived)
  - `POST /api/rulesets/<slug>/versions/<version_id>/publish` — publish draft, retire old
- [`backend/tests/test_rulesets_api.py`](backend/tests/test_rulesets_api.py) — 17 passing tests covering all endpoints + validation

### Frontend — Admin Page (complete)
- [`frontend/app/admin/rulesets/page.tsx`](frontend/app/admin/rulesets/page.tsx) — Two-panel layout: RuleSet list (left) + detail editor (right). Inline create form, metadata editor with dirty-state tracking, version list with status badges, Monaco JSON editor for `rules_json`, publish with inline confirmation. NavBar link added.

### Frontend — Builder Rules Wiring (complete)
- [`frontend/lib/builder-config.ts`](frontend/lib/builder-config.ts) — Constants renamed to `DEFAULT_*` with old names re-exported for unchanged consumers. Added `VALID_TEAM_SIZES`, `TEAM_SIZE_LABELS`, `teamLabelForSize()`.
- [`frontend/lib/hooks/useBuilderSalary.ts`](frontend/lib/hooks/useBuilderSalary.ts) — Accepts optional `salaryCap` and `legendSalary` params from RuleSet.
- [`frontend/lib/hooks/useRosterSlots.ts`](frontend/lib/hooks/useRosterSlots.ts) — Accepts optional `maxSlots` param from RuleSet.
- [`frontend/lib/roster-utils.ts`](frontend/lib/roster-utils.ts) — `readSlotsFromParams` accepts optional `maxSlots`.
- [`frontend/components/builder/BuilderPage.tsx`](frontend/components/builder/BuilderPage.tsx) — Fetches RuleSet by slug, extracts `team_size`, `salary_cap`, `cornerstone_salary` from `rules_json`, threads into hooks and child components.
- [`frontend/components/builder/CourtStrip.tsx`](frontend/components/builder/CourtStrip.tsx), [`BuilderLeftPanel.tsx`](frontend/components/builder/BuilderLeftPanel.tsx), [`PlayerPickerPanel.tsx`](frontend/components/builder/PlayerPickerPanel.tsx) — Accept live `salaryCap`/`maxRosterSlots` props.

### What's NOT done
- **RookieDeal enforcement is still dead end-to-end.** The `rookie_deal_limit` rule exists in `rules_json` and the save-time validator checks `is_rookie_deal`, but the frontend never sets it and there's no data source for whether a player is on a rookie scale contract.

---

## Important Working Instructions

- Use `/tdd` for backend endpoints, `/verification-loop` after implementation, `/commit` to persist
- All admin write endpoints must use `@require_admin` from `api/auth.py`
- "Rule Set" in UI text, "RuleSet" in code (see memory: `feedback_ruleset_user_facing.md`)
- Don't run `npm run build` after frontend changes (see memory: `feedback_no_npm_build.md`)
- `team_size` is an Invariant: only {5, 9, 12} are valid. `team_label` derived server-side.
- `rules_hash` is computed server-side as MD5 of canonicalized `rules_json` — never trust from client

---

## Next Scope: RookieDeal Enforcement

### Research Conclusion

The best approach to determine RookieDeal status uses `nba_api`'s `CommonPlayerInfo` endpoint, which returns `DRAFT_ROUND` and `SEASON_EXP`. Per the CBA, rookie scale contracts are 4-year deals that only first-round picks sign. The derivation:

    is_rookie_deal = (DRAFT_ROUND == "1") AND (SEASON_EXP <= 3)

`SEASON_EXP` (not `current_year - DRAFT_YEAR`) is the correct anchor because it tracks NBA experience, handling international/late-signing edge cases where a player is drafted but doesn't sign for 1-2 years.

Edge cases covered:
- Second-rounders and undrafted: `DRAFT_ROUND != "1"` → always false
- Rookie extensions: don't start until year 5 (`SEASON_EXP >= 4`), so `<= 3` is structurally correct
- 5th year team options: still under rookie scale umbrella while `SEASON_EXP <= 3`

### Vertical Slice

1. **Pipeline** — Add `DRAFT_ROUND` + `SEASON_EXP` fetch from `CommonPlayerInfo` in `nba_api_client.py` / `stats_assembler.py`. Store on the player record or stats blob.
2. **Backend** — Derive `is_rookie_deal` at query time when returning player data. Include in player API responses.
3. **Frontend** — Surface RookieDeal badge on player cards in the builder. Pass `is_rookie_deal` in `SaveTeamPlayerPayload`.
4. **Enforcement** — `_validate_saved_team()` in `saved_teams.py` already checks `rookie_deal_limit` against `is_rookie_deal` — just needs the frontend to actually send the flag.

---

## Verification Baseline

**Backend:**
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_rulesets_api.py -v
```
Expected: 17 passed.

**Frontend:**
```bash
cd frontend && npm run build
```
Expected: clean build, `/admin/rulesets` route present.
