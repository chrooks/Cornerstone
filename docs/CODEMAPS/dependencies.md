<!-- Generated: 2026-05-02 | Scanned: requirements.txt + package.json | Token estimate: ~780 -->

# External Dependencies & Integrations

## Backend (Python)

### Web Framework

| Package | Version | Purpose |
|---------|---------|---------|
| `flask` | 3.1.0 | Lightweight web framework |
| `flask-cors` | 5.0.1 | CORS middleware (restrict to FRONTEND_ORIGIN) |
| `python-dotenv` | 1.0.1 | Load environment variables from .env |

### Database & Auth

| Package | Version | Purpose |
|---------|---------|---------|
| `supabase` | 2.15.1 | PostgreSQL client + auth SDK (service role key: `SUPABASE_SERVICE_KEY`) |
| `PyJWT` | ≥2.0.0 | JWT verification (HS256 + RS256 asymmetric) |
| `cryptography` | ≥41.0.0 | Cryptographic primitives (for JWT + JWKS) |

### NBA Data

| Package | Version | Purpose |
|---------|---------|---------|
| `nba_api` | 1.9.0 | Official NBA.com stats API wrapper |
| `requests` | ≥2.31.0 | HTTP client (for salary scraping, JWKS fetch) |
| `beautifulsoup4` | ≥4.12.0 | HTML parsing (salary scraper) |
| `curl-cffi` | ≥0.7.0 | HTTP client with modern TLS (Cloudflare bypass) |

### AI Integration

| Package | Version | Purpose |
|---------|---------|---------|
| `anthropic` | ≥0.40.0 | Claude API SDK (skill assessment + suggestions) |

### Installation

```bash
cd backend
pip install -r requirements.txt
```

## Frontend (JavaScript/TypeScript)

### Framework & Core

| Package | Version | Purpose |
|---------|---------|---------|
| `next` | 14.2.35 | React framework with App Router |
| `react` | 18.x | UI library |
| `react-dom` | 18.x | React DOM bindings |
| `typescript` | 5.x | Type safety |

### Authentication & Database

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/ssr` | 0.9.0 | SSR client (cookie management for JWT) |
| `@supabase/supabase-js` | 2.100.0 | Supabase JS SDK (auth + real-time) |

### UI Components & Styling

| Package | Version | Purpose |
|---------|---------|---------|
| `@base-ui/react` | 1.3.0 | Headless UI primitives (Select, Popover, Combobox) |
| `shadcn` | 4.1.0 | Component library installer (pre-built Tailwind components) |
| `tailwindcss` | 3.4.1 | Utility-first CSS framework |
| `tailwind-merge` | 3.5.0 | Merge Tailwind class names dynamically |
| `lucide-react` | 1.6.0 | Icon library (SVG icons) |
| `class-variance-authority` | 0.7.1 | Type-safe component variants |
| `clsx` | 2.1.1 | Conditional class name composition |
| `sonner` | 2.0.7 | Toast notification library |
| `tw-animate-css` | 1.4.0 | Additional Tailwind animations |

### Editors & Interactions

| Package | Version | Purpose |
|---------|---------|---------|
| `@monaco-editor/react` | 4.7.0 | VS Code editor (for threshold JSON editing) |
| `@dnd-kit/core` | 6.3.1 | Drag-and-drop core library |
| `@dnd-kit/sortable` | 10.0.0 | Drag-and-drop sortable plugin |
| `@dnd-kit/utilities` | 3.2.2 | DnD utilities |

### Development

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | 8.x | JavaScript linter |
| `eslint-config-next` | 14.2.35 | Next.js ESLint rules |
| `postcss` | 8.x | CSS transformer (Tailwind pipeline) |
| `@types/node` | 20.x | Node.js type definitions |
| `@types/react` | 18.x | React type definitions |
| `@types/react-dom` | 18.x | React DOM type definitions |

### Installation

```bash
cd frontend
npm install
# or
yarn install
```

## External Services (Runtime Dependencies)

### Anthropic Claude API

**Purpose**: Skill assessment + legend skill suggestions
**Integration**: `backend/services/claude_assessment.py`
**Authentication**: `ANTHROPIC_API_KEY` environment variable
**Usage**:
- `rate_player(player_name, stats_blob)` → evaluates player on 21 skills
- `suggest_skills_for_legend(legend_name, legend_era)` → pre-fills legend skill profile

**Rate Limits**: Anthropic enforces request rate limits based on tier; see https://docs.anthropic.com/en/docs/resources/rate-limits

**Cost**: Pay-per-token; typical evaluation is ~2,000 tokens

### NBA.com API (via nba_api)

**Purpose**: Live player stats, searchable player directory
**Integration**: `backend/services/nba_api_client.py`
**Authentication**: Public (no API key required)
**Usage**:
- `fetch_stats(player_nba_api_id, season)` → returns stats blob
- `search_players(name)` → player directory search
- `get_player_career(nba_api_id)` → career history

**Rate Limits**: NBA.com may rate-limit aggressive crawling; production uses backoff + caching

**Note**: `curl-cffi` used for Cloudflare bypass if needed

### Supabase (PostgreSQL + Auth)

**Purpose**: Persistent storage + user authentication
**Integration**: `backend/services/supabase_client.py`, `frontend/lib/api.ts`
**Authentication**:
- Public anon key: `NEXT_PUBLIC_SUPABASE_ANON_KEY` (frontend, read-only)
- Service role key: `SUPABASE_SERVICE_KEY` (backend, admin queries)
- JWT signing: `SUPABASE_JWT_SECRET` (HS256 only, older projects) or JWKS (RS256, newer)

**Usage**:
- User login/registration via Supabase Auth UI
- Database queries via PostgREST + RLS
- Admin role enforcement via `require_admin` decorator

**Configuration**:
- URL: `SUPABASE_URL`
- Anon key: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Service role: `SUPABASE_SERVICE_ROLE_KEY`
- JWT secret: `SUPABASE_JWT_SECRET` (if HS256)

**Note**: RLS restricts queries based on authenticated user. Admin queries bypass RLS using service role key.

## Environment Variables Checklist

### Backend (.env)

```bash
# Required
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
ANTHROPIC_API_KEY=sk-ant-...

