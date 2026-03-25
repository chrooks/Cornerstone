# Stat-to-Skill Mapping
*How statistical profiles map to the 19-skill taxonomy*

---

## Data Sources

All stat inputs are pulled from two free Python libraries:

- **nba_api** (github.com/swar/nba_api) — primary source for tracking and play type data via NBA.com endpoints
- **pbpstats** (api.pbpstats.com) — supplementary source for possession-level and contextual data

Key endpoints used across the pipeline:
- `SynergyPlayTypes` — play type frequency and efficiency (Isolation, Transition, PRBallHandler, PRRollman, Spotup, Postup, Handoff, Cut, OffScreen, OffRebound)
- `LeagueDashPtStats` — tracking data by category (CatchShoot, PullUpShot, Drives, Defense, Passing, Rebounding, Possessions)
- `LeagueDashPlayerShotLocations` — shot location breakdowns
- `PlayerDashPtShotDefend` — opponent FG% by closest defender
- `PlayerDashPtShots` — detailed shot type breakdowns
- `LeagueHustleStatsPlayer` — screen assists, deflections, charges
- `LeagueDashPlayerStats` — box score advanced stats including usage rate and rebound rate
- `LeaguePlayerOnDetails` — defensive matchup data

---

## Historical Weighting Logic

All percentage and rate stats use a weighted rolling average across seasons:

- Current season → 50% weight
- Previous season → 30% weight
- Two seasons ago → 20% weight

**History depth modifier:**
- 1 season of data → low confidence, flag for review regardless of disagreement
- 2 seasons → weighted average applied, medium confidence
- 3+ seasons → weighted average applied, normal confidence logic

**Skill breakpoint detection:**
If a player shows a significant jump from their historical average, the weighted average may misrepresent their true current skill level. Flag as a potential skill breakpoint if ALL of the following are true:
- 3%+ jump in the relevant percentage stat
- 1.5+ increase in attempts or frequency per game
- Sustained for at least one full season

When a breakpoint is detected, flag for manual review with a note. Reviewer decides whether to apply the breakpoint model (ignore pre-breakpoint data) or the standard weighted average.

---

## Skill Mappings

### Reliability Key
- ✅ Clean — one or two stats tell most of the story
- ⚠️ Hybrid — stats provide signal but Claude adds meaningful context
- 🔴 Messy — no clean stat exists, Claude weight is high

---

### Spot-up Shooter ✅
**What it means:** A player who shoots threes effectively when stationary, catching and shooting without needing to create off the dribble. Examples: Bobby Portis, Bruce Bowen, Josh Hart.

**Primary stats:**
- Catch-and-shoot 3P% (`LeagueDashPtStats`, `PtMeasureType=CatchShoot`)
- Catch-and-shoot 3PA per game (volume qualifier)

**Composite score:** `Catch-and-shoot 3P% × 3 × catch-and-shoot 3PA per game`

**Thresholds:** TBD — requires pressure testing against current player data with catch-and-shoot splits

**Notes:** Overall 3P% is an unreliable proxy — it conflates spot-up and off-dribble shooting. Always use catch-and-shoot splits specifically.

---

### Movement Shooter ⚠️
**What it means:** A player who shoots threes effectively coming off screens and handoffs (DHOs). Distinct from spot-up shooters who are stationary. Examples: Steph Curry, Duncan Robinson, JJ Redick, Ray Allen, Michael Porter Jr. All movement shooters are also viable spot-up shooters — assign both tags if this threshold is met.

**Primary stats:**
- Off-screen play type frequency and PPP (`SynergyPlayTypes`, `play_type=OffScreen`)
- Handoff frequency and PPP (`SynergyPlayTypes`, `play_type=Handoff`)

**Thresholds:** TBD

**Notes:** Tag as Movement Shooter AND Spot-up Shooter if this threshold is met. Check movement shooter first — if qualified, both tags are assigned automatically.

---

### Off-Dribble Shooter ✅
**What it means:** A player who can shoot effectively off the dribble — pull-up jumpers, step-backs, mid-range creation. This is a zero-sum skill.

**Primary stats:**
- Pull-up FG% and pull-up 3P% (`LeagueDashPtStats`, `PtMeasureType=PullUpShot`)
- Pull-up attempts per game (volume qualifier)

**Thresholds:** TBD

---

### Cutter ✅
**What it means:** A player who actively cuts to the basket to receive passes for easy scores. Also captures off-ball movement and baseline cuts.

**Primary stats:**
- Cut play type frequency and PPP (`SynergyPlayTypes`, `play_type=Cut`)

**Thresholds:** TBD

---

### PnR Ball Handler ✅
**What it means:** A player who initiates and runs pick-and-roll actions as the ball handler. This is a zero-sum skill.

