# Handoff: Admin RuleSet Creator/Publisher Page

**Date:** 2026-05-12
**Branch:** main
**Scope:** Build the admin RuleSet creator/publisher page

---

## Context

RuleSets (the configuration that governs a Lab session — Team size, SalaryCap, Cornerstone rules, PlayerPool source, RookieDeal limit) are currently seeded via SQL migration with no admin UI for creating, editing, or publishing them. Three RuleSets exist in the database: "standard" (active), "free-for-all" (coming_soon), "budget" (coming_soon). Each RuleSet has immutable RuleSet Versions (draft → published → retired lifecycle) containing `rules_json` and a `rules_hash` for integrity checking.

The backend has **read-only** endpoints (`GET /api/rulesets`, `GET /api/rulesets/<slug>`) but **no write endpoints**. The admin needs a page to:
1. Create new RuleSets
2. Edit RuleSet metadata (name, description, status, display_order)
3. Create new RuleSet Versions with a `rules_json` editor
4. Publish a draft RuleSet Version (making it the active version for that RuleSet)

---

## Current Implementation Status

### Database (complete)
- [`supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql`](supabase/migrations/20260511000000_real_rulesets_saved_teams_domain.sql) — `rulesets`, `ruleset_versions`, and `rules` tables with seeded data
- `rulesets.status`: `active | coming_soon | archived`
- `ruleset_versions.status`: `draft | published | retired`
- RLS: anyone can read; `service_role` manages writes

### Backend (read-only)
- [`backend/api/rulesets.py`](backend/api/rulesets.py) — `GET /api/rulesets` (list) and `GET /api/rulesets/<slug>` (detail with current published version)
- No POST/PUT/PATCH/DELETE endpoints

### Frontend (no admin page)
- [`frontend/lib/types.ts`](frontend/lib/types.ts):604-619 — `RuleSetSummary` type
- [`frontend/lib/api.ts`](frontend/lib/api.ts):594-597 — `listRuleSets()` function
- No `/admin/rulesets` page exists

### Admin page conventions (for consistency)
- Client components (`"use client"`) with local state
- Data loaded on mount via `useEffect`
- `@require_admin` decorator on backend write endpoints (JWT + `user_roles` table check)
- Examples: [`frontend/app/admin/legends/page.tsx`](frontend/app/admin/legends/page.tsx) (grid + detail pattern), [`frontend/app/admin/calibration/page.tsx`](frontend/app/admin/calibration/page.tsx) (split-view editor pattern)

### Related recent work
- Saved Team `POST` endpoint now uses client-asserted `ruleset_version_id` + `rules_hash` for integrity checking — see [`backend/api/saved_teams.py`](backend/api/saved_teams.py):364-410
- `rules_hash` is an MD5 of the canonical JSON serialization of `rules_json` — see [`supabase/migrations/20260512000000_canonicalize_rules_hash_and_tighten_rls.sql`](supabase/migrations/20260512000000_canonicalize_rules_hash_and_tighten_rls.sql)

---

## Important Working Instructions

- Use `/tdd` for backend endpoints, `/verification-loop` after implementation, `/commit` to persist
- All admin write endpoints must use `@require_admin` from `api/auth.py`
- The `rules_hash` must be computed server-side as MD5 of canonicalized `rules_json` (sorted keys, no whitespace) — match the existing migration function `canonicalize_rules_hash()`
- "Rule Set" in UI text, "RuleSet" in code (see memory: `feedback_ruleset_user_facing.md`)
- Skill thresholds are JSONB, never SQL migrations — same principle applies to `rules_json`
- Give all React/HTML elements human-communicatable `id` tags

---

## Next 3 Steps

1. **Backend write endpoints** — Add to `backend/api/rulesets.py`:
   - `POST /api/rulesets` — create a new RuleSet (name, slug, description, status, display_order)
   - `PATCH /api/rulesets/<slug>` — update RuleSet metadata (name, description, status, display_order)
   - `POST /api/rulesets/<slug>/versions` — create a new RuleSet Version (rules_json; server computes rules_hash, status defaults to draft)
   - `POST /api/rulesets/<slug>/versions/<version_id>/publish` — publish a draft version (set status=published, retire any previously published version for that RuleSet)

2. **Frontend API + types** — Add `createRuleSet()`, `updateRuleSet()`, `createRuleSetVersion()`, `publishRuleSetVersion()` to `frontend/lib/api.ts`. Add any needed request/response types to `frontend/lib/types.ts`.

3. **Admin page** — Create `/admin/rulesets/page.tsx` with:
   - RuleSet list (grid or table) showing name, slug, status, current published version label
   - Create new RuleSet form
   - Click into RuleSet detail: metadata editor + version list
   - Version detail: JSON editor for `rules_json` (Monaco editor, matching calibration page pattern)
   - Publish button with confirmation

---

## Expectations for this Conversation

- Backend endpoints with full test coverage (TDD)
- Admin page following existing conventions (client component, `@require_admin`, toast feedback)
- `rules_hash` computed server-side, never trusted from client
- Publishing a version retires the previous published version for that RuleSet
- Frontend build clean (`npm run build` passes)

---

## Verification Baseline

**Backend:**
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_saved_teams_api.py tests/test_rulesets_api.py -v
```

**Frontend:**
```bash
cd frontend && npm run build
```
