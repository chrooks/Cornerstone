<!-- Generated: 2026-05-02 | Files scanned: 25 migrations | Token estimate: ~900 -->

# Database Schema

## Overview

PostgreSQL via Supabase. 25 migrations, 9 core tables, 20+ columns with JSONB flexibility.

## Core Tables

### players

Current NBA players with basic stats.

```sql
CREATE TABLE players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nba_api_id        integer UNIQUE NOT NULL,
  name              text NOT NULL,
  team              text,
  position          text,
  age               integer,
  games_played      integer,
  minutes_per_game  numeric,
  season            text NOT NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

Indexes:
  idx_players_nba_api_id ON nba_api_id
  idx_players_season ON season
  trigger: update_updated_at_column()
```

**Note**: One row per player per season. `nba_api_id` is the NBA.com canonical ID.

### player_stats

Raw stat blob (JSON) fetched from NBA.com for a player/season.

```sql
CREATE TABLE player_stats (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid REFERENCES players (id) ON DELETE CASCADE,
  season    text NOT NULL,
  stats     jsonb NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

Indexes:
  idx_player_stats_player_id
  idx_player_stats_season
```

**Note**: Multiple rows allowed per player/season (captures multiple fetches). `stats` is a complete JSONB blob with sections: box_score, advanced, tracking_shooting, etc.

### skill_profiles

Skill ratings for a player (one row per player/source).

```sql
CREATE TABLE skill_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid REFERENCES players (id) ON DELETE CASCADE,
  season          text,
  is_legend       boolean DEFAULT false,
  profile         jsonb NOT NULL,
  source          text,
  review_required boolean DEFAULT false,
  reviewed        boolean DEFAULT false,
  reviewed_at     timestamptz,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

Indexes:
  idx_skill_profiles_player_id
  idx_skill_profiles_is_legend
  idx_skill_profiles_review ON (review_required) WHERE review_required = true
  trigger: update_updated_at_column()
```

**Profile schema**:
```json
{
  "Scorer": "Elite",
  "Playmaker": "Proficient",
  "Defender": "Capable",
  // ... 21 skills total
}
```

**Source values**: `"composite"`, `"manual"`, `"claude"`, `"stats"`

### skill_flags

Disagreements between stat-based and Claude-based ratings.

```sql
CREATE TABLE skill_flags (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_profile_id     uuid REFERENCES skill_profiles (id) ON DELETE CASCADE,
  skill_name           text NOT NULL,
  stat_rating          text NOT NULL,
  claude_rating        text NOT NULL,
  flag_reason          text NOT NULL,
  stat_values          jsonb,
  claude_justification text,
  resolution           text,
  resolved_value       text,
  resolved_at          timestamptz,
  notes                text
);

Indexes:
  idx_skill_flags_profile_id
  idx_skill_flags_unresolved ON (resolution) WHERE resolution IS NULL
```

**Resolution values**: `"trust_stats"`, `"trust_claude"`, `"manual_override"`, or NULL (unresolved)

### skill_thresholds

JSONB rules for skill evaluation (Elite/Proficient/Capable tiers).

```sql
CREATE TABLE skill_thresholds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_name text UNIQUE NOT NULL,
  thresholds jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

Trigger: update_updated_at_column()
```

**Thresholds schema**:
```json
{
  "volume_gate": {
    "operator": ">=",
    "metric": "games_played",
    "value": 70
  },
  "tiers": {
    "Elite": { "operator": ">=", "metric": "pts", "value": 20.5 },
    "Proficient": { "operator": ">=", "metric": "pts", "value": 15.0 },
    "Capable": { "operator": ">=", "metric": "pts", "value": 10.0 }
  },
  "tier_bumps": [
    { "condition": {...}, "bump_tier": "Elite", "source_skill": "Scorer" }
  ],
  "auto_promotions": [
    { "source_skill": "Scorer", "target_skill": "OffDribbShooter", "min_tier": "Elite" }
  ],
  "stabilization": [
    { "metric": "pts", "regression_factor": 0.7 }
  ],
  "pre_adjustments": []
}
```

