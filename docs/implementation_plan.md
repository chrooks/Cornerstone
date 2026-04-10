# Cornerstone — Implementation Plan

## Overview

Cornerstone is an internal tool for constructing modern NBA rosters around all-time great players. The system profiles every qualifying current NBA player across 19 basketball skills using a hybrid pipeline: deterministic stat thresholds handle what numbers can measure, a Claude AI pass fills in what they can't, and a manual review layer resolves disagreements. Historical legends are profiled manually with Claude's assistance. The full stack is Next.js (frontend), Flask (backend), Supabase (database), nba_api + ESPN salary scraping (data sources), and the Anthropic API (Claude assessment).

The project is built across 8 sequential prompts. Each prompt produces a working, testable feature before the next begins.

---

## Dependency Graph

```
Prompt 1 (Scaffolding)
    └── Prompt 2 (Schema + Seed Data)
            └── Prompt 3 (Stats & Salary Pipeline)
                    └── Prompt 4 (Rule Engine & Skill Mapping)
                            └── Prompt 5 (Claude Assessment & Compositing)
                                    ├── Prompt 6 (Calibration UI)
                                    ├── Prompt 7 (Pipeline UI, Review Queue, Player Profiles)
                                    └── Prompt 8 (Legends Builder & Hub Dashboard)
```

Prompts 6, 7, and 8 all depend on 5 being complete but are independent of each other. They could technically be built in any order, but the numbered order is recommended because Prompt 6 produces reusable components that 7 and 8 consume.

---

## Pre-Implementation: Backport Patches

Before running any prompts, apply the backport patches to Prompts 1 and 2 and the Project Document. These patches propagate decisions made during the Prompt 3–8 design process back into the foundation layers.

| Patch | Target | What Changes | Why |
|---|---|---|---|
| 1 | Prompt 1 | Add `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` to `.env`; add `anthropic` pip dependency | Prompts 5/8 need the Anthropic API |
| 2a | Prompt 2 | Add `salary` column to `players` table | Salary data will be populated by the stats service |
| 2b | Prompt 2 | Add `league_averages` table | Prompt 4's stabilization formula reads league averages from this table |
| 2c | Prompt 2 | Rename `pnr_roll_man` → `pnr_finisher` in all seed data | Skill renamed to include both rollers and poppers |
| 2d | Prompt 2 | Replace placeholder skill_thresholds seed with full JSONB rules for all 19 skills | Prompt 4's rule engine needs complete rules on first run |
| 3a-b | Project Doc | Rename PnR Roll Man → PnR Finisher in skill taxonomy and skill weighting | Keeps source-of-truth document in sync |

**Deliverable:** `backport_patches.md` — contains all patches with a verification checklist.

---

## Prompt 1 — Project Scaffolding

**What it builds:** Monorepo with Next.js frontend and Flask backend, both configured with environment variables, dependencies installed, and health checks passing.

**Key outputs:**
- `/frontend` — Next.js app with Tailwind, shadcn/ui, TypeScript
- `/backend` — Flask app with nba_api, supabase-py, anthropic SDK, requests/beautifulsoup4
- Health check endpoints confirming both apps run

**Estimated effort:** Small. Scaffolding only, no features.

---

## Prompt 2 — Supabase Schema & Seed Data

**What it builds:** All database tables, seed data for the 36 legends and 19 skill threshold rules.

**Key outputs:**
- 8 tables: `players`, `player_stats`, `skill_profiles`, `skill_flags`, `skill_thresholds`, `league_averages`, `legends`, `anchor_players`
- 36 legend records seeded
- 19 skill threshold JSONB rules seeded (full rules, not placeholders)
- Migration file at `/backend/migrations/001_initial_schema.sql`

**Estimated effort:** Medium. The skill threshold seed data is 19 complex JSON blobs following Prompt 4's rule engine schema.

**Critical detail:** The skill_thresholds seed data must follow the exact JSONB schema that Prompt 4's rule engine will evaluate. Reference the Skill-to-Stat Mapping document (`skill_stat_mapping.md`) and Prompt 4's Rule Schema section when writing the seed data.

---

## Prompt 3 — NBA Stats & Salary Service

**What it builds:** Backend service that fetches live NBA player data from nba_api and salary data scraped from ESPN roster pages, persists everything to Supabase.

**Key outputs:**
- 5 endpoints: `GET /api/players`, `GET /api/players/<id>/stats`, `GET /api/players/<id>/salary`, `GET /api/salaries/bulk`, `GET /api/players/<id>/career`
- ESPN salary scraping service (matches scraped salaries to Supabase player records by name and team)
- Stats JSON blob with 18 top-level sections covering box score, advanced, tracking (8 categories), shot zones, shot detail, play type (9 types), hustle, matchup defense, salary, metadata
- Matchup defense computation derived from `LeagueSeasonMatchups` + `CommonPlayerInfo`
- Shot detail computation derived from `ShotChartDetail` ACTION_TYPE filtering
- Multi-season support via `?season` param
- Career metadata endpoint for notability scoring

