# NBA skill profiling: a statistical indicator guide for 20 player skills

**The best publicly available NBA stats can reliably classify roughly half these skills into None/Capable/Elite tiers; the rest require a hybrid stat-plus-scouting approach.** Skills anchored in Synergy play-type data (spot-up shooting, PnR actions, transition, cutting) and rim-protection tracking have the strongest statistical foundations. Perimeter defense, switchability, and athleticism-based skills remain fundamentally limited by public data and should lean heavily on the Claude AI pass. This guide maps each skill to specific `nba_api` endpoints, recommends composite metrics with threshold ranges, and flags where deterministic classification breaks down.

The core data source is `nba_api` (wrapping stats.nba.com), which provides **11 Synergy play types, 12 tracking measure categories, full hustle stats, defensive tracking by distance, matchup data, and shot-chart-level detail**—all free and unauthenticated. The `balldontlie` API is a secondary supplement: its GOAT tier ($39.99/mo) offers game-level advanced stats but lacks Synergy play types, shot zones, tracking splits, and hustle stats entirely. Every recommendation below prioritizes `nba_api` endpoints.

---

## How the data pipeline should be structured

Before diving into individual skills, several cross-cutting principles from the analytics literature should guide the pipeline architecture.

**Sample-size stabilization is non-negotiable.** BBall Index's "Stable Stats" approach pads player data with league-average results, pulling small-sample extremes toward the mean. Dunks & Threes' "Estimated Skills" uses machine learning to determine per-stat stabilization rates—3P% needs ~750 attempts to reach 0.7 reliability, while drive FG% stabilizes faster at ~150 attempts. For Synergy play-type data, a minimum of **50 possessions** should be required for single-season classification; below that threshold, defer to multi-season rolling averages or the Claude pass.

**Role-adjust thresholds where possible.** A guard with 8% TRB% is an elite rebounder; a center at 12% is below average. BBall Index's 12 offensive archetypes provide the most granular public framework for role adjustment. At minimum, thresholds should be split into guard/wing/big buckets.

**Synergy public data captures scoring only.** The full Synergy subscription includes passing possessions from each play type, but the free `SynergyPlayTypes` endpoint on stats.nba.com shows only scoring actions. This systematically undervalues playmakers who create for others within PnR, post-up, and transition actions. Seth Partnow's key caution applies broadly: tracking data measures "style as much as achievement."

**Consider garbage-time filtering.** Ben Falk's Cleaning the Glass approach of removing non-competitive minutes produces more accurate efficiency stats. While you cannot access CtG data directly, you can implement your own filter using `PlayByPlayV3` and game score data.

---

## Additive skills: the 12 "more is always better" abilities

### 1. Spot-up Shooter

**Current mapping (catch-and-shoot 3P% + C&S 3PA) is good but incomplete.** The optimal approach combines two data sources that capture different dimensions:

The `SynergyPlayTypes` endpoint with `PlayType='Spotup'` returns **PPP, POSS_PCT, EFG_PCT, PERCENTILE, and POSS** for every qualifying player. This captures the full play context—including turnovers, fouls drawn, and shot selection—specific to spot-up possessions. Meanwhile, `LeagueDashPtStats` with `PtMeasureType='CatchShoot'` returns `CATCH_SHOOT_FG3_PCT`, `CATCH_SHOOT_FG3A`, and `CATCH_SHOOT_EFG_PCT`, which track all catch-and-shoot attempts regardless of play type (including off screens and handoffs). Use both: Synergy Spotup for play-context accuracy, C&S tracking for mechanical shooting ability.

**Recommended composite and thresholds:** Primary gate is volume (Spotup POSS_PCT ≥ 10% or ≥1.0 possessions/game). Elite: C&S 3P% ≥ **40%** + Spotup PPP ≥ **1.10** with ≥2 Spotup possessions/game. Capable: C&S 3P% **36–40%**, Spotup PPP **0.95–1.10**. None: C&S 3P% < 34% or negligible volume. League average C&S 3P% hovers around **37%** over a six-year span; Spotup league-average PPP runs **0.95–1.00**.

**Limitation:** Single-season 3P% on 200 C&S attempts has substantial noise. Two-to-three-year rolling averages or Bayesian stabilization (padding with league-average makes) dramatically improves reliability.

### 2. Movement Shooter

**Current mapping (off-screen PPP/frequency + handoff PPP/frequency) is correct and well-targeted.** The `SynergyPlayTypes` endpoint with `PlayType='OffScreen'` and `PlayType='Handoff'` captures precisely the actions that define movement shooting. CraftedNBA's public leaderboard validates this approach: Klay Thompson showed 26.8% OffScreen frequency with 0.994 PPP; Stephen Curry showed 17.8% OffScreen with 1.013 PPP plus 11.9% Handoff with 1.618 PPP. Importantly, Synergy's OffScreen category **already includes pull-ups off screens**—no separate pull-up-off-screen metric is needed.