**Primary stats:**
- PRBallHandler play type frequency and PPP (`SynergyPlayTypes`, `play_type=PRBallHandler`)

**Thresholds:** TBD

---

### PnR Roll Man ✅
**What it means:** A player who executes the roll in a pick-and-roll — setting a good screen, reading the defense, and finishing at the rim or making decisions off the roll. Distinct from Vertical Spacer / Lob Threat, which is about passive rim gravity rather than active PnR execution. Examples of strong roll men who are not elite vertical spacers: Nikola Jokic (roll decisions and passing), Draymond Green (capable roll, no lob threat). Examples of vertical spacers who are not elite roll men: Clint Capela, DeAndre Jordan (lob threats but limited reads off the roll).

**Primary stats:**
- PRRollman play type frequency and PPP (`SynergyPlayTypes`, `play_type=PRRollman`)

**Thresholds:** TBD

---

### Vertical Spacer / Lob Threat ⚠️
**What it means:** A player whose above-the-rim presence forces the defense to account for them, creating space for others. This is a passive threat as much as an active one — the mere presence of a lob threat opens up the floor. Distinct from PnR Roll Man, which requires active decision making in a specific half-court action.

**Primary stats:**
- Alley-oop and lob catch frequency (tracking data)
- Dunk frequency (`PlayerDashPtShots`)
- Cut play type efficiency as a proxy (`SynergyPlayTypes`, `play_type=Cut`)

**Notes:** No single clean stat. Claude weight is higher here. Claude reliably identifies players whose athleticism forces defensive attention above the rim even when stats are indirect.

---

### Transition Threat ✅
**What it means:** A player who is dangerous and frequently involved in transition offense.

**Primary stats:**
- Transition play type frequency and PPP (`SynergyPlayTypes`, `play_type=Transition`)

**Thresholds:** TBD

---

### Screen Setter ✅
**What it means:** A player who sets effective screens that create advantages for teammates.

**Primary stats:**
- Screen assists per game (`LeagueHustleStatsPlayer`)

**Thresholds:** TBD

---

### Passer ✅
**What it means:** A player with vision, passing ability, and playmaking skill. Additive at all levels — more passers on a roster means better ball movement.

**Primary stats:**
- Potential assists per game (`LeagueDashPtStats`, `PtMeasureType=Passing`)
- Secondary assists (hockey assists) per game
- AST rate from box score (`LeagueDashPlayerStats`)
- AST/TOV ratio as a quality signal

**Thresholds:** TBD

---

### High Flyer 🔴
**What it means:** A player with exceptional above-the-rim athleticism — dunks, blocks, lob finishes, play-above-the-rim ability. Creates energy and highlight plays.

**Primary stats:**
- Dunk frequency (`PlayerDashPtShots`)
- Alley-oop catch frequency (tracking data)
- Some correlation with transition PPP and cut efficiency

**Notes:** No clean single stat. This is one of the highest Claude-weight skills — Claude reliably identifies elite athletes even when stats are indirect. Flag most cases for Claude weight.

---

### Crafty Finisher ⚠️
**What it means:** A player who finishes effectively at the rim through contact, off-angle, or with touch — not necessarily through athleticism. Think floaters, reverse layups, Euro steps.

**Primary stats:**
- Drive FG% and drive attempts per game (`LeagueDashPtStats`, `PtMeasureType=Drives`)
- Contested shot FG% at rim (`PlayerDashPtShots`)
- Free throw rate (FTA/FGA) as a proxy for drawing contact

**Thresholds:** TBD

**Notes:** Claude adds meaningful context here for players whose craftiness isn't reflected in raw efficiency — players on bad teams or in limited roles who finish well when given opportunities.

---

### Mid Post Player ⚠️
**What it means:** A player who can operate effectively in the mid-post area — face-up jumpers, short pull-ups, passing out of the post from the elbow.

**Primary stats:**
- Post-up play type frequency and PPP (`SynergyPlayTypes`, `play_type=Postup`)
- Mid-range shot attempts and FG% from `LeagueDashPlayerShotLocations` (specifically 10-16ft and 16ft-3pt line zones)

**Notes:** `SynergyPlayTypes` Postup covers both mid and low post — use shot location data to distinguish. Claude helps differentiate mid-post facing players (Dirk, KD) from low-post back-to-basket players (Shaq, Hakeem).

---

### Low Post Player ⚠️
**What it means:** A player who scores effectively with their back to the basket in the low post.

**Primary stats:**
- Post-up play type frequency and PPP (`SynergyPlayTypes`, `play_type=Postup`)
- Close-range shot attempts and FG% from `LeagueDashPlayerShotLocations` (restricted area and paint non-RA zones)

**Notes:** Same source as Mid Post Player — use shot location distribution to distinguish. Claude differentiates back-to-basket players from face-up post scorers reliably for well-known players.

---

