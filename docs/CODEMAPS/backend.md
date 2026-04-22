<!-- Generated: 2026-04-22 | Files scanned: 14 API files | Token estimate: ~980 -->

# Backend Codemap

## Entry Point

**File**: `backend/app.py` (145 lines)
- Flask application factory
- Registers 11 blueprints
- CORS restricted to `FRONTEND_ORIGIN` env var
- Max payload: 64 KB
- Colored logging with truncation for long httpx requests

## API Blueprints

### Routing Structure

All routes prefixed with `/api/`. Blueprint registration in `app.py`:

```python
app.register_blueprint(health_bp)       # /health
app.register_blueprint(players_bp)      # /players
app.register_blueprint(salaries_bp)     # /salaries
app.register_blueprint(skills_bp)       # /skills
app.register_blueprint(composite_bp)    # /composite
app.register_blueprint(calibration_bp)  # /calibration
app.register_blueprint(pipeline_bp)     # /pipeline
app.register_blueprint(review_bp)       # /review
app.register_blueprint(legends_bp)      # /legends
app.register_blueprint(rosters_bp)      # /rosters
app.register_blueprint(builder_bp)      # /builder
```

## API Routes by Domain

### Health (15 lines)
```
GET  /health                                    → health check
```

### Players (981 lines)
```
GET    /players                                 → list (with filters)
GET    /players/<player_id>/stats               → fetch + store stats blob
GET    /players/<player_id>/salary              → salary for player
GET    /players/<player_id>/career              → career history
GET    /players/<player_id>/profile             → full profile view
GET    /players/stats-bulk                      → multi-player stats fetch
GET    /players/nba-search                      → search NBA.com
GET    /players/bulk                            → fetch multiple player records
GET    /players/search                          → search by name/team
POST   /players/manual-include                  → add custom player
PATCH  /players/<player_id>/bio                 → update name/team/position
DELETE /players/<player_id>/manual-include      → remove custom player
DELETE /players/<player_id>                     → delete player record
```
Depends: `nba_api_client`, `stats_assembler`, `players_service`, `notability`

### Salaries (59 lines)
```
GET    /salaries/bulk                           → fetch salaries for player list
```
Depends: `salary_scraper`, `players_service`

### Skills (286 lines)
```
GET    /players/<player_id>/skills              → evaluate all skills for player
POST   /skills/batch                            → evaluate multiple players
GET    /league-averages                         → cached league averages per skill
```
Depends: `skill_engine`, `players_service`

### Composite (498 lines)
```
POST   /players/<player_id>/claude-assessment   → fetch Claude ratings for player
POST   /players/<player_id>/composite-profile   → merge stat + Claude, create flags
POST   /composite/batch                         → process multiple players
```
Depends: `claude_assessment`, `compositing`, `skill_engine`

### Calibration (576 lines)
```
GET    /skills/thresholds                       → fetch all skill thresholds (JSONB)
PUT    /skills/thresholds/<skill_name>          → update threshold rule set
POST   /skills/test-thresholds                  → test threshold against player stats
GET    /anchors                                 → fetch anchor players for calibration
POST   /anchors                                 → create anchor player
DELETE /anchors/<anchor_id>                     → delete anchor player
```
Depends: `skill_engine`, `supabase_client`
Note: Requires `@require_admin` JWT decorator

### Pipeline (277 lines)
```
GET    /pipeline/status                         → status of ongoing evaluations
POST   /pipeline/fetch-stats                    → trigger bulk stat fetch
```
Depends: `nba_api_client`, `stats_assembler`, `players_service`

### Review (910 lines)
```
GET    /review/queue                            → unresolved skill_flags
GET    /review/<player_id>/flags                → flags for one player
GET    /review/<player_id>/skill-breakdown      → detailed skill evaluation
POST   /review/<player_id>/resolve              → resolve single flag
POST   /review/bulk-resolve                     → resolve multiple flags
POST   /review/<player_id>/manual-override      → manual skill rating override
```
Depends: `supabase_client`, `compositing`
Note: Requires `@require_admin` JWT decorator

### Legends (718 lines)
```
GET    /legends                                 → list all legends
GET    /legends/<legend_id>                     → fetch legend with skills
PUT    /legends/<legend_id>/skills              → update legend skill profile
PUT    /legends/<legend_id>/attributes          → update legend metadata
POST   /legends/<legend_id>/claude-suggestion   → get Claude suggestions for skills
```
Depends: `claude_assessment`, `supabase_client`
Note: POST requires `@require_admin` JWT decorator

### Rosters (530 lines)
```
POST   /rosters                                 → create roster for legend
GET    /rosters?legend_id=<uuid>                → list rosters for legend
GET    /rosters/<roster_id>                     → fetch roster with all slots
PUT    /rosters/<roster_id>/players             → add/replace supporting player
DELETE /rosters/<roster_id>/players/<slot>      → remove supporting player
```
Depends: `supabase_client`
Note: Rosters store legend (cornerstone) + up to 7 supporting players

### Builder (194 lines)
```
POST   /builder/evaluate                        → evaluate complete roster
```
Depends: `roster_evaluator`, `supabase_client`

## Middleware

### Authentication

**File**: `backend/api/auth.py` (176 lines)

- `@require_admin` decorator — enforces Supabase JWT verification + admin role check
- Supports both HS256 (older) and RS256/ES256 (newer Supabase projects)
- JWKS auto-caching from Supabase `/auth/v1/.well-known/jwks.json`
- Returns 401 on invalid/expired token, 403 on missing admin role, 500 on config error
- Used on: `calibration`, `review`, `legends` POST, write endpoints