**Thresholds:** Elite: combined OffScreen + Handoff POSS_PCT ≥ **20%**, weighted PPP ≥ **1.05**. Capable: combined ≥ **12%**, weighted PPP ≥ **0.95**. None: combined < 8% or PPP < 0.85. Volume minimum: ≥50 combined possessions per season (NBA.com requires 10 possessions minimum per play type to qualify for leaderboards).

**Limitation:** Sample sizes for OffScreen possessions can be small even for starters (~100–200 per season). Handoff possessions are rarer still. This skill benefits strongly from multi-season aggregation.

### 3. Switchable Defender

**Current mapping acknowledges this is hard to measure, and that acknowledgment is correct.** However, more can be done with available data than the current approach suggests.

The `LeagueSeasonMatchups` endpoint is the key tool. Query by `DefPlayerID` to retrieve all offensive players guarded, with `MATCHUP_MIN`, `PARTIAL_POSS`, and `MATCHUP_FG_PCT`. Cross-reference against `CommonPlayerInfo` to get each offensive player's listed position, then compute a **positional diversity index**—how many distinct positional groups (PG/SG/SF/PF/C) the defender spent meaningful time guarding. Supplement with `LeagueDashPtDefend` queried across multiple `DefenseCategory` values (`"Less Than 6Ft"`, `"Greater Than 15Ft"`, `"3 Pointers"`) to check whether the defender maintains reasonable DFG% across distance ranges.

**Critical caveat from analytics literature:** Simple positional diversity is misleading. Isaiah Thomas appeared "versatile" because offenses hunted him in switches; Giannis appeared less versatile because he primarily guarded forwards. BBall Index's proprietary "Defensive Positional Versatility" metric adjusts for this by weighting matchup difficulty. Without that adjustment, **this metric must be interpreted carefully**.

**Thresholds:** Elite: guards **3+ positional groups** regularly with neutral-to-negative DFG% across multiple distance categories (Draymond Green, Bam Adebayo, OG Anunoby archetype). Capable: meaningful minutes (>10% POSS) guarding 2+ positional groups without dramatically negative DFG% differentials. None: guards only 1 positional group effectively.

**Confidence: LOW.** This is the weakest skill to measure statistically. The Claude AI pass should carry heavy weight here, using knowledge of player body type, defensive reputation, and scheme context.

### 4. Cutter

**Current mapping (Synergy Cut frequency + PPP) is the best available approach.** The `SynergyPlayTypes` endpoint with `PlayType='Cut'` returns POSS, POSS_PCT, PPP, SCORE_POSS_PCT, and EFG_PCT. Cutting is one of the NBA's most efficient play types (league average ~**1.25 PPP**), so PPP thresholds should be set higher than for other play types.

**Supplementary data:** `LeagueDashPtStats` with `PtMeasureType='PaintTouch'` provides PAINT_TOUCHES and PAINT_TOUCH_FG_PCT—frequent cutters have elevated paint touches. `SpeedDistance` tracking (AVG_SPEED_OFF) can identify players with high off-ball movement.

**Thresholds:** Elite: Cut POSS_PCT > **12%**, > 3.0 cut possessions/game, PPP > **1.30**. Capable: POSS_PCT **5–12%**, 1.5–3.0 possessions/game. None: POSS_PCT < 5% or < 1.0 possessions/game. Reference: Denver cut at ~9% of possessions (3rd highest team rate); Philadelphia at 4.9% (league low).

**Limitation:** Synergy's public Cut data captures scoring only—not passes out of cuts or fouls drawn. Classification can be inconsistent (shallow flash cuts vs. deep backdoor cuts). The stat also cannot distinguish players who cut well from players who simply receive passes in the paint.

### 5. Screen Setter

**Current mapping (screen assists per game) is correct but should be expanded.** `LeagueHustleStatsPlayer` returns both `SCREEN_ASSISTS` and `SCREEN_AST_PTS`—the latter is more valuable because a screen leading to a three-pointer creates more value than one leading to a two. BBall Index's "Roll Gravity" grade also incorporates screen assist data, confirming this metric's relevance.

**Supplementary data:** PRRollman Synergy data correlates with screening activity (screeners who roll often set more screens). `BOX_OUTS` from hustle stats indicate physicality and positioning ability relevant to screen-setting.

**Thresholds:** Elite: > **4.0 screen assists/game** (top ~20 in league; reference: Marcin Gortat and Rudy Gobert tied at **6.2/game** for a season-leading mark). Capable: **1.5–4.0/game**. None: < 1.5/game.