**Data sources:**
- 28 league-wide nba_api calls (~42 seconds for a full refresh)
- Per-player `ShotChartDetail` and `LeagueSeasonMatchups` (fetched lazily, ~30 minutes for full league sweep)
- ESPN roster page scraping for salary data (~30 page fetches, no API key required)

**Estimated effort:** Large. This is the most API-integration-heavy prompt. The matchup defense computation and shot detail aggregation are non-trivial derived data.

**Deliverables:** `prompt3_final.md` (prompt + acceptance criteria)

---

## Prompt 4 — Skill Mapping Service (Rule Engine)

**What it builds:** A generic rule engine that evaluates JSONB threshold rules from Supabase to classify players into None/Capable/Elite tiers across 19 skills. No skill-specific code — all logic lives in the database.

**Key outputs:**
- Generic rule engine supporting: flat conditions, AND/OR logic, one level of nesting, stabilization, volume gates, tier bumps, pre-adjustments, computed stats, auto-promotions
- League averages computation and storage
- 2 endpoints: `GET /api/players/<id>/skills`, `POST /api/skills/batch`
- 1 utility endpoint: `GET /api/league-averages`
- Historical weighting (50/30/20 across 3 seasons)
- Per-skill output: tier, stat_confidence, review_recommended, driving_stats (raw + stabilized), volume_gate_passed, tier_bump_applied, auto_promoted

