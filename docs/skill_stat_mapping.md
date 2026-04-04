# Skill-to-Stat Mapping — Composite Definitions & Thresholds

This document defines the deterministic stat-based classification rules for all 19 skills in the Cornerstone taxonomy. Each skill maps to specific keys in the `player_stats.stats` JSON blob, combines them into a composite, and applies universal thresholds (not position-adjusted) to assign None/Capable/Elite tiers.

Thresholds are starting points for calibration. The calibration tool (Prompt 6) exists specifically to fine-tune these using anchor players.

---

## Global Rules

**Sample-size stabilization:** For any percentage-based stat (FG%, PPP, etc.), pad the player's attempts with league-average results before computing the percentage. This pulls small-sample extremes toward the mean. The stabilization formula is:

```
stabilized_pct = (player_makes + (K * league_avg_pct)) / (player_attempts + K)
```

Where K is the stabilization constant (number of league-average attempts to add). Recommended K values:
- 3P% and C&S 3P%: K = 100 (~300 attempts to reach 0.7 reliability)
- Pull-up 3P%: K = 80
- Drive FG%: K = 50
- Play type PPP: K = 30 possessions
- FG% at rim / shot zones: K = 60

**Multi-season rolling window:** When current-season sample size falls below the minimum threshold for a skill, blend with prior seasons using 50/30/20 weighting (current/prior/two years ago). If total combined sample still falls below minimum, flag for Claude review.

**Volume gates:** Every skill has a minimum volume requirement. Players below the volume gate are classified as None regardless of efficiency, unless multi-season data pushes them above the threshold.

**Universal thresholds:** All thresholds are position-agnostic. A guard who blocks shots at an elite rate is an elite rim protector. A center who passes at an elite rate is an elite passer. The question is "can this player fill this role for your team?" not "is this impressive for their position?"

---

## Stats JSON Schema Additions

The following keys need to be added to the `player_stats.stats` blob to support all 19 skill mappings. These come from `nba_api` endpoints not yet included in Prompt 3:

```json
{
  "tracking_paint_touch": {
    "paint_touches": 0.0,
    "paint_touch_fg_pct": 0.0,
    "paint_touch_pts": 0.0
  },
  "tracking_post_touch": {
    "post_touches": 0.0,
    "post_touch_fg_pct": 0.0,
    "post_touch_pts": 0.0,
    "post_touch_fta": 0.0,
    "post_touch_tov": 0.0
  },
  "tracking_elbow_touch": {
    "elbow_touches": 0.0,
    "elbow_touch_fg_pct": 0.0,
    "elbow_touch_pts": 0.0
  },
  "shot_detail": {
    "alley_oop_fgm": 0.0,
    "alley_oop_fga": 0.0,
    "driving_dunk_fgm": 0.0,
    "driving_dunk_fga": 0.0,
    "floating_jump_shot_fgm": 0.0,
    "floating_jump_shot_fga": 0.0,
    "floating_jump_shot_fg_pct": 0.0
  },
  "matchup_defense": {
    "positional_groups_guarded": 0,
    "matchup_poss_at_pg": 0.0,
    "matchup_poss_at_sg": 0.0,
    "matchup_poss_at_sf": 0.0,
    "matchup_poss_at_pf": 0.0,
    "matchup_poss_at_c": 0.0,
    "matchup_fg_pct_at_pg": null,
    "matchup_fg_pct_at_sg": null,
    "matchup_fg_pct_at_sf": null,
    "matchup_fg_pct_at_pf": null,
    "matchup_fg_pct_at_c": null,
    "cross_group_fg_pct_diff": null,
    "total_matchup_poss": 0.0
  }
}
```

Also add to the existing `hustle` section:
```json
{
  "hustle": {
    "screen_assists": 0.0,
    "screen_assist_pts": 0.0,
    "charges_drawn": 0.0,
    "loose_balls_recovered": 0.0,
    "box_outs_off": 0.0,
    "box_outs_def": 0.0
  }
}
```

Sources:
- `tracking_paint_touch` → `LeagueDashPtStats` with `PtMeasureType='PaintTouch'`
- `tracking_post_touch` → `LeagueDashPtStats` with `PtMeasureType='PostTouch'`
- `tracking_elbow_touch` → `LeagueDashPtStats` with `PtMeasureType='ElbowTouch'`
- `shot_detail` → `ShotChartDetail` filtered by `ACTION_TYPE` values, aggregated per player per season
- `matchup_defense` → Derived from `LeagueSeasonMatchups` queried by `DefPlayerID`, cross-referenced with `CommonPlayerInfo` for opponent positions. The `positional_groups_guarded` field and per-group poss/FG% are computed during the stat fetch, not raw API fields. The `cross_group_fg_pct_diff` is the weighted average MATCHUP_FG_PCT minus league average FG% for each guarded group.
- `hustle.box_outs_off` / `hustle.box_outs_def` → `LeagueHustleStatsPlayer` (fields `OFF_BOXOUTS` and `DEF_BOXOUTS`)

---

## Skill Rename

**PnR Roll Man → PnR Finisher.** This skill captures any player who scores as the screener in pick-and-roll actions, whether they roll to the rim, pop for a jumper, or slip the screen. "Roll Man" implies rim-running only and excludes stretch bigs who pop effectively. "PnR Finisher" is inclusive of both while still distinct from Screen Setter (which measures creating for others via screens, not scoring yourself).