**Limitation:** Screen assists only count when the screened-for player scores immediately. Screens that free a player who then draws a foul, or screens 1–2 passes earlier in the chain, are invisible. No public "screens set" count exists—only successful ones. Heavily dependent on offensive system and teammates' shooting ability.

### 6. Transition Threat

**Current mapping (Synergy Transition frequency + PPP) is correct.** `SynergyPlayTypes` with `PlayType='Transition'` provides the primary data. Supplement with `LeagueDashPtStats` `PtMeasureType='SpeedDistance'` for `AVG_SPEED_OFF` (elite transition players tend to exceed **4.3 mph** average offensive speed).

**Missing dimension:** The current mapping cannot distinguish transition creators from transition finishers. A player who pushes the ball and dishes gets no credit in Synergy scoring data. Partial workaround: combine transition scoring data with the player's overall STL rate (steals create transition opportunities) and AST% (high AST% + high transition frequency suggests creator role).

**Thresholds:** Elite: > **6% transition frequency**, > 4.0 transition possessions/game, PPP > **1.15**. Capable: **2–6%** frequency, 1.5–3.5 possessions/game, PPP > 1.05. None: < 2% frequency or < 1.0 possessions/game. League-average transition PPP runs **~1.12–1.25**, making it one of the more efficient play types.

**Limitation:** Players on fast-paced teams get inflated transition numbers. Synergy's transition classification is subjective (not time-based). Cannot separate creation from finishing in public data.

### 7. Vertical Spacer / Lob Threat

**Current mapping is reasonable but misses the most direct lob data available.** Alley-oop finishes are directly trackable through `ShotChartDetail` by filtering `ACTION_TYPE` for `'Alley Oop Dunk Shot'` and `'Alley Oop Layup Shot'`. This is the single best lob-threat indicator and should be the primary metric.

**Recommended composite:** Combine alley-oop finishes per game (from ShotChartDetail) + Synergy Cut PPP × frequency + Synergy PRRollman PPP × frequency + Restricted Area FG% × FGA frequency (from `LeagueDashPlayerShotLocations`). BBall Index's "Roll Gravity" grade uses exactly this combination: alley-oop volume + efficiency, screen assist data, and Synergy roll man data.

**Thresholds:** Elite (Capela/Gafford archetype): ≥ **25 alley-oop finishes/season**, ≥ 2 dunks/game, Restricted Area FG% ≥ **68%**, Cut + PRRollman POSS_PCT ≥ **15%**. Capable: ≥ 15 alley-oop finishes, ≥ 1 dunk/game, Restricted Area FG% ≥ 62%. None: < 0.5 dunks/game, low rim FGA frequency.

**Limitation:** Lob "gravity"—the defensive distortion a lob threat creates even without receiving the ball—is invisible in all public data.

### 8. Passer

**Current mapping (potential assists + secondary assists + AST rate) is solid but should be enhanced with passing-specific tracking data.** `LeagueDashPtStats` with `PtMeasureType='Passing'` provides the richest passing dataset: `POTENTIAL_AST`, `SECONDARY_AST`, `FT_ASSISTS`, `PASSES_MADE`, `AST_PTS_CREATED`, and crucially `AST_TO_PASS_PCT` (assists as a percentage of passes made). The `PlayerDashPtPass` endpoint adds the passer-receiver network with per-target FG%.

**What analytics communities recommend:** Ben Taylor's Box Creation metric estimates open shots created per 100 possessions from box-score inputs (scoring volume × assist rate × 3PT sigmoid). It reduces the "Rondo Assist" problem by measuring whether a player actually broke down the defense. BBall Index's Playmaking grade uses five components: Passing Creation Volume (potential assists + FT assists), Passing Creation Quality (expected eFG% of shots created), Passing Versatility, Passing Efficiency (bad-pass TO rate), and On-Ball Gravity.

**Key normalization:** Potential assists per time of possession separates true passing skill from ball-handling volume. A high potential-assist rate relative to touches and time of possession indicates genuine passing talent, not just primary ball-handler status.

**Thresholds:** Elite: > **10 potential assists/game**, AST% > **25%**, high AST_TO_PASS_PCT. Capable: **4–10 potential assists/game**, AST% **15–25%**. None: < 4 potential assists/game, AST% < 15%. Reference: Trae Young led the NBA at ~20.7 potential assists/game; the 2:1 ratio of potential assists to actual assists is roughly constant across players.

**Limitation:** Potential assists still reward high-volume ball handlers. "Grenade passes" (poor passes that happen to lead to shot attempts) count. No public data on pass difficulty, angle, or whether the defense was truly broken down.

### 9. High Flyer

