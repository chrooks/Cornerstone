# Cornerstone — The Rules
*How to build a modern NBA team around any all-time great*

---

## Core Rules

**Rule 1 — Superstar Salary**
Every all-time great gets the current NBA supermax (~35% of the salary cap, roughly $54M in 2025-26). This removes historical distortion and reflects what the market would truly pay them today.

**Rule 2 — Total Team Budget**
Average the five highest team payrolls in the current NBA season. This sets a realistic, competitive spending ceiling. In JJ's original exercise this came to ~$195M.

**Rule 3 — Roster Construction**
Build a rotation of 8 players using current players and their real salaries. Remaining roster spots are filled with minimum contracts. All 8 salaries must fit within the total budget.

**Rule 4 — Define the Star's Modern Role**
Before building, decide how the superstar fits in today's NBA. Are they a primary ball-handler, a post scorer, a facilitator? This determines everything else about how you Cornerstone them.

**Rule 5 — Identify What They Need**
Based on the star's role, define a checklist of what the supporting cast must provide using the skill taxonomy below.

**Rule 6 — Roster Justification**
You must have a plausible path to each player via draft, trade, or free agency. There should be a logical GM narrative for how you assembled the team — you can't just hand-pick anyone.

---

## Skill Taxonomy

Every player (including the superstar) is rated on 19 skills across three tiers:

- **None** — the player does not meaningfully possess this skill
- **Capable** — the player is a competent practitioner of this skill
- **Elite** — the player is among the best in the league at this skill

### Additive Skills
*More is always better. No penalty for excess.*

- Spot-up Shooter
- Movement Shooter
- Versatile Defender
- Cutter
- Screen Setter
- Transition Threat
- Vertical Spacer / Lob Threat
- Passer
- High Flyer
- Rim Protector
- Rebounder
- Offensive Rebounder

### Threshold-Based Skills
*You need at least one. Soft penalty if absent, diminishing returns beyond two.*

- Point of Attack Defender
- Crafty Finisher
- Mid Post Player
- Low Post Player
- PnR Finisher (includes rollers, poppers, and slippers — any screener who scores in PnR actions)

### Zero-Sum Skills
*Must be distributed carefully. Excess creates conflict.*

- Ball Dominator
- PnR Ball Handler
- Off-Dribble Shooter

---

## Skill Weighting

Not all skills carry equal weight for every superstar. The star's own profile determines what the roster most needs.

Examples:
- An elite PnR Ball Handler elevates the value of Vertical Spacer / Lob Threat and PnR Finisher
- A low post scorer elevates the value of Spot-up Shooters and Cutters around them
- A pass-first point guard elevates the value of High Flyers, Cutters, and Transition Threats

---

## Compatibility Scoring Logic

### Additive Skills
Score based on cumulative tier ratings across the roster. Higher is always better. No cap on benefit.

### Threshold-Based Skills
- Threshold met (at least one Capable or Elite) → no penalty
- Threshold not met → soft penalty only. A team of elite shooters around an elite finisher should not be penalized for lacking a post player.

### Zero-Sum Skills
The superstar pre-fills zero-sum slots before roster building begins. Additional players with zero-sum skills trigger a conflict check:

**Conflict detected → evaluate mitigating factors:**
- Do the overlapping players have additive secondary skills that allow off-ball coexistence? (e.g. cutting, transition threat, spacing)
- Is there sufficient spacing on the roster to absorb the overlap?
- Can one player credibly operate off-ball?

**If mitigating factors exist** → soft penalty
**If no mitigating factors** → heavy penalty

*Example: LeBron and Wade on the 2012 Heat were both Ball Dominators but coexisted because both were Elite cutters and transition threats, and the roster had sufficient spacing. Wade also gradually conceded to a more off-ball role as the team matured. Contrast with the 2024-25 Suns (Beal, KD, Booker) — three primary scorers with minimal playmaking, spacing, or defensive versatility, and no mitigating secondary skills to resolve the overlap.*

---

## Evaluator Output

The compatibility engine produces:
1. **A cohesion score** broken down by offensive fit, defensive fit, role clarity, and depth
2. **A narrative evaluation** describing the team's strengths, weaknesses, and how the supporting cast complements or conflicts with the superstar's profile

---

*Note: Supermax figure (~$54M) and team budget (~$195M) should be updated each season as the salary cap changes. Player skill profiles should be refreshed annually.*

---

## Part 3a — Current Player Skill Profile Pipeline

### Step 1 — Filter Valid Players
Minimum MPG threshold (TBD, suggested 15-20 MPG) to exclude garbage time players and two-way contracts with insufficient sample size.

### Step 2 — Stat Selection
Pull from four layers:
- **Basic box score** — 3P%, AST, REB, BLK, STL
- **Advanced stats** — usage rate, true shooting %, defensive rating, BPM
- **Tracking data** — catch-and-shoot vs. pull-up frequency, contested shot %, drives per game, screen assists
- **Play type data** — PnR ball handler vs. roll man frequency, spot-up frequency, post-up frequency

### Step 3 — Stat-to-Skill Mapping
Deterministic rules map stat thresholds to skill tiers. Fully automated and auditable. Example: if catch-and-shoot 3P% > 38% and catch-and-shoot attempts > 3 per game → Spot-up Shooter: Elite.

