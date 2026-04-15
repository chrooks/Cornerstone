# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (Flask)
```bash
cd backend
source venv/bin/activate
python -m flask run --port=5001        # Dev server at http://localhost:5001
python -m pytest tests/      # Run all tests
python -m pytest tests/test_skill_mapping_service.py  # Single test file
```

### Frontend (Next.js)
```bash
cd frontend
npm run dev     # Dev server at http://localhost:3000
npm run build   # Production build
npm run lint    # ESLint
```

### Database
```bash
supabase db push             # Apply pending migrations
# New migrations: add timestamped file to supabase/migrations/, then push
```

## Architecture Overview

This is a three-layer NBA skill evaluation platform:

**Layer 1 — Skill Pipeline** (internal tooling)
- Backend fetches stats from NBA.com via `nba_api`, maps them to a 19-skill taxonomy
- Claude API independently rates players on the same taxonomy
- A compositing service compares both ratings: agreements are auto-accepted, disagreements create `skill_flags` for manual review
- Frontend tools: threshold calibration (`/calibration`), pipeline runner (`/pipeline`), review queue (`/review`)

**Layer 2 — Legends Builder** (`/legends`)
- Manual editor for 36 all-time greats rated on the same 19-skill taxonomy
- Claude pre-populates suggestions via `POST /api/legends/<id>/suggest`

**Layer 3 — Roster Builder** (`/` — scaffolded, not fully built)
- Users build 8-man rosters around a cornerstone legend within a salary cap

### Backend Structure

```
backend/
  app.py                        # Flask factory — registers all blueprints
  api/                          # Route blueprints, one per domain
  services/
    skill_engine/               # Core evaluation engine (conditions, transforms, evaluator, cache, history)
    skill_mapping_service.py    # Orchestrates stat-to-skill evaluation using skill_engine
    compositing.py              # Merges stat and Claude ratings, creates flags
    claude_assessment.py        # Claude API integration for player skill ratings
    nba_api_client.py           # Fetches live stats from NBA.com
    supabase_client.py          # Supabase singleton client
    players_service.py          # Player CRUD and bulk queries
```

**Key services pattern**: `skill_engine/` is a sub-package extracted from the original monolithic `skill_mapping_service.py`. Each file in `skill_engine/` has a single responsibility (conditions evaluation, stat transforms, tier evaluation, caching, history).

### Frontend Structure

```
frontend/
  app/                          # Next.js App Router pages
    calibration/                # Threshold calibration tool (complex UI)
    pipeline/                   # Pipeline status dashboard
    review/                     # Review queue + per-player flag resolution
    legends/                    # Legends grid + editor
    players/                    # Player explorer + individual profile pages
  lib/
    types.ts                    # All shared TypeScript types (mirrors backend response shapes)
    api.ts                      # All fetch calls to Flask backend via apiFetch()
    skills.ts                   # SKILL_LIST, SKILL_LABELS — the canonical 19-skill taxonomy
    tiers.ts                    # SKILL_TIERS ordering and display helpers
    stat-keys.ts                # Stat key labels for display
  components/                   # shadcn/ui components
```

**Key frontend pattern**: All backend calls go through `apiFetch<T>()` in `lib/api.ts`, which prepends the base URL and injects the calibration API key for write requests. Types in `lib/types.ts` mirror backend response shapes exactly.

### Skill Threshold Data Model

Skill thresholds are stored as JSONB in the `skill_thresholds` table. Each row has a `thresholds` field with this shape:
```
{
  volume_gate: ConditionsBlock,     # minimum games/minutes to qualify
  tiers: { Elite: ConditionsBlock, Proficient: ConditionsBlock, Capable: ConditionsBlock },
  tier_bumps: TierBump[],           # promote/demote based on secondary conditions
  auto_promotions: AutoPromotion[], # link one skill's tier to another's minimum
  stabilization: StabilizationConfig[],  # Bayesian regression-to-mean configs
  pre_adjustments: []               # stat mutations applied before evaluation
}
```

The calibration UI allows editing these JSONB rules directly. **Do not convert threshold updates to SQL migrations** — always return updated JSON to the calibration endpoint.

### Key Constraints

- **Skill thresholds use per-game volume conditions** — the volume gate divisor is ~70 games (a full season). Don't use per-season raw counts when writing new threshold conditions.
- **`apply_pre_adjustments` in skill_engine uses `copy.deepcopy`** — this is load-bearing; removing it causes multiple adjustments to mutate the original stats blob.
- **API write endpoints require `X-Calibration-Key` header** — set `NEXT_PUBLIC_CALIBRATION_API_KEY` in frontend `.env.local`.