### Point of Attack Defender 🔴
**What it means:** A player who can guard ball handlers effectively one-on-one, navigate screens, and disrupt opposing offense at the point of attack.

**Primary stats:**
- Steals rate (`LeagueDashPlayerStats`)
- Defensive matchup data — opponent FG% when guarding guards (`LeaguePlayerOnDetails`)
- Deflections per game (`LeagueHustleStatsPlayer`)

**Notes:** One of the hardest skills to capture statistically. Opponent FG% when guarding specific positions helps but requires matchup data that can be noisy. Claude weight is high here — it reliably identifies elite POA defenders like Marcus Smart, Kawhi, and Gary Payton whose impact doesn't always surface in counting stats.

---

### Switchable Defender 🔴
**What it means:** A player who can credibly guard multiple positions — ideally 1-through-4 in today's NBA. The most important defensive skill for modern roster construction.

**Primary stats:**
- Defensive matchup position range (`LeaguePlayerOnDetails`) — how many different position types they've guarded
- Defensive rating across different matchup types
- Physical profile (height, wingspan, mobility) as a baseline filter

**Notes:** Hardest skill to map statistically. No single clean metric captures positional range and effectiveness across matchups. Claude weight is the highest of any skill — it knows which players can switch reliably even when the stats are ambiguous. Flag most cases for review.

---

### Rim Protector ✅
**What it means:** A player who protects the basket through shot blocking, altering shots, and deterring drives.

**Primary stats:**
- Blocks per game and block rate (`LeagueDashPlayerStats`)
- Opponent FG% at rim when this player is closest defender (`PlayerDashPtShotDefend`)
- Contested shots at rim per game (`LeagueDashPtStats`, `PtMeasureType=Defense`)

**Thresholds:** TBD

---

### Rebounder ✅
**What it means:** A player who secures defensive and offensive rebounds at an above-average rate.

**Primary stats:**
- Total rebound rate (`LeagueDashPlayerStats`)
- Rebounds per 36 minutes as a secondary signal

**Thresholds:** TBD

---

### Offensive Rebounder ✅
**What it means:** A player who specifically pursues and secures offensive rebounds — a distinct and specialized skill from general rebounding.

**Primary stats:**
- Offensive rebound rate (`LeagueDashPlayerStats`)
- Offensive rebounds per 36 minutes

**Thresholds:** TBD

---

### Ball Dominator ✅
**What it means:** A player who requires significant ball time to be effective. High usage players who function as primary creators. This is a zero-sum skill — too many ball dominators creates role conflict.

**Primary stats:**
- Usage rate (`LeagueDashPlayerStats`)
- Time of possession per game (`LeagueDashPtStats`, `PtMeasureType=Possessions`)
- Touches per game as a secondary signal

**Thresholds:** TBD

---

## Skill Reliability Summary

| Skill | Reliability | Primary Endpoint |
|---|---|---|
| Spot-up Shooter | ✅ Clean | LeagueDashPtStats (CatchShoot) |
| Movement Shooter | ⚠️ Hybrid | SynergyPlayTypes (OffScreen, Handoff) |
| Off-Dribble Shooter | ✅ Clean | LeagueDashPtStats (PullUpShot) |
| Cutter | ✅ Clean | SynergyPlayTypes (Cut) |
| PnR Ball Handler | ✅ Clean | SynergyPlayTypes (PRBallHandler) |
| PnR Roll Man | ✅ Clean | SynergyPlayTypes (PRRollman) |
| Vertical Spacer / Lob Threat | ⚠️ Hybrid | PlayerDashPtShots + Claude |
| Transition Threat | ✅ Clean | SynergyPlayTypes (Transition) |
| Screen Setter | ✅ Clean | LeagueHustleStatsPlayer |
| Passer | ✅ Clean | LeagueDashPtStats (Passing) |
| High Flyer | 🔴 Messy | PlayerDashPtShots + Claude |
| Crafty Finisher | ⚠️ Hybrid | LeagueDashPtStats (Drives) |
| Mid Post Player | ⚠️ Hybrid | SynergyPlayTypes (Postup) + ShotLocations |
| Low Post Player | ⚠️ Hybrid | SynergyPlayTypes (Postup) + ShotLocations |
| Point of Attack Defender | 🔴 Messy | LeaguePlayerOnDetails + Claude |
| Switchable Defender | 🔴 Messy | LeaguePlayerOnDetails + Claude |
| Rim Protector | ✅ Clean | PlayerDashPtShotDefend |
| Rebounder | ✅ Clean | LeagueDashPlayerStats |
| Offensive Rebounder | ✅ Clean | LeagueDashPlayerStats |
| Ball Dominator | ✅ Clean | LeagueDashPlayerStats (Usage) |

---

*Thresholds for all skills are TBD — to be determined by pressure testing against current player data.*