---

## Additive Skills

### 1. Spot-up Shooter

**Justification:** Catch-and-shoot accuracy and volume directly measure a player's ability to space the floor as a stationary off-ball threat, confirmed by Synergy spot-up context.

| Component | Stat Key | Weight |
|---|---|---|
| C&S three-point accuracy | `tracking_shooting.catch_shoot_fg3_pct` | Primary efficiency |
| C&S three-point volume | `tracking_shooting.catch_shoot_fg3a` | Volume gate |
| Spot-up PPP | `play_type.spotup_ppp` | Secondary efficiency |
| Spot-up possessions | `play_type.spotup_poss` | Secondary volume |

**Composite logic:**
1. Volume gate: `catch_shoot_fg3a` ≥ 2.0/game AND `spotup_poss` ≥ 50 season total. Below gate → None.
2. Primary metric: stabilized `catch_shoot_fg3_pct`
3. Bonus: if `spotup_ppp` ≥ 1.05, bump borderline cases up one tier

| Tier | Stabilized C&S 3P% | Volume Floor |
|---|---|---|
| **Elite** | ≥ 40% | ≥ 3.0 C&S 3PA/game |
| **Capable** | 36–40% | ≥ 2.0 C&S 3PA/game |
| **None** | < 36% or below volume gate | — |

**Stabilization K:** 100

---

### 2. Movement Shooter

**Justification:** Off-screen and handoff play type data isolates shooting off movement, while catch-and-shoot 3P% confirms the player can actually convert these looks — a player who runs off screens constantly but can't shoot is a cutter, not a movement shooter.

**Taxonomy note:** All Movement Shooters are also considered Spot-up Shooters. Movement shooting is a strict superset — if you can hit shots relocating off screens and handoffs, you can hit them standing still. During skill profile generation, any player classified as Capable or Elite in Movement Shooter should be automatically set to at least Capable in Spot-up Shooter if their Spot-up rating would otherwise be lower.

| Component | Stat Key | Weight |
|---|---|---|
| Off-screen PPP | `play_type.offscreen_ppp` | Primary play-type efficiency |
| Off-screen possessions | `play_type.offscreen_poss` | Primary volume |
| Handoff PPP | `play_type.handoff_ppp` | Secondary play-type efficiency |
| Handoff possessions | `play_type.handoff_poss` | Secondary volume |
| C&S three-point % | `tracking_shooting.catch_shoot_fg3_pct` | Shooting accuracy floor |
| C&S three-point attempts | `tracking_shooting.catch_shoot_fg3a` | Shooting volume floor |

**Composite logic:**
1. Combined volume: `offscreen_poss` + `handoff_poss` ≥ 75 season total. Below → None.
2. Shooting accuracy floor: stabilized `catch_shoot_fg3_pct` ≥ 34%. A player running off screens at high volume but shooting below 34% on catch-and-shoot threes is not a Movement Shooter — they're running action without converting. Below → None regardless of play-type data.
3. Weighted PPP: `(offscreen_ppp × offscreen_poss + handoff_ppp × handoff_poss) / (offscreen_poss + handoff_poss)`
4. Combined frequency: `offscreen_freq + handoff_freq`
5. Elite requires both high play-type involvement AND strong shooting accuracy. A player with 25% combined frequency but 35% C&S 3P% is Capable, not Elite — the volume is there but the shooting isn't at the top tier.

| Tier | Weighted PPP | Combined Frequency | C&S 3P% Floor |
|---|---|---|---|
| **Elite** | ≥ 1.02 | ≥ 18% | ≥ 38% |
| **Capable** | 0.90–1.02 | ≥ 10% | ≥ 34% |
| **None** | < 0.90, below volume gate, or C&S 3P% < 34% | — | — |

**Stabilization K:** 30 possessions per play type; 100 for C&S 3P%

---

### 3. Switchable Defender

**Justification:** Matchup data from `LeagueSeasonMatchups` reveals which positional groups a player actually guards and how effective they are across those matchups, providing the most direct available measurement of defensive versatility.

| Component | Stat Key / Source | Weight |
|---|---|---|
| Positional diversity index | Derived from `LeagueSeasonMatchups` | Primary — how many positional groups defended |
| Matchup FG% across groups | Derived from `LeagueSeasonMatchups` | Primary — effectiveness across those groups |
| 2PT contests | `tracking_defense.contested_shots_2pt` | Supporting — interior engagement |
| 3PT contests | `tracking_defense.contested_shots_3pt` | Supporting — perimeter engagement |
| Deflections | `tracking_defense.deflections` | Supporting — active hands |
| Defended at rim FG% | `tracking_defense.defended_at_rim_fg_pct` | Supporting — rim deterrence |

