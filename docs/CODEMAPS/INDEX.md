<!-- Generated: 2026-04-22 | Cornerstone Codemap Index -->

# Cornerstone Codemaps Index

Token-lean architectural documentation for the NBA skill evaluation + roster builder platform.

## What are Codemaps?

Codemaps are searchable architectural guides that map the actual codebase structure — routes, services, types, data flows. They answer questions like:
- What API endpoints exist?
- How do components talk to the database?
- What's the data flow for skill evaluation?
- Where do external services integrate?

Each codemap is under 1000 tokens for fast scanning.

## Available Codemaps

### 1. Architecture (`architecture.md`)

**Focus**: System-level overview, three layers, data flows

What you'll find:
- Three-layer system diagram (Frontend → Backend → Database)
- Layer 1 (Skill Pipeline): stat evaluation, Claude API, flag merging
- Layer 2 (Legends Builder): manual legend curation
- Layer 3 (Roster Builder): roster scoring + synergies
- Data flow diagram for skill evaluation
- External service dependencies
- Key constraints (19-skill taxonomy, per-game volume gates, JSONB thresholds)

**Use this when**: Understanding the overall system, explaining to stakeholders, planning integrations

### 2. Backend (`backend.md`)

**Focus**: API routes, services, middleware, request flows

What you'll find:
- Entry point: `app.py` blueprint registration
- All 11 API blueprints with route listing (66 routes total)
- Service layer breakdown with line counts
- Authentication via `@require_admin` JWT decorator
- Request flow examples
- Environment variables
- File organization by domain

**Use this when**: Adding a new endpoint, understanding service dependencies, debugging API issues

### 3. Frontend (`frontend.md`)

**Focus**: Page structure, routing, components, API client

What you'll find:
- Next.js 14 App Router structure
- Public, protected, and admin page routes
- Library structure: `lib/api.ts`, `lib/types.ts`, `lib/skills.ts`
- Component organization by domain
- Authentication flow (Supabase SSR)
- Environment variables
- Data fetching patterns
- 21 dependencies with version + purpose

**Use this when**: Adding a new page, understanding auth flow, integrating API client

### 4. Data Schema (`data.md`)

**Focus**: Database tables, relationships, migrations

What you'll find:
- 8 core tables: players, player_stats, skill_profiles, skill_flags, skill_thresholds, legends, anchor_players, rosters
- Complete CREATE TABLE statements
- Indexes and constraints
- JSONB schema examples (thresholds, profile)
- 23 migrations timeline (Mar 25 - Apr 13)
- Data flow diagram: NBA.com → skill_engine → skill_profiles → skill_flags → review UI
- Key constraints (per-game volume gates, JSONB updates via API not migrations)

**Use this when**: Designing a new table, understanding relationships, debugging data issues

### 5. Dependencies (`dependencies.md`)

**Focus**: External services, npm/pip packages, integrations

What you'll find:
- Backend: 12 Python packages (Flask, Supabase, nba_api, anthropic)
- Frontend: 21 npm packages (Next.js, React, shadcn/ui, @dnd-kit)
- External services: NBA.com API, Anthropic Claude, Supabase PostgreSQL + Auth
- Environment variable checklist (backend + frontend)
- Integration code examples (Claude API, Supabase query, nba_api)
- Security scanning (bandit for Python, npm audit for JavaScript)

**Use this when**: Adding a dependency, understanding service integrations, setting up env vars

## Quick Navigation

### I need to...

**Add a new API endpoint**
→ Read: `backend.md` (routes section) + `architecture.md` (system flow)

**Add a new page**
→ Read: `frontend.md` (page structure) + `architecture.md` (system flow)

**Fix a database issue**
→ Read: `data.md` (schema + migrations) + `architecture.md` (data flow)

**Integrate a new external service**
→ Read: `dependencies.md` (integrations) + `architecture.md` (service boundaries)

**Understand the skill evaluation pipeline**
→ Read: `architecture.md` (Layer 1) + `data.md` (data flow diagram) + `backend.md` (services table)

**Debug an authentication issue**
→ Read: `backend.md` (@require_admin decorator) + `frontend.md` (Supabase SSR auth flow)

**Set up local dev environment**
→ Read: `dependencies.md` (env variables checklist) + root `CLAUDE.md`

## Codebase Statistics

| Component | Metric | Value |
|-----------|--------|-------|
| Backend | Total API endpoints | 66 routes across 11 blueprints |
| Backend | Total service files | 25+ (.py files in backend/services/) |
| Backend | Code size | ~9,500 lines of API code |
| Frontend | Page routes | 14 (public + protected + admin) |
| Frontend | Components | ~3,000 lines (shadcn/ui + custom) |
| Database | Tables | 8 core + 1 auth (user_roles) |
| Database | Migrations | 23 incremental schema changes |
| Skill Taxonomy | Total skills | 19 (Scorer, Playmaker, Defender, ...) |
| External APIs | Services | 3 (NBA.com, Anthropic Claude, Supabase) |

## Key Files by Purpose

### Backend

```
backend/app.py (145)                    — Flask factory + blueprint registration
backend/services/skill_engine/          — Stat→skill evaluation (5 files)
backend/services/roster_evaluator/      — Roster scoring (8 files)
backend/services/claude_assessment.py   — Claude API client
backend/services/compositing.py         — Stat + Claude merge
backend/api/players.py (981)            — Player CRUD + stats
backend/api/review.py (910)             — Flag review + resolution
backend/api/legends.py (718)            — Legend editor
backend/api/calibration.py (576)        — Threshold tuning
```

### Frontend

```
frontend/app/                           — Next.js 14 App Router pages
frontend/lib/api.ts                     — Backend fetch client
frontend/lib/types.ts                   — TypeScript interfaces
frontend/lib/skills.ts                  — 19-skill constants
frontend/components/                    — shadcn/ui + custom UI
frontend/app/admin/                     — Admin tools (calibration, review, pipeline)
```

### Database

```
supabase/migrations/                    — 23 schema migrations (Mar 25 - Apr 13)
-- Initial: players, player_stats, skill_profiles, skill_flags, thresholds, legends
-- Incremental: physical attributes, tiers, skills, constraints, auth
```

## Refreshing Codemaps

**When to update**:
- New major features (Layer 1, 2, 3 changes)
- API route changes (endpoints added/removed/renamed)
- Service layer refactoring
- Database schema changes
- Dependency upgrades

**How to update**:
1. Read affected source files
2. Extract actual route names, function signatures, file paths
3. Verify all links/examples still work
4. Update freshness header (date + file count)
5. Keep token estimate under 1000 per file

**Last Updated**: 2026-04-22

## Related Documentation

| File | Purpose |
|------|---------|
| `README.md` | Project overview + setup |
| `CLAUDE.md` | Dev commands + architecture (this project's notes) |
| `RUNBOOK.md` | Operational procedures |
| `CONTRIBUTING.md` | Contribution guidelines |
| `gm-notes-rule-engine.md` | GM notes system (roster description logic) |
| `eval-system-notes.md` | Evaluator system design notes |
| `docs/evaluator-api-contract.md` | Evaluator API specification |
| `docs/suggestion-system.md` | Claude suggestion system design |

---

**Maintained by**: Documentation specialist agent
**Last scan**: 2026-04-22 | ~30 source files analyzed