**JWT Flow**:
```
Frontend sends: Authorization: Bearer <supabase-access-token>
  → _verify_jwt() detects algorithm from header
  → validates signature (HS256 with SUPABASE_JWT_SECRET or RS256 with JWKS)
  → extracts user_id from 'sub' claim
  → queries user_roles table to confirm admin
  → if ok → proceeds; else 401/403
```

### CORS

Configured in `create_app()` — allowed origins from `FRONTEND_ORIGIN` env var (comma-separated list).

## Service Layer (backend/services/)

| File | Purpose | Key Functions |
|------|---------|---|
| `skill_engine/` | Stat→skill evaluation engine | `evaluate_skill()`, `evaluate_all_skills()`, `apply_auto_promotions()` |
| `skill_engine/cache.py` | Caching + league averages | `get_thresholds()`, `get_league_averages()`, `compute_and_store_league_averages()` |
| `skill_engine/conditions.py` | Condition evaluation | `evaluate_condition()`, `evaluate_conditions_block()`, `resolve_stat()` |
| `skill_engine/evaluator.py` | Tier assignment + tier bumps | `evaluate_skill()`, `apply_auto_promotions()` |
| `skill_engine/transforms.py` | Stat pre-processing | `apply_pre_adjustments()`, `compute_derived_stats()`, `apply_stabilization()` |
| `skill_engine/history.py` | Multi-season blending | `get_weighted_stats()`, `_blend_blobs()` |
| `roster_evaluator/` | Roster scoring engine | `RosterEvaluator.evaluate_roster()` |
| `roster_evaluator/evaluator.py` | Core scoring (770 lines) | Computes roster score via weights + modifiers + synergies |
| `roster_evaluator/weights.py` | Per-skill weights | Base score contributions |
| `roster_evaluator/modifiers.py` | Dynamic modifiers | Playoff, playoff bonus, era adjustments (1600 lines) |
| `roster_evaluator/hard_checks.py` | Validation rules | Draft-pick validity, physical constraint checks |
| `roster_evaluator/cornerstone_complement.py` | Synergy scoring | How well supporting players complement cornerstone |
| `roster_evaluator/team_description.py` | Narrative generation | Claude-powered team description |
| `roster_evaluator/optionality.py` | Bench flexibility | Not yet integrated |
| `skill_mapping_service.py` | Orchestrator | Chains skill_engine, compositing, Claude API |
| `claude_assessment.py` | Claude API client | `rate_player()`, `suggest_skills_for_legend()` |
| `compositing.py` | Stat + Claude merge | `merge_ratings()`, `create_flags()` |
| `nba_api_client.py` | NBA.com fetcher | `fetch_stats()`, `search_players()` |
| `stats_assembler.py` | Stat compilation | Assembles raw NBA.com stats into `stats` JSONB blob |
| `salary_scraper.py` | Salary ingestion | `scrape_salaries()` |
| `players_service.py` | Player CRUD | `get_player()`, `list_players()`, `create_player()`, `delete_player()` |
| `notability.py` | Signal detection | Identifies notable/fringe players |
| `supabase_client.py` | DB client singleton | `get_supabase()` |
| `skills.py` | Skill constants | `SKILL_LIST`, `SKILL_LABELS` (19 skills) |
| `stats_schema.py` | Stat validation | Schema for raw stat blobs |

## Request Flow Example: Evaluate Player Skills

```
POST /api/players/<player_id>/skills
  ↓
skills_bp handler
  ↓
skill_engine.evaluate_all_skills(stats_blob)
  ├─ loops 19 skills
  ├─ for each:
  │  ├─ apply pre_adjustments
  │  ├─ check volume_gate
  │  ├─ evaluate_conditions_block() for tier thresholds
  │  ├─ apply_tier_bumps()
  │  ├─ apply_auto_promotions()
  │  └─ collect_driving_stats()
  │
  └─ returns { skill_name: SkillResult }
  
Returned as JSON:
{
  "success": true,
  "data": {
    "all_skills": { "Scorer": {...}, "Defender": {...}, ... },
    "league_averages": {...}
  },
  "error": null
}
```

## Environment Variables

| Var | Purpose | Required |
|-----|---------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_KEY` | Supabase anon key (public) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin queries) | Yes |
| `SUPABASE_JWT_SECRET` | JWT signing secret (HS256 only) | No (newer projects use RS256) |
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `FRONTEND_ORIGIN` | CORS allowed origins | Yes (default: localhost:3000) |
| `LOG_LEVEL` | Logging level | No (default: INFO) |

## Key Files by Line Count

```
players.py        981 lines   — main player management API
review.py         910 lines   — flag review + manual override
legends.py        718 lines   — legend editor API
calibration.py    576 lines   — threshold tuning UI backend
rosters.py        530 lines   — roster persistence
composite.py      498 lines   — stat + Claude merge
pipeline.py       277 lines   — pipeline status + trigger
skills.py         286 lines   — skill evaluation endpoint
builder.py        194 lines   — roster evaluation endpoint
auth.py           176 lines   — JWT + admin auth
salaries.py        59 lines   — salary fetching
health.py          15 lines   — health check
```

## Related Codemaps

- `architecture.md` — system overview + data flows
- `frontend.md` — Next.js page structure
- `data.md` — database schema
- `dependencies.md` — external services + versions