**Note**: Updated via calibration API (not migrations). Stored as JSONB to avoid schema migrations.

### legends

36 all-time NBA greats (no modern stats).

```sql
CREATE TABLE legends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  peak_era        text NOT NULL,
  nba_api_id      integer UNIQUE,
  team            text,
  position        text,
  height_cm       numeric,
  weight_kg       numeric,
  birth_year      integer,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

Trigger: update_updated_at_column()
```

**Note**: `nba_api_id` links to BBall Reference or historical records. Position normalized via migrations (e.g., PG, SG, SF, PF, C, G, F).

### anchor_players

Current players with known expected tier values (calibration reference).

```sql
CREATE TABLE anchor_players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid REFERENCES players (id) ON DELETE CASCADE,
  skill_name    text NOT NULL,
  expected_tier text NOT NULL,
  notes         text,
  created_at    timestamptz DEFAULT now()
);

Indexes:
  idx_anchor_players_player_id
  idx_anchor_players_skill_name
```

### rosters

User-created rosters: cornerstone legend + supporting players.

```sql
CREATE TABLE rosters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legend_id   uuid REFERENCES legends (id),
  name        text,
  description text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);
```

**Note**: Each roster has up to 8 slots (1 cornerstone + 7 supporting).

### roster_slots

Individual slots within a roster.

```sql
CREATE TABLE roster_slots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id   uuid REFERENCES rosters (id) ON DELETE CASCADE,
  slot_number integer NOT NULL,
  player_id   uuid REFERENCES players (id),
  is_cornerstone boolean DEFAULT false,
  salary      numeric,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

Constraints:
  slot_number between 1 and 8
  cornerstone slot (slot_number=1) has is_cornerstone=true, salary=$54M
```

### cohesion_weights

Configurable weights for the cohesion engine subscore rollup.

```sql
CREATE TABLE cohesion_weights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text UNIQUE NOT NULL,
  weights    jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
```

**Note**: Updated via cohesion calibration API (`PUT /api/cohesion/weights`), not migrations. Weights control how offense, defense, spacing, PnR pairing, and other subscores contribute to the final cohesion score.

### user_roles (Auth)

Admin role tracking for calibration/review access.

```sql
CREATE TABLE user_roles (
  user_id text PRIMARY KEY,
  role    text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

**Role values**: `"admin"` (others may be added)

**Note**: user_id is the UUID from Supabase auth (JWT 'sub' claim).

## Data Flow Diagram

```
NBA.com stats
    ↓ (nba_api_client)
┌───────────────────┐
│  player_stats     │  ← raw JSONB blob
│  (one per fetch)  │
└────────┬──────────┘
         │
         ├─→ stats_assembler.build_blob() ─→ processes into sections
         │
    ┌────▼──────────────────────────────┐
    │  skill_engine.evaluate_all_skills  │  ← loops 21 skills
    │  - apply_pre_adjustments           │
    │  - check volume_gate               │
    │  - evaluate conditions             │
    │  - apply tier_bumps                │
    │  - apply_auto_promotions           │
    └────┬──────────────────────────────┘
         │
    ┌────▼──────────────────┐
    │  skill_profiles       │  ← source: "stats"
    │  (stat-based rating)  │
    └────┬──────────────────┘
         │
         ├─→ claude_assessment.rate_player()
         │        ↓
         │   ┌────────────────────┐
         │   │  skill_profiles    │  ← source: "claude"
         │   │  (Claude rating)   │
         │   └─────┬──────────────┘
         │         │
         ├─────────┤
         │         │
         ▼         ▼
    ┌──────────────────────────┐
    │ compositing.merge_ratings│
    │ - compare stat vs Claude │
    └────┬─────────────────────┘
         │
    ┌────▼──────────────────┐
    │  skill_profiles       │  ← source: "composite"
    │  (merged)             │
    └────┬──────────────────┘
         │
         ├─→ disagreement?
         │        ↓
         │   ┌─────────────────┐
         │   │ skill_flags     │  ← for manual review
         │   └─────────────────┘
         │
         ▼
    ┌─────────────────────┐
    │ /review UI          │  ← admin resolves flags
    │ (manual override)   │
    └─────────────────────┘
