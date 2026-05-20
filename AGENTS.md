# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

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
# npm run build   # Production build Update: Dont do this, it breaks the dev server
npm run lint    # ESLint
```

### Database
```bash
supabase db push   # Apply pending migrations to linked project
# New migrations: add a timestamped .sql file to supabase/migrations/, then push
```

---

## North Star

Cornerstone is the engine for the barbershop argument: "$15 to build a starting five," "five eras of LeBron, which years?", "best roster around prime Hakeem?" The product turns hypothetical roster debates into something you can build, test, and compare against others using the same rules. Think of those Instagram/social media posts where you pick players at different price tiers, but with a real evaluation engine behind it.

Product inspirations: **Pokemon Showdown** (RuleSets = metagames/tiers, format-first team building), **NBA 2K** (Lab/Build nomenclature, builder UX). The Lab lifecycle: `/lab/<ruleset>/legends` → `/lab/<ruleset>/build` → `/lab/<ruleset>/eval`.

---

## Architecture Overview

NBA skill evaluation and roster builder platform with RuleSet-scoped team building and versioned evaluation.

```
Frontend (Next.js) ──HTTP + JWT──▶ Backend (Flask) ──SQL──▶ Supabase PostgreSQL
```

**Layer 1 — Skill Pipeline** (admin tooling at `/admin/*`)
- Stats fetched from NBA.com via `nba_api` → assembled by `stats_assembler.py` → stored in `player_stats`
- `skill_engine/` evaluates each of 21 skills against JSONB threshold rules → `skill_profiles` (source: `"stats"`)
- `claude_assessment.py` asks Claude API for the same 21 ratings → `skill_profiles` (source: `"claude"`)
- `compositing.py` merges both: agreements auto-accepted, disagreements create `skill_flags` for manual review
- Frontend tools: `/admin/calibration` (stat->skill threshold editor), `/admin/pipeline` (stat fetch trigger), `/admin/review` (flag resolver)

**Layer 2 — Legends Builder** (`/admin/legends`)
- Manual editor for all-time greats rated on the same 21-skill taxonomy
- `POST /api/legends/<id>/claude-suggestion` pre-populates ratings; admin accepts or overrides

**Layer 3 — Lab Lifecycle** (`/lab/<ruleset>/legends` → `/lab/<ruleset>/build` → `/lab/<ruleset>/eval`)
- Users pick a RuleSet (format/metagame), select a legend cornerstone, build a roster within salary cap constraints
- `POST /api/builder/evaluate` runs `cohesion_engine/` — subscores (spacing, rim pressure, perimeter defense, etc.), synergies, accentuation, lineup combination ranking, and Claude-powered team narrative
- Teams can be saved against a specific RuleSet Version + Evaluation Version
- Community leaderboard ranks public saved teams

**Foundational concepts:**
- **RuleSet** — a named format (e.g., "standard", "all-time"). Each has versioned `rules_json` (team size, salary cap, allowed positions). Only one version published at a time.
- **Evaluation Version** — immutable snapshot of cohesion engine config (weights, composites, bell curves, synergy bonuses). Independent from RuleSet versions. Only one active at a time.
- **Saved Team** — persisted roster referencing both `ruleset_version_id` and `evaluation_version_id`.

---

## Backend Structure

```
backend/
  app.py                          # Flask factory — registers 17 blueprints, configures CORS
  api/
    auth.py                       # @require_admin JWT decorator (HS256/RS256/ES256)
    builder.py                    # POST /builder/evaluate
    calibration.py                # GET/PUT /skills/thresholds, /anchors
    cohesion_calibration.py       # Cohesion engine calibration: weights, rotation eval, composites
    community.py                  # Community leaderboard / social features
    composite.py                  # POST /players/<id>/composite-profile, /claude-assessment
    evaluation_versions.py        # Evaluation version publishing, reactivation, validation
    health.py                     # GET /health
    legends.py                    # CRUD + /claude-suggestion
    pipeline.py                   # GET /pipeline/status, POST /pipeline/fetch-stats
    players.py                    # Full player management (search, stats, profile, bio)
    profile.py                    # User profile API
    review.py                     # GET /review/queue, POST /review/<id>/resolve
    rosters.py                    # CRUD for rosters + roster_slots
    rulesets.py                   # RuleSet read API
    salaries.py                   # GET /salaries/bulk
    saved_teams.py                # Saved team persistence + evaluation versioning
  services/
    skill_engine/                 # Core stat→skill evaluation sub-package
      conditions.py               # evaluate_condition(), evaluate_conditions_block()
      evaluator.py                # evaluate_skill(), apply_auto_promotions(), tier bumps
      transforms.py               # apply_pre_adjustments(), apply_stabilization()
      cache.py                    # get_thresholds(), compute_and_store_league_averages()
      history.py                  # Multi-season stat blending
    cohesion_engine/              # Sole evaluation engine (roster_evaluator/ was removed)
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
    evaluation_versions/          # Evaluation version management
      repo.py                     # get_active(), publish/reactivate version persistence
      validator.py                # Validates version blob structure and completeness
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
    lab/[ruleset]/                # RuleSet-scoped Lab lifecycle
      legends/                    # Legend selection within a RuleSet
      build/                      # Builder within a RuleSet context
      eval/                       # Evaluation within a RuleSet context
    community/                    # Community leaderboard / social features
    profile/                      # User profile
    faq/                          # FAQ page
    admin/
      calibration/                # Threshold JSONB editor (Monaco editor)
      cohesion-calibration/       # Cohesion engine weight/composite calibration
      pipeline/                   # Pipeline status + trigger
      review/                     # Flag queue + [player_id] resolver
      legends/                    # Legend grid + [legend_id] editor
      rulesets/                   # RuleSet management
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
- **Evaluation versions are immutable snapshots** — cohesion weights + composites get published as a version via `evaluation_versions/`. Saved teams reference a specific version. Active version loaded at startup (`_warm_cohesion_distributions`).

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

### Project flow

Skill Boundary for issue tracking, roadmap, and execution loop. See `docs/agents/project-flow.md`.
