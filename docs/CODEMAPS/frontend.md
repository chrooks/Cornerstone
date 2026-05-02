<!-- Generated: 2026-05-02 | Files scanned: Next.js app structure | Token estimate: ~980 -->

# Frontend Codemap

## Entry Point

**Framework**: Next.js 14.2.35 (App Router)
**Root**: `frontend/app/`

## Page Structure

### Public Pages

```
/                              → app/page.tsx
                                 Home / splash page
                                 Unauthenticated entry point

/login                         → app/login/page.tsx
                                 Supabase auth login form

/signup                        → app/signup/page.tsx
                                 User registration form
```

### Protected Pages (Require Auth)

```
/players                       → app/players/page.tsx
                                 Player explorer / list view
                                 Search, filter by team/position

/players/[player_id]           → app/players/[player_id]/page.tsx
                                 Individual player profile
                                 Shows stats, skills, flags history

/builder                        → app/builder/page.tsx
                                 Roster editor (scaffold phase)
                                 Select cornerstone legend

/builder/evaluate              → app/builder/evaluate/page.tsx
                                 Roster evaluation results
                                 Score breakdown, synergies

/unauthorized                  → app/unauthorized/page.tsx
                                 Auth error page
```

### Admin Pages (Require JWT + Admin Role)

```
/admin                         → app/admin/page.tsx
                                 Admin dashboard / menu

/admin/calibration             → app/admin/calibration/page.tsx
                                 Skill threshold tuning tool
                                 Edit JSONB conditions directly
                                 Test against anchor players

/admin/pipeline                → app/admin/pipeline/page.tsx
                                 Pipeline status dashboard
                                 Bulk stat fetch, processing queue

/admin/players/[player_id]     → app/admin/players/[player_id]/page.tsx
                                 Admin player editor
                                 Manual stat override, include/exclude

/admin/review                  → app/admin/review/page.tsx
                                 Review queue dashboard
                                 Filter flags by status

/admin/review/[player_id]      → app/admin/review/[player_id]/page.tsx
                                 Per-player flag resolver
                                 Trust stats / trust Claude / manual

/admin/legends                 → app/admin/legends/page.tsx
                                 Legends grid browser
                                 Search, filter by era

/admin/legends/[legend_id]     → app/admin/legends/[legend_id]/page.tsx
                                 Legend editor
                                 Edit skills, attributes
                                 Claude suggestion integration

/admin/cohesion-calibration     → app/admin/cohesion-calibration/page.tsx
                                 Cohesion engine weight editor
                                 Lineup tester, rotation diagnostics
                                 Player composites + bell curves

/admin/layout.tsx              → Wrapper layout with admin nav
```

## Root Layout

**File**: `app/layout.tsx`
- Configures Next.js metadata, fonts, Tailwind CSS
- Sets up Supabase auth provider (SSR via `@supabase/ssr`)
- Includes global styles, Toast notifications (sonner)

## Library Structure

### Core Types

**File**: `lib/types.ts` (~350 lines)
```typescript
// API Response Envelope
interface ApiResponse<T> {
  success: boolean
  data: T | null
  error: string | null
}

// Domain Models
interface Player { ... }
interface StatsBlob { ... }
interface SkillResult { ... }
interface Legend { ... }
interface Roster { ... }
interface RosterSlot { ... }
interface SkillFlag { ... }
```

Key type definitions:
- `SkillTier` = "All-Time Great" | "Elite" | "Proficient" | "Capable" | "None"
- `StatConfidence` = "high" | "moderate" | "low"
- `ConditionsBlock` = AND/OR tree of conditions
- `RosterEvaluation` = score + modifiers + team_description

### API Client

**File**: `lib/api.ts` (~200 lines)

All backend calls go through `apiFetch<T>()`:

```typescript
export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // Prepends NEXT_PUBLIC_API_URL
  // Injects X-Calibration-Key header for write requests (if set)
  // Handles auth token via Supabase SSR
}
```

**Exported functions** (by domain):
- `getPlayers()`, `getPlayer()`, `getPlayerStats()`, `searchPlayers()`
- `getSkills()`, `evaluateSkills()`, `getLeagueAverages()`
- `getCompositeProfile()`, `assessPlayerWithClaude()`
- `getThresholds()`, `updateThreshold()`, `testThresholds()`
- `getPipelineStatus()`, `triggerStatsFetch()`
- `getReviewQueue()`, `getPlayerFlags()`, `resolveFlag()`, `manualOverride()`
- `getLegends()`, `getLegend()`, `updateLegendSkills()`, `suggestLegendSkills()`
- `getRosters()`, `getRoster()`, `createRoster()`, `addRosterPlayer()`, `removeRosterPlayer()`
- `evaluateRoster()`
- `getCohesionWeights()`, `updateCohesionWeights()`, `evaluateRotation()`, `evaluateLineup()`
- `getPlayerComposites()`, `getPlayerBellCurve()`

### Skill Constants

**File**: `lib/skills.ts` (~50 lines)

```typescript
export const SKILL_LIST = [
  'Scorer', 'Playmaker', 'Defender', 'Rebounder', 'Athlete',
  'Finisher', 'Shooter', 'Ballhandler', 'FoulDrawer', 'OffDribbShooter',
  'TransitionRunner', 'CraftyFinisher', 'PoaDefender', 'TeamDefender',
  'ZoneDefender', 'Driver', 'Versatile', 'Durable', 'SmartTeamChem'
]

export const SKILL_LABELS = {
  'Scorer': 'Scorer',
  'Playmaker': 'Playmaker',
  // ...
}

export const SKILL_TIERS = ['All-Time Great', 'Elite', 'Proficient', 'Capable', 'None']
```