### Step 4 — Claude Pass
Feed the same statistical profile to Claude with a prompt asking it to independently rate the player on all 19 skills at None/Capable/Elite. Claude contributes contextual knowledge that stats don't capture.

### Step 5 — Notability Score
Before compositing the two ratings, calculate a notability score (0-100) to determine how much weight Claude's assessment carries. Higher notability = more weight to Claude.

**Notability Score Components:**
- Minutes per game (0-30 pts) — scaled linearly, 20 MPG = 15pts, 35+ MPG = 30pts
- All-Star appearances (0-25 pts) — 1 = 10pts, 2-3 = 18pts, 4+ = 25pts
- Award voting presence (0-25 pts) — any All-NBA ballot = 10pts, any MVP/DPOY top-5 = 18pts, winner = 25pts
- Web/Wikipedia content depth (0-20 pts) — approximated by career games played or seasons documented

**Notability Thresholds:**
- 70-100 → High notability, Claude weight high
- 40-69 → Medium notability, Claude weight medium
- 0-39 → Low notability, Claude weight low, flag aggressively

### Step 6 — Confidence Logic & Auto-Accept Rules
Where Step 3 and Step 4 agree → auto-accept. Where they disagree, apply the following rules:

**Zero-sum skills** — flag any disagreement regardless of notability
**Threshold-based skills** — flag two-tier disagreements only
**Additive skills** — auto-accept one-tier disagreements, flag two-tier

Additional rule: players scoring 0-39 on notability are flagged wholesale regardless of disagreement level. Neither the stats nor Claude are reliable enough to auto-accept.

When auto-accepting a one-tier disagreement, default to the more conservative (lower) rating.

### Step 7 — Review Queue
Flagged players enter a review queue. UI should display:
- Player's relevant stat line
- Stat-based rating and reasoning
- Claude's rating and explanation
- One-click override with optional notes
- "Trust stats" and "Trust Claude" buttons

---

## Part 3b — All-Time Greats Skill Profiles
No modern stats exist for historical legends. Profiles are manually curated. The list is finite (estimated 30-50 legends). This is where personal basketball knowledge and opinions matter most. Same 19-skill taxonomy and None/Capable/Elite tiers apply.

---

## Legends List (36 Players)

One profile per player representing their peak era. All 36 are manually profiled using the 19-skill taxonomy at None/Capable/Elite tiers.

1. Michael Jordan (Early 90s)
2. LeBron James (Mid 2010s — Heat & 2nd Cavs)
3. Kareem Abdul-Jabbar (70s)
4. Wilt Chamberlain (Mid 60s)
5. Bill Russell (Mid 60s)
6. Kobe Bryant (Mid 2000s)
7. Magic Johnson (Late 80s)
8. Larry Bird (Late 80s)
9. Tim Duncan (Early 2000s)
10. Shaquille O'Neal (Early 2000s)
11. Steph Curry (Mid-Late 2010s)
12. Kevin Durant (Mid-Late 2010s)
13. David Robinson (Mid 90s)
14. Hakeem Olajuwon (Mid 90s)
15. Kevin Garnett (Mid 2000s)
16. Allen Iverson (Early 2000s)
17. Jason Kidd (Early 2000s)
18. Steve Nash (Mid 2000s)
19. Dirk Nowitzki (Mid-Late 2000s)
20. Kawhi Leonard (Mid 2010s)
21. Scottie Pippen (Mid 90s)
22. Giannis Antetokounmpo (Early 2020s)
23. Julius Erving / Dr. J (Mid 70s)
24. Jerry West (Mid 60s)
25. Oscar Robertson / Big O (Mid 60s)
26. Charles Barkley (Peak)
27. Dwyane Wade (Peak)
28. Isiah Thomas (Peak)
29. Karl Malone (Peak)
30. James Harden (Peak)
31. Chris Paul (Peak)
32. Russell Westbrook (Peak)
33. Tracy McGrady (Peak)
34. Joel Embiid (2021)
35. Anthony Davis (2020)
36. Dwight Howard (2011)

---

## App Architecture Overview

The project breaks into three parts with a clear dependency order:

**Part 3 (first) — Player Skill Profiles**
Foundation for everything else. Splits into:
- 3a: Automated pipeline for current players (stats + Claude hybrid)
- 3b: Manual profiling for 36 legends

**Part 1 (second) — Roster Builder**
UI for selecting a superstar, browsing current players, and assembling a roster within the salary cap. Displays real-time budget tracking.

**Part 2 (third) — Compatibility Evaluator**
Runs compatibility logic against skill profiles and outputs a cohesion score with narrative evaluation generated via the Claude API.

---

## Data Sources

**nba_api** (github.com/swar/nba_api) — Python wrapper around NBA.com endpoints. Surfaces tracking data, play type splits, catch-and-shoot vs pull-up breakdowns, PnR frequency. Unofficial but well maintained.

**pbpstats** (api.pbpstats.com) — Built on play-by-play data. Useful for contextual stats like shot quality, finishing at the rim in traffic, and lineup-level data.

Both sources together are expected to cover most stat inputs needed for the skill mapping pipeline. Investigation needed to map each of the 19 skills to specific endpoints and identify any gaps.

Note: Second Spectrum and Synergy Sports are not accessible via public API — both are B2B products gated behind enterprise contracts.