# Evaluator System: Frontend ↔ Backend API Contract

## Endpoint

```
POST /api/builder/evaluate
```

No authentication required. Stateless.

---

## Request

**Sent by:** `evaluateRoster()` in `frontend/lib/api.ts`
**Called from:** `frontend/components/builder/EvaluatePage.tsx`

### Payload Shape (`EvaluatePayload`)

```typescript
{
  players: Array<{
    name: string;              // non-empty, max 100 chars
    slot: number;              // integer 0–9
    is_cornerstone: boolean;   // exactly one must be true
    height: string | null;     // e.g. "6-7", or null
    skills: Record<string, string>; // skill_name → tier string, max 30 entries
  }>;
  mode: "live" | "final"; // default "live"
  debug: boolean;          // default false
}
```

### Frontend Builds Payload As

- Filters null roster slots
- Maps active players + cornerstone legend to `{ name, slot, is_cornerstone, height, skills }`
- Calls `evaluateRoster({ players, mode: "final", debug: isAdmin })`

### Backend Validation Rules (`backend/api/builder.py`)

| Field | Rule |
|---|---|
| `players` | Required list, 1–20 items |
| `players[].name` | Non-empty string, max 100 chars |
| `players[].slot` | Required integer, 0–9 |
| `players[].is_cornerstone` | Required boolean; exactly one player must be `true` |
| `players[].height` | Optional string or null |
| `players[].skills` | Optional dict, max 30 entries; values null → coerced to `"None"` |
| `mode` | Must be `"live"` or `"final"` |
| `debug` | Must be boolean |

Invalid input → `400 Bad Request`.

---

## Evaluation Engines

The backend supports two evaluation engines, selected via the `EVAL_ENGINE` environment variable:

| Engine | `EVAL_ENGINE` value | Description |
|---|---|---|
| Legacy | `"legacy"` (default) | Skill-weight scoring: base weights, modifiers, GM Notes, cornerstone complement |
| Cohesion | `"cohesion"` | Lineup/rotation cohesion: player composites, PnR pairing, defensive bell curves, accentuation |

The response shape differs between engines (see below).

---

## Response — Legacy Engine

### Success Envelope

```json
{
  "success": true,
  "data": { ... RosterEvaluation (legacy) ... },
  "error": null
}
```

### `RosterEvaluation` Shape (Legacy)

```typescript
{
  scores: {
    overall: number;
    offense: number;
    defense: number;
    // additional dimension scores
  };
  notes: Note[];
  player_traces: Record<string, Record<string, unknown>> | null;
  aggregate_traces: Record<string, unknown> | null;
  height_coverage: Record<string, unknown>;
  team_description: string | null;       // Claude narrative (final mode only)
  player_impact_summary: Record<string, unknown>;
}

interface Note {
  severity: "critical" | "warning" | "tip" | "strength";
  category: "offense" | "defense" | "two_way" | "roster_balance";
  text: string;    // may contain user-supplied player names — render as plain text, NOT innerHTML
  trace_key: string;
  presence_type: string;
}
```

### Mode Differences (Legacy)

| | `live` | `final` |
|---|---|---|
| Severities returned | critical, warning, tip | critical, warning, tip, **strength** |
| Note cap | 7 (`LIVE_NOTE_LIMIT`) | None |
| `player_traces` | null (unless debug) | null (unless debug) |
| `aggregate_traces` | null (unless debug) | null (unless debug) |
| `team_description` | null | Claude-generated narrative |

### Debug Mode (`debug: true`, Legacy)

Populates the otherwise-null trace fields:

```json
{
  "player_traces": {
    "Player Name": {
      "trace_key": {
        "score": 0.85,
        "components": { "stat_name": 0.3 },
        "multipliers": { "amplifier": 1.2 },
        "label": "human description"
      }
    }
  },
  "aggregate_traces": {
    "spacing_score": { "score": ..., "components": {...}, "multipliers": {...}, "label": "..." }
  }
}
```

---

## Response — Cohesion Engine

### Success Envelope

```json
{
  "success": true,
  "data": { ... RosterEvaluation (cohesion) ... },
  "error": null
}
```

### `RosterEvaluation` Shape (Cohesion)