**Current mapping acknowledges this needs Claude review, and that instinct is correct—this is the hardest skill to measure statistically.** The best available proxy combines dunk frequency and variety from `ShotChartDetail` (filter ACTION_TYPE for `'Driving Dunk'`, `'Running Dunk'`, `'Reverse Dunk'`, `'Cutting Dunk'`) with transition scoring data and `SpeedDistance` tracking (AVG_SPEED_OFF).

**What distinguishes High Flyer from Vertical Spacer statistically:** High Flyers have more **self-created dunks** (driving dunks, transition dunks, contested dunks through traffic). Vertical Spacers have more **assisted dunks** (alley-oops, cut dunks). Count driving/running dunks separately from alley-oop dunks to differentiate the two skills.

**Thresholds (weak proxies):** Elite: ≥ **2.5 dunks/game** with high variety (driving + transition + contested), high AVG_SPEED_OFF. Capable: ≥ 1.5 dunks/game with some self-created dunks. None: < 0.5 dunks/game. NBA Draft Combine data (standing vertical, max vertical, lane agility) would be superior but is not available through these APIs.

**Confidence: VERY LOW.** This skill should **heavily defer to the Claude AI pass**. Speed and dunk data are weak proxies for explosiveness and athleticism.

### 10. Rim Protector

**Current mapping (block rate + opponent FG% at rim) is excellent—this is the best-measured defensive skill.** The key endpoint is `LeagueDashPtDefend` with `DefenseCategory="Less Than 6Ft"`, returning `D_FGA`, `D_FGM`, `D_FG_PCT`, `NORMAL_FG_PCT`, and `PCT_PLUSMINUS` (differential—negative is good).

**Recommended composite:** BLK% (from `LeagueDashPlayerStats` with `MeasureType='Advanced'`) + D_FG_PCT at rim + D_FGA volume per game + PCT_PLUSMINUS. BBall Index's Interior Defense grade follows this exact structure, adjusting rim attempts contested for team rim attempt frequency. Conor McLaughlin's RIMD stat weights efficiency and volume similarly.

**Thresholds:** Elite: BLK% ≥ **3.5%**, D_FG_PCT ≤ **54%** at rim, D_FGA/G ≥ **8**, PCT_PLUSMINUS ≤ **-4%** (Gobert, Wembanyama, Brook Lopez archetype). Capable: BLK% ≥ 1.5% or D_FG_PCT ≤ 58% with D_FGA/G ≥ 5. None: BLK% < 1.5% and D_FG_PCT > 60% or D_FGA/G < 4. Reference: league average FG% at the rim is ~**66%**; anything under 55% is good, under 52% very good, under 50% elite.

**Confidence: HIGH.** NBA.com uses minimum **75 D_FGA** for "medium volume" and 125 for "high volume" qualifying thresholds.

### 11. Rebounder (total)

**Current mapping (TRB%) is a solid baseline but should incorporate tracking data.** `LeagueDashPtStats` with `PtMeasureType='Rebounding'` provides `REB_CONTEST`, `REB_UNCONTEST`, `REB_CHANCES`, `REB_CHANCE_PCT`, and `REB_CHANCE_PCT_ADJ` (adjusted for deferred chances). BBall Index doubles the weight for contested rebounds in their rebounding grade.

**Best approach:** Use `REB_CHANCE_PCT_ADJ` as the primary metric (what percentage of rebound chances does the player actually convert, excluding deferrals) and weight contested rebounds at **1.25–2x** uncontested. `BOX_OUTS` from `LeagueHustleStatsPlayer` indicate effort and positioning skill.

**Position-adjusted thresholds for TRB%:** Elite guards > **8%**, elite wings > **10%**, elite bigs > **16%**. Capable guards **4–8%**, wings **6–10%**, bigs **10–16%**. None: below those floors. Dennis Rodman's career 23.4% TRB% is the all-time benchmark.

### 12. Offensive Rebounder

**Current mapping (ORB%) is sufficient as a primary metric but can be enhanced.** Add offensive rebound chance conversion rate from tracking data and weight contested offensive rebounds more heavily. Interestingly, research from the Jumpshot in the Dark blog found that uncontested offensive rebounds have a higher regression coefficient for impact because they're rarer and indicate elite anticipation and positioning.

**Thresholds (position-adjusted):** Elite bigs: ORB% > **10%** (Steven Adams holds the record at **22.4%**; Mitchell Robinson and Clint Capela peak at **12–15%**). Capable bigs: **5–10%**. None bigs: < 5%. For guards/wings, shift all thresholds down by ~3–5 percentage points. BBall Index also incorporates putback Synergy data (`PlayType='OffRebound'`) in their offensive rebounding grade—this is available through `SynergyPlayTypes` and worth including.

---

## Threshold-based skills: the 5 "need at least one" abilities

### 13. Point of Attack Defender

