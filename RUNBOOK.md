# Cornerstone Runbook

Operational guide for developing, testing, and deploying the Cornerstone platform.

## Quick Start

### Backend + Frontend (Parallel)

**Terminal 1 — Backend**:
```bash
cd backend
source venv/bin/activate
python -m flask run --port=5001
```

**Terminal 2 — Frontend**:
```bash
cd frontend
npm run dev
```

**Terminal 3 — Database** (first time only):
```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Then navigate to `http://localhost:3000`.

## Common Tasks

### Add a New Route

1. **Backend** — Create a blueprint in `backend/api/` (e.g., `my_domain.py`)
   ```python
   from flask import Blueprint, jsonify
   
   bp = Blueprint("my_domain", __name__, url_prefix="/api/my_domain")
   
   @bp.route("/items", methods=["GET"])
   def list_items():
       return jsonify({"data": []})
   ```

2. **Register in app.py** — Add to Flask factory:
   ```python
   from api.my_domain import bp as my_domain_bp
   app.register_blueprint(my_domain_bp)
   ```

3. **Frontend** — Call via `apiFetch<T>()` in `lib/api.ts`:
   ```typescript
   const items = await apiFetch<Item[]>("/api/my_domain/items");
   ```

### Update Skill Thresholds

**Do NOT** create SQL migrations for threshold changes. Instead:

1. Edit thresholds via the **Calibration UI** at `http://localhost:3000/calibration`
2. The calibration UI sends JSON to `POST /api/calibration/thresholds/<skill_id>`
3. The endpoint updates the JSONB in `skill_thresholds` directly

Thresholds use **per-game volume conditions** (~70 games divisor for season conversion).

Example threshold JSON:
```json
{
  "volume_gate": {
    "operator": "AND",
    "conditions": [
      { "stat": "games_played", "op": ">=", "value": 20 }
    ]
  },
  "tiers": {
    "Elite": { "operator": "AND", "conditions": [...] },
    "Capable": { "operator": "AND", "conditions": [...] }
  },
  "tier_bumps": [],
  "auto_promotions": [],
  "stabilization": [],
  "pre_adjustments": []
}
```

### Tune Cohesion Engine Weights

The cohesion engine scores lineup and rotation chemistry. Weights are stored in Supabase (`cohesion_weights` table) and edited via the calibration UI:

1. Navigate to `http://localhost:3000/admin/calibration` and open the cohesion tab
2. Adjust subscore weights (offense, defense, spacing, PnR pairing, etc.)
3. Use the lineup tester to evaluate sample rotations in real-time
4. View player composites and bell curves to understand individual contributions

**API endpoints** (all require `@require_admin`):
- `GET /api/cohesion/weights` — fetch current weights
- `PUT /api/cohesion/weights` — update weights
- `POST /api/cohesion/evaluate-rotation` — score a rotation
- `POST /api/cohesion/evaluate-lineup` — score a 5-man lineup
- `GET /api/cohesion/player/<id>/composites` — player composite breakdown
- `GET /api/cohesion/player/<id>/bell-curve` — bell curve normalization data

### Run the Skill Pipeline

The pipeline evaluates all players across both stat-based and Claude evaluation:

1. **Start the pipeline** via Frontend:
   - Navigate to `http://localhost:3000/pipeline`
   - Click "Run Pipeline"

2. **Monitor progress**:
   - Pipeline runner queries `player_stats`, maps to skills, calls Claude API
   - Results written to `skill_profiles` (with source indicator)

3. **Review flagged differences**:
   - Navigate to `http://localhost:3000/review`
   - Resolve stat-vs-Claude disagreements manually
   - Accepted flags update `skill_profiles` and clear `skill_flags`

### Test a Single Skill

**Backend test**:
```bash
cd backend
source venv/bin/activate
python -m pytest tests/test_skill_mapping_service.py::test_elite_three_point_shooter -v
```

**Debug a specific player**:
```python
from services.skill_mapping_service import evaluate_player_skills
from services.nba_api_client import fetch_player_stats

stats = fetch_player_stats(player_id=201939)  # Steph Curry
skills = evaluate_player_skills(player_id=201939, season=2024, stats=stats)
print(skills["Three Point Shooting"])  # Check the rating
```

