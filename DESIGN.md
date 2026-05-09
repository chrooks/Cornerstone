---
name: Cornerstone
description: NBA skill evaluation and roster builder
colors:
  hardwood-amber: "#ffa05c"
  heat-check: "#fe6d34"
  warmup-peach: "#f3a181"
  chalk-dust: "#f0f0f0"
  scoreboard-black: "#0e0907"
  warm-border: "#d9d0c9"
  card-white: "#f7f7f7"
  deep-amber: "#a34400"
  dark-rust: "#7e2c0c"
  deep-surface: "#0f0f0f"
  warm-offwhite: "#f8f3f1"
  tier-violet: "#7c3aed"
  tier-emerald: "#059669"
  tier-sky: "#0284c7"
  tier-amber: "#d97706"
  tier-slate: "#64748b"
  destructive: "#e53e3e"
typography:
  display:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw + 1rem, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 2vw + 0.5rem, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
  section: "64px"
components:
  button-primary:
    backgroundColor: "{colors.hardwood-amber}"
    textColor: "{colors.scoreboard-black}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-primary-hover:
    backgroundColor: "{colors.heat-check}"
    textColor: "{colors.scoreboard-black}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.scoreboard-black}"
    rounded: "{rounded.md}"
    padding: "10px 20px"
  button-ghost-hover:
    backgroundColor: "{colors.chalk-dust}"
  chip-tier:
    rounded: "{rounded.sm}"
    padding: "2px 8px"
  nav-link:
    textColor: "{colors.tier-slate}"
    padding: "0"
  nav-link-active:
    textColor: "{colors.scoreboard-black}"
---

# Design System: Cornerstone

## 1. Overview

**Creative North Star: "The Scouting Report"**

**Product North Star:** Cornerstone is the engine for the barbershop argument. "$15 to build a starting five." "Five eras of LeBron, which years?" The product turns hypothetical roster debates into something you can build, test, and compare. The design must feel like that conversation: competitive, fun, data-backed, and worth arguing about.

Cornerstone looks like a front-office document that happens to be interactive. Clean grids, monospaced stats, sharp edges, warm paper tones. Every surface earns its presence through the data it carries, not through decoration.

The system is precise without being clinical. Space Grotesk headlines give it geometric personality; Geist Mono stat readouts give it analytical credibility; the warm amber palette keeps it from feeling like a spreadsheet. There is energy here, but it is controlled energy: kinetic transitions, snappy interactions, a sense that every tap reveals something worth knowing.

This is not a SaaS marketing page. Not a sports media site. Not a shadcn template with a different accent color. It is a scouting report for people who build rosters the way chess players build positions.

**Design note — the 2K parallel:** Cornerstone shares a thought exercise with NBA 2K's MyPlayer builder: assemble a hypothetical configuration, test it, iterate. The terminology ("Build" for an in-progress roster) and the core loop (configure → evaluate → refine) are deliberately borrowed. Large audience overlap expected. The UI should feel familiar to someone who spends hours tweaking a 2K build, but with real NBA data instead of sliders.

**Key Characteristics:**
- Sharp geometry: tight radii, precise grid alignment, rectangular containers
- Data-forward: real stats and skill tiers are the primary visual content
- Warm analytical: amber/orange palette over neutral paper tones, not cold blue/gray
- Tight and tactile: compact padding, snappy state changes, nothing floats loosely
- Progressive depth: simple surfaces that reveal complexity on interaction

## 2. Colors: The Scouting Report Palette

A warm analytical palette. Orange/amber as the action color against paper-toned neutrals. The warmth prevents the analytical precision from feeling sterile.