**Current mapping (steals rate + deflections) is on the right track but should be expanded into a three-pronged composite.** The `LeagueHustleStatsPlayer` endpoint is essential here, providing `DEFLECTIONS`, `CONTESTED_SHOTS_3PT`, `LOOSE_BALLS_RECOVERED`, and `CHARGES_DRAWN`. Combine with STL% from advanced stats and DFG% from `LeagueDashPtDefend` with `DefenseCategory="3 Pointers"` and `"Overall"`.

**What BBall Index recommends (their Perimeter Defense grade):** The three heaviest-weighted inputs are **steals/75 possessions**, **deflections/75 possessions**, and **3-point shot contest volume/rate**. Synergy defensive play-type data (PnR ball handler defense, isolation defense) receives small weight due to known classification errors. Luck-adjusted on/off data is incorporated but requires more complex computation.

**Thresholds:** Elite: STL% > **2.0%** AND Deflections/G > **3.0** AND high Contested 3PT Shots/G, with negative DFG_PCT_PLUSMINUS across categories (Jrue Holiday, Alex Caruso, Derrick White, Dyson Daniels archetype). Capable: STL% **1.2–2.0%** or Deflections/G **1.5–3.0**. None: STL% < 1.2% and Deflections/G < 1.5.

**Limitation:** Steals can reward gambling (the "Monta Ellis effect"). Deflections don't distinguish successful disruptions from risky reach-ins. The Ringer's survey rated public defensive metrics just **3.6 out of 10**. Screen navigation, communication, and recovery—critical POA defender skills—are invisible in all public data. **Confidence: LOW-MODERATE.** Supplement heavily with Claude assessment.

### 14. Crafty Finisher

**Current mapping (drive FG% + drive attempts + FT rate) is well-chosen. But add floater/short-midrange data.** `LeagueDashPtStats` with `PtMeasureType='Drives'` returns the full drive dataset: `DRIVES`, `DRIVE_FGM`, `DRIVE_FGA`, `DRIVE_FG_PCT`, `DRIVE_FTM`, `DRIVE_FTA`, `DRIVE_PTS`, `DRIVE_AST`, `DRIVE_TOV`. This is the core data source. Add `PtMeasureType='PaintTouch'` for PAINT_TOUCH_FG_PCT and, critically, use `ShotChartDetail` to count floaters by filtering `ACTION_TYPE='Floating Jump shot'`.

**The "crafty" distinction from power finishers** (Giannis vs. Kyrie): Crafty finishers show higher **short midrange FG%** (3–10ft, capturing floaters/runners) and more varied shot types in `ShotChartDetail` ACTION_TYPE distributions. Power finishers show higher Restricted Area FG% with more dunks. BBall Index's Finishing grade uses rim-area data plus Synergy play types; a "crafty" variant would weight short midrange efficiency more.

**Thresholds:** Elite (Kyrie archetype): Drive FG% ≥ **52%**, Drives ≥ **8/game**, short midrange FG% ≥ **48%**, drive FT rate (DRIVE_FTA/DRIVE_FGA) ≥ **0.30**. Capable: Drive FG% ≥ 46%, Drives ≥ 5/game, short midrange FG% ≥ 42%. None: Drive FG% < 42% or Drives < 3/game. League average drive FG% runs **~45–48%**.

### 15. Mid Post Player

**Current mapping (post-up frequency + mid-range shot location %) is correct but needs a disambiguation layer to separate from Low Post.** Synergy's `PlayType='Postup'` does not distinguish mid-post from low-post. The key separator is `LeagueDashPtStats`: use `PtMeasureType='ElbowTouch'` for `ELBOW_TOUCHES` and `ELBOW_TOUCH_FG_PCT` (mid-post indicator) versus `PtMeasureType='PostTouch'` for `POST_TOUCHES` (low-post indicator). A player with a high ElbowTouch-to-PostTouch ratio is a mid-post player.

**Shot zone data:** `LeagueDashPlayerShotLocations` with the Mid-Range zone (8–16ft) captures the mid-post scoring area. Elite mid-range shooters hit ~**47–50%** from this zone (Durant archetype); league average is ~**41–42%**.

**Thresholds:** Elite: Postup POSS_PCT ≥ **10%**, Mid-Range FG% ≥ **47%**, Elbow touches elevated relative to post touches, Postup PPP ≥ **1.00**. Capable: Postup POSS_PCT ≥ 5%, Mid-Range FG% ≥ 43%, PPP ≥ 0.90. None: Postup POSS_PCT < 3% or Mid-Range FG% < 38%.

**Limitation:** Synergy Postup PPP includes turnovers and fouls—not pure shooting. Back-to-basket vs. face-up play cannot be reliably distinguished in public data (the full Synergy subscription separates these, but stats.nba.com does not). `ShotChartDetail` ACTION_TYPE partially helps: "Turnaround" and "Hook Shot" suggest back-to-basket; "Jump Shot" from close range may be face-up.