### Tier Display Helpers

**File**: `lib/tiers.ts` (~40 lines)

```typescript
export function getTierColor(tier: SkillTier): string
export function getTierIcon(tier: SkillTier): React.ReactNode
export function getTierLabel(tier: SkillTier): string
```

### Stat Key Labels

**File**: `lib/stat-keys.ts` (~100 lines)

Maps stat keys (e.g., `box_score.pts`, `advanced.ts_pct`) to display labels.

## Component Structure

### Components Directory

**Path**: `frontend/components/`
shadcn/ui + custom components

Key component categories:
- **UI Primitives**: Button, Card, Badge, Dialog, Input, Select, etc.
- **Navigation**: Header, Sidebar, Breadcrumbs, AdminNav
- **Player**: PlayerCard, PlayerStatsTable, SkillHeatmap, SkillBreakdown
- **Skills**: SkillEditor, ThresholdEditor, ConditionBuilder
- **Roster**: RosterSlotEditor, RosterEvaluationView, TeamDescription
- **Cohesion**: CohesionScoreDisplay, CohesionDebugPanel, CohesionResultDetails
- **Review**: FlagCard, FlagResolver, BulkResolveModal
- **Legends**: LegendCard, LegendEditor, LegendSkillsEditor
- **Admin**: PipelineStatus, CalibrationDashboard, ReviewQueue

## Authentication Flow

**Provider**: Supabase Auth with SSR
**Location**: `lib/api.ts` (Supabase client setup)

```
User clicks login
  ↓
/login page
  ↓
Supabase Auth form
  ↓
JWT returned (stored in secure cookie via SSR)
  ↓
All API calls include JWT in Authorization header
  ↓
Backend @require_admin decorator verifies JWT + admin role
```

**Client-side**: Uses `@supabase/ssr` for cookie management
**Server-side**: Supabase service role key used for admin queries

## Key Styling

**Framework**: Tailwind CSS 3.4
**Icons**: lucide-react
**Component Library**: shadcn/ui (Base UI + Tailwind)
**Animations**: `tw-animate-css`
**Merge Utility**: `tailwind-merge` for dynamic class composition
**Notifications**: `sonner` (toast library)

## Dependency Highlights

| Package | Purpose | Version |
|---------|---------|---------|
| `next` | Framework | 14.2.35 |
| `react` | UI library | 18.x |
| `@supabase/ssr` | Auth + cookie management | 0.9.0 |
| `@supabase/supabase-js` | DB client | 2.100.0 |
| `@monaco-editor/react` | Code editor (threshold editor) | 4.7.0 |
| `@dnd-kit/*` | Drag-and-drop (roster builder) | 6.3.1 + 10.0.0 |
| `@base-ui/react` | Headless UI (select, popover) | 1.3.0 |
| `lucide-react` | Icons | 1.6.0 |
| `shadcn` | Component installer | 4.1.0 |
| `clsx` | Class name utility | 2.1.1 |
| `sonner` | Toast notifications | 2.0.7 |
| `TypeScript` | Language | 5.x |
| `ESLint` | Linting | 8.x |
| `Tailwind CSS` | Styling | 3.4.1 |

## Data Fetching Patterns

### Server Components

- Initial data fetch happens at route render time
- Uses Supabase SSR client to include auth cookie
- Passes data to client components as props

### Client Components

- Interactive filters, searches use `apiFetch()` via `api.ts`
- JWT automatically injected from Supabase SSR cookie
- Error handling via toast notifications (sonner)
- Loading states via React hooks (useState, useEffect)

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | Flask API base URL | `http://localhost:5001/api` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key | (from Supabase dashboard) |
| `NEXT_PUBLIC_CALIBRATION_API_KEY` | Key for write endpoints | (set if calibration endpoint requires it) |

## Key Files by Purpose

| File | Lines | Purpose |
|------|-------|---------|
| `lib/api.ts` | ~200 | All backend fetch calls |
| `lib/types.ts` | ~350 | All TypeScript interfaces |
| `lib/skills.ts` | ~50 | 21-skill taxonomy constants |
| `lib/cohesionHelpers.ts` | ~100 | Cohesion score formatting + display utilities |
| `app/admin/calibration/page.tsx` | ~400 | Complex threshold editor UI |
| `app/admin/review/[player_id]/page.tsx` | ~300 | Flag resolver with manual overrides |
| `app/builder/page.tsx` | ~250 | Roster editor (drag-drop) |
| `components/*` | ~3000 | shadcn/ui + custom components |

## Request Flow Example: Fetch Player Profile

```
User navigates to /players/[player_id]
  ↓
page.tsx server component
  ↓
calls apiFetch<Player>('/players/{id}')
  ├─ Prepends NEXT_PUBLIC_API_URL
  ├─ Gets auth token from Supabase SSR
  ├─ Sends GET request with JWT
  │
  └─ Backend: flask players_bp route
       ├─ Verifies JWT (if protected)
       ├─ Fetches player record
       └─ Returns ApiResponse<Player>
  
  ↓
Passes data to <PlayerProfile /> component
  ↓
Component renders stats table, skills grid, flags history
```

## Related Codemaps

- `architecture.md` — system overview
- `backend.md` — API routes + services
- `data.md` — database schema
- `dependencies.md` — npm + Python packages