# Optional
SUPABASE_JWT_SECRET=<only if HS256>
FRONTEND_ORIGIN=http://localhost:3000,https://cornerstone.example.com
LOG_LEVEL=INFO
```

### Frontend (.env.local)

```bash
# Required
NEXT_PUBLIC_API_URL=http://localhost:5001
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Optional
NEXT_PUBLIC_CALIBRATION_API_KEY=<key if needed>
```

## Development Dependencies

### Backend Testing

```bash
pytest                  # Unit + integration tests
pytest --cov           # Coverage report
```

### Frontend Development

```bash
npm run dev            # Dev server (localhost:3000)
npm run build          # Production build
npm run lint           # ESLint check
```

## Version Compatibility

### Python

Minimum: Python 3.9 (type unions, walrus operator)
Recommended: Python 3.11+

```bash
python --version
# Python 3.11.x or higher
```

### Node.js

Minimum: Node 18.x (for native ESM support)
Recommended: Node 20.x LTS

```bash
node --version
# v20.x or higher
```

## Dependency Security

### Backend

Run bandit for static security analysis:

```bash
pip install bandit
bandit -r backend/
```

### Frontend

Run npm audit:

```bash
npm audit
npm audit fix
```

## Key Integration Patterns

### Claude API Prompt Example

```python
# backend/services/claude_assessment.py
response = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=2000,
    messages=[{
        "role": "user",
        "content": f"Rate {player_name} on these 19 NBA skills: {SKILL_LIST}..."
    }]
)
```

### Supabase Query Example

```python
# Backend (service role key bypasses RLS)
supabase.table("skill_profiles")\
    .select("*")\
    .eq("player_id", player_id)\
    .execute()

# Frontend (anon key, respects RLS)
supabase.from("players")\
    .select("*")\
    .limit(10)\
    .execute()
```

### NBA API Example

```python
# backend/services/nba_api_client.py
from nba_api.stats.endpoints import playerstats

stats = playerstats.PlayerStats(
    player_id=player_nba_api_id,
    season="2024-25"
).get_data_frames()[0]
```

## Related Codemaps

- `architecture.md` — system design overview
- `backend.md` — API routes + services
- `frontend.md` — page structure + components
- `data.md` — database schema