### 16. Low Post Player

**Current mapping (post-up frequency + close-range shot location %) is correct.** The disambiguation from Mid Post uses `PtMeasureType='PostTouch'`: `POST_TOUCHES`, `POST_TOUCH_FG_PCT`, `POST_TOUCH_PTS`, `POST_TOUCH_FTM`, `POST_TOUCH_FTA`, `POST_TOUCH_TOV`. High PostTouch frequency relative to ElbowTouch frequency identifies low-post players. Shot zones should focus on Restricted Area (0–4ft) and In The Paint Non-RA (4–8ft) from `LeagueDashPlayerShotLocations`.

**Thresholds:** Elite: Postup POSS_PCT ≥ **12%**, PostTouch FG% ≥ **50%**, Restricted Area FG% ≥ **65%**, PostTouch ≥ **5/game**, Postup PPP ≥ **0.98**. Capable: Postup POSS_PCT ≥ 6%, PostTouch FG% ≥ 45%, PostTouch ≥ 3/game. None: Postup POSS_PCT < 3% or PostTouch < 2/game. League average Restricted Area FG% runs ~**62–63%**.

### 17. PnR Roll Man

**Current mapping (PRRollman frequency + PPP) is correct.** `SynergyPlayTypes` with `PlayType='PRRollman'` captures all screener scoring in PnR actions. **Important nuance:** public data lumps rolls, slips, and pops together. A stretch-five who pops for threes and a rim-runner who dives are both captured under PRRollman, but with very different play profiles. Cross-reference with Restricted Area FGA% to identify true rollers vs. poppers.

**Supplementary data:** Screen assists from `LeagueHustleStatsPlayer` correlate with PnR activity. Paint touch data from `LeagueDashPtStats` identifies roll men who finish at the rim.

**Thresholds:** Elite: > **3.5 PRRollman poss/game**, PPP > **1.15**, SCORE_POSS_PCT > **55%** (Bam Adebayo, prime Clint Capela archetype). Capable: **1.5–3.5 poss/game**, PPP > **1.00**. None: < 1.0 poss/game or POSS_PCT < 3%. Reference: Vucevic averaged 5.4–5.7 roll man possessions/game (league-leading).

**Limitation:** Public data misses the passing dimension entirely—elite roll men who create for others (Bam, Draymond) are undervalued by scoring-only Synergy data. Cannot separate roll vs. pop vs. slip. Synergy PnR classification accuracy is a known concern in analytics departments.

---

## Zero-sum skills: the 3 abilities where excess creates conflict

### 18. Ball Dominator

**Current mapping (usage rate + time of possession) is correct, but the composite should be more nuanced.** `LeagueDashPtStats` with `PtMeasureType='Possessions'` returns `TOUCHES`, `FRONT_CT_TOUCHES`, `TIME_OF_POSS`, `AVG_SEC_PER_TOUCH`, `AVG_DRIB_PER_TOUCH`, and `PTS_PER_TOUCH`. Combine with USG% from `LeagueDashPlayerStats` with `MeasureType='Advanced'`.

**Key insight from analytics literature:** Usage Rate and Time of Possession measure different things. Ricky Rubio had high touch time but low usage (passes instead of shoots). Klay Thompson had high usage but low touch time (scores efficiently on quick touches). **True ball dominance requires high USG% AND high Time of Possession AND high Seconds Per Touch.** NBA.com's John Schuhmann tracks "Ball Dominance %" = Time of Possession / total minutes on floor—this is the purest single metric.

**Thresholds (for the zero-sum warning):** Elite/Concerning: USG% > **28%**, Time of Possession > **6 min/game**, Seconds Per Touch > **3.5** (Luka Doncic led at ~9.2 min ToP/game). Capable: USG% **20–28%**, ToP **3–6 min/game**. None: USG% < 20%, < 3 min ToP/game. The zero-sum threshold where marginal efficiency typically declines is roughly USG% > **30%** combined with high hold time.

**Limitation:** High ball dominance isn't inherently negative—LeBron and Jokic are highly dominant but efficient. Must pair with team offensive rating on/off and assist generation to determine whether dominance helps or hurts. This context is best evaluated by the Claude pass.

### 19. PnR Ball Handler

**Current mapping (PRBallHandler frequency + PPP) is correct.** `SynergyPlayTypes` with `PlayType='PRBallHandler'` provides the primary data. PnR ball handling is one of the **least efficient** play types on average (~**0.85–0.90 PPP** league-wide), so efficiency thresholds should be calibrated lower than for other play types.

**Critical missing dimension:** Public data only shows scoring possessions—assists generated from PnR are invisible. The full Synergy subscription includes PnR passing possessions, but stats.nba.com does not. Partial workaround: combine PnR BH scoring data with the player's overall potential assists and AST% to infer PnR creation.

