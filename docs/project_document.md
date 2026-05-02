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

Every player (including the superstar) is rated on 21 skills across four tiers:

- **None** — the player does not meaningfully possess this skill
- **Capable** — the player is a competent practitioner of this skill
- **Proficient** — the player is above average at this skill
- **Elite** — the player is among the best in the league at this skill

### Additive Skills
*More is always better. No penalty for excess.*

- **Spot Up Shooter** (`spot_up_shooter`) — Hits catch-and-shoot threes and mid-range shots from set positions
- **Off-Dribble Shooter** (`off_dribble_shooter`) — Creates and converts shots off the dribble, including pull-ups and step-backs
- **Isolation Scorer** (`isolation_scorer`) — Beats defenders one-on-one in isolation through dribble moves and athleticism
- **Movement Shooter** (`movement_shooter`) — Hits shots while relocating off screens and handoffs
- **Cutter** (`cutter`) — Scores effectively by cutting to the basket off-ball
- **Transition Threat** (`transition_threat`) — Scores effectively in the open court on fast breaks
- **PnR Ball Handler** (`pnr_ball_handler`) — Initiates and scores/creates as the ball handler in pick-and-roll
- **PnR Finisher** (`pnr_finisher`) — Scores as the screener in PnR actions (rolling, popping, slipping)
- **Crafty Finisher** (`crafty_finisher`) — Scores at the rim using touch and body control rather than pure athleticism
- **Passer** (`passer`) — Creates quality shot opportunities through vision and passing skill
- **Offensive Rebounder** (`offensive_rebounder`) — Crashes offensive boards and converts second-chance opportunities
- **Vertical Spacer** (`vertical_spacer`) — Threatens vertically as a lob target, creating driving lanes for teammates

### Threshold-Based Skills
*You need at least one. Soft penalty if absent, diminishing returns beyond two.*

- **Rebounder** (`rebounder`) — Consistently grabs boards through positioning and effort
- **Rim Protector** (`rim_protector`) — Deters and blocks shots at the rim
- **Screen Setter** (`screen_setter`) — Sets quality screens that free teammates
- **Driver** (`driver`) — Attacks the paint from the perimeter, generating driving lane pressure
- **Mid-Post Player** (`mid_post_player`) — Scores from the mid-post/elbow area using face-up moves
- **Low-Post Player** (`low_post_player`) — Scores with back-to-basket moves in the low post

### Zero-Sum Skills
*Must be distributed carefully. Excess creates conflict.*

- **Versatile Defender** (`versatile_defender`) — Guards multiple positional groups effectively when switched
- **Perimeter Disruptor** (`perimeter_disruptor`) — Disrupts ball handlers through active hands and pressure at point of attack
- **High Flyer** (`high_flyer`) — Elite explosive athleticism for above-the-rim plays and transition finishes

### Skill Confidence Tiers

Skills are also classified by how reliably the stat pipeline can evaluate them:

| Confidence | Skills | Claude Behavior |
|---|---|---|
| **High** | spot_up_shooter, off_dribble_shooter, isolation_scorer, rebounder, offensive_rebounder, rim_protector | Claude is NOT called |
| **Moderate** | movement_shooter, cutter, transition_threat, pnr_ball_handler, pnr_finisher, crafty_finisher, driver, vertical_spacer, screen_setter, passer, mid_post_player, low_post_player | Claude runs blind (sees stats, not stat tier) |
| **Low** | versatile_defender, perimeter_disruptor, high_flyer | Claude runs informed (sees stats AND stat tier) |

---

## Skill Weighting

Not all skills carry equal weight for every superstar. The star's own profile determines what the roster most needs.

Examples:
- An elite PnR Ball Handler elevates the value of Vertical Spacer and PnR Finisher
- A low post scorer elevates the value of Spot Up Shooters and Cutters around them
- A pass-first point guard elevates the value of High Flyers, Cutters, and Transition Threats

---

## Evaluation Engines