**Positional diversity index computation:**
1. Query `LeagueSeasonMatchups` by `DefPlayerID` to retrieve all offensive players guarded, with `MATCHUP_MIN`, `PARTIAL_POSS`, and `MATCHUP_FG_PCT`.
2. Cross-reference each offensive player's listed position from `CommonPlayerInfo` to assign them to one of five positional groups: PG, SG, SF, PF, C.
3. A positional group counts as "meaningfully guarded" if the defender spent ≥ 10% of their total `PARTIAL_POSS` against that group.
4. **Positional diversity index** = count of meaningfully guarded positional groups (1–5 scale).
5. **Cross-group effectiveness** = weighted average `MATCHUP_FG_PCT` across all guarded groups, where weight = `PARTIAL_POSS` per group. Compare to league-average FG% for each group to get a differential (negative = good).

**Multi-level contest check (supplementary):**
Query `LeagueDashPtDefend` across `DefenseCategory` values (`"Less Than 6Ft"`, `"Less Than 10Ft"`, `"Greater Than 15Ft"`, `"3 Pointers"`) and check whether the defender maintains neutral-to-negative DFG% differentials across multiple distance categories. This confirms the matchup data — a player might get assigned perimeter matchups but fail to actually contest at the perimeter.

**Composite logic:**
1. Primary: positional diversity index ≥ 3 groups meaningfully guarded.
2. Effectiveness: cross-group MATCHUP_FG_PCT differential must be ≤ +3% (not dramatically worse than league average across guarded groups).
3. Multi-level confirmation: `contested_shots_3pt` ≥ 1.0/game AND (`defended_at_rim_fga` ≥ 2.0/game OR `contested_shots_2pt` ≥ 4.0/game). Both perimeter AND interior engagement must be present.
4. Volume floor: ≥ 200 total `PARTIAL_POSS` across all matchups for season.

| Tier | Positional Groups Guarded | Cross-Group FG% Diff | Multi-Level Contests Active |
|---|---|---|---|
| **Elite** | ≥ 4 groups | ≤ 0% (at or below league avg) | Yes — both perimeter and interior |
| **Capable** | ≥ 3 groups | ≤ +3% | Yes |
| **None** | ≤ 2 groups, or cross-group diff > +3%, or single-level only | — | — |

**Critical caveat:** Raw positional diversity can be misleading. Offenses hunt weak defenders in switches — Isaiah Thomas appeared to guard multiple positions because he was targeted, not because he was versatile. A positive MATCHUP_FG_PCT differential (opponents shoot better than average against this player) at a secondary position is a red flag that the matchups are being hunted, not chosen.

**Stat confidence: LOW.** This is the weakest skill to measure statistically even with matchup data. The positional diversity index can identify candidates and rule out non-candidates, but cannot confirm true switchability — that requires film-based assessment of lateral movement, recovery speed, body type, and scheme context. Always flag for Claude review. The stat pipeline should classify obvious cases (pure rim protectors → None, known switch-everything defenders with broad matchup data → Capable or Elite candidate) but defer to Claude for the final call.

---

### 4. Cutter

**Justification:** Synergy cut frequency and efficiency directly capture off-ball scoring via basket cuts, the defining action of this skill.

| Component | Stat Key | Weight |
|---|---|---|
| Cut PPP | `play_type.cut_ppp` | Efficiency |
| Cut frequency | `play_type.cut_freq` | Volume |
| Cut possessions | `play_type.cut_poss` | Volume gate |
| Paint touch FG% | `tracking_paint_touch.paint_touch_fg_pct` | Supporting |

**Composite logic:**
1. Volume gate: `cut_poss` ≥ 50 season total. Below → None.
2. Primary: `cut_freq` as volume signal, `cut_ppp` as efficiency signal
3. Tiebreaker: elevated `paint_touch_fg_pct` supports borderline cases

| Tier | Cut Frequency | Cut PPP | Min Possessions/Season |
|---|---|---|---|
| **Elite** | ≥ 10% | ≥ 1.25 | ≥ 100 |
| **Capable** | 5–10% | ≥ 1.10 | ≥ 50 |
| **None** | < 5% or PPP < 1.10 or below volume gate | — | — |

**Stabilization K:** 30 possessions

---

### 5. Screen Setter

**Justification:** Screen assists directly count successful screens that lead to made baskets, while box outs — though primarily a rebounding stat — indicate the physicality, body positioning, and willingness to make contact that separates good screeners from players who merely stand in the way.

| Component | Stat Key | Weight |
|---|---|---|
| Screen assists/game | `hustle.screen_assists` | Primary (70%) |
| Screen assist points/game | `hustle.screen_assist_pts` | Secondary — quality indicator |
| Defensive box outs/game | `hustle.box_outs_def` | Tertiary (15%) — physicality proxy |
| Offensive box outs/game | `hustle.box_outs_off` | Tertiary (15%) — positioning/effort |

**Composite logic:**
1. Primary metric: `screen_assists` per game (this is the direct measurement)
2. Quality bonus: if `screen_assist_pts / screen_assists` > 2.3 (meaning screens are leading to threes more than twos), bump borderline cases up
3. Physicality supplement: box out activity indicates the contact/effort profile that correlates with screening quality. A player with 2.5 screen assists AND high box-out numbers is a stronger Screen Setter than one with 2.5 screen assists who avoids contact. Compute a physicality modifier: if offensive box outs/game ≥ 2.0, add +0.5 to the screen assist score for tier purposes.

| Tier | Screen Assists/Game (adjusted) |
|---|---|
| **Elite** | ≥ 4.0 |
| **Capable** | 1.5–4.0 |
| **None** | < 1.5 |