**Thresholds:** Elite: > **6.0 PnR BH poss/game**, PPP > **0.95**, PERCENTILE > 70th (Luka Doncic, Trae Young, Damian Lillard archetype). Capable: **3.0–6.0 poss/game**, PPP > **0.85**. None: < 1.5 poss/game or POSS_PCT < 5%.

**Limitation:** Some coaches run very few PnR actions, suppressing even skilled ball handlers' numbers. The TO data is misleading in public data because it combines scoring TOs and passing TOs against only scoring possessions (denominator is too small). Classification accuracy for PnR vs. other actions is a known concern.

### 20. Off-Dribble Shooter

**Current mapping (pull-up 3P% + pull-up attempts/game) is the right proxy.** `LeagueDashPtStats` with `PtMeasureType='PullUpShot'` returns `PULL_UP_FG3_PCT`, `PULL_UP_FG3A`, `PULL_UP_FG_PCT`, and `PULL_UP_EFG_PCT`. NBA tracking defines "pull-up" as any shot taken after at least one dribble—this is precisely "off-dribble shooting."

**Additional granularity available:** `LeagueDashPlayerPtShot` with the `DribbleRange` filter provides shooting splits by dribble count (`'0 Dribbles'`, `'1 Dribble'`, `'2 Dribbles'`, `'3-6 Dribbles'`, `'7+ Dribbles'`). This can identify players who are efficient on quick 1-dribble pull-ups (catch-and-go) versus extended creation sequences. The `TouchTimeRange` filter similarly breaks shooting by time holding the ball.