```

## Migrations Overview

| File | Date | Purpose |
|------|------|---------|
| `20260325000000_initial_schema.sql` | Mar 25 | Core tables: players, player_stats, skill_profiles, skill_flags, skill_thresholds, legends, anchor_players |
| `20260325000001_backport_patches.sql` | Mar 25 | Legacy data migration |
| `20260326000000_add_player_physical_attributes.sql` | Mar 26 | height_cm, weight_kg, birth_year on players |
| `20260401000000_anchor_players_unique.sql` | Apr 1 | Unique constraint on (player_id, skill_name) |
| `20260402000000_rename_skills.sql` | Apr 2 | Skill name normalization |
| `20260402000001_skill_profiles_unique_constraint.sql` | Apr 2 | Unique on (player_id, season, source) |
| `20260403000000_add_all_time_great_tier.sql` | Apr 3 | Added "All-Time Great" skill tier |
| `20260404000000_add_legend_id.sql` | Apr 4 | legend_id column (foreign key) |
| `20260407000000_add_proficient_tier.sql` | Apr 7 | Added "Proficient" tier |
| `20260407000001_add_driver_skill.sql` | Apr 7 | Added "Driver" skill to taxonomy |
| `20260408000000_update_crafty_finisher.sql` | Apr 8 | Crafty Finisher thresholds |
| `20260408000001_rename_defender_skills.sql` | Apr 8 | Defender → TeamDefender, etc. |
| `20260408000002_rename_poa_defender.sql` | Apr 8 | POA Defender rename |
| `20260408000003_off_dribble_shooter_fg3_penalty.sql` | Apr 8 | OffDribbShooter FG3 penalty adjustment |
| `20260410000000_add_legend_physical_fields.sql` | Apr 10 | height_cm, weight_kg, birth_year on legends |
| `20260410000001_add_legend_team.sql` | Apr 10 | team column on legends |
| `20260410000002_add_legend_position.sql` | Apr 10 | position column on legends |
| `20260410000003_normalize_legend_positions.sql` | Apr 10 | Standardize position format |
| `20260410000004_normalize_legend_positions_v2.sql` | Apr 10 | Further position normalization |
| `20260410000005_normalize_player_positions.sql` | Apr 10 | Standardize player positions |
| `20260410100000_add_legend_nba_api_id.sql` | Apr 10 | nba_api_id on legends (for linking) |
| `20260410100001_legend_nba_api_id_unique_index.sql` | Apr 10 | Unique index on nba_api_id |
| `20260412000000_add_manually_included.sql` | Apr 12 | manually_included flag for custom players |
| `20260412000001_backfill_haliburton_profile.sql` | Apr 12 | Data fix for Haliburton |
| `20260413000000_add_user_roles.sql` | Apr 13 | user_roles table for admin auth |

## Key Constraints

1. **Per-game volume gates** — conditions use games_played as divisor (~70 games for season conversion)
2. **JSONB thresholds** — never use migrations for threshold updates, use calibration API
3. **Immutable skill list** — 21 skills defined in code (`backend/services/skills.py`, `frontend/lib/skills.ts`)
4. **Admin writes** — most write endpoints require `@require_admin` JWT decorator
5. **Cascading deletes** — player deletion cascades to player_stats, skill_profiles, skill_flags, anchor_players, roster_slots

## Index Strategy

- **Foreign keys**: indexed by default (PostgreSQL)
- **Lookups**: idx_players_nba_api_id, idx_player_stats_player_id
- **Filtering**: idx_skill_profiles_review, idx_skill_flags_unresolved (partial indexes for unresolved items)
- **Performance**: `season` indexed for time-based queries

## Related Codemaps

- `architecture.md` — system overview + data flows
- `backend.md` — API routes + services
- `frontend.md` — page structure
- `dependencies.md` — external integrations
