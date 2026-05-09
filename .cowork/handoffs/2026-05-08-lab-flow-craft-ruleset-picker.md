<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->
<!-- DESIGN: DESIGN.md -->
<!-- PRODUCT: PRODUCT.md -->

# Handoff: Craft the Lab Flow (Starting with RuleSet Picker)

## Where We Left Off

The landing page is built and committed (`077216f`). Design system ("The Scouting Report") is established with PRODUCT.md, DESIGN.md, and CONTEXT.md all updated. The full Lab flow has been shaped but not yet built.

## Confirmed Shape Brief

The full user journey has been designed and the brief is confirmed. Build order: Lab RuleSet picker → Legends → Build reskin → Eval reskin → Saved Teams.

### Route Architecture

```
/                              Landing (brand) — DONE
/lab                           RuleSet picker (2-10 cards)
/lab/standard/legends          Pick Cornerstone
/lab/standard/build            Assemble Rotation
/lab/standard/eval             Score + breakdown
/saved-teams                   Persisted Teams (auth required)
/login, /signup                Auth modal (available anywhere, preserves Build)
```

### Page 1: `/lab` (RuleSet Picker) — BUILD FIRST

- Page title: "The Lab" in Space Grotesk headline
- RuleSet cards in responsive grid (2-3 columns desktop, 1 mobile)
- Each card is a **notebook with bookmark tabs**:
  - **Rules tab**: constraints as visual content (Team size, SalaryCap, Cornerstone requirement, PlayerPool source, RookieDeal limit)
  - **Players tab**: PlayerPool preview (count, sample headshots)
  - **Community tab**: stats ("127 teams built under this RuleSet")
- Cards are NOT identical: Standard gets full detail, coming-soon RuleSets are visually muted/disabled
- Status badge: "Active" or "Coming Soon"
- CTA at card bottom: "Enter Lab →"
- Color strategy: Restrained (product register). Amber accent on CTAs only.

### Page 2: `/lab/<ruleset>/legends` (Cornerstone Picker)

- Breadcrumb: "Standard > Pick Your Cornerstone"
- Rich filter bar: name search, position, era/peak year, team, skill level
- **Primary view: 4-up large cards** showing:
  - Large player headshot
  - Name, position, era
  - Key stats in Geist Mono
  - Full Skill Profile (all 21 skills with tier badges)
- **Secondary view: table** (toggle, same as Players page pattern)
- Pagination (4 per page, ~9 pages for 36 legends)
- Sort: name, era, position, overall skill strength

### Page 3: `/lab/<ruleset>/build` (Team Builder)

- Existing builder reskinned to design system
- Route migration from `/builder?cornerstone=<id>` to `/lab/<ruleset>/build?cornerstone=<id>`
- Space Grotesk page title, Geist body/labels, Geist Mono stats/salary
- Tight radii, warm borders
- Breadcrumb: "Standard > Build Your Rotation"
- RuleSet constraints visible (SalaryCap gauge, slot count, RookieDeal counter)

### Page 4: `/lab/<ruleset>/eval` (Evaluation)

- Existing eval reskinned
- Route migration to `/lab/<ruleset>/eval`
- Breadcrumb: "Standard > Your Score"
- Save Team CTA: if authenticated → save. If not → auth modal.
- Auto-generated team name: "Jordan + 8 · Standard · May 8"

### Page 5: Auth Modal

- Modal overlay at any point in Lab lifecycle
- Build visible behind (dimmed)
- Two tabs: Sign In / Sign Up
- Build persisted in localStorage (survives refresh, tab close, auth redirect)
- On success: modal closes, resume where you were

### Page 6: `/saved-teams` (Build Last)

- Auth required
- List of saved Teams: RuleSet badge, Cornerstone headshot, auto-generated name, cohesion score (mono), date
- Sort: date, score, RuleSet
- Actions: "View" (re-open eval), "Edit" (reopen builder, resume or start fresh prompt)
- Empty state: "No saved teams yet. Enter the Lab to build your first."

## Design Resolved Questions

1. **Team naming**: Auto-generate `Jordan + 8 · Standard · May 8`. No modal prompt.
2. **Build conflicts**: Prompt "Resume or start fresh?" when re-entering a RuleSet with existing localStorage Build.
3. **RuleSet card content**: Notebook with 3 bookmark tabs (Rules, Players, Community).
4. **Legends pagination**: 4-up cards with pagination + table view toggle. Same pattern as Players page.
5. **Edit saved team**: Prompt resume vs fork (edit original or create copy).

## Design System Reference

- **North Star**: "The Scouting Report"
- **Product register**: Restrained color (amber accent ≤10%), fixed rem type scale, predictable grids
- **Fonts**: Space Grotesk (page titles only), Geist (all UI), Geist Mono (stats/salary/scores)
- **Radii**: 2-6px (tight, rectangular)
- **Elevation**: Flat by default, shadow only on floating elements
- **Inspirations**: Pokemon Showdown (RuleSets = metagames), NBA 2K (Lab/Build nomenclature), Baseball Savant (data presentation)

## Key Files

- `frontend/app/page.tsx` — Landing page (done)
- `frontend/app/layout.tsx` — Root layout with fonts
- `frontend/tailwind.config.ts` — Design tokens
- `frontend/app/globals.css` — CSS variables
- `frontend/components/builder/` — Existing builder components to reskin
- `frontend/lib/skills.ts` — Skill taxonomy
- `frontend/lib/tiers.ts` — Tier colors/styles
- `CONTEXT.md` — Domain glossary (Team, Lab, Build, RuleSet, etc.)
- `DESIGN.md` — Full visual system spec
- `PRODUCT.md` — Brand context + north star

## Next Action

Run `/impeccable craft` targeting the Lab RuleSet picker page (`/lab`). The brief above is confirmed — shape is done. Build the notebook-tab RuleSet cards with the three content panels (Rules, Players, Community).
