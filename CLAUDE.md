# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (Flask)
```bash
cd backend
source venv/bin/activate
python -m flask run --port=5001        # Dev server at http://localhost:5001
python -m pytest tests/                # Run all tests
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
supabase db push   # Apply pending migrations to linked project
# New migrations: add a timestamped .sql file to supabase/migrations/, then push
```

---

## Architecture Overview

Three-layer NBA skill evaluation and roster builder platform.

```
Frontend (Next.js) ──HTTP + JWT──▶ Backend (Flask) ──SQL──▶ Supabase PostgreSQL
```

**Layer 1 — Skill Pipeline** (admin tooling at `/admin/*`)
- Stats fetched from NBA.com via `nba_api` → assembled by `stats_assembler.py` → stored in `player_stats`
- `skill_engine/` evaluates each of 21 skills against JSONB threshold rules → `skill_profiles` (source: `"stats"`)
- `claude_assessment.py` asks Claude API for the same 21 ratings → `skill_profiles` (source: `"claude"`)
- `compositing.py` merges both: agreements auto-accepted, disagreements create `skill_flags` for manual review
- Frontend tools: `/admin/calibration` (threshold editor), `/admin/pipeline` (stat fetch trigger), `/admin/review` (flag resolver)

**Layer 2 — Legends Builder** (`/admin/legends`)
- Manual editor for all-time greats rated on the same 21-skill taxonomy
- `POST /api/legends/<id>/claude-suggestion` pre-populates ratings; admin accepts or overrides

**Layer 3 — Roster Builder** (`/builder`)
- Users pick a legend cornerstone ($54M salary), add up to 7 supporting players within a salary cap
- `POST /api/builder/evaluate` runs `roster_evaluator/` to score the roster: base skill weights, dynamic modifiers, hard checks, cornerstone complement synergies, GM Notes (37+ rules), and a Claude-generated team description

---

## Backend Structure

```
backend/
  app.py                          # Flask factory — registers 12 blueprints, configures CORS
  api/
    auth.py                       # @require_admin JWT decorator (HS256/RS256/ES256)
    builder.py                    # POST /builder/evaluate
    calibration.py                # GET/PUT /skills/thresholds, /anchors
    cohesion_calibration.py       # Cohesion engine calibration: weights, rotation eval, composites
    composite.py                  # POST /players/<id>/composite-profile, /claude-assessment
    health.py                     # GET /health
    legends.py                    # CRUD + /claude-suggestion
    pipeline.py                   # GET /pipeline/status, POST /pipeline/fetch-stats
    players.py                    # Full player management (search, stats, profile, bio)
    review.py                     # GET /review/queue, POST /review/<id>/resolve
    rosters.py                    # CRUD for rosters + roster_slots
    salaries.py                   # GET /salaries/bulk
  services/
    skill_engine/                 # Core stat→skill evaluation sub-package
      conditions.py               # evaluate_condition(), evaluate_conditions_block()
      evaluator.py                # evaluate_skill(), apply_auto_promotions(), tier bumps
      transforms.py               # apply_pre_adjustments(), apply_stabilization()
      cache.py                    # get_thresholds(), compute_and_store_league_averages()
      history.py                  # Multi-season stat blending
    roster_evaluator/             # Roster scoring engine
      evaluator.py                # RosterEvaluator.evaluate_roster() — 770 lines, main entry
      weights.py                  # Per-skill base score contributions
      modifiers.py                # Dynamic modifiers (playoff, era, tier-scaled) — 1600 lines
      hard_checks.py              # Validation (physical constraints, draft-pick rules)
      cornerstone_complement.py   # Synergy scores: how well players complement cornerstone
      team_description.py         # Claude-powered narrative generation
      types.py                    # RosterEvaluation dataclass + related types
    cohesion_engine/              # Lineup/rotation cohesion scoring (newer eval system)
      cohesion.py                 # evaluate_lineup() — subscores, composites, PnR pairing
      roster.py                   # evaluate_roster() — rotation combos, depth, accentuation
      composites.py               # Player composite scores (offense, defense, shooting, etc.)
      synergies.py                # Pairwise synergy bonuses between players
      accentuation.py             # Strength/weakness accentuation modifiers
      weights.py                  # Configurable subscore weights (stored in Supabase)
      bell_curve.py               # Bell curve normalization for composite values
      ratios.py                   # Spacing, rim pressure, and other ratio calculations
      notes.py                    # Cohesion-specific note generation
      team_description.py         # Claude-powered cohesion narrative
      types.py                    # LineupCohesion, PlayerComposites, RosterEvaluation types
    skill_engine/pipeline.py      # Orchestrates fetch → evaluate → persist for skill profiles
    claude_assessment.py          # rate_player(), suggest_skills_for_legend()
    compositing.py                # merge_ratings(), create_flags()
    nba_api_client.py             # Fetches live stats from NBA.com
    stats_assembler.py            # Compiles raw NBA.com stats into player_stats JSONB blob
    salary_scraper.py             # Salary data ingestion
    players_service.py            # get_player(), list_players(), create_player()
    notability.py                 # Notability signals for player context
    supabase_client.py            # Supabase singleton: get_supabase()
    skills.py                     # SKILL_LIST, SKILL_LABELS (backend canonical source)
```