**Thresholds:** Elite: Pull-Up 3P% ≥ **37%** AND Pull-Up 3PA ≥ **4/game** (Curry, LaVine archetype; BBall Index's Stable Pull-Up 3PT% leaders: LaVine 38.5%, Anthony Edwards 36.6%). Capable: Pull-Up 3P% **33–37%**, Pull-Up 3PA ≥ 2/game. None: Pull-Up 3P% < 30% or Pull-Up 3PA < 1/game. League average pull-up 3P% runs **~31–33%**, significantly lower than C&S (~37%). Only **7 players** averaged double-digit points on pull-up shots in a recent season—the elite tier is very small.

---

## The complete endpoint map for pipeline implementation

This table maps every skill to its primary and supplementary `nba_api` endpoints, with the exact parameter values needed:

| Skill | Primary Endpoint(s) | Key Parameters | Supplementary Endpoint(s) |
|---|---|---|---|
| Spot-up Shooter | `SynergyPlayTypes` + `LeagueDashPtStats` | `PlayType='Spotup'` / `PtMeasureType='CatchShoot'` | `LeagueDashPlayerPtShot` (TouchTimeRange) |
| Movement Shooter | `SynergyPlayTypes` (×2) | `PlayType='OffScreen'` + `PlayType='Handoff'` | — |
| Switchable Defender | `LeagueSeasonMatchups` + `LeagueDashPtDefend` | `DefPlayerID` / multiple DefenseCategory values | `CommonPlayerInfo` (for positions) |
| Cutter | `SynergyPlayTypes` | `PlayType='Cut'` | `LeagueDashPtStats` (`PaintTouch`, `SpeedDistance`) |
| Screen Setter | `LeagueHustleStatsPlayer` | `PerMode='PerGame'` | `SynergyPlayTypes` (`PRRollman`) |
| Transition Threat | `SynergyPlayTypes` + `LeagueDashPtStats` | `PlayType='Transition'` / `PtMeasureType='SpeedDistance'` | — |
| Vertical Spacer | `ShotChartDetail` + `SynergyPlayTypes` + `LeagueDashPlayerShotLocations` | ACTION_TYPE filter / `PlayType='Cut'`+`'PRRollman'` / Restricted Area | — |
| Passer | `LeagueDashPtStats` + `PlayerDashPtPass` | `PtMeasureType='Passing'` | `LeagueDashPlayerStats` (Advanced for AST%) |
| High Flyer | `ShotChartDetail` + `LeagueDashPtStats` | ACTION_TYPE='Driving Dunk' etc. / `PtMeasureType='SpeedDistance'` | `SynergyPlayTypes` (`Transition`) |
| Rim Protector | `LeagueDashPtDefend` + `LeagueDashPlayerStats` | `DefenseCategory='Less Than 6Ft'` / `MeasureType='Advanced'` (BLK%) | `LeagueHustleStatsPlayer` (CONTESTED_SHOTS_2PT) |
| Rebounder | `LeagueDashPlayerStats` + `LeagueDashPtStats` | `MeasureType='Advanced'` (TRB%) / `PtMeasureType='Rebounding'` | `LeagueHustleStatsPlayer` (BOX_OUTS) |
| Offensive Rebounder | `LeagueDashPlayerStats` + `LeagueDashPtStats` | `MeasureType='Advanced'` (ORB%) / `PtMeasureType='Rebounding'` | `SynergyPlayTypes` (`OffRebound`) |
| POA Defender | `LeagueHustleStatsPlayer` + `LeagueDashPtDefend` + `LeagueDashPlayerStats` | Deflections, Contested 3PT / `DefenseCategory='3 Pointers'` / STL% | — |
| Crafty Finisher | `LeagueDashPtStats` + `ShotChartDetail` | `PtMeasureType='Drives'`+`'PaintTouch'` / ACTION_TYPE='Floating Jump shot' | `LeagueDashPlayerShotLocations` (Mid-Range) |
| Mid Post Player | `SynergyPlayTypes` + `LeagueDashPtStats` + `LeagueDashPlayerShotLocations` | `PlayType='Postup'` / `PtMeasureType='ElbowTouch'` / Mid-Range zone | — |
| Low Post Player | `SynergyPlayTypes` + `LeagueDashPtStats` + `LeagueDashPlayerShotLocations` | `PlayType='Postup'` / `PtMeasureType='PostTouch'` / Restricted Area | — |
| PnR Roll Man | `SynergyPlayTypes` | `PlayType='PRRollman'` | `LeagueHustleStatsPlayer` (Screen Assists), `LeagueDashPtStats` (`PaintTouch`) |
| Ball Dominator | `LeagueDashPtStats` + `LeagueDashPlayerStats` | `PtMeasureType='Possessions'` / `MeasureType='Advanced'` (USG%) | — |
| PnR Ball Handler | `SynergyPlayTypes` | `PlayType='PRBallHandler'` | `LeagueDashPtStats` (`Passing`) |
| Off-Dribble Shooter | `LeagueDashPtStats` + `LeagueDashPlayerPtShot` | `PtMeasureType='PullUpShot'` / `DribbleRange` filter | — |

---

## Where stats work and where Claude should take over

Not all skills are created equal from a measurement standpoint. Based on the analytics literature—particularly BBall Index's framework, FiveThirtyEight's DRAYMOND findings, and Seth Partnow's "70 Post-Its" exercise—skills fall into three confidence tiers for statistical classification:

**High confidence (stats can drive classification):** Rim Protector, Spot-up Shooter, Off-Dribble Shooter, PnR Ball Handler, PnR Roll Man, Rebounder, Offensive Rebounder, Ball Dominator, Transition Threat. These have clear metrics with reasonable sample sizes and well-established thresholds. The stat pipeline should classify confidently here, with the Claude pass serving as a sanity check.

**Moderate confidence (stats as primary with Claude as tiebreaker):** Cutter, Movement Shooter, Passer, Crafty Finisher, Mid Post Player, Low Post Player, Screen Setter, Vertical Spacer. These have usable metrics but suffer from sample-size issues, missing dimensions (passing from play types), or ambiguous classification boundaries. The stat pipeline should propose a tier, but the Claude pass should have authority to override with reasoning.

**Low confidence (Claude should lead, stats as input):** Switchable Defender, Point of Attack Defender, High Flyer. These skills are fundamentally difficult to measure with public data. Switchable defense requires understanding scheme, body type, and film-based assessments. POA defense statistics explain only a fraction of actual defensive impact. High Flyer is an athleticism assessment that tracking data barely approximates. For these three, the Claude pass should be the primary classifier, using stats as supporting evidence rather than deterministic thresholds.

---

## Conclusion

The gap between what's measurable and what matters remains large—Partnow's Bucks analytics group identified ~70 concepts needed to "solve" basketball and found only 3 were already solved. But the public data available through `nba_api` in 2025–26 is far richer than most pipeline builders realize. The combination of **11 Synergy play types, 12 tracking measure categories, comprehensive hustle stats, multi-distance defensive tracking, and shot-chart-level action types** provides enough signal to make credible tier classifications for roughly 14 of 20 skills.

Three design choices will most improve classification accuracy: implementing per-stat **Bayesian stabilization** (BBall Index's Stable Stats approach), using **position-adjusted thresholds** rather than universal cutoffs, and building in **multi-season rolling windows** for play-type data where single-season possessions fall below 50. The `balldontlie` API adds marginal value—basic box-score and advanced stats for cross-verification—but the overwhelming majority of skill-specific data comes exclusively from `nba_api` endpoints. Finally, the most sophisticated public framework to study as a blueprint is BBall Index's talent grading system, which already solves many of the same problems this pipeline faces: role adjustment, sample-size handling via sigmoid regression, and composite scoring with XGBoost for skill interactions.