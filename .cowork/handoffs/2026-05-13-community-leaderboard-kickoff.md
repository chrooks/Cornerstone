# Handoff: Community Leaderboard & RuleSet Card Stats

**Date:** 2026-05-13
**Branch:** `feat/saved-team-visibility` (or create `feat/community-leaderboard`)
**Issue:** [#4 — Community leaderboard and RuleSet card stats](https://github.com/chrooks/Cornerstone/issues/4)
**Plan file:** None yet — create `feature_requests/community-leaderboard-plan.md`

---

## Context

Issue #4 is now unblocked. It depends on #3 (Saved Team visibility), which is complete:

- Backend: `GET /api/shared/<id>` returns public/unlisted Saved Teams without auth
- Backend: `VISIBLE_TO_ANYONE = ("public", "unlisted")` constant in [`backend/api/saved_teams.py`](backend/api/saved_teams.py):879
- RLS policies allow unauthenticated SELECT on public/unlisted saved_teams, saved_team_players, saved_team_evaluations
- Frontend: `/shared/[saved_team_id]` page renders read-only Saved Team view

The Lab page already has a **Community tab** on each RuleSet card ([`frontend/app/lab/page.tsx`](frontend/app/lab/page.tsx):70-74) — currently hardcoded to zeros:

```typescript
community: {
  teamsBuilt: 0,
  topCornerstone: "-",
  avgScore: 0,
},
```

## Acceptance Criteria (from issue #4)

- [ ] Community leaderboard page at `/community` or `/lab/community` showing public Saved Teams
- [ ] Leaderboard filterable by RuleSet and team size
- [ ] Community tab on Lab RuleSet cards shows real data: teams built, most popular Cornerstone, average score
- [ ] Leaderboard respects visibility — only public Saved Teams appear
- [ ] Clicking a leaderboard entry navigates to the public Saved Team detail view (`/shared/<id>`)

## Important Working Instructions

- Use `/tdd` for backend work, `/impeccable` for frontend design
- RuleSet cards use notebook-style tabs; Community tab already exists with placeholder UI
- Backend queries must filter `visibility IN ('public', 'unlisted')` — use `VISIBLE_TO_ANYONE` constant
- Shared team detail view already exists at `/shared/[saved_team_id]` — link to it from leaderboard entries
- Do not use `npm run build` — dev server catches errors
- "Rule Set" in UI text, "RuleSet" in code

## Next 3 Steps

1. **Create ExecPlan** at `feature_requests/community-leaderboard-plan.md` — scope backend endpoints (aggregate stats per RuleSet, paginated public team list), frontend pages, and Community tab data wiring
2. **Backend: community stats endpoint** — `GET /api/community/stats` returning per-RuleSet aggregates (team count, top cornerstone, avg score) filtered to public teams only
3. **Backend: public teams list endpoint** — `GET /api/community/teams` with pagination, RuleSet filter, team size filter, sorted by score or date

## Verification Baseline

```bash
cd backend && source venv/bin/activate
python -m pytest tests/test_saved_teams_api.py -q   # 63 tests pass
python -m pytest tests/test_rulesets_api.py -q       # existing tests pass
```