**Note:** Heavily system-dependent. Steven Adams in OKC posted ~6/game; the same player in a different offense may post 2/game. No stabilization needed — this is a counting stat reflecting current role, not a true-talent percentage.

---

### 6. Transition Threat

**Justification:** Synergy transition data captures all fast-break scoring, and combining frequency with efficiency identifies players who are both willing and effective in the open court.

| Component | Stat Key | Weight |
|---|---|---|
| Transition PPP | `play_type.transition_ppp` | Efficiency |
| Transition frequency | `play_type.transition_freq` | Volume |
| Transition possessions | `play_type.transition_poss` | Volume gate |

**Composite logic:**
1. Volume gate: `transition_poss` ≥ 75 season total. Below → None.
2. Primary: frequency × efficiency. High frequency alone isn't enough (could be inefficient gambling); high efficiency on low volume isn't enough (opportunistic only).

| Tier | Transition Frequency | Transition PPP | Min Poss/Season |
|---|---|---|---|
| **Elite** | ≥ 6% | ≥ 1.12 | ≥ 100 |
| **Capable** | 3–6% | ≥ 1.00 | ≥ 75 |
| **None** | < 3% or PPP < 1.00 or below volume gate | — | — |

**Stabilization K:** 30 possessions

---

### 7. Vertical Spacer / Lob Threat

**Justification:** Alley-oop finishes and dunk volume at the rim directly measure a player's ability to threaten vertically, creating the gravity that opens driving lanes and pull-up opportunities for teammates.

| Component | Stat Key | Weight |
|---|---|---|
| Alley-oop makes/game | `shot_detail.alley_oop_fgm` | Primary (direct lob measurement) |
| Dunk FGA/game | `shot_zones.dunk_fga` | Volume of vertical finishing |
| Restricted area FG% | `shot_zones.restricted_area_fg_pct` | Rim finishing efficiency |
| PnR finisher possessions | `play_type.pr_roll_man_poss` | Roll threat context |
| Cut possessions | `play_type.cut_poss` | Off-ball dive context |

**Composite logic:**
1. Primary gate: `dunk_fga` ≥ 1.0/game. Below → None.
2. Core metric: `alley_oop_fgm` per game (annualized) + `dunk_fga` per game
3. Efficiency check: `restricted_area_fg_pct` ≥ 60%
4. Context bonus: high `pr_roll_man_poss` or `cut_poss` indicates the player is used as a vertical threat in structured actions, not just transition dunks

| Tier | Dunks/Game | Alley-Oop FGM/Season | Restricted Area FG% |
|---|---|---|---|
| **Elite** | ≥ 2.5 | ≥ 30 | ≥ 65% |
| **Capable** | 1.0–2.5 | ≥ 12 | ≥ 60% |
| **None** | < 1.0 or Restricted Area FG% < 58% | — | — |

---

### 8. Passer

**Justification:** Potential assists measure passes that create shot opportunities (regardless of whether the teammate converts), isolating passing creation from teammate shooting luck better than raw assists.

| Component | Stat Key | Weight |
|---|---|---|
| Potential assists/game | `tracking_passing.potential_assists` | Primary creation volume |
| AST% | `advanced.ast_pct` | Conversion rate context |
| Secondary assists/game | `tracking_passing.secondary_assists` | Hockey-assist playmaking |
| Passes made/game | `tracking_passing.passes_made` | Willingness to move the ball |

**Composite logic:**
1. Primary metric: `potential_assists` per game
2. Quality check: `ast_pct` confirms conversion; `secondary_assists` captures extra-pass playmaking
3. Composite score: `potential_assists + (secondary_assists × 1.5)` — secondary assists weighted higher because they indicate vision beyond the primary read

| Tier | Potential AST/Game | AST% | Composite (Pot AST + 1.5 × Sec AST) |
|---|---|---|---|
| **Elite** | ≥ 10.0 | ≥ 25% | ≥ 13.0 |
| **Capable** | 5.0–10.0 | ≥ 14% | ≥ 7.0 |
| **None** | < 5.0 | < 14% | < 7.0 |

---

### 9. High Flyer

**Justification:** Self-created dunk volume (driving dunks, not alley-oops) combined with transition scoring approximates the explosive athleticism that defines high flyers, though this remains the weakest statistical proxy of any skill.

| Component | Stat Key | Weight |
|---|---|---|
| Driving dunk makes/game | `shot_detail.driving_dunk_fgm` | Primary (self-created explosiveness) |
| Total dunk FGA/game | `shot_zones.dunk_fga` | Overall vertical finishing |
| Alley-oop FGM (negative signal at high ratios) | `shot_detail.alley_oop_fgm` | Distinguish from Vertical Spacer |
| Transition frequency | `play_type.transition_freq` | Open-court athleticism |

**Composite logic:**
1. Self-created dunk ratio: `driving_dunk_fgm / (dunk_fga)`. High ratio = High Flyer. Low ratio (mostly alley-oops) = Vertical Spacer, not High Flyer.
2. Volume: total `dunk_fga` per game
3. Transition bonus: `transition_freq` ≥ 5% and `transition_ppp` ≥ 1.10 adds supporting evidence

