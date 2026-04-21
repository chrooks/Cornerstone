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
    name: string;          // non-empty, max 100 chars
    height: string | null; // e.g. "6-7", or null
    skills: Record<string, string>; // skill_name → tier string, max 30 entries
  }>;
  mode: "live" | "final"; // default "live"
  debug: boolean;          // default false
}
```

### Frontend Builds Payload As

- Filters null roster slots
- Maps active players + cornerstone legend to `{ name, height, skills }`
- Calls `evaluateRoster({ players, mode: "final", debug: isAdmin })`

### Backend Validation Rules (`backend/api/builder.py`)

| Field | Rule |
|---|---|
| `players` | Required list, 1–20 items |
| `players[].name` | Non-empty string, max 100 chars |
| `players[].height` | Optional string or null |
| `players[].skills` | Optional dict, max 30 entries; values null → coerced to `"None"` |
| `mode` | Must be `"live"` or `"final"` |
| `debug` | Must be boolean |

Invalid input → `400 Bad Request`.

---

## Response

### Success Envelope

```json
{
  "success": true,
  "data": { ... RosterEvaluation ... },
  "error": null
}
```

### `RosterEvaluation` Shape

```typescript
{
  notes: Note[];
  player_traces: Record<string, Record<string, unknown>> | null;
  aggregate_traces: Record<string, unknown> | null;
}

interface Note {
  severity: "critical" | "warning" | "tip" | "strength";
  category: "offense" | "defense" | "two_way" | "roster_balance";
  text: string;    // may contain user-supplied player names — render as plain text, NOT innerHTML
  trace_key: string; // key into aggregate_traces for this note's source data
}
```

### Mode Differences

| | `live` | `final` |
|---|---|---|
| Severities returned | critical, warning, tip | critical, warning, tip, **strength** |
| Note cap | 7 (`LIVE_NOTE_LIMIT`) | None |
| `player_traces` | null (unless debug) | null (unless debug) |
| `aggregate_traces` | null (unless debug) | null (unless debug) |

### Debug Mode (`debug: true`)

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

Only shown to admin users in the frontend debug panel.

### Error Response

```json
{
  "success": false,
  "data": null,
  "error": "validation error message"
}
```

---

## Backend Evaluation Pipeline

`backend/services/roster_evaluator/evaluator.py` → `evaluate_roster(players, mode, debug)`

**Phase 1 — Per-Player Scoring**  
Computes `player_traces`: per-player score traces (size modifier, on-ball threat, off-ball gravity, etc.)

**Phase 2 — Cross-Roster Aggregates**  
Computes `agg`: roster-wide metrics (spacing score, passer score, defense score, rebounding, etc.) plus boolean synergy flags (lob threat, PnR synergy, transition, etc.)

**Phase 3 — Rule Engine**  
`backend/services/roster_evaluator/rules.py` evaluates `ALL_RULES` (always) and `STRENGTH_RULES` (final mode only). Each rule is `check_X(roster, agg) → Note | None`.

**Phase 4 — Sort & Cap**  
Notes sorted by severity (`critical → warning → tip → strength`), capped at 7 in live mode.

---

## Frontend Rendering (`EvaluatePage.tsx`)

Notes split into three buckets:

| Bucket | Severities |
|---|---|
| `issues` | critical + warning |
| `tips` | tip |
| `strengths` | strength |

Each bucket rendered in a collapsible section. Note `text` rendered as plain text (XSS prevention — names are user-supplied).

Admin users see a debug panel with raw `player_traces` and `aggregate_traces` as JSON with copy-to-clipboard.

---

## Type Mirroring

Backend (`backend/services/roster_evaluator/types.py`) and frontend (`frontend/lib/types.ts`) define matching types:

| Backend (`@dataclass frozen`) | Frontend (`interface`) |
|---|---|
| `ScoreTrace` | `Record<string, unknown>` (opaque in frontend) |
| `Note` | `Note` |
| `RosterEvaluation` | `RosterEvaluation` |
| `EvaluatePayload` (implicit) | `EvaluatePayload` |

---

## Limits & Constants

| Constant | Value | Location |
|---|---|---|
| `_MAX_PLAYERS` | 20 | `backend/api/builder.py` |
| `_MAX_NAME_LENGTH` | 100 | `backend/api/builder.py` |
| `_MAX_SKILLS` | 30 | `backend/api/builder.py` |
| `LIVE_NOTE_LIMIT` | 7 | `backend/services/roster_evaluator/weights.py` |
| `MAX_ROSTER_SLOTS` | 9 | `frontend/lib/builder-config.ts` |