```typescript
{
  star_rating: number;             // 0.0–5.0 star scale
  star_rating_breakdown: {
    [dimension: string]: number;   // per-dimension star contributions
  };
  starting_lineup: LineupCohesion; // best 5-man lineup evaluation
  player_composites: PlayerComposites[];
  lineup_summary: Record<string, unknown>;
  notes: CohesionNote[];
  team_description: string | null; // Claude narrative (final mode only)
}

interface LineupCohesion {
  cohesion_score: number;          // 0.0–5.0 star scale
  subscores: Record<string, number>; // e.g. spacing, finishing, defense (0.0–10.0)
  synergies_applied: string[];     // named synergy bonuses active
  accentuation: {
    strength_amplification: number;
    weakness_coverage: number;
  };
  accentuation_details: Record<string, unknown>;
  boosted_bell_curves: Array<BellCurve | null>; // one per starting player
  rp_pd_boosts: RPPDBoost[];      // rim protector → perimeter disruptor boosts
}

interface PlayerComposites {
  player_id: string;
  name: string;
  base: {
    spacing: number;        // 0.0–10.0 normalized composites
    finishing: number;
    paint_touch: number;
    anchor: number;
    post_game: number;
    pnr_screener: number;
    off_ball_impact: number;
    shot_creation: number;
    rebounding: number;
    transition: number;
    perimeter_defense: number;
    interior_defense: number;
  };
  bell_curve: BellCurve;
}

interface BellCurve {
  amplitude: number;
  peak: number;             // height in inches (defensive coverage center)
  range_down: number;
  range_up: number;
  flat_down: number;
  flat_up: number;
}

interface RPPDBoost {
  player_index: number;
  player_name: string;
  provider_index: number;
  provider_name: string;
  provider_rim_protector_tier: string;
  boost: number;
  original_pd_tier: string;
  effective_pd_tier: string;
  original_pd_value: number;
  effective_pd_value: number;
}

interface CohesionNote {
  type: "strength" | "weakness" | "suggestion";
  category: string;
  severity: number;         // numeric severity (for sorting)
  raw_value: number;
  text: string;             // may contain user-supplied names — render as plain text
}
```

---

## Error Response (Both Engines)

```json
{
  "success": false,
  "data": null,
  "error": "validation error message"
}
```

---

## Backend Evaluation Pipeline

### Legacy Engine

`backend/services/roster_evaluator/evaluator.py` → `evaluate_roster(players, mode, debug)`

**Phase 1 — Per-Player Scoring**
Computes `player_traces`: per-player score traces (size modifier, on-ball threat, off-ball gravity, etc.)

**Phase 2 — Cross-Roster Aggregates**
Computes `agg`: roster-wide metrics (spacing score, passer score, defense score, rebounding, etc.) plus boolean synergy flags (lob threat, PnR synergy, transition, etc.)

**Phase 3 — Rule Engine**
`backend/services/roster_evaluator/modifiers.py` evaluates rules. Each rule is `check_X(roster, agg) → Note | None`.

**Phase 4 — Sort & Cap**
Notes sorted by severity (`critical → warning → tip → strength`), capped at 7 in live mode.

### Cohesion Engine

`backend/services/cohesion_engine/roster.py` → `evaluate_roster(players, mode)`

**Phase 1 — Player Composites**
`composites.py` computes normalized 0.0–10.0 composite scores per player (spacing, finishing, anchor, etc.) plus defensive bell curve parameters from height + skill tiers.

**Phase 2 — Lineup Evaluation**
`cohesion.py` → `evaluate_lineup()` scores each valid 5-man combination on subscores (spacing, PnR pairing, defensive coverage, transition, etc.), applies synergy bonuses, and rolls up to a star rating.

**Phase 3 — Roster Rollup**
`roster.py` ranks all lineup combinations, applies depth/accentuation modifiers, and selects the best starting lineup.

**Phase 4 — Notes & Narrative**
`notes.py` generates structured feedback. `team_description.py` calls Claude API for narrative (final mode only).

---

## Frontend Rendering (`EvaluatePage.tsx`)

### Legacy Engine
Notes split into three buckets:

| Bucket | Severities |
|---|---|
| `issues` | critical + warning |
| `tips` | tip |
| `strengths` | strength |

### Cohesion Engine
- Star rating displayed with CohesionScoreDisplay component
- Subscores shown as bar chart
- Player composites displayed in heatmap/table
- CohesionDebugPanel shows raw composites, bell curves, and synergy data for admins

Note `text` rendered as plain text in both engines (XSS prevention — names are user-supplied).

---

## Type Mirroring

Backend (`backend/services/roster_evaluator/types.py` and `backend/services/cohesion_engine/types.py`) and frontend (`frontend/lib/types.ts`) define matching types:

### Legacy Engine

| Backend (`@dataclass frozen`) | Frontend (`interface`) |
|---|---|
| `Scores` | `Scores` |
| `Note` | `Note` |
| `RosterEvaluation` | `RosterEvaluation` |

### Cohesion Engine

| Backend (`@dataclass frozen`) | Frontend (`interface`) |
|---|---|
| `PlayerComposites` | `PlayerComposites` |
| `LineupCohesion` | `LineupCohesion` |
| `Note` | `CohesionNote` |
| `RosterEvaluation` | `CohesionRosterEvaluation` |

---

## Limits & Constants

| Constant | Value | Location |
|---|---|---|
| `_MAX_PLAYERS` | 20 | `backend/api/builder.py` |
| `_MAX_NAME_LENGTH` | 100 | `backend/api/builder.py` |
| `_MAX_SKILLS` | 30 | `backend/api/builder.py` |
| `LIVE_NOTE_LIMIT` | 7 | `backend/services/roster_evaluator/weights.py` |
| `MAX_ROSTER_SLOTS` | 9 | `frontend/lib/builder-config.ts` |
| `EVAL_ENGINE` | `"legacy"` or `"cohesion"` | `backend/api/builder.py` (env var) |