| Tier | Driving Dunks/Game | Self-Created Dunk Ratio | Total Dunks/Game |
|---|---|---|---|
| **Elite** | ≥ 1.5 | ≥ 50% of dunks are self-created | ≥ 2.5 |
| **Capable** | 0.7–1.5 | ≥ 35% self-created | ≥ 1.5 |
| **None** | < 0.7 or most dunks are alley-oops | — | — |

**Stat confidence: VERY LOW.** This is primarily an athleticism assessment. Always flag for Claude review. The stat pipeline should propose a tier, but Claude should have full override authority. Players like early-career Vince Carter or prime Ja Morant require scouting context no stat captures.

---

### 10. Rim Protector

**Justification:** Opponent field goal percentage at the rim combined with block rate and volume of rim contests measures both the deterrent and the actual shot-altering impact of a player's rim protection.

| Component | Stat Key | Weight |
|---|---|---|
| Block % | `advanced.blk_pct` | Shot-blocking rate |
| Opponent FG% at rim | `tracking_defense.defended_at_rim_fg_pct` | Actual rim deterrence |
| Defended at rim FGA/game | `tracking_defense.defended_at_rim_fga` | Volume of rim contests |

**Composite logic:**
1. Volume gate: `defended_at_rim_fga` ≥ 4.0/game. Below → None (even with high block rate, insufficient rim presence).
2. Primary: `defended_at_rim_fg_pct` — lower is better. League average is ~60%.
3. Secondary: `blk_pct` adds shot-blocking dimension beyond just contesting

| Tier | Defended at Rim FG% | BLK% | Defended at Rim FGA/G |
|---|---|---|---|
| **Elite** | ≤ 54% | ≥ 3.5% | ≥ 6.0 |
| **Capable** | 54–60% | ≥ 1.5% | ≥ 4.0 |
| **None** | > 60% or BLK% < 1.5% or below volume gate | — | — |

**Stat confidence: HIGH.** Best-measured defensive skill. Minimum 75 defended FGA for reliable classification.

---

### 11. Rebounder

**Justification:** Total rebound percentage measures the share of available rebounds a player collects while on the floor, normalizing for pace and minutes in a way raw rebounds per game cannot.

| Component | Stat Key | Weight |
|---|---|---|
| Total rebound % | `advanced.reb_pct` | Primary |
| Contested rebound rate | `tracking_rebounding.dreb_contest_pct` | Quality/effort indicator |

**Composite logic:**
1. Primary metric: `reb_pct`
2. Quality bonus: `dreb_contest_pct` ≥ 60% (majority of rebounds are contested) bumps borderline cases up

| Tier | TRB% |
|---|---|
| **Elite** | ≥ 15% |
| **Capable** | 10–15% |
| **None** | < 10% |

**Note:** This means many guards are None, which is correct — a guard averaging 4 RPG at 6% TRB% is not someone you can rely on as a rebounder for your team construction purposes.

---

### 12. Offensive Rebounder

**Justification:** Offensive rebound percentage isolates second-chance creation ability, and is the strongest predictor of a player's offensive rebounding impact regardless of team pace or scheme.

| Component | Stat Key | Weight |
|---|---|---|
| Offensive rebound % | `advanced.oreb_pct` | Primary |
| Offensive rebound chances | `tracking_rebounding.oreb_chances` | Volume context |
| Off-rebound Synergy PPP | `play_type.off_rebound_ppp` (if available) | Putback efficiency |

**Composite logic:**
1. Primary metric: `oreb_pct`
2. Volume check: `oreb_chances` confirms the player is in position to get offensive boards (not just mathematically high ORB% on 2 chances/game)

| Tier | ORB% | Min OREB Chances/Game |
|---|---|---|
| **Elite** | ≥ 8% | ≥ 2.5 |
| **Capable** | 4–8% | ≥ 1.5 |
| **None** | < 4% or below volume gate | — |

---

## Threshold-Based Skills

### 13. Point of Attack Defender

**Justification:** Steal rate and deflections together capture active-hands disruption — steals measure completed takeaways while deflections measure the higher-volume activity of tipping and disrupting passes that precedes them.

| Component | Stat Key | Weight |
|---|---|---|
| Steal % | `advanced.stl_pct` | Takeaway rate |
| Deflections/game | `tracking_defense.deflections` | Active disruption volume |
| Contested 3PT shots/game | `tracking_defense.contested_shots_3pt` | Perimeter contest effort |

**Composite logic:**
1. Core composite: `(stl_pct × 10) + deflections + (contested_shots_3pt × 0.5)`. This weights steals rate (rare, high-value events) heavily, deflections as the primary volume indicator, and perimeter contests as supporting evidence.
2. Both disruption AND contest must be present: `deflections` ≥ 1.0/game AND `stl_pct` ≥ 1.0%

| Tier | Composite Score | STL% Floor | Deflections Floor |
|---|---|---|---|
| **Elite** | ≥ 28 | ≥ 2.0% | ≥ 3.0 |
| **Capable** | 18–28 | ≥ 1.2% | ≥ 1.5 |
| **None** | < 18 or missing either disruption or contest | — | — |

