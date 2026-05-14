# Handoff: Verify 12-man FFA Roster mode end-to-end

**Date:** 2026-05-13
**Branch:** main
**Scope:** Verify the Free For All — Roster (12-player) RuleSet works through the full Lab lifecycle, fix bugs as encountered

---

## Context

Three Free For All RuleSets were shipped across two commits (`c186142`, `22794dc`). The Lineup (5-man) variant has been manually tested and debugged through multiple rounds — eval, save, rebuild, and scoring all work. The Rotation (9-man) variant is structurally similar to Standard and likely works. The Roster (12-man) variant is untested and has the highest surface area for edge cases: 792 Lineup Combinations (C(12,5)), bench slots 6-12, and the largest CourtStrip rendering.

The RuleSet row `free-for-all-roster` is `active` in the database with a published `v1` version:
```json
{
  "team_size": 12,
  "team_label": "Roster",
  "cornerstone_source": "all",
  "cornerstone_rule": "Any player",
  "player_pool": "2025-26 Snapshot + Legends"
}
```

No SalaryCap, no RookieDeal limit, no mandatory Legend Cornerstone.

---

## Current Implementation Status

### Complete (Lineup verified, Rotation/Roster not yet)
- **Migration** ([`supabase/migrations/20260512200000_free_for_all_rulesets.sql`](supabase/migrations/20260512200000_free_for_all_rulesets.sql)) — 3 RuleSet rows + rules + published versions
- **Lab page** — CTA links to `/lab/[ruleset]/build` for FFA (skips cornerstone picker)
- **BuilderPage** — no cornerstone redirect for FFA; slot 1 not locked; all Players + Legends in picker
- **CourtStrip** — dynamic slot count from `team_size`; bench divider only when >5 slots; SalaryGauge hidden when no cap
- **useRosterSlots** — resize effect syncs slot count when `maxRosterSlots` changes after mount
- **useBuilderEvaluation** — fires without `legendDetail`; slot 1 auto-tagged as cornerstone
- **EvaluatePage** — handles null cornerstone param; Legend `player_id` set to null in save payload
- **Cohesion engine** — lineup-only rollup weights (90/10); `_memo_instructions` adapts prompt to team size; `_slot_label` uses "starter" for all when ≤5 players
- **saved_teams.py** — `cornerstone_legend_id` nullable; validation adapts to `cornerstone_source`; rebuild resolves Legend supporting players and FFA cornerstones
- **CohesionScoreDisplay** — `isLineupOnly` hides rotation median, durability, viable combos, depth/floor factors

### Known areas to verify for 12-man Roster
- CourtStrip renders 5 starters + 7 bench (slots 6-12) correctly
- `useRosterSlots` resize from default 9 to 12 works (expansion, not just truncation)
- 792 Lineup Combinations don't timeout on the backend eval endpoint
- BuilderHeader breadcrumb and title show "Roster" correctly
- EvaluatePage handles 12-player save payload (slot numbering 1-12)
- Rebuild compat check with mixed Legend + active player supporting cast
- `readSlotsFromParams` handles s1-s12 URL encoding
- Feedback panel score factors show all 4 factors (depth, floor apply for 12-man)

---

## Important Working Instructions

- Use `/tdd` for backend endpoints, `/verification-loop` after implementation, `/commit` to persist
- "Rule Set" in UI text, "RuleSet" in code (see memory: `feedback_ruleset_user_facing.md`)
- Don't run `npm run build` after frontend changes (see memory: `feedback_no_npm_build.md`)
- Don't define project-level Lexicon terms (RuleSet, Team, PlayerPool, etc.)
- `team_size` is an Invariant: only {5, 9, 12} are valid. `team_label` derived server-side.
- Slot 1 is auto-tagged as cornerstone when `cornerstoneId` is null (FFA) — this is an API validator requirement, not a user-facing concept

---

## Next Steps

### Step 1 — Manual verification of 12-man Roster flow

Walk through the full Lab lifecycle for `free-for-all-roster`:
1. Lab page → "Enter Lab" on Free For All — Roster card
2. Builder loads with 12 empty slots (5 starters + 7 bench)
3. Fill all 12 slots from the PlayerPool (mix of Legends and active Players)
4. Verify live eval fires and shows all 4 score factors (including depth and floor)
5. Click "Evaluate Roster →" → final eval page
6. Verify CohesionScoreDisplay shows full rotation metrics (viable combos, median, rotation median in subscores)
7. Save the Team
8. Load saved Team from Profile, verify rebuild compat check

### Step 2 — Fix any bugs found

Apply the same pattern used for Lineup debugging: trace the issue, fix, verify.

### Step 3 — Commit

---

## Verification Baseline

**Backend:**
```bash
cd backend && source venv/bin/activate && python -m pytest tests/test_rulesets_api.py tests/test_saved_teams_api.py tests/test_rookie_deal.py -v
```
Expected: 54 passed.
