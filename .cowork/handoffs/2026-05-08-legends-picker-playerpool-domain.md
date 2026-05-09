<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: Lab Flow — Build Reskin + PlayerPool Extraction Plan

## Context

Cornerstone's Lab lifecycle is being built page by page. The route architecture is `/lab` (Rule Set picker) → `/lab/<ruleset>/legends` (Cornerstone picker) → `/lab/<ruleset>/build` (Team builder) → `/lab/<ruleset>/eval` (evaluation). Design system is "The Scouting Report" defined in `DESIGN.md`.

This session built the first two Lab pages and established critical domain vocabulary that will shape all remaining work.

## Current Implementation Status

### Completed and committed
- **Landing page** redesigned with Scouting Report design system (`077216f`)
- **Lab Rule Set picker** at `/lab` — notebook-tab cards with Rules/Players/Community tabs (`b6a2e77`)
- **Legends picker** at `/lab/[ruleset]/legends` — scouting report cards with NBA.com headshots, reuses FilterBar + SortControls + PlayerTable from Players page via `legendToPlayerWithSkills` adapter (`96dd192`)
- **NavBar** updated: Builder link removed (Lab is entry point), brand name uses Space Grotesk (`32e100f`, `3f7d89a`)
- **CONTEXT.md** vocabulary tightened: added Player, Legend, PlayerView, PlayerPool definitions; Player hierarchy in Relationships section

### Key domain decisions made this session
- **Player** is the universal entity. **Legend** is a subtype (`is_legend: true`) with manually curated Skill Profile. All Legends are Players.
- **PlayerPool** is the `players` prop passed to filter/sort/view surfaces. Different surfaces render different PlayerPools.
- **PlayerView** renders one Player at 3 densities: row (table), card (grid), report (scouting report). Same data, different zoom.
- User-facing text uses "Rule Set" (two words); code uses `RuleSet` (PascalCase).

## Important Working Instructions

1. Never kill the user's dev server — screenshot against running instance at localhost:3000
2. Use `/impeccable craft` for design/frontend work — shape brief required before building
3. Skill threshold updates use JSON not migrations
4. Use CONTEXT.md domain language strictly (Player, Legend, PlayerPool, PlayerView, Build, Rotation, etc.)
5. All React/HTML elements need human-communicatable `id` tags
6. Ask user for screenshots instead of fighting with Playwright

## Planned Work — Build Order

Per the [confirmed handoff brief](.cowork/handoffs/2026-05-08-lab-flow-craft-ruleset-picker.md):

1. ~~Lab Rule Set picker (`/lab`)~~ — done
2. ~~Legends picker (`/lab/[ruleset]/legends`)~~ — done
3. **Build reskin (`/lab/[ruleset]/build`)** — next
4. Eval reskin (`/lab/[ruleset]/eval`)
5. Saved Teams (`/saved-teams`)

After all Lab pages are built, extract shared components (interactive, not subagent):
- PlayerView (3 densities: row, card, report)
- PlayerPoolBrowser (FilterBar + SortControls + PlayerView collection, configurable columns/filters)
- Rewire Players page, Builder picker, Legends picker

See [notes](.claude/notes.md) and [extraction plan memory](project_playerpool_extraction_plan.md).

## Next Step

**Reskin the existing builder as `/lab/[ruleset]/build`.**

The existing builder lives at [`frontend/app/builder/`](frontend/app/builder/) and [`frontend/components/builder/`](frontend/components/builder/). The reskin needs:
- Route migration from `/builder?cornerstone=<id>` to `/lab/<ruleset>/build?cornerstone=<id>`
- Breadcrumb: "Standard > Build Your Rotation"
- Design system typography (Space Grotesk headline, Geist body, Geist Mono stats/salary)
- Tight radii, warm borders per DESIGN.md
- RuleSet constraints visible (SalaryCap gauge, slot count, RookieDeal counter)

Start by reading the existing builder components to understand scope before running `/impeccable craft`.

## Verification Baseline

```bash
cd frontend && npx tsc --noEmit  # should pass clean
npm run build                     # production build should succeed
```

Existing pages to verify visually: `/`, `/lab`, `/lab/standard/legends`