**Stat confidence: LOW-MODERATE.** Steals reward gambling; deflections don't distinguish quality. Screen navigation, help positioning, and recovery speed are invisible. Supplement with Claude review.

---

### 14. Crafty Finisher

**Justification:** Drive volume and efficiency capture the ability to get to the basket, while short midrange efficiency (floaters, runners, paint non-RA shots) and free throw rate capture the craft dimension — the touch, body control, and foul-drawing ability that separates a Kyrie Irving from a pure downhill athlete who needs a clear lane.

| Component | Stat Key | Weight |
|---|---|---|
| Drives per game | `tracking_drives.drives_per_game` | Volume of self-creation |
| Drive FG% | `tracking_drives.drive_fg_pct` | Finishing efficiency |
| Free throw rate (FTA/FGA) | `advanced.free_throw_rate` | Foul-drawing craft |
| Paint non-RA FG% | `shot_zones.paint_non_ra_fg_pct` | Short midrange touch (4–8ft floaters, runners, push shots) |
| Paint non-RA FGA/game | `shot_zones.paint_non_ra_fga` | Short midrange volume |
| Floater FG% | `shot_detail.floating_jump_shot_fg_pct` | Direct floater efficiency |
| Floater FGA/game | `shot_detail.floating_jump_shot_fga` | Floater volume |

**Composite logic:**
1. Volume gate: `drives_per_game` ≥ 4.0. Below → None.
2. Finishing composite: weighted blend of drive finishing and short midrange touch:
   - `finishing_score = (drive_fg_pct × 0.5) + (paint_non_ra_fg_pct × 0.3) + (free_throw_rate × 0.2)`
   - This weights pure drive finishing as the primary signal, but short midrange efficiency is a core component, not a tiebreaker. A player with 48% drive FG% and 50% paint non-RA FG% scores higher than one with 52% drive FG% and 35% paint non-RA FG% — the first player has more tools.
3. Craft indicators (used to confirm tier, not to gate): `floating_jump_shot_fga` ≥ 0.5/game indicates a floater in the bag. `paint_non_ra_fga` ≥ 1.5/game indicates regular short midrange usage. Either one present elevates confidence in a Capable or Elite classification.
4. Free throw rate ≥ 0.22 is required for Capable, ≥ 0.30 for Elite — the ability to draw fouls on drives is inseparable from crafty finishing. A player who drives a lot but never gets to the line is attacking without craft.

| Tier | Drive FG% (stab.) | Drives/G | Free Throw Rate | Paint Non-RA FG% (stab.) | Short MR Volume (paint non-RA FGA/G) |
|---|---|---|---|---|---|
| **Elite** | ≥ 50% | ≥ 8.0 | ≥ 0.30 | ≥ 46% | ≥ 1.5 |
| **Capable** | 46–50% | ≥ 4.0 | ≥ 0.22 | ≥ 40% | ≥ 0.8 |
| **None** | < 46% or below volume gate or FT rate < 0.22 | — | — | — | — |

**Note on the Elite drive FG% threshold:** I lowered this from 52% to 50% compared to the earlier draft because the short midrange composite now carries real weight. A player at 50% drive FG% with elite floater touch and high free throw rate (SGA, Kyrie) is an elite Crafty Finisher even if their raw drive FG% isn't the absolute top tier — the craft shows up in the short midrange efficiency and foul drawing, not just the at-rim conversion.

**Stabilization K:** 50 (drive attempts); 60 (paint non-RA FGA); 40 (floater FGA)

---

### 15. Mid Post Player

**Justification:** Post-up Synergy frequency combined with elbow touch data and mid-range shot zone efficiency isolates face-up and elbow-area scoring from pure low-post back-to-basket play.

| Component | Stat Key | Weight |
|---|---|---|
| Post-up frequency | `play_type.postup_freq` | Overall post involvement |
| Post-up PPP | `play_type.postup_ppp` | Post scoring efficiency |
| Post-up possessions | `play_type.postup_poss` | Volume gate |
| Elbow touches/game | `tracking_elbow_touch.elbow_touches` | Mid-post positioning |
| Mid-range FG% | `shot_zones.mid_range_fg_pct` | Face-up shooting efficiency |
| Mid-range FGA/game | `shot_zones.mid_range_fga` | Mid-range volume |

**Composite logic:**
1. Requires mid-range presence: `mid_range_fga` ≥ 1.5/game. Below → None for this skill (might still qualify for Low Post).
2. Post context: `postup_freq` ≥ 5% confirms post-up usage
3. Mid-post identifier: `elbow_touches` ≥ 2.0/game OR `mid_range_fga` > `restricted_area_fga` (face-up oriented)
4. Efficiency: stabilized `mid_range_fg_pct`

| Tier | Mid-Range FG% (stabilized) | Mid-Range FGA/G | Post-Up Freq |
|---|---|---|---|
| **Elite** | ≥ 47% | ≥ 3.0 | ≥ 8% |
| **Capable** | 42–47% | ≥ 1.5 | ≥ 4% |
| **None** | < 42% or below volume gates | — | — |

**Stabilization K:** 60 (mid-range FGA)

---

### 16. Low Post Player

**Justification:** Post touch volume and efficiency combined with restricted area finishing identifies players who can score with their back to the basket in the paint — the traditional center skillset.