---

## Frontend Structure

```
frontend/
  app/
    page.tsx                      # Home / splash
    login/, signup/               # Supabase auth forms
    unauthorized/                 # Auth error page
    players/                      # Player explorer + [player_id] profile
    builder/                      # Roster editor (drag-drop via @dnd-kit)
      evaluate/                   # Evaluation results: score breakdown, GM Notes, narrative
    admin/
      calibration/                # Threshold JSONB editor (Monaco editor)
      pipeline/                   # Pipeline status + trigger
      review/                     # Flag queue + [player_id] resolver
      legends/                    # Legend grid + [legend_id] editor
      players/[player_id]/        # Admin player editor
  lib/
    api.ts                        # All backend calls via apiFetch<T>() — injects JWT + base URL
    types.ts                      # All TypeScript interfaces (mirrors backend response shapes)
    skills.ts                     # SKILL_LIST, SKILL_LABELS, SKILL_TIERS (frontend canonical source)
    tiers.ts                      # getTierColor(), getTierIcon(), getTierLabel()
    stat-keys.ts                  # Display labels for raw stat keys
  components/                     # shadcn/ui + custom components
```

**Key frontend pattern**: All backend calls go through `apiFetch<T>()` in `lib/api.ts`. Types in `lib/types.ts` mirror backend response shapes exactly. All API responses follow `{ success, data, error }` envelope.

---

## Key Constraints

- **Skill thresholds are JSONB, not SQL** — threshold updates always go through the calibration API (`PUT /api/skills/thresholds/<skill_name>`), never as SQL migrations. The calibration UI edits these live.
- **Volume gates use per-game divisors** — `~70 games` for a full season. Never use raw per-season counts in threshold conditions.
- **`apply_pre_adjustments` uses `copy.deepcopy`** — load-bearing; removing it causes stat mutations to bleed across multiple adjustments.
- **21-skill taxonomy is immutable** — defined in `backend/services/skills.py` and `frontend/lib/skills.ts`. Adding a skill requires a DB migration.
- **Admin write endpoints require `@require_admin`** — decorator in `api/auth.py` verifies Supabase JWT and checks `user_roles` table. Grant admin via Supabase dashboard (`user_roles` table, `role = 'admin'`).
- **`NEXT_PUBLIC_CALIBRATION_API_KEY`** — required in frontend `.env.local` for calibration write endpoints.

---

## Skill Threshold Schema

```json
{
  "volume_gate": ConditionsBlock,
  "tiers": {
    "Elite": ConditionsBlock,
    "Proficient": ConditionsBlock,
    "Capable": ConditionsBlock
  },
  "tier_bumps": [{ "condition": ConditionsBlock, "bump_tier": "Elite" }],
  "auto_promotions": [{ "source_skill": "Scorer", "target_skill": "OffDribbShooter", "min_tier": "Elite" }],
  "stabilization": [{ "metric": "pts", "regression_factor": 0.7 }],
  "pre_adjustments": []
}
```

---

## Environment Variables

### backend/.env
| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key — server only |
| `SUPABASE_JWT_SECRET` | Yes | For HS256 JWT verification (newer projects use JWKS/RS256 auto-fetched) |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `FRONTEND_ORIGIN` | No | CORS origin (default: `http://localhost:3000`) |
| `CLAUDE_MODEL` | No | Model override (default: `claude-sonnet-4-20250514`) |

### frontend/.env.local
| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key |
| `NEXT_PUBLIC_API_URL` | Yes | Flask backend URL (default: `http://localhost:5001`) |
| `NEXT_PUBLIC_CALIBRATION_API_KEY` | No | Key for calibration write endpoints |

---

## Agent skills

### Issue tracker

GitHub Issues on chrooks/Cornerstone. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout. See `docs/agents/domain.md`.