### Legacy Evaluator (`roster_evaluator/`)
Skill-weight scoring system:
- **Base scores** — per-skill weight contributions
- **Dynamic modifiers** — playoff, era, tier-scaled adjustments
- **Hard checks** — physical constraints, draft-pick rules
- **Cornerstone complement** — how well supporting players complement the legend
- **GM Notes** — 37+ contextual rules that fire observations about roster construction
- **Team description** — Claude-generated narrative evaluation

### Cohesion Engine (`cohesion_engine/`)
Lineup and rotation chemistry scoring:
- **Player composites** — normalized 0.0-10.0 scores per player (spacing, finishing, anchor, defense, etc.)
- **Defensive bell curves** — height-based coverage modeling with rim protector → perimeter disruptor boosts
- **Lineup subscores** — spacing, PnR pairing, defensive coverage, transition, rebounding
- **Synergies** — pairwise bonuses (PnR handler+finisher, rim protector+perimeter defenders)
- **Accentuation** — amplifying roster strengths and covering weaknesses
- **Star rating** — 0.0-5.0 final score with per-dimension breakdown
- **Notes & narrative** — structured feedback + Claude-generated team description

The active engine is selected via the `EVAL_ENGINE` environment variable (`"legacy"` or `"cohesion"`).

---

## Evaluator Output

The compatibility engine produces:
1. **A cohesion/compatibility score** broken down by dimension (offense, defense, spacing, etc.)
2. **Structured notes** describing strengths, weaknesses, and suggestions
3. **A narrative evaluation** describing the team's identity and how the supporting cast complements or conflicts with the superstar's profile

---

*Note: Supermax figure (~$54M) and team budget (~$195M) should be updated each season as the salary cap changes. Player skill profiles should be refreshed annually.*

---

## Player Skill Profile Pipeline

### Step 1 — Filter Valid Players
Minimum MPG threshold to exclude garbage time players and two-way contracts with insufficient sample size.

### Step 2 — Stat Selection
Pull from four layers:
- **Basic box score** — 3P%, AST, REB, BLK, STL
- **Advanced stats** — usage rate, true shooting %, defensive rating, BPM
- **Tracking data** — catch-and-shoot vs. pull-up frequency, contested shot %, drives per game, screen assists
- **Play type data** — PnR ball handler vs. roll man frequency, spot-up frequency, post-up frequency

### Step 3 — Stat-to-Skill Mapping
Deterministic rules map stat thresholds to skill tiers. Fully automated and auditable. Thresholds stored as JSONB in `skill_thresholds` table, editable via calibration UI. Volume gates use per-game conditions (~70 games divisor).

### Step 4 — Claude Pass
Feed the statistical profile to Claude with a prompt asking it to independently rate the player on all 21 skills at None/Capable/Proficient/Elite. Claude contributes contextual knowledge that stats don't capture. The confidence tier determines whether Claude sees the stat-based rating.

### Step 5 — Notability Score
Before compositing, calculate a notability score (0-100) to determine how much weight Claude's assessment carries. Higher notability = more weight to Claude.

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
Flagged players enter a review queue. UI displays:
- Player's relevant stat line
- Stat-based rating and reasoning
- Claude's rating and explanation
- One-click override with optional notes
- "Trust stats" and "Trust Claude" buttons

---

## All-Time Greats Skill Profiles
No modern stats exist for historical legends. Profiles are manually curated. The list is finite (36 legends). Same 21-skill taxonomy and None/Capable/Proficient/Elite tiers apply.

---

## Legends List (36 Players)

One profile per player representing their peak era. All 36 are manually profiled using the 21-skill taxonomy at None/Capable/Proficient/Elite tiers.

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

## Data Sources

**nba_api** (github.com/swar/nba_api) — Python wrapper around NBA.com endpoints. Surfaces tracking data, play type splits, catch-and-shoot vs pull-up breakdowns, PnR frequency. Unofficial but well maintained.

Both stat and tracking data are used to cover most stat inputs needed for the skill mapping pipeline. Stats are assembled by `stats_assembler.py` into a comprehensive JSONB blob per player/season.

Note: Second Spectrum and Synergy Sports are not accessible via public API — both are B2B products gated behind enterprise contracts.