| Component | Stat Key | Weight |
|---|---|---|
| Post-up frequency | `play_type.postup_freq` | Overall post involvement |
| Post-up PPP | `play_type.postup_ppp` | Post scoring efficiency |
| Post-up possessions | `play_type.postup_poss` | Volume gate |
| Post touches/game | `tracking_post_touch.post_touches` | Low block usage |
| Post touch FG% | `tracking_post_touch.post_touch_fg_pct` | Efficiency from the block |
| Restricted area FGA/game | `shot_zones.restricted_area_fga` | Close-range finishing volume |
| Restricted area FG% | `shot_zones.restricted_area_fg_pct` | Close-range finishing efficiency |

**Composite logic:**
1. Volume gate: `post_touches` ≥ 3.0/game AND `postup_poss` ≥ 75 season total. Below → None.
2. Post-type identifier: `post_touches` > `elbow_touches` (low-post oriented, not mid-post)
3. Core metrics: stabilized `post_touch_fg_pct` and `postup_ppp`

| Tier | Post Touch FG% (stabilized) | Post Touches/G | Post-Up PPP |
|---|---|---|---|
| **Elite** | ≥ 50% | ≥ 5.0 | ≥ 0.98 |
| **Capable** | 44–50% | ≥ 3.0 | ≥ 0.88 |
| **None** | < 44% or below volume gates | — | — |

**Stabilization K:** 30 possessions (post-up PPP); 50 (post touch FGA)

---

### 17. PnR Finisher *(renamed from PnR Roll Man)*

**Justification:** Synergy PnR roll man data captures all screener scoring in pick-and-roll actions — rolls to the rim, pops for jumpers, and slips — directly measuring a player's value as the finisher in the NBA's most common two-man action.

| Component | Stat Key | Weight |
|---|---|---|
| PnR roll man PPP | `play_type.pr_roll_man_ppp` | Efficiency |
| PnR roll man frequency | `play_type.pr_roll_man_freq` | Usage share |
| PnR roll man possessions | `play_type.pr_roll_man_poss` | Volume gate |
| Screen assists/game | `hustle.screen_assists` | Supporting (engagement in PnR actions) |