### Add a New Legend

1. **Add to database** via `POST /api/legends`:
   ```bash
   curl -X POST http://localhost:5001/api/legends \
     -H "X-Calibration-Key: $CALIBRATION_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Michael Jordan",
       "nba_position": "SG",
       "era": "1984-2003",
       "team": "Chicago Bulls"
     }'
   ```

2. **Open legends editor** at `http://localhost:3000/legends`
3. **Get Claude suggestions** via `POST /api/legends/<id>/suggest`
4. **Rate skills** in the UI and save

### Verify Supabase Connectivity

```bash
# Check environment
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_KEY

# Test from Python
python3 -c "
from services.supabase_client import get_client
client = get_client()
players = client.table('players').select('id,name').limit(1).execute()
print(f'Connected. Found {len(players.data)} players.')
"

# Test from Node
node -e "
const { createClient } = require('@supabase/supabase-js');
const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
client.from('players').select('count()', { count: 'exact' })
  .then(r => console.log('Connected. Total players:', r.count))
"
```

### Bulk Update Player Stats

For a full player stats refresh:

```bash
cd backend
source venv/bin/activate
python3 << 'EOF'
from services.nba_api_client import fetch_all_player_stats
from services.supabase_client import get_client

# Fetch all stats from NBA.com
all_stats = fetch_all_player_stats(season=2024)

# Store in Supabase
client = get_client()
for player_id, stats_blob in all_stats.items():
    client.table('player_stats').upsert({
        'player_id': player_id,
        'season': 2024,
        'stats_json': stats_blob
    }).execute()

print(f"Updated {len(all_stats)} player records")
EOF
```

## Database Schema

### Core Tables

| Table | Purpose | Key Columns |
|---|---|---|
| `players` | Current NBA players | `id`, `name`, `nba_position`, `nba_team`, `salary` |
| `player_stats` | Raw stat blobs from NBA.com | `player_id`, `season`, `stats_json` (JSONB) |
| `skill_profiles` | Evaluated 21-skill ratings | `player_id`, `season`, `source` (stat\|claude), `skills_json` (JSONB) |
| `skill_flags` | Disagreements pending review | `player_id`, `season`, `skill_name`, `stat_rating`, `claude_rating`, `resolved` |
| `skill_thresholds` | Calibration rules | `skill_name`, `thresholds` (JSONB) |
| `legends` | 36 all-time greats | `id`, `name`, `nba_position`, `era`, `skills_json` (JSONB) |
| `anchor_players` | Known-good tier assignments | `player_id`, `skill_name`, `expected_tier`, `reason` |
| `cohesion_weights` | Cohesion engine subscore weights | `key`, `weights` (JSONB) |

### Creating a New Migration

```bash
# Create file in supabase/migrations/
echo "ALTER TABLE players ADD COLUMN notes TEXT;" > supabase/migrations/20260422_add_notes.sql

# Apply
supabase db push
```

### Querying the Database

**From Python**:
```python
from services.supabase_client import get_client

client = get_client()
response = client.table('players').select('id,name').eq('nba_team', 'LAL').execute()
players = response.data
```

**From Node**:
```typescript
import { createClient } from "@supabase/supabase-js";

const client = createClient(url, anonKey);
const { data: players } = await client
  .from("players")
  .select("id,name")
  .eq("nba_team", "LAL");
```

## Testing

### Backend Tests

**Run all tests**:
```bash
cd backend
source venv/bin/activate
python -m pytest tests/ -v --tb=short
```

**Run with coverage**:
```bash
python -m pytest tests/ --cov=services --cov-report=term-missing
```

**Run a single test file**:
```bash
python -m pytest tests/test_skill_mapping_service.py -v
```

**Run a single test**:
```bash
python -m pytest tests/test_skill_mapping_service.py::test_elite_three_point_shooter -v
```

**Test the skill engine**:
```bash
python -m pytest tests/test_optionality.py -v  # Tier-bump logic
python -m pytest tests/test_cornerstone_complement.py -v  # Compatibility scoring
```

### Frontend Tests

**Lint**:
```bash
cd frontend
npm run lint
```

