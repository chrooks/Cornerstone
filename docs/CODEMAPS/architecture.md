<!-- Generated: 2026-04-22 | Files scanned: 30+ | Token estimate: ~850 -->

# Cornerstone Architecture

## System Overview

Three-layer NBA skill evaluation + roster builder platform with AI-assisted evaluation.

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (Next.js)                                              │
│ Players / Legends / Roster Builder / Admin Tools               │
│ Auth via Supabase + JWT                                         │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP + JWT
┌────────────────────▼────────────────────────────────────────────┐
│ Backend (Flask)                                                  │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ API Blueprints: players, skills, composite, calibration,  │ │
│ │ pipeline, review, legends, rosters, builder, health       │ │
│ └────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ Services:                                                  │ │
│ │ • skill_engine/ — stat→skill evaluation (cache, cache,    │ │
│ │   conditions, evaluator, history, transforms)             │ │
│ │ • roster_evaluator/ — roster scoring (evaluator,          │ │
│ │   weights, modifiers, hard_checks, cornerstone_complement)│ │
│ │ • claude_assessment.py — Claude API for skill ratings     │ │
│ │ • compositing.py — merges stat + Claude ratings          │ │
│ │ • nba_api_client.py — fetches live NBA.com stats         │ │
│ │ • stats_assembler.py — compiles per-player stats         │ │
│ │ • salary_scraper.py — ingests salary cap data            │ │
│ │ • players_service.py — player CRUD + bulk queries        │ │
│ │ • notability.py — identifies notable players             │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────┬────────────────────────────────────────────┘
                     │ SQL + Auth
┌────────────────────▼────────────────────────────────────────────┐
│ Database (Supabase PostgreSQL)                                  │
│ players, player_stats, skill_profiles, skill_flags,             │
│ skill_thresholds, legends, anchor_players, rosters              │
│ user_roles (admin auth)                                         │
└────────────────────────────────────────────────────────────────┘
```

## Layer 1: Skill Pipeline

**Purpose**: Evaluate players on 19-skill taxonomy (stat-driven + Claude AI)

**Flow**:
1. Backend fetches stats from NBA.com via `nba_api` → `player_stats` table
2. `skill_engine` evaluates each skill using thresholds (JSONB conditions)
3. `claude_assessment` asks Claude API for same 19-skill ratings
4. `compositing.py` merges both ratings: agreements auto-accepted, disagreements create `skill_flags`
5. Frontend review tool (`/review`) lets admins resolve flags manually

**Key Files**:
- `backend/services/skill_engine/` — conditions, evaluator, transforms, cache, history
- `backend/services/claude_assessment.py` — prompt-based Claude API calls
- `backend/services/compositing.py` — flag creation + merge logic
- `backend/api/skills.py`, `api/composite.py`, `api/review.py` — evaluation endpoints

## Layer 2: Legends Builder

**Purpose**: Manually curate 36 all-time greats on the same 19-skill taxonomy

**Flow**:
1. Admin selects a legend from `legends` table
2. Frontend editor at `/admin/legends/<id>` for skill editing
3. Claude pre-populates suggestions via `POST /api/legends/<id>/claude-suggestion`
4. Admin reviews + manually commits skills to DB
5. Legend skills used as roster complements in Layer 3

**Key Files**:
- `backend/api/legends.py` — CRUD + suggestion endpoints
- `frontend/app/admin/legends/` — legend editor pages
- `supabase/migrations/*legends*` — schema for legends, nba_api_id, physical attributes

## Layer 3: Roster Builder (Phase 4)

**Purpose**: Users build 8-man rosters (cornerstone + 7 players within salary cap)

**Flow**:
1. User picks a legend (cornerstone) with $54M salary
2. Adds up to 7 more players, staying under total cap
3. `roster_evaluator` scores the roster:
   - Base skill contributions (weights + modifiers)
   - Roster synergies (complement scores, hard checks)
   - Team description, GM notes system
4. Rosters persisted in `rosters` table with player slots

**Key Files**:
- `backend/services/roster_evaluator/` — scoring engine
- `backend/api/rosters.py`, `api/builder.py` — persistence + evaluation
- `frontend/app/builder/` — roster assembly UI

## Data Flow: Skill Evaluation

```
NBA.com stats
    ↓
nba_api_client.fetch_stats()
    ↓
stats_assembler.build_blob() → player_stats table
    ↓
┌───────────────────┬───────────────────┐
│                   │                   │
skill_engine        claudeassessment    │
.evaluate_all       .rate_player()      │
    │                   │               │
    ↓                   ↓               │
stat ratings      claude ratings       │
(tier values)     (tier values)        │
    │                   │               │
    └───────┬───────────┘               │
            │                           │
        compositing.merge()             │
            ↓                           │
        ┌─────────────────┐             │
        │ Skill Profile   │             │
        │ (composite)     │             │
        └─────────────────┘             │
            │                           │
        ┌─────────────────┐             │
        │  Disagreement?  │             │
        │  → skill_flag   │             │
        └─────────────────┘             │
            ↓                           │
        Frontend /review                │
        Admin resolves flag             │
            │                           │
            └───────────────────────────┘
```

## External Dependencies

| Service | Purpose | Integration |
|---------|---------|-------------|
| **NBA.com** | Live player stats | `nba_api` (fetch via Python lib) |
| **Anthropic Claude API** | Skill assessment + suggestion | `anthropic` SDK, prompt-based |
| **Supabase** | Auth + PostgreSQL DB | `supabase-py` + RLS (admin auth via `require_admin` JWT decorator) |
| **Supabase Auth** | User login, JWT signing | OpenID compatible, stored `user_roles` table |

## Key Constraints

- **19-skill taxonomy** — immutable list, defined in `frontend/lib/skills.ts` and `backend/services/skills.py`
- **Skill thresholds** — stored as JSONB in `skill_thresholds` table, edited via calibration UI (not migrations)
- **Volume gates** — conditions use per-game divisors (~70 games for full season conversion)
- **Supabase RLS** — some tables use RLS, write endpoints protected by `@require_admin` decorator + Bearer JWT
- **API envelope** — all responses follow `{ success, data, error }` format

## Related Codemaps

- `backend.md` — API routes + middleware details
- `frontend.md` — page structure + component hierarchy
- `data.md` — database schema + relationships
- `dependencies.md` — external integrations + versions