### Primary
- **Hardwood Amber** (#ffa05c): Primary action color. CTAs, active states, the nav underline, avatar backgrounds. The court surface in visual form.
- **Heat Check** (#fe6d34): High-emphasis accent. Hover states, urgent actions, highlighted data points. Used sparingly; its intensity is the point.

### Secondary
- **Warmup Peach** (#f3a181): Secondary UI surfaces. Soft backgrounds for selected states, muted badges, supporting highlights. Never competes with Hardwood Amber.

### Neutral
- **Chalk Dust** (#f0f0f0): Light mode background. Warm enough to not be sterile white, neutral enough to not compete with content.
- **Card White** (#f7f7f7): Card and elevated surface background. Barely distinguishable from Chalk Dust; separation through border, not contrast.
- **Warm Border** (#d9d0c9): Borders and dividers. Warm-tinted, not pure gray. Visible but never dominant.
- **Scoreboard Black** (#0e0907): Primary text. Near-black with a warm undertone. Never pure `#000`.
- **Warm Offwhite** (#f8f3f1): Dark mode text. Warm, not blue-white.
- **Deep Surface** (#0f0f0f): Dark mode background.
- **Deep Amber** (#a34400): Dark mode primary. Hardwood Amber's dark counterpart.
- **Dark Rust** (#7e2c0c): Dark mode secondary.

### Tier Colors (semantic, fixed)
- **Tier Violet** (#7c3aed): All-Time Great
- **Tier Emerald** (#059669): Elite
- **Tier Sky** (#0284c7): Proficient
- **Tier Amber** (#d97706): Capable
- **Tier Slate** (#64748b): None

Tier colors are a closed vocabulary. They appear on badges, selectors, and context menus. They do not leak into the general palette.

### Named Rules

**The Paper Rule.** Backgrounds are paper, not screens. Warm tints on every neutral. No `#000`, no `#fff`, no pure gray. If it feels like a monitor, add warmth.

**The Tier Fence Rule.** Tier colors (violet, emerald, sky, amber, slate) are reserved exclusively for skill tier UI. They never appear as accent colors, link colors, or decorative elements outside the tier system.

## 3. Typography

**Display Font:** Space Grotesk (with system-ui fallback)
**Body Font:** Geist (with system-ui fallback)
**Data Font:** Geist Mono (with ui-monospace fallback)

**Character:** Space Grotesk's quirky geometric terminals give headlines personality without shouting. Geist is the quiet workhorse: clean, contemporary, high legibility at small sizes. Geist Mono turns every stat line into something that looks like it belongs in a front-office report.

### Hierarchy
- **Display** (700, clamp(2.5rem, 5vw + 1rem, 4.5rem), 1.05): Landing page hero, major section headers. Tight tracking (-0.02em). Space Grotesk only.
- **Headline** (600, clamp(1.5rem, 2vw + 0.5rem, 2.25rem), 1.15): Page titles, feature section headers. Slight negative tracking (-0.01em). Space Grotesk.
- **Title** (600, 1.125rem, 1.3): Card headers, panel titles, nav labels. Geist.
- **Body** (400, 0.9375rem, 1.6): Descriptions, explanatory text. Geist. Max line length 65ch.
- **Label** (500, 0.8125rem, 1.4): UI labels, metadata, secondary information. Geist. Slight positive tracking (0.01em).
- **Mono** (400, 0.8125rem, 1.5): Stat values, skill ratings, numerical data. Geist Mono. Tabular figures enabled.

### Named Rules

**The Mono Data Rule.** Every numerical stat, rating, and score renders in Geist Mono. Numbers in body text (prose paragraphs, descriptions) stay in Geist. The distinction is functional: if the number is data, it is mono. If the number is part of a sentence, it is not.

**The Tight Headlines Rule.** Display and Headline sizes always use negative letter-spacing. Body and Label never do. The contrast between tight headlines and open body text creates visual rhythm without additional elements.

## 4. Elevation

Flat by default. Scouting reports are paper, not layered glass.

Depth is conveyed through tonal contrast (card surfaces slightly lighter than background) and borders (warm-tinted, 1px). Surfaces do not hover above the page; they sit on it.

Shadows appear only on elements that literally float above the document: dropdown menus, popovers, tooltips. These are functional, not decorative.

### Shadow Vocabulary
- **Float** (`0 4px 16px rgba(14, 9, 7, 0.08), 0 1px 4px rgba(14, 9, 7, 0.04)`): Dropdowns, popovers, floating panels. The only shadow in the system.

### Named Rules

**The Flat-By-Default Rule.** No surface has a shadow at rest. Cards, containers, sections: all flat with border separation. Shadows exist only as a response to floating state (dropdowns, popovers). If you are reaching for `shadow-md`, reconsider the component hierarchy instead.

## 5. Components

Tight and tactile. Sharp corners, snappy interactions, compact padding. Every component feels like a precisely cut piece of a scouting report.

### Buttons
- **Shape:** Nearly square corners (4px radius)
- **Primary:** Hardwood Amber background, Scoreboard Black text, 10px 20px padding. Font: label weight (500), 0.8125rem.
- **Hover:** Background shifts to Heat Check. Transition: 150ms ease-out.
- **Focus:** 2px ring in Hardwood Amber, 2px offset.
- **Ghost:** Transparent background, Scoreboard Black text, same padding. Hover fills with Chalk Dust.
- **Sizing:** Compact. No oversized hero buttons. CTAs are the same size as navigation actions.

### Chips / Tier Badges
- **Shape:** Tight rectangular (2px radius), minimal padding (2px 8px)
- **Style:** Tinted background + matching text + 1px border, per tier color vocabulary
- **Sizes:** sm (text-xs), md (text-sm), lg (text-base)
- **States:** Default, selected (stronger background saturation + ring), context-menu (text color + hover tint)

### Cards / Containers
- **Corner Style:** Slightly rounded (6px radius)
- **Background:** Card White in light mode, slightly elevated dark tone in dark mode
- **Shadow Strategy:** None. Flat always. See Elevation.
- **Border:** 1px Warm Border. Consistent, never absent.
- **Internal Padding:** 24px (lg spacing)

### Inputs / Fields
- **Style:** 1px Warm Border, transparent background, 4px radius
- **Focus:** Border shifts to Hardwood Amber, no glow, no shadow
- **Error:** Border shifts to Destructive red

### Navigation
- **Bar:** Sticky, 48px height, frosted backdrop blur, 95% opacity background
- **Links:** Label weight, 0.8125rem. Muted when inactive, foreground when active.
- **Active indicator:** 2px bottom bar in Hardwood Amber, flush with nav bottom edge, rounded top corners
- **Dropdowns:** Float shadow, 6px radius, 1px border, compact 8px vertical padding per item

### Skill Tier Badge (Signature Component)
The most distinctive UI element. A compact rectangular chip that color-codes a player's skill rating using the five-tier vocabulary. Appears on player cards, profile pages, review queues, and the roster builder. The tier color system (violet/emerald/sky/amber/slate) is visually loud on purpose: scannable at a glance across dense data tables.

## 6. Do's and Don'ts

### Do:
- **Do** use Geist Mono for all numerical data (stats, ratings, scores, salary figures).
- **Do** keep backgrounds warm-tinted. Every neutral should lean toward the orange hue family (chroma 0.005-0.01 in OKLCH).
- **Do** use sharp, tight radii (2-6px). Cornerstone's geometry is rectangular, not bubbly.
- **Do** let real data be the visual interest. A grid of skill tier badges is more compelling than any illustration.
- **Do** use the tier color vocabulary consistently and exclusively for tier-related UI.
- **Do** reveal complexity progressively: simple surface first, detail on hover/click/expand.

### Don't:
- **Don't** use generic SaaS landing page patterns: gradient blob heroes, floating device mockups, "Built for teams who..." copy. (PRODUCT.md anti-reference)
- **Don't** use ESPN-style busy layouts with competing elements, ad-shaped containers, or lowest-common-denominator sports styling. (PRODUCT.md anti-reference)
- **Don't** ship anything that looks like an unmodified shadcn/Tailwind template: gray-on-white, Inter font, default rounded-lg, forgettable. (PRODUCT.md anti-reference)
- **Don't** use decorative shadows, gradients, or blurs. If it doesn't carry data or indicate a floating element, it doesn't belong.
- **Don't** use `border-left` or `border-right` greater than 1px as colored accent stripes.
- **Don't** use `background-clip: text` gradient text.
- **Don't** use tier colors (violet, emerald, sky, amber, slate) outside the skill tier system.
- **Don't** use rounded corners larger than 6px. No `rounded-xl`, no `rounded-2xl`, no pill shapes.
- **Don't** use Inter, system-ui as the primary visible font. Space Grotesk for headlines, Geist for body, Geist Mono for data.