**Composite logic:**
1. Volume gate: `pr_roll_man_poss` ≥ 75 season total. Below → None.
2. Primary: `pr_roll_man_freq` × `pr_roll_man_ppp`
3. Distinguish from Screen Setter: a player can be an elite Screen Setter (creates for others) but a None PnR Finisher (doesn't score himself), and vice versa. Lauri Markkanen: high PPP on pops, low screen assists. Steven Adams: high screen assists, modest PPP.

| Tier | PnR Roll Man PPP | PnR Roll Man Freq | Min Poss/Season |
|---|---|---|---|
| **Elite** | ≥ 1.12 | ≥ 8% | ≥ 125 |
| **Capable** | 0.95–1.12 | ≥ 4% | ≥ 75 |
| **None** | < 0.95 or below volume gate | — | — |

**Stabilization K:** 30 possessions

---

## Zero-Sum Skills

### 18. Ball Dominator

**Justification:** Usage rate measures the share of team possessions a player ends (shots, FTs, turnovers) while time of possession measures literal ball-holding — together they capture both scoring burden and on-ball control that defines ball dominance.

| Component | Stat Key | Weight |
|---|---|---|
| Usage rate | `advanced.usage_rate` | Possession-ending share |
| Time of possession/game | `tracking_possessions.time_of_possession` | Ball-holding time |
| Avg seconds per touch | `tracking_possessions.avg_sec_per_touch` | Hold-time per touch |

**Composite logic:**
1. Both dimensions must be elevated. High USG% with low ToP = efficient scorer (Klay Thompson), not a ball dominator. Low USG% with high ToP = passive ball-handler (late-career Ricky Rubio), not a ball dominator either.
2. Classification requires: elevated USG% AND elevated time of possession
3. Avg seconds per touch confirms the ball "sticks" — distinguishes true dominance from high-volume quick scorers

| Tier | Usage Rate | Time of Possession/G (min) | Avg Sec Per Touch |
|---|---|---|---|
| **Elite** | ≥ 28% | ≥ 6.0 | ≥ 4.0 |
| **Capable** | 22–28% | ≥ 3.5 | ≥ 3.0 |
| **None** | < 22% OR ToP < 3.5 min | — | — |

**Note:** Ball Dominator is a zero-sum descriptor, not a value judgment. LeBron and Luka are elite Ball Dominators AND elite players. The zero-sum conflict check in the evaluator determines whether overlap with another Ball Dominator is a problem.

---

### 19. PnR Ball Handler

**Justification:** Synergy PnR ball handler data directly measures a player's frequency and efficiency as the primary initiator in pick-and-roll actions — the single most important offensive action in modern basketball.

| Component | Stat Key | Weight |
|---|---|---|
| PnR ball handler PPP | `play_type.pr_ball_handler_ppp` | Efficiency |
| PnR ball handler frequency | `play_type.pr_ball_handler_freq` | Usage share |
| PnR ball handler possessions | `play_type.pr_ball_handler_poss` | Volume gate |

**Composite logic:**
1. Volume gate: `pr_ball_handler_poss` ≥ 100 season total. Below → None. (Higher gate than other play types because PnR BH is more common and has more available data.)
2. Primary: `pr_ball_handler_freq` as volume signal, `pr_ball_handler_ppp` as efficiency signal
3. PnR is less efficient than most play types on average (~0.87 PPP league average), so thresholds are set lower than for spot-up or transition

| Tier | PnR BH PPP | PnR BH Frequency | Min Poss/Season |
|---|---|---|---|
| **Elite** | ≥ 0.95 | ≥ 15% | ≥ 200 |
| **Capable** | 0.82–0.95 | ≥ 8% | ≥ 100 |
| **None** | < 0.82 or below volume gate | — | — |

**Stabilization K:** 30 possessions

---

### 20. Off-Dribble Shooter

**Justification:** Pull-up three-point accuracy and volume directly measure the ability to create and convert jump shots off the bounce — a scarce skill that separates shot creators from catch-and-shoot specialists.

| Component | Stat Key | Weight |
|---|---|---|
| Pull-up 3P% | `tracking_shooting.pullup_fg3_pct` | Efficiency |
| Pull-up 3PA/game | `tracking_shooting.pullup_fg3a` | Volume |
| Pull-up EFG% | `tracking_shooting.pullup_fg_pct` | Overall pull-up efficiency (includes 2PT) |

**Composite logic:**
1. Volume gate: `pullup_fg3a` ≥ 2.0/game. Below → None.
2. Primary metric: stabilized `pullup_fg3_pct`
3. Supporting: if `pullup_fg_pct` ≥ 45% (overall pull-up including twos), adds confidence to borderline cases

| Tier | Pull-Up 3P% (stabilized) | Pull-Up 3PA/Game |
|---|---|---|
| **Elite** | ≥ 37% | ≥ 4.0 |
| **Capable** | 33–37% | ≥ 2.0 |
| **None** | < 33% or below volume gate | — |

**Stabilization K:** 80

---

## Stat Confidence Summary

This table summarizes how much the stat pipeline should be trusted versus deferring to the Claude AI pass for each skill.

| Confidence | Skills | Guidance |
|---|---|---|
| **High** | Rim Protector, Spot-up Shooter, Off-Dribble Shooter, Rebounder, Offensive Rebounder, Ball Dominator | Stats drive classification. Claude serves as sanity check. Auto-accept one-tier disagreements (default to stats). |
| **Moderate** | Cutter, Movement Shooter, Passer, Crafty Finisher, Mid Post Player, Low Post Player, Screen Setter, Vertical Spacer, Transition Threat, PnR Ball Handler, PnR Finisher | Stats propose a tier. Claude has tiebreaker authority on one-tier disagreements. Flag two-tier disagreements for manual review. |
| **Low** | Switchable Defender, Point of Attack Defender, High Flyer | Claude leads classification. Stats provide supporting evidence only. Flag all cases for review regardless of agreement level. |

---

## Anchor Player Sanity Checks

Use these archetypes to validate thresholds during calibration. If a threshold set produces a result that contradicts these known archetypes, the thresholds need adjustment.

| Skill | Expected Elite | Expected Capable | Expected None |
|---|---|---|---|
| Spot-up Shooter | Klay Thompson, Duncan Robinson | Khris Middleton | Russell Westbrook |
| Movement Shooter | Steph Curry, Klay Thompson | Buddy Hield | Ben Simmons |
| Switchable Defender | Bam Adebayo, OG Anunoby | Derrick White | Trae Young |
| Cutter | Bam Adebayo, Zach Collins | Draymond Green | James Harden |
| Screen Setter | Clint Capela, Domantas Sabonis | Brook Lopez | Steph Curry |
| Transition Threat | Ja Morant, Anthony Edwards | LeBron James | Nikola Jokic |
| Vertical Spacer / Lob Threat | Clint Capela, Nic Claxton | Anthony Davis | Nikola Jokic |
| Passer | Nikola Jokic, Trae Young | Draymond Green | Clint Capela |
| High Flyer | Ja Morant, Anthony Edwards | Derrick Jones Jr | Nikola Jokic |
| Rim Protector | Rudy Gobert, Wemby | Myles Turner | Trae Young |
| Rebounder | Domantas Sabonis, Rudy Gobert | Anthony Davis | Chris Paul |
| Offensive Rebounder | Steven Adams, Mitchell Robinson | Giannis | Steph Curry |
| Point of Attack Defender | Jrue Holiday, Derrick White | Marcus Smart | Trae Young |
| Crafty Finisher | Kyrie Irving, SGA | De'Aaron Fox | Brook Lopez |
| Mid Post Player | Kevin Durant, DeMar DeRozan | Kawhi Leonard | Rudy Gobert |
| Low Post Player | Joel Embiid, Bam Adebayo | Julius Randle | Steph Curry |
| PnR Finisher | Bam Adebayo, Clint Capela | Lauri Markkanen | Steven Adams |
| Ball Dominator | Luka Doncic, SGA | Jimmy Butler | Klay Thompson |
| PnR Ball Handler | Trae Young, Luka Doncic | Jalen Brunson | Klay Thompson |
| Off-Dribble Shooter | Steph Curry, Damian Lillard | CJ McCollum | Ben Simmons |