**Rule engine features:**
- Sample-size stabilization with per-stat K values (30–100)
- Volume gates with per-game and per-season modes
- Tier bumps for borderline cases
- Pre-adjustments (Screen Setter's box-out modifier)
- Computed stats (Passer composite, perimeter disruptor composite)
- Auto-promotions (Movement Shooter → Spot-up Shooter)
- Confidence flags (high/moderate/low) and always_flag_for_review

**Estimated effort:** Large. The rule engine DSL is the most architecturally complex piece. Stabilization math requires careful handling of per-game ↔ season-total conversions.

**Deliverables:** `prompt4_final.md` (prompt + acceptance criteria), `skill_stat_mapping.md` (reference document for all 19 skill rules)

---

## Prompt 5 — Claude Skill Assessment & Compositing

**What it builds:** Claude integration that independently rates players on 14 skills (skipping 6 high-confidence skills), then composites stat and Claude ratings into a final profile with flags for manual review.

**Key outputs:**
- Claude assessment service with hybrid prompt (11 blind + 3 informed skills)
- Notability scoring function (0–100 scale from career data)
- Compositing engine with confidence-based rules
- 3 endpoints: `POST /api/players/<id>/claude-assessment`, `POST /api/players/<id>/composite-profile`, `POST /api/composite/batch`
- Three skill_profiles records per player: source=stats, source=claude, source=composite
- skill_flags records for every disagreement requiring review
- Batch processing: concurrent Claude calls (5 parallel, ~25 players/minute), cost tracking

**Compositing logic (stat_confidence drives everything):**

| Confidence | Agreement | Action |
|---|---|---|
| High | — | Claude skipped, stat tier = final |
| Moderate | Exact match | Auto-accept |
| Moderate | One-tier gap | Auto-accept lower tier |
| Moderate | Two-tier gap | Flag for review |
| Low | Exact match | Auto-accept |
| Low | Any gap | Flag for review |

Plus: notability 0–39 flags all non-high-confidence skills. Claude self-reporting low confidence tightens the rules.

**Estimated effort:** Medium. The Claude prompt construction and JSON parsing are straightforward. The compositing matrix has many edge cases but is well-defined. Concurrency adds complexity.

**Deliverables:** `prompt5_final.md` (prompt + acceptance criteria)

---

## Prompt 6 — Threshold Calibration UI

**What it builds:** The primary internal tool for tuning skill classification thresholds. Three-panel layout: player explorer, threshold editor, anchor sidebar.

**Key outputs:**
- `/calibration` page with three-panel layout
- Threshold-only editor (default): edit numerical values within existing rule structure
- Advanced JSONB editor (toggle): full rule editing with syntax highlighting
- Anchor player system: set expected tiers, test thresholds against anchors
- 6 reusable components: `PlayerStatDisplay`, `SkillProfileCard`, `SkillTierSelector`, `SkillTierBadge`, `StatConfidenceIndicator`, `PlayerSearchCombobox`
- 5 new backend endpoints: threshold CRUD, test-thresholds, anchor CRUD
- Stabilized/raw value toggle for stat display

**Core workflow loop:** Search player → see rating → click skill → see thresholds → edit number → test against anchors → re-evaluate player → save. Should feel tight — no step over 2 seconds.

**Estimated effort:** Medium-large. The threshold editor needs to parse arbitrary JSONB rules into a structured form, which is complex UI work. The reusable components are foundational for Prompts 7 and 8.

**Deliverables:** `prompt6_final.md` (prompt + acceptance criteria)

---

## Prompt 7 — Pipeline UI, Review Queue, Player Profiles

**What it builds:** Four new pages for running the batch pipeline, reviewing flagged players, and viewing final skill profiles.

**Key outputs:**
- `/pipeline` — two-step runner (stat mapping → composite), progress tracking, status dashboard
- `/review` — filterable/sortable queue of flagged players with full search, team/position/notability/flag-reason filters
- `/review/<player_id>` — side-by-side review panel with per-skill resolution (Trust Stats / Trust Claude / Override) and bulk shortcuts
- `/players/<player_id>` — canonical player profile page with all 19 skills and source indicators
- 7 new backend endpoints: review queue, flags, resolution (single + bulk), player profile, pipeline status, player search
- Global navigation bar with badge counts
- Keyboard navigation and prefetching in review panel

**Estimated effort:** Large. Four pages with substantial interactivity. The review panel has the most complex state management (optimistic updates, undo, bulk actions, navigation with filter preservation).

**Deliverables:** `prompt7_final.md` (prompt + acceptance criteria)

---

## Prompt 8 — Legends Builder & Hub Dashboard

**What it builds:** The hub dashboard at `/` and the legend profile editor for the 36 all-time greats.

**Key outputs:**
- `/` — hub dashboard with 4 navigation cards (live stat badges) + 3 status summary blocks
- `/legends` — responsive grid of 36 legend cards with completion indicators, sort/filter
- `/legends/<legend_id>` — two-column editor with skill selectors (4-state: null/None/Capable/Elite), auto-save, general notes field
- Claude suggestion diff view: blank profiles get pre-filled, existing profiles get a per-skill diff with accept/reject
- 4 new backend endpoints: legends CRUD, Claude suggestion
- Updated global navigation with Legends link + completion badge

**Key UX detail:** Unrated (null) is visually distinct from None. Null means "haven't gotten to it yet." None means "this player deliberately does not have this skill." Both are valid, but only rated skills count toward completion.

**Estimated effort:** Medium. The legend editor is simpler than the calibration UI. The Claude diff view has two distinct modes (blank vs existing) which adds complexity.

**Deliverables:** `prompt8_final.md` (prompt + acceptance criteria)

---

## Supporting Documents

| Document | Purpose | Used By |
|---|---|---|
| `skill_stat_mapping.md` | Defines all 19 skill composites, stat sources, thresholds, stabilization K values, and anchor player sanity checks | Prompts 2 (seed data), 4 (rule engine), 6 (calibration reference) |
| `Free_NBA_Play_Type_and_Tracking_Data_Sources.md` | Documents available nba_api endpoints, access patterns, rate limits, and known issues | Prompt 3 (implementation reference) |
| `backport_patches.md` | Changes to apply to Prompts 1, 2, and the Project Document before implementation | Apply before running any prompts |
| `Project_Document` | Core game rules, skill taxonomy, compatibility logic, app architecture | All prompts (source of truth for the skill taxonomy and game rules) |

---

## Estimated Total Endpoints

| Prompt | New Endpoints | Running Total |
|---|---|---|
| 1 | 1 (health check) | 1 |
| 2 | 0 | 1 |
| 3 | 5 | 6 |
| 4 | 3 | 9 |
| 5 | 3 | 12 |
| 6 | 5 | 17 |
| 7 | 7 | 24 |
| 8 | 4 | 28 |

---

## Estimated Total Pages

| Prompt | New Pages | Running Total |
|---|---|---|
| 1 | 1 (placeholder) | 1 |
| 6 | 1 (/calibration) | 2 |
| 7 | 4 (/pipeline, /review, /review/[id], /players/[id]) | 6 |
| 8 | 3 (/, /legends, /legends/[id]) | 9 |

---

## Risk Areas

**nba_api fragility.** The NBA deprecates endpoints without warning, blocks cloud IPs, and shifts header requirements. Run from residential IPs or use residential proxies. Pin nba_api to v1.11.4+. Budget time for endpoint debugging.

**ESPN salary scraping fragility.** ESPN's roster pages are undocumented — the embedded JSON structure could change without warning. The scraper should fail gracefully (null salaries, not crashes). If ESPN breaks, Basketball Reference is the fallback: use `basketball-reference-scraper` (`pip install basketball-reference-scraper`) which also provides annual salary data, but respect the 20 requests/minute rate limit.

**Matchup defense data quality.** The `LeagueSeasonMatchups` endpoint is the weakest data source. The positional diversity index is a useful filter but not a reliable classifier. Expect Versatile Defender to be flagged for nearly every player — this is by design.

**Claude assessment cost at scale.** 300 players × ~3000 tokens per call ≈ $1–4 per full league run. Not expensive, but it adds up during iterative development. Use the "Skip Claude" checkbox during calibration to avoid unnecessary API spend.

**Rule engine complexity.** The JSONB rule DSL is the most architecturally ambitious piece. If the generic engine proves too complex, the fallback is hardcoding composite formulas in code (Prompt 4 Option B) and storing only threshold numbers in the database. This reduces calibration UI flexibility but simplifies implementation significantly.

**Shot detail fetch time.** `ShotChartDetail` is per-player and slow (~7.5 minutes for 300 players). Lazy fetching means the first request for any player's stats will be slower than subsequent cached requests. Consider a background job for initial data population.
