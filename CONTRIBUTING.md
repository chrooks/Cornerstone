# Contributing to Cornerstone

This guide covers development setup, workflow, and testing for the Cornerstone NBA skill evaluation platform.

## Prerequisites

- Python 3.10+
- Node.js 18+
- A [Supabase](https://supabase.com) project
- An [Anthropic API key](https://console.anthropic.com)

## Development Setup

### 1. Backend (Flask)

```bash
cd backend

# Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your Supabase and Anthropic credentials
```

**Backend dependencies** (from `requirements.txt`):
- `flask` — REST API framework
- `flask-cors` — Cross-origin request handling
- `python-dotenv` — Environment variable management
- `nba_api` — Live NBA stats integration
- `supabase` — Database client
- `anthropic` — Claude API integration
- `requests`, `beautifulsoup4`, `curl-cffi` — HTTP utilities
- `PyJWT`, `cryptography` — JWT validation

### 2. Frontend (Next.js)

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your Supabase and API URL
```

### 3. Database (Supabase)

```bash
# Install Supabase CLI if needed
brew install supabase/tap/supabase

# Link to your project
supabase login
supabase link --project-ref <your-project-ref>

# Apply migrations
supabase db push
```

## Running the Application

### Start the Backend

```bash
cd backend
source venv/bin/activate
python -m flask run --port=5001
```

API will be available at `http://localhost:5001`.

Health check: `GET http://localhost:5001/api/health`

### Start the Frontend

```bash
cd frontend
npm run dev
```

App will be available at `http://localhost:3000`.

### Running Tests

**Backend unit tests:**

```bash
cd backend
source venv/bin/activate
python -m pytest tests/
```

**Single test file:**

```bash
python -m pytest tests/test_skill_mapping_service.py -v
```

**Frontend linting:**

```bash
cd frontend
npm run lint
```

## Architecture Overview

The app is built in three interdependent layers:

### Layer 1 — Skill Pipeline (Internal Tooling)

- **Stat fetching**: Flask backend fetches live NBA stats via `nba_api` from NBA.com
- **Skill mapping**: Raw stats are translated to a 21-skill taxonomy via calibrated thresholds (stored in Supabase)
- **Claude validation**: Each player is independently rated by Claude API on the same taxonomy
- **Compositing**: Stat and Claude ratings are merged; disagreements create `skill_flags` for manual review
- **Frontend tools**:
  - `/calibration` — Threshold calibration UI
  - `/pipeline` — Pipeline runner and status dashboard
  - `/review` — Review queue for flagged profiles

### Layer 2 — Legends Builder

- `/legends` page provides a manual editor for 36 all-time NBA greats
- Each legend is rated on the 21-skill taxonomy
- Claude suggests ratings via `POST /api/legends/<id>/suggest` for user acceptance/override

### Layer 3 — Roster Builder and Evaluator

User-facing product:
- Browse current players and their skill profiles
- Select an all-time great as cornerstone player
- Build 8-man roster within salary cap budget
- Two evaluation engines: `roster_evaluator/` (weights, modifiers, GM Notes) and `cohesion_engine/` (lineup composites, PnR pairing, defensive coverage, accentuation)
- Receive AI-generated compatibility evaluation via the Claude API

## Key Concepts

### 19-Skill Taxonomy

All player ratings use a consistent taxonomy with four tiers:
- **Elite** — Top-tier performance
- **Proficient** — Above-average proficiency
- **Capable** — Professional standard
- **None** — Below threshold

See `frontend/lib/skills.ts` for the canonical list and display labels.

### Skill Thresholds

Thresholds define how raw NBA stats map to skill tiers. They are stored as JSONB in the `skill_thresholds` table with this structure:

```json
{
  "volume_gate": ConditionsBlock,          // Minimum games/minutes to qualify
  "tiers": {
    "Elite": ConditionsBlock,
    "Capable": ConditionsBlock
  },
  "tier_bumps": TierBump[],                // Promote/demote based on secondary conditions
  "auto_promotions": AutoPromotion[],      // Link one skill's tier to another's minimum
  "stabilization": StabilizationConfig[],  // Bayesian regression-to-mean
  "pre_adjustments": []                    // Stat mutations before evaluation
}
```

**Important**: Volume gates use per-game conditions, not per-season raw counts. The standard divisor for conversion is ~70 games (a full season).

### Skill Engine

The skill evaluation engine (`backend/services/skill_engine/`) is extracted from the original monolithic service. Each file has a single responsibility:

- `conditions.py` — Evaluate conditional logic blocks
- `transforms.py` — Apply stat mutations and pre-adjustments
- `evaluator.py` — Rate players on skill tiers
- `cache.py` — Cache evaluated profiles
- `history.py` — Track skill rating changes over time

## Development Workflow

### Before Coding

1. **Read existing implementations** — Find similar features or components
2. **Use existing patterns** — Follow library choices and conventions in the codebase
3. **Identify test impact** — Which tests will need updating?

### Writing Code

1. **Immutability first** — Always create new objects, never mutate in-place
2. **Small, focused files** — Aim for 200–400 lines; maximum 800
3. **Clear naming** — Variables and functions should explain their purpose
4. **Explicit error handling** — Never silently swallow exceptions
5. **Inline comments** — Explain the *why* when the intent isn't obvious

### Testing

**Write tests first (TDD approach)**:

1. Write the test (RED)
2. Run — it should fail
3. Write minimal implementation (GREEN)
4. Run — it should pass
5. Refactor (IMPROVE)
6. Verify 80%+ coverage

**Example test structure**:

```python
def test_skill_rating_with_eligible_volume():
    # Setup
    player_stats = create_test_player_stats(games=75, minutes_per_game=32)
    
    # Execute
    rating = evaluate_skill(player_stats, "Shooting")
    
    # Assert
    assert rating in ["Elite", "Capable", "None"]
```

### Code Review Checklist

Before committing:

- [ ] Code compiles and tests pass
- [ ] No hardcoded secrets or credentials
- [ ] All user inputs validated
- [ ] Error messages are descriptive
- [ ] Functions are < 50 lines
- [ ] Files are < 800 lines
- [ ] No premature abstractions
- [ ] Follows project naming conventions
- [ ] Immutable patterns used (no mutations)

## Committing Changes

Use conventional commit messages:

```
feat: Add height coverage analysis for roster builder
fix: Correct tier bumping logic for defensive perimeter skills
docs: Update threshold documentation with per-game conversion
refactor: Extract skill evaluation logic into separate module
test: Add tests for multi-season skill averaging
```

The format is `<type>: <description>`. Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`.

## API Contracts

### Health Check

```
GET /api/health
```

Returns `200 OK` if the backend is responsive.

### Player Skill Profiles

Player skill profiles are fetched and composited in Layer 1. See `docs/evaluator-api-contract.md` for full API specifications.

### Legends API

- `GET /api/legends` — List all legends
- `POST /api/legends/<id>/suggest` — Get Claude-generated suggestions for a legend
- Update endpoints require `X-Calibration-Key` header

## Environment Variables

### Backend (.env)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `SUPABASE_JWT_SECRET` | Yes | Supabase JWT secret (for JWT validation) |
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `CLAUDE_MODEL` | No | Model override (defaults to `claude-sonnet-4-20250514`) |
| `FRONTEND_ORIGIN` | No | CORS origin (defaults to `http://localhost:3000`) |

### Frontend (.env.local)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `NEXT_PUBLIC_API_URL` | No | Flask backend URL (defaults to `http://localhost:5001`) |

## Database Migrations

Migrations are managed via Supabase CLI. To add a new migration:

1. Create a new file in `supabase/migrations/` with a timestamp prefix
2. Write SQL schema changes
3. Run `supabase db push` to apply

Example:

```bash
# File: supabase/migrations/20260422_add_player_notes.sql
ALTER TABLE players ADD COLUMN notes TEXT;
```

## Troubleshooting

### Backend won't start

- Verify Python 3.10+: `python3 --version`
- Check `.env` is set up correctly
- Verify Supabase connectivity: `curl $SUPABASE_URL`

### Frontend build fails

- Clear cache: `rm -rf .next && npm install`
- Check Node version: `node --version` (should be 18+)
- Verify `.env.local` is configured

### Tests fail

- Ensure virtual environment is activated: `source backend/venv/bin/activate`
- Run with verbose output: `pytest -v tests/`
- Check for stale test data in Supabase

### Supabase connection issues

- Verify JWT secret is correct in `.env`
- Check that database migrations have been applied: `supabase db push`
- Confirm project is not in "paused" state on Supabase dashboard

## Resources

- [Project Architecture](README.md) — High-level system overview
- [Evaluator API Contract](docs/evaluator-api-contract.md) — API specifications
- [Suggestion System](docs/suggestion-system.md) — Claude integration details
- [Team Building Heuristics](docs/team-building-heuristics.md) — Roster evaluation logic
- [Skill Mapping Research](docs/stats_skill_mapping_research.md) — Stat-to-skill theory