No automated test suite in frontend yet. Manual QA via the dev server at `http://localhost:3000`.

### Integration Testing

Test end-to-end flows:

1. **Stat fetch → Skill evaluation → Flag creation**:
   - Run backend pipeline
   - Check that `skill_profiles` and `skill_flags` are populated

2. **Threshold update → Re-evaluation**:
   - Edit a skill threshold in calibration UI
   - Re-run pipeline
   - Verify new threshold produces different ratings

3. **Legend creation → Claude suggestions**:
   - Add a new legend via API
   - Call `POST /api/legends/<id>/suggest`
   - Verify suggestions are returned

## Health Checks

### Backend is healthy

```bash
curl http://localhost:5001/api/health
# Expected: HTTP 200 OK
```

### Frontend is running

```bash
curl http://localhost:3000
# Expected: HTTP 200 OK (HTML page)
```

### Supabase is reachable

```bash
curl $SUPABASE_URL/rest/v1/  \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
# Expected: HTTP 200 OK (JSON metadata)
```

### Claude API is available

```bash
python3 -c "
from anthropic import Anthropic
import os
client = Anthropic(api_key=os.getenv('ANTHROPIC_API_KEY'))
response = client.messages.create(
    model='claude-opus-4-1',
    max_tokens=10,
    messages=[{'role': 'user', 'content': 'OK'}]
)
print('Claude API OK')
"
```

## Debugging

### Backend Debug Mode

```bash
cd backend
source venv/bin/activate
export FLASK_ENV=development
export FLASK_DEBUG=1
python -m flask run --port=5001
```

Enables auto-reload and detailed error pages.

### View Logs

**Backend logs** (console where Flask is running):
- Shows request logs, exceptions, print statements

**Supabase logs** (Dashboard):
- Navigate to your Supabase project
- View SQL and API logs in the dashboard

**Frontend console**:
- Open `http://localhost:3000`
- Press F12 or Cmd+Option+I (macOS)
- Check Console tab for errors and network requests

### Common Issues

**"Connection refused" on 5001**:
- Flask isn't running. Check `cd backend && python -m flask run --port=5001`

**"SUPABASE_URL is not set"**:
- `.env` is missing or incorrect. Run `cp .env.example .env` and fill in values

**"invalid JWT"**:
- Check `SUPABASE_JWT_SECRET` in `.env` matches Supabase dashboard
- Verify `X-Calibration-Key` header is set for write requests

**"No module named 'nba_api'"**:
- Virtual environment not activated. Run `source venv/bin/activate`

**npm ERR! 404 Not Found**:
- Clear cache: `npm cache clean --force && npm install`

## Performance Tuning

### Skill Evaluation Cache

The skill engine caches evaluated profiles to avoid re-computation:

```python
from services.skill_engine.cache import clear_cache

# Clear cache if thresholds change
clear_cache()
```

### Database Query Optimization

For large player batches, use pagination:

```python
client.table('players').select('id,name').limit(100).offset(0).execute()
```

### Claude API Rate Limiting

The platform respects Anthropic rate limits. If hitting limits:
- Add delays between API calls
- Batch requests where possible
- Consider Claude model tier

## Deployment Checklist

Before deploying to production:

- [ ] All tests pass: `pytest tests/ && npm run lint`
- [ ] `.env` variables are production-ready (URLs, keys, origins)
- [ ] Database migrations applied: `supabase db push`
- [ ] Claude model version matches production requirement in `.env`
- [ ] CORS origin set to production domain in `FRONTEND_ORIGIN`
- [ ] No hardcoded secrets in codebase
- [ ] Git is clean: `git status`
- [ ] Recent commits reviewed

## Rollback Procedure

If deployment causes issues:

1. **Identify the problem** via logs and health checks
2. **Revert code** to last known-good commit: `git revert <bad-commit>`
3. **Revert database** if needed: Supabase provides snapshots for restoration
4. **Redeploy** with the reverted code

## Support Resources

- **CLAUDE.md** — Project architecture and conventions
- **docs/evaluator-api-contract.md** — API specifications
- **docs/suggestion-system.md** — Claude integration
- **docs/team-building-heuristics.md** — Roster evaluation logic
- **README.md** — High-level system overview
