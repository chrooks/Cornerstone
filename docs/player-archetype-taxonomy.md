# Player Archetype taxonomy (spec)

- **Status:** Approved 2026-09-21. Chris approved the #119 ExecPlan with every recommendation.
- **Closes:** [#15 Define the Player Archetype taxonomy](https://github.com/chrooks/Cornerstone/issues/15).
- **Feeds:** [#17 Compute and display Player Archetypes](https://github.com/chrooks/Cornerstone/issues/17).
- **Binding source:** the Decision Ledger (D3-D24) in `.tasks/119-3d-archetypes/throughline.md` (local, gitignored).
  Where this spec and the ledger disagree, the ledger wins, except where an approval decision below reopens a
  ledger line on purpose: decision (a) reopens D7's Final Eval placement (§6), and default c.5 reopens D5 for
  Legend negatives (§7). Those two approval decisions win over the ledger lines they reopen.
- **Approval decisions:** the ExecPlan `.tasks/119-3d-archetypes/plan.md` (local, gitignored). This spec cites its
  decisions as "decision (a)" to "(g)" and its Appendix A defaults as "c.1" to "c.21". Each rule it decided is
  written into the section it governs.
- **Evidence:** `.tasks/119-3d-archetypes/research/` (local, gitignored) and a preview run of both classifiers on
  the dev [Snapshot Release](../LEXICON.md) (401 actives, 36 [Legends](../LEXICON.md)). The preview wrote nothing.

| #15 acceptance criterion | Where this spec answers it |
|---|---|
| Approved label list, grouped by basketball identity | §3 (offense by family, defense by kind) |
| Derivation rules (which signals qualify each label) | §3 tables and §4. #15 names "Impact Trait signals"; Skill tiers plus league stat rates meet it (default c.13). |
| Tie-breakers for a Player who qualifies for more than one label | §4 |
| Player Archetype vs Lineup archetype vs [Versatility](../LEXICON.md) | §8 |
| A follow-up issue detailed enough to be AFK-ready | §9 (the [#17](https://github.com/chrooks/Cornerstone/issues/17) build brief) and Appendix A |
| Roll-in (2026-05-14 comment): spider/radar chart axes from Skill Profile and Impact Trait signals, apart from Lineup archetypes and Versatility | Already met by the shipped [Player Shape](../LEXICON.md) (PlayerShapeGlyph, PlayerProfileShape; ADR 0005): its axes are league-percentile composites, which are Impact Traits. Recorded on #17 (2026-09-21). §8 keeps it apart from the Team Shape. |

---

## 1. Read this first

- A Player Archetype names what a [Player](../LEXICON.md) can do, on offense and on defense, as two separate roles.
- Each end has one main role. Each end can also have one second role, when that role clears its own bar.
- Offense reads league-wide stat rates for actives and curated Skill tiers for Legends.
- Defense reads reviewed defensive Skill tiers only. Deployment stats are evidence for the rating, never the label.
- A negative defense label needs a None that Chris reviewed (D21). The classifier also asks for a full read
  (default c.13).
- A Player with no data gets the Empty State, never a guessed label.
- Labels change no score. They do not enter `overall` or price.
- Seven pair names ("3-and-D Wing", "Two-Way Creator") name common main-role pairs (D23, D24). See §5.

---

## 2. Principles

1. **A portable skill set, not a team role (D17).** A label describes what the Player can do on any team.
   The Lab moves every Player onto a new team, so a team role would not be an
   Honest Signifier. No rule reads team data: no team lead, no share of a team's load,
   no team pace, no traded flag. Every bar is a league bar on a per-possession or per-minute rate, a share of
   his own shots or play-type possessions, or a curated Skill tier.
2. **JKM vocabulary first (D4, D8).** Role names come from J. Kyle Mann's (The Ringer) glossary and Big Board.
   When no JKM term fits, the name is a plain role name, and code flags it as ours. Our own terms today:
   **Stretch big**, **Cone**, **Neutral Defender**, and the word "defender" in **Point-of-attack defender**.
   Code also flags **Rim finisher** as ours until someone verifies it as verbatim JKM (default c.13).
   Point-of-attack defender keeps origin JKM in code, because the role is JKM's and only the word is ours.
   Barbershop names are for pair names only (D4).
3. **Roles only in V1 (D9b).** JKM traits (chef vs patron, ball stopper, glue guy, and the like) and team
   concepts wait for [#135 archetype traits and team-fit concepts](https://github.com/chrooks/Cornerstone/issues/135).
   One exception: **Glue Guy** is an approved pair name (D23, Connector + a positive defense role, §5). JKM's
   "glue guy" trait (chemistry and fit) stays with #135.
4. **Labels never enter `overall` or price.** Player Archetypes are display and search only.
   [#118 archetype-relative overall](https://github.com/chrooks/Cornerstone/issues/118) is closed as not planned.
5. **Defense reads reviewed tiers only (D19).** A defense label reads the defensive Skill tiers after the
   [#152 Perimeter Disruptor split](https://github.com/chrooks/Cornerstone/issues/152) review. Deployment,
   steals and deflections, rim FG% and DREB% feed Claude's informed rating and Chris's review. They never set a
   label. Auto-accepted tiers can set a positive label or Neutral Defender (D21).
6. **A negative needs proof (D10, D21).** Cone and Defensive target need a None that Chris reviewed on the key
   Skills (D21). The classifier adds two bars that no ledger line sets (default c.13): a full read (1,000+
   minutes and 30+ games), and every core defensive Skill at None.
7. **No data means the Empty State (D7).** The rules never guess. An admin can set a label through the override.
8. **One rule set for actives and Legends (D5).** Legends run the same labels on their curated tiers, plus an
   admin override. One exception reopens D5: the rules never give a Legend a negative (default c.5, §7).
9. **Credit JKM once (D11).** One FAQ line: "Role names borrow J. Kyle Mann's (The Ringer) scouting vocabulary."
   No Ringer branding.

---

## 3. The labels

Every rule below is a bar the Player clears on his own numbers. A role's **strength** is how far he clears its
bar (signal ÷ bar on the stats path, the tier on the tiers path). Strength ranks roles in §4.

### 3.1 Offense: 16 roles in two families

- **Families (D9):** *Advantage creator* (makes the advantage, mostly with the ball) and *Advantage exploiter*
  (cashes it in, mostly off the ball). D13 is resolved: Advantage creator / Advantage exploiter. The family is
  stored, not displayed in V1 (default c.13).
- **Load ladder (actives):** three rungs read league load.
  - **Capacity** = usage rate ≥ .255 at 24+ mpg and 10+ games.
  - **Creation Load Index (CLI)** = z(USG%) + z(AST%) + max(z(time of possession/36), z(touches/36)).
    Each z compares him to the league rotation pool (actives, 20+ mpg, 10+ games) and is capped at 3.
- **Size (offense):** a *big* is listed position C or FC, or 6'10"+. A *center* is position C, or 6'10"+.
  Defense uses a different size rule (§3.2). Offense keeps listed position in V1 (decision g): here it only
  separates bigs from wings, and the defense rule would make LeBron and Siakam bigs and drop Allen and Vučević
  from the center gate.
- **Share** = share of his play-type possessions (NBA.com Synergy). Per-36 rates in this table become per-100
  rates in production (§9.3).
- **Make-rate floor (D23).** Movement shooter, Floor spacer and Stretch big also need a 3P% make-rate floor, read
  on the season blended with career 3P%. The shot-diet bars count attempts, not makes. Research intent, from
  `.tasks/119-3d-archetypes/research/pair-names.json` (local, gitignored): keep a one-season slump (Caruso,
  Herb Jones), drop a non-shooter (Vanderbilt, Ronald Holland II). Stats path only; the tiers path already reads
  shooter tiers. **The preview counts below do not apply it**, so these three roles will shrink.
  - **Source (decision d):** the one stats refetch stores the 3-point makes and attempts of every regular season
    before 2025-26 in the stats blob, as `shooting_history.prior_fg3m` and `prior_fg3a` (career totals minus the
    2025-26 row, from the PlayerCareerStats call the fetch already makes).
  - **Blend:** (season 3PM + prior 3PM) / (season 3PA + prior 3PA), where season 3PM = `box_score.fg3m` ×
    `box_score.gp`, because the blob stores per-game values. Each season counts once, weighted by attempts. A
    Player with no prior season (a rookie, `prior_fg3a` 0) or no stored `shooting_history` uses the season alone.
  - **Value:** the #17 build picks it from the refetched data, so that Caruso and Herb Jones keep their shooter
    role and Vanderbilt and Ronald Holland II lose it.
  - The classifier and the publish freeze read only these two stored fields. They never read the `career` stats
    rows and never call `get_or_fetch_career` (§9.3).

| Family | Label | Source | What it says (tooltip copy, c.19) | Rule for actives (stats) | Rule for Legends (Skill tiers) | Main: actives / Legends |
|---|---|---|---|---|---|---|
| Creator | **Primary creator** | JKM Big Board ("Primary/supplementary creator", #7 Flemings). Was "Offensive hub" (D15, D17). | Carries his own scoring load, and creates for others. League-elite only (~10, D15). | Capacity AND CLI ≥ 5.2 AND AST% ≥ .20. | Tier lead AND (passer ≥ Elite with a ball door, OR passer ≥ Proficient with pnr_ball_handler ≥ Elite or driver = All-Time Great). | 11 / 18 |
| Creator | **Scorer/facilitator** | JKM Big Board "Primary scorer/facilitator" (#2 Peterson), shortened. On the Big Board that name sits above "Primary creator", so the full name would read upside down (logged default). | Carries a big scoring load and passes out of it. | Capacity, not Primary creator, not a Fulcrum-shaped center, AND AST% ≥ .20 AND AST%/USG ≥ .68. | Tier lead AND passer ≥ Capable. | 20 / 12 |
| Creator (follows diet) | **Volume scorer** | JKM Big Board (#3 Dybantsa). | Carries a big scoring load. Scoring comes before passing. | Capacity, and not the passing share. Family: creator if he has a creator door (see Secondary creator), else the family of his strongest diet (logged default). | Tier lead with no passer tier (family: creator). | 15 / 2 |
| Creator | **Secondary creator** | JKM Big Board. Absorbs "Supplementary creator" (D14). | Creates off the dribble or with the pass, below a lead creator's load. | No load rung, AND (iso + PnR ball-handler share ≥ .30, OR AST% ≥ .25 with AST%/USG ≥ 1.0). A center with iso + PnR < .10 never lands here (asserted). | max(pnr_ball_handler, driver, isolation_scorer) ≥ Proficient AND passer ≥ Proficient. | 67 / 1 |
| Creator | **Fulcrum playmaker** | JKM Big Board (#15 Mara); glossary "Playmaking hub (big)". | A center the offense runs through, from the elbow and the post. | Center AND AST% ≥ .19 AND AST%/USG ≥ .85 AND iso + PnR < .30 AND touches/36 ≥ 72 AND elbow + post touches/36 ≥ 4.5. A capacity center who clears this reads Fulcrum before the scorer rungs (Sengun). | Big AND passer ≥ Elite AND max(low_post_player, mid_post_player) ≥ Elite. | 3 / 1 |
| Creator | **Pull-up shooter** | JKM glossary (alias "Dribble pull-up guy"; Big Board badge "Pull-up Threat"). | His weapon is the jumper off the dribble. | Pull-up FGA ≥ 40% of FGA AND ≥ 4.5 per 36. | off_dribble_shooter ≥ Proficient AND above both driver and pnr_ball_handler. | 13 / 0 |
| Creator | **Slasher** | JKM Big Board. | Drives downhill and finishes at the rim. | Drives/36 ≥ 10 AND restricted-area FGA ≥ 30% of FGA AND drives ≥ 1.5 × pull-ups, AND not a passing creator. | driver ≥ Proficient. | 9 / 0 |
| Creator | **Traditional post player** | JKM glossary. | Scores with his back to the basket. | Post-up share ≥ .15 AND catch-and-shoot 3PA < 20% of FGA. | low_post_player ≥ Proficient AND spot_up_shooter < Proficient. | 3 / 0 |
| Exploiter | **Movement shooter** | JKM glossary + Big Board. | Hits catch-and-shoot threes on the move, off screens and handoffs. | Catch-and-shoot 3PA ≥ 3.0 per 36 AND ≥ 30% of FGA AND off-screen + handoff share ≥ .15, AND the make-rate floor (D23). | movement_shooter ≥ Proficient AND ≥ spot_up_shooter. | 32 / 0 |
| Exploiter | **Floor spacer** | JKM glossary + Big Board. | A guard or wing who spaces the floor with spot-up threes. | The shooter bars above (with the make-rate floor), off-screen + handoff < .15, and not a big. | spot_up_shooter ≥ Proficient, not a big. | 99 / 0 |
| Exploiter | **Stretch big** | **Ours** (D14): a big the Floor spacer rule catches. | A big who spaces the floor with spot-up threes. | The Floor spacer rule (with the make-rate floor), for a big. | Big AND spot_up_shooter ≥ Proficient. | 27 / 0 |
| Exploiter | **Rim finisher** | JKM Big Board (Mara) per research. Absorbs "Lob threat", "Roller", "Dunker spot mainstay". Renamed from "Play finisher" for rim-running bigs (D14). | Rolls, cuts and finishes at the rim. A lob threat. | Roll + cut share ≥ .25 AND restricted-area FGA ≥ 40% AND (big OR roll-man share ≥ .08). | max(vertical_spacer, pnr_finisher) ≥ Proficient. | 33 / 1 |
| Exploiter | **Glass eater** | JKM Big Board. | Scores off offensive rebounds and putbacks. | OREB% ≥ .10 AND putback/other share ≥ max(roll + cut share, .25). | offensive_rebounder ≥ Elite. | 9 / 1 |
| Exploiter | **Cutter** | JKM Big Board. | Scores by cutting to the rim off the ball. | Cut share ≥ .15, and not a big. | cutter ≥ Proficient. | 7 / 0 |
| Exploiter | **Connector** | JKM glossary ("Connector / universal donor") + Big Board. | Keeps the ball moving. Passes far more than he shoots. | AST%/USG ≥ 1.1 at usage ≤ .18, AND iso + PnR < .30. | passer ≥ Proficient (low-strength fallback). | 20 / 0 |
| Exploiter | **Play finisher** | JKM Big Board, forwards sense ("play finisher, at the rim or from 3"). Was "Advantage converter" (D14). | Finishes plays others create, at the rim or from three. No single diet stands out. | Fallback: iso + PnR < .30, 2+ of (spot-up, off-screen + handoff, roll + cut, transition, post-up) at 10%+ each, and no other diet at its own bar. | None (no tier rule). | 19 / 0 |
| — | *Empty State* | — | "Not enough 2025-26 data for an archetype" (D7). | No usable data and no Skill at Proficient+. All 14 are data gaps, not failed rules (asserted). | Never (0 Legends). | 14 / 0 |

**Tier lead (Legends and tiers-path actives):** (passer ≥ Elite AND pnr_ball_handler ≥ Elite), OR 2+ of
[isolation_scorer ≥ Proficient, pnr_ball_handler ≥ Proficient, off_dribble_shooter ≥ Elite, driver ≥ Elite,
low_post_player ≥ Elite, mid_post_player ≥ Elite], OR any of those six at All-Time Great.
**Ball door:** pnr_ball_handler ≥ Proficient, OR driver ≥ Elite, OR (isolation_scorer ≥ Proficient and not a big).

**Which path a Player takes:**

| Path | Who | Load ladder | Diet |
|---|---|---|---|
| Stats | Actives with a 2025-26 row and a usable play-type feed | Stats | Play-type + tracking diets |
| Stats load + tiers diet | Actives whose play-type feed is missing or unusable | Stats | Tracking shots for Pull-up shooter, Stretch big and Floor spacer at 12+ mpg; else the tier rules |
| Tiers | Legends; actives with no 2025-26 row or 0 games | Tier lead | Tier rules |

**Retired names (do not reuse):** Offensive hub → Primary creator. Primary scorer/facilitator →
Scorer/facilitator. Supplementary creator → merged into Secondary creator. Advantage converter → Play finisher.
Transition engine → dropped (it read team pace, D17; Ayo Dosunmu now reads Floor spacer, Quenton Jackson
Slasher). "Bucket getter" stays free for JKM's lather scorer (#135).

**Approved calibration (default c.13):**

- The numeric bars above (capacity .255, CLI 5.2 and the diet bars) implement D15. They stand as written and
  convert to per-100 rates in production (§9.3).
- One creation role and one catch-and-shoot role per Player (§4.1).
- Play finisher keeps its 4 guards (Anthony Black, Bruce Brown, Nique Clifford, Jase Richardson). The guard
  wording is revisited with #135.
- The taste edges stand as the rules give them: Giannis's second role is Traditional post player (1.27) over
  Slasher (1.26); "Rim finisher + Cutter" (Paul Reed, Murray-Boyles, Sochan, Gill) counts the cut share twice;
  Wembanyama, Siakam, Powell and active AD read Volume scorer in the exploiter family.

### 3.2 Defense: 5 core roles, Possession ender, 2 negatives, and a neutral chip

- **Skills read (post-#152 keys, D18):** `point_of_attack_defender`, `off_ball_disruptor`,
  `versatile_defender`, `rim_protector` (the four **core** Skills), and `rebounder` (Possession ender only).
- **Bar:** every positive core role needs its Skill at **Proficient or higher**. No bar drops for a second role.
- **Size (defense):** listed height and weight. *Big* = 6'10"+, or 6'8"+ at 240 lb+. *Guard* = 6'5" and under.
  *Wing* = everyone else. Listed position is never read. This is a classifier default, not a D17 ruling: the
  offense size rule does read listed position, and keeps it in V1 (decision g, §3.1).
- **Full read** = 1,000+ minutes and 30+ games in 2025-26. A **LOW read** is 500+ minutes that is not a full
  read (mostly 500-999 minutes; also 1,000+ minutes in under 30 games). **No read** is under 500 minutes.
  Total minutes = `box_score.min` × `box_score.gp` (games fall back to `metadata.games_played`). Every Legend
  reads `legend` (default c.5, §7).
- **Usable entry (default c.20).** An entry on `point_of_attack_defender`, `off_ball_disruptor` or
  `versatile_defender` is unusable for a label when its source is `flagged`, when it still has an open flag
  (`flagged` true and source not `resolved` or `manual_override`), or when `claude_tier` is null and source is
  not `resolved` or `manual_override` (only the stat rule set it, which D19 forbids as a label source). An
  unusable entry makes the defense end `pending_review`, with no main role and no second role. The #152 Snapshot
  draft does not publish while these three keys hold an open flag. Legend tiers are bare strings and are always
  usable.

| Kind | Label | Source | What it says (tooltip copy, c.19) | Tier rule | Main (+ second): actives / Legends (preview) |
|---|---|---|---|---|---|
| Core | **Anchor** | JKM verbatim: glossary "Primary defensive anchor"; Big Board role and badge. | Protects the rim: deters and blocks shots near the basket. | rim_protector ≥ Proficient, any size. | 35 (+4) / 11 (+2) |
| Core | **Assignment defender** | JKM Big Board verbatim (#3 Dybantsa). Covers the glossary's "tough-assignment big forward" and the "bendy Gumby strength" wing stopper. | A wing who stays in front of the ball and guards across positions, so he can take the other team's best scorer. | Wing size AND point_of_attack_defender ≥ Proficient AND versatile_defender ≥ Proficient. Strength = the higher of the two tiers. | 22 / 4 |
| Core | **Point-of-attack defender** | JKM glossary "Point-of-attack guy"; Big Board "Point of attack". "Defender" is ours (Mom Test). | Stays in front of the ball handler, fights over screens and pressures the ball at the top. | Guard or wing size (never big) AND point_of_attack_defender ≥ Proficient. | 32 (+6) / 5 (+1) |
| Core | **Switchable** | JKM verbatim: Big Board role and badge; glossary "Switch big / switchable defender". | Guards several positions and switches without giving up a mismatch. | versatile_defender ≥ Proficient, any size. For a big, this is his only perimeter role. | 29 (+18) / 7 (+6) |
| Core | **Off-ball disruptor** | JKM verbatim: Big Board role and badge; glossary "Weak-side disruptor". | Makes plays away from his own man: jumps passing lanes, digs at drivers, gets deflections and steals. | off_ball_disruptor ≥ Proficient, any size. Last in every tie, so it is main only when strictly above the other core tiers. | 38 (+24) / 4 (+10) |
| Rebounding | **Possession ender** | JKM Big Board verbatim (#11 Steinbach, "Helper, possession ender"). Chris reversed its drop: "a less important part of defense". | Ends the other team's possession by securing the defensive rebound. | rebounder ≥ Elite. Always ranks below every core role. | 5 (+4) / 2 (+10) |
| Negative | **Cone** (guard or wing) | **Ours** (Chris, D10). | Every core defensive Skill at None: no on-ball, off-ball, switching or rim skill. | Guard or wing size, full read, all four core Skills at None, AND point_of_attack_defender + off_ball_disruptor rated None and reviewed by Chris (D21). | 21 / 2 |
| Negative | **Defensive target** (big) | JKM glossary verbatim ("guy offenses hunt"). | A big with every core defensive Skill at None: no rim protection and no switching. | Big size, full read, all four core Skills at None, AND rim_protector + versatile_defender rated None and reviewed by Chris (D21). | 3 (+1) / 1 |
| Neutral | **Neutral Defender** | **Ours** (Chris, D20). Replaces JKM's "Helper". | No defensive Skill reaches a role bar, and none is rated a liability. | No defense role applies (no core role, no Possession ender, no negative; a negative that waits for review counts as a role, §4.3), AND a full read, OR a LOW read with at least one core Skill above None (thin-sample mark, default c.6). A Legend counts as a full read here (c.5). | 128 / 0 |
| — | *Empty State* | — | See §6. | No defense role applies AND no read (under 500 minutes, default c.6). | 88 / 0 |

- **Preview caution.** Defense counts rest on proxies until #152: `point_of_attack_defender` = today's reviewed
  `perimeter_disruptor` tier; `off_ball_disruptor` = steals + deflections per 36 percentile (Capable p56.8,
  Proficient p81.8, Elite p93.2, All-Time Great p99.3); `rim_protector` = a proposed, uncalibrated quality rule.
  Every Off-ball disruptor and every negative in the preview rests on a proxy or an unreviewed None.
- **Retired names:** Helper → Neutral Defender (D20). `perimeter_disruptor` → `point_of_attack_defender` +
  `off_ball_disruptor` (D18). Eraser was tested and dropped (it caught only two centers).

**Approved calibration (default c.13):**

- Assignment defender is wing-only. 16 of 32 Point-of-attack defenders hold the same two tiers and differ only by
  listed height (6'5" vs 6'6").
- The Anchor bar is Proficient (35 actives; 23 at Elite), with the tie order that changes at Elite (§4.2).
- The strict negative bar: a full read and all four core Skills at None, with the claim Skills Cone:
  `point_of_attack_defender` + `off_ball_disruptor` and Defensive target: `rim_protector` + `versatile_defender`
  (§4.3). A loose bar (claim Skills only) would give Cone 71 instead of 21.
- The Possession ender bar is `rebounder` Elite+, and "always below every core role" is the reading of "a less
  important part of defense".
- A defense second role reads a different Skill from the main role (§4.2).

---

## 4. Main role, second role, and tie-breaks (D22)

Each end has **one main role** and **at most one second role**. A second role shows only when it clears its
**own** bar. No bar drops for the second slot. The headline and the pair name use the main roles. The second role
is a smaller chip. The picker filter matches both.

### 4.1 Offense

1. **Main role.**
   1. The load rung comes first: Primary creator, then Fulcrum playmaker (a capacity center who passes), then
      Scorer/facilitator, then Volume scorer.
   2. With no load rung, the strongest diet wins.
      - **Family first:** a creator (either door of the Secondary creator gate) chooses only among creator
        roles plus the two playmaking roles (Fulcrum playmaker, Connector). Everyone else chooses among all roles.
      - Fulcrum playmaker and Connector have a fixed strength of 3.0, so they beat the shot diets.
      - A tie goes by list order: Fulcrum playmaker, Connector, Secondary creator, Pull-up shooter, Slasher,
        Traditional post player, Movement shooter, Stretch big, Floor spacer, Rim finisher, Glass eater, Cutter,
        Play finisher.
      - Tiers path order: Primary creator, Scorer/facilitator, Volume scorer, Fulcrum playmaker, Secondary
        creator, Pull-up shooter, Slasher, Traditional post player, Movement shooter, Stretch big, Floor spacer,
        Glass eater, Rim finisher, Cutter, Connector.
   3. An admin override can replace the main role (§7).
2. **Second role.** The strongest other role in his **pool**. The pool is every role whose own gate he clears.
   On the stats path that means strength ≥ 1 (asserted). On the tiers path it means that role's tier bar.
   Three kinds of role are skipped:
   - the main role itself;
   - any role in the main role's **group**, because it would say the same thing twice.
     - Creation group: Primary creator, Scorer/facilitator, Volume scorer, Secondary creator,
       Fulcrum playmaker, Connector.
     - Catch-and-shoot group: Movement shooter, Floor spacer, Stretch big.
     - Every other role is its own group.
   - Play finisher, because it means "no diet at its own bar". It is main-only.
3. No main role means no second role. The family filter applies to the main role only.

Examples: Luka = Primary creator + Pull-up shooter. Curry = Scorer/facilitator + Movement shooter.
Draymond = Connector + Floor spacer. Jokić = Primary creator + Traditional post player (not Fulcrum playmaker,
which is in his main role's group).

- A big who clears the Stretch big bar reads Stretch big before Play finisher (a #17 test). In the preview, Chet
  Holmgren and Jaren Jackson Jr. clear no diet bar and read Play finisher. The #17 build reports their real
  result for Chris.

### 4.2 Defense

1. **Rank every role he clears, once:**
   1. The five core roles, highest tier first. A tie goes by one list:
      - At Elite or higher: Anchor, Assignment defender, Point-of-attack defender, Switchable, Off-ball disruptor.
      - Below Elite: Assignment defender, Point-of-attack defender, Switchable, Anchor, Off-ball disruptor.
      - So a rim role leads a tie only at Elite+ (Wembanyama, Mobley: Anchor; a Proficient tie reads Switchable).
   2. Possession ender, always below every core role.
   3. The negative (Cone or Defensive target).
2. **Main role** = the first role in the ranking.
3. **Second role** = the next role in the ranking that reads a **different Skill**. D22 asks only that the second
   role clear its own bar; the different-Skill filter is a classifier default, approved as c.13.
   - Assignment defender reads both `point_of_attack_defender` and `versatile_defender`. So it never gets
     Point-of-attack defender or Switchable as a second role.
   - A negative reads all four core Skills, so no core role can sit next to it.
4. **Neutral Defender and the Empty State never have a second role.**

Examples: Draymond = Assignment defender + Anchor. Wembanyama and Mobley = Anchor + Switchable.
Jrue Holiday = Point-of-attack defender + Switchable. Hakeem (Legend) = Anchor + Possession ender.

- Derrick White reads Point-of-attack defender + Switchable, not Chris's example (Point-of-attack defender +
  Off-ball disruptor). His off-ball proxy sits just under the Capable cut (p56.3 vs p56.8). A synthetic test
  proves the POA + OBD shape works once #152 rates him Proficient+. The spec does not force his label.

### 4.3 Negatives

- **Bar:** a full read, all four core Skills at None, and the label's claim Skills rated None.
  - Cone claims `point_of_attack_defender` + `off_ball_disruptor`.
  - Defensive target claims `rim_protector` + `versatile_defender`.
- **Reviewed (D21):** each claim None must be a None that Chris reviewed himself. An auto-accepted None does not
  count. A missing tier or a null `final_tier` on a claim Skill is not a None. A gated None is no evidence
  either: the full-read bar and the marker below keep it out, so compositing stores no gate flag (default c.16).
  - **Marker (default c.3):** a None counts as reviewed only when its composite entry carries
    `human_reviewed: true`. Only the one-by-one resolve and the manual override write it. A bulk resolve removes
    it, the #152 split strips it from every carried Perimeter Disruptor entry (decision b), and no recompute adds
    it. Entries resolved before the marker shipped carry none, so they do not count.
- **Non-claim Skills (default c.17):** a negative needs all four core Skills at `'None'` by final tier, with all
  four entries present and usable (§3.2). The two claim Skills need a reviewed None. The two non-claim Skills may
  hold an auto-accepted None. A missing or unusable entry on any of the four blocks the negative and sets
  `pending_review`.
- **Rebounder is never read by the negative bar.** A rebound tier can never hide or create a negative.
- **Only partner:** Possession ender. It ranks above the negative, so both show
  (Drummond: Possession ender + Defensive target).
- **Chip:** the same neutral chip as every other role. No red (D7).
- **Today:** 25 active negatives in the preview (Cone 21, Defensive target 4). All rest on an unreviewed None,
  so **0 could show today** under D21. Each carries the tag "NEG pending review (D21)".
- **While a negative waits for review (default c.4):** the end never shows Neutral Defender in its place. Only the
  negative leaves the ranking. The main and second roles come from what remains (the Drummond shape reads
  Possession ender main), and `pending_review` is true. With no role left, the Profile shows a quiet visible
  line, "Defense label pending review" (not a chip), which also anchors the reason tooltip. A neutral chip on a
  likely negative is not an Honest Signifier.
- **Legends (default c.5):** the rules never give a Legend a negative. See §7.

### 4.4 Possession ender

- **Bar:** `rebounder` Elite or higher. Rebounder is a HIGH-confidence stats-only Skill and is trusted as rated.
  Its bar is never lowered.
- **Main** only when no core role clears its bar: Towns, Jokić, Sabonis, DeAndre Jordan, Drummond; Legends Magic
  and Karl Malone.
- **Second** only when no other core role is left: for example Kareem, Duncan, Hakeem, Wilt, Shaq (Legends);
  Robert Williams, Nurkić, Mitchell Robinson, Tatum.
- Like every positive role, it can show on a low read (Sabonis on a LOW read, DeAndre Jordan with 12 games).
- **It can never hide a negative.** A test re-randomizes every rebounder tier. Only Possession ender and
  Neutral Defender move. No core role and no negative moves.

### 4.5 Neutral Defender (D20)

- Shows only when **no defense role applies**, main or second. On a **full read**, that alone is enough. A defense
  role here means any core role, Possession ender, or a negative.
- It also implies `rebounder` below Elite (asserted per row). An exhaustive sweep of every tier combination
  (5⁵ tiers × 3 sizes) checks that, on a full read, Neutral Defender appears exactly when the ranking is empty.
- **A negative that waits for review is not an empty ranking (default c.4).** Its end reads `pending_review`
  and shows the pending line (§4.3, §6), never Neutral Defender.
- **Below a full read (default c.6).** On a LOW read (§3.2), a no-role Player reads Neutral Defender with the
  thin-sample mark only when at least one core Skill is above None. With all four core Skills at None, he gets
  `pending_review` instead (§4.3). With no read (under 500 minutes) and no role, he gets the Empty State, not
  Neutral Defender. This keeps D23's veto of a full-read gate and never puts a neutral chip on a likely Cone.
- **Legends (default c.5):** a Legend counts as a full read here, and only here.
- The preview's why-line names his nearest core Skill (Luka: "nearest off_ball_disruptor Capable"). That is a
  preview default for the why-line (Q22), not chip copy; the chip reads "Neutral Defender" (D20).
- It never has a second role.

---

## 5. Pair names (D23, D24)

A pair name is a barbershop name (D4) for a common pair of **main** roles, one per end (D22). Second roles never
make a pair name. No two rows share an (offense main, defense main) pair, so a Player gets at most one name; the
classifier asserts it. (The shooter mains sit in two rows, 3-and-D Wing and 3-and-D Guard, and the defense main
decides which. A main pair that no row lists gets no name.)
Member lists come from `.tasks/119-3d-archetypes/research/pair-names.json` (local, gitignored), with the D23 and
D24 changes applied.

| Pair name | Offense main | Defense main | Preview: actives / Legends |
|---|---|---|---|
| **3-and-D Wing** | Floor spacer or Movement shooter | Assignment defender or Switchable | 18 / 0 |
| **3-and-D Guard** | Floor spacer or Movement shooter | Point-of-attack defender | 12 / 0 |
| **3-and-D Big** | Stretch big | Anchor or Switchable | 9 / 0 |
| **Lob-and-Block Big** | Rim finisher | Anchor | 15 / 1 |
| **Two-Way Creator** | Secondary creator | Point-of-attack defender, Assignment defender or Switchable | 21 / 1 |
| **Two-Way Star** | Primary creator, Scorer/facilitator or Volume scorer | Assignment defender, Point-of-attack defender, Switchable or Anchor | 13 / 23 |
| **Glue Guy** | Connector | Anchor, Assignment defender, Point-of-attack defender or Switchable | 9 / 0 |

- **Ladder (D24):** 3-and-D (shoots + defends) · Two-Way Creator (creates + defends) · Two-Way Star (carries the
  offense + defends) · Lob-and-Block Big · Glue Guy.
- **Merges:** Two-Way Guard and Two-Way Wing → **Two-Way Creator** (D24). Two-Way Big → **Two-Way Star** (D23).
  Size words stay only on the 3-and-D names and Lob-and-Block Big.
- **No name** for an Off-ball disruptor main, a negative main (Cone, Defensive target), Neutral Defender, or the
  Empty State (D23). The two roles are the headline instead (Q21).
- **No name for a Possession ender main (default c.7).** Possession ender returned after the pair-name research,
  so no row covers it. Jokić, Magic, Sabonis and Towns read their two roles as the headline.
- **No full-read gate (D23).** Chris vetoed it. The name shows whenever both main roles qualify, on thin samples
  and on manually edited Skill tiers. The thin-sample mark (D7) carries the uncertainty.
- **Loose size words are accepted (D23).** The size word follows the role, not the size rule (Isaac Okoro reads
  3-and-D Wing at guard size; Ronald Holland II reads 3-and-D Guard at wing size).
- **The "3" rests on the make-rate floor (D23, §3.1).** The preview counts above do not apply it yet.
- **Preview totals:** 97 of 401 actives, 25 of 36 Legends. Legend names are preview only until the #152 Legend
  pass sets their defense labels.
- **Anchors:** OG Anunoby, Mikal Bridges = 3-and-D Wing. Porziņģis (override) = 3-and-D Big. Gobert, Mobley =
  Lob-and-Block Big. Jrue Holiday, Derrick White, Scottie Barnes = Two-Way Creator. SGA, Giannis, Wembanyama =
  Two-Way Star. Draymond = Glue Guy. Luka, Jokić, Curry = no name.

---

## 6. Display guidance (D7, D20, D22)

Exact layout comes from `/sketch` in the #17 display milestone (moved from the plan stage), then `/impeccable`.

- **Where (Q20):**
  - [Profile](../LEXICON.md) and [Panel](../LEXICON.md) [PlayerViews](../LEXICON.md).
  - Under the [Player Shape](../LEXICON.md) in the Build page's live feedback panel (`BuilderFeedbackPanel.tsx`).
  - Final Eval (decision a, reopens D7): a hover/tap tooltip on each Final Eval player slot, with the headline and
    the roles. Final Eval renders only the Team Shape, the Contribution Overlay chips and a row of headshots, and
    its 56-72 px name slots hold no visible label text. A small visible Signifier on each slot shows that the
    tooltip is there (its form comes from the `/sketch` pass). Final Eval gets no per-player Player Shape.
  - [Card](../LEXICON.md) and [Row](../LEXICON.md): no label.
- **Build picker:** an archetype **filter** ("find me a 3-and-D Wing"), not a column. A role filter matches the
  main role and the second role (D22). A pair-name filter matches the pair name, which reads main roles only.
- **Headline (Q21):** the pair name when the Player has one, with both main roles under it. No pair name: the two
  main roles are the headline. Second roles are smaller chips (D22).
- **Why-line (Q22):** tap or hover a label to see the 2-3 signals behind it.
  - Offense stats path: the signals that cleared the bar (for example usage, CLI, AST%).
  - Defense: the Skill tiers that set the role (D19: tiers set the label).
- **Empty State:** a no-data Player gets no label and one quiet Profile line:
  "Not enough 2025-26 data for an archetype." Per-end copy is decided at the `/sketch` pass (§10).
- **Pending review (default c.4):** a defense end that waits for review and has no role left shows no defense
  chip. The Profile shows the quiet visible line "Defense label pending review" (not a chip), which also anchors
  the reason tooltip.
- **Copy (default c.19):** the §3 "What it says" lines ship as the role tooltips. Three glosses:
  - Possession ender: "Ends the other team's possession by securing the defensive rebound."
  - Assignment defender: "Can take the other team's best scorer."
  - Primary creator: "Carries his own scoring load, and creates for others."
  - Chris can change any of them at the `/sketch` pass.
- **Thin-sample mark:** a thin-sample or tiers-only label gets a small mark. The Player keeps the label.
  - Offense flags: LOW (under 25 games, no 2025-26 row, 0 games, or an unusable play-type feed) and PARTIAL
    (the play-type feed misses part of his possessions). After the traded-Player merge (§9.3), a traded Player's
    merged feed is not PARTIAL.
  - Defense flags: LOW read and no read (§3.2).
- **Neutral chips:** Cone and Defensive target use the same neutral chip as every role. No red.
  Neutral Defender is a chip (D20), shown only when no defense role applies.
- **Quotes (from the grill):** display ~5-6 h, picker filter ~2-3 h, why-line ~3-4 h.
- **FAQ credit (D11):** "Role names borrow J. Kyle Mann's (The Ringer) scouting vocabulary."

---

## 7. Legends

- **Same rules (D5).** Legends run the tiers path on their curated Skill tiers. Every Legend gets an offense
  label (0 Empty States in the preview).
- **Legend defense (default c.5, reopens D5).** On the Legend scale, a None means "not notable", not "a
  liability". So the rules never give a Legend Cone or Defensive target. Only an explicit curated liability can:
  Chris sets it through the admin label override on the Legend editor (preview: Nash Cone, Harden Cone, Dirk
  Defensive target; each needs his override if he wants it). Legends have no minutes, so a Legend counts as a full read
  for Neutral Defender only. A Legend whose ranking is empty, or held only the suppressed negative, reads Neutral
  Defender. So every Legend has a defense main role.
- **Admin override (D5, D16).** The admin legends editor gets a manual label override. It mirrors the
  admin-accept pattern for Claude legend suggestions. Chris reviews the 36 Legend labels once through it
  (D16). No tier re-curation to move a label (D16).
- **An override replaces the main role only.** The second role still comes from the rules, recomputed against
  the override main, with the same filters as §4: on offense, not the override main and not in its group
  (§4.1); on defense (Legends only), the next ranked role that reads a different Skill (§4.2). So Porziņģis
  (override Stretch big) reads Stretch big + Volume scorer. The pair name uses the final mains. The
  row records `source: "override"` and the rules' own answer (`rule_main`).
- **Where overrides live (default c.10).** Legend overrides sit on the Legend editor and cover both ends. Active
  overrides sit on the admin player page (`/admin/players/<id>`) and cover offense only: a `defense` override
  returns 400 `defense_override_not_allowed`, because an active's defense label must come from reviewed tiers
  (D19, D21). Overrides are stored on `legends.archetype_override` and `players.archetype_override`, written in
  an open Snapshot draft, and frozen into each Snapshot Release at its next publish.
- **Karl Malone's defense (default c.13).** He reads Possession ender only, because no Skill carries post
  defense. Chris sets Switchable through the Legend override if he wants it (D16: no tier re-curation). The
  `versatile_defender` Claude guidance gains "includes defending bigs in the post".
- **Override list (approved 2026-09-21; Chris sets each one in the #17 build, c.10):**

  | Player | Override (main) | Rules say | Why |
  |---|---|---|---|
  | Michael Jordan (Legend) | Primary creator | Scorer/facilitator | His curated passer tier (Capable) keeps him off the top rung. |
  | Anthony Davis (Legend) | Volume scorer | Rim finisher | A Legend is never below his own active season (active AD = Volume scorer). |
  | Dejounte Murray (active) | Secondary creator | Primary creator | 14 post-Achilles games on a thin roster; CLI mostly from time of possession. |
  | Kristaps Porziņģis (active) | Stretch big | Volume scorer | Capacity at exactly the 24.0-mpg floor with a .00 iso + PnR share. His second role reads Volume scorer. |

- **Legend defense labels wait for the #152 Legend pass.** Until that pass sets both new keys, every legend
  guard ties `point_of_attack_defender` = `off_ball_disruptor`. The preview uses a 6-Legend stand-in split
  (Iverson, Curry, Westbrook, Isiah Thomas, Kobe, McGrady). It is not for release.
- **Legend twins:** a Legend's offense rung sits at or above his own 2025-26 active rung (asserted). The ledger
  states this for Anthony Davis only; the preview asserts it for every twin (a generalization, veto open).
- **Second roles:** all 36 Legends get a second offense role and 29 get a second defense role (actives: 136 and
  57 of 401). The tier bars are the Legends' own bars, so this follows the rule. The rate stands as the rules
  give it (default c.13).

---

## 8. Player Archetype vs Lineup archetype vs Versatility

Three different things share the word "archetype". Keep them apart in code, copy and conversation.

| | Player Archetype (this spec) | Lineup archetype (existing) | [Versatility](../LEXICON.md) (existing) |
|---|---|---|---|
| Unit | One [Player](../LEXICON.md) | One [Lineup](../LEXICON.md) (5 Players) | One [Rotation](../LEXICON.md) or larger [Team](../LEXICON.md) |
| Question it answers | What can this Player do, on each end? | What style does this five play? | How many viable styles can this Rotation play? |
| Input | The Player's own Skill tiers and league stat rates | The Lineup's [Subscores](../LEXICON.md) | The Lineup archetypes of viable [Lineup Combinations](../LEXICON.md) |
| Output | Offense main + second; defense main + second | Up to 3 labels from `ARCHETYPE_LABELS` (offensive, defensive, transition, balanced, paint, shooting), picked from the strongest mapped Subscores | One 0-1 score, backend key `archetype_diversity` |
| Code today | New (#17) | `SUBSCORE_ARCHETYPES` + `_archetypes_for_lineup` (`cohesion_engine/roster.py`); `archetype_labels` / `archetype_details` in API responses | `_star_breakdown` in `cohesion_engine/roster.py`; a roster rollup weight in `weights.py` |
| Changes a score? | No. Never enters `overall` or price. | Feeds Versatility and the team narrative | Yes: 20% of the Rotation rollup (`ROSTER_ROLLUP_WEIGHTS`), 10% for a lone Lineup |

- **Visual identity:** the Player Shape is "the visual identity of a Player Archetype" (Lexicon). The label sits
  under the Build page's Player Shape; Final Eval has no per-player Player Shape, so its player slots get a
  tooltip (decision a, §6). The [Team Shape](../LEXICON.md) stays a Team-level glyph.
- **No link today.** Player Archetypes are not an input to Lineup archetypes or Versatility. A future link is a
  new decision.
- **Naming collisions to avoid:** `archetype_labels`, `archetype_details`, `archetype_diversity`,
  `ARCHETYPE_LABELS` (`weights.py`), `OPPORTUNITY_ARCHETYPES` (`notes.py`), `_ARCHETYPE_BANDS`
  (`bell_curve.py`; it also names `perimeter_disruptor`, which #152 retires). The Player Archetype code key
  differs from all of these: the API field is `player_archetype`, role keys carry an `off_` or `def_` prefix
  (`def_anchor`), and pair keys a `pair_` prefix (`pair_3d_wing`).
- **"Anchor" has four meanings already.** The Lexicon lists Anchor as an Impact Trait example and `anchor` as a
  Subscore example (code key `anchor_total`); calibration uses "anchor players" (`Anchor`, `/api/anchors`, and
  Appendix A's "anchor" list); `frontend/lib/noteFilters.ts` has an `anchor` key. The defense role **Anchor** is
  a fifth. The role's code key is `def_anchor`, and the Lexicon (`LEXICON.md`, Relationships) says which Anchor
  it means.
- **Skill labels vs role labels.** The new Skills show as "Point of Attack Defender" and "Off-Ball Disruptor"
  (default c.9). The defense roles are **Point-of-attack defender** and **Off-ball disruptor**. A why-line names
  the Skill label; a chip names the role label. Do not swap them.
- **"Defensive versatility"** collides with Versatility. For a Player, say **Switchable** (the role) or
  `versatile_defender` (the Skill).
- **Traits and team concepts** ([#135](https://github.com/chrooks/Cornerstone/issues/135)) are a third thing.
  Team concepts are Lineup-level and belong in GM Notes, apart from both tables above.

---

## 9. Dependencies, sequencing, and the #17 build brief

### 9.1 Dependencies

| Issue | Why the archetypes need it |
|---|---|
| [#134 Matchup fetch sends the wrong params](https://github.com/chrooks/Cornerstone/issues/134) | Every active's `matchup_defense` blob is the league total. The `versatile_defender` stat input and the future on-ball rule read it. |
| [#154 "Trust All Claude" nulls stats-only tiers](https://github.com/chrooks/Cornerstone/issues/154) | A null written as "resolved" can read as a reviewed None: a no-data path to a negative. Must land before any review queue. |
| [#152 Perimeter Disruptor split](https://github.com/chrooks/Cornerstone/issues/152) | Creates `point_of_attack_defender` and `off_ball_disruptor`, runs the review and the Legend pass. Defense labels are final only after it (D19). |
| [#130 Recompute drifted Skill tiers](https://github.com/chrooks/Cornerstone/issues/130) | HIGH-only recompute in the same Snapshot draft as #152. Also carries the Lillard `passer = None` data defect. |
| [#153 3-season usage blend](https://github.com/chrooks/Cornerstone/issues/153) | Post-launch. The portable fix for the one-direction usage bias (LeBron, Reaves, Jalen Williams sit at the capacity bar). Labels get recomputed and diffed after it. |
| [#135 Archetype traits and team-fit concepts](https://github.com/chrooks/Cornerstone/issues/135) | Post-launch. Traits, team concepts, and JKM's "Chaser" (no data measures screen navigation). |

### 9.2 Sequencing (the approved plan's milestones)

0. This spec → `docs/` (closes #15).
1. #154 + #134, plus the #17 fetch fixes that ride the one stats refetch (traded-Player merge, pace and
   possessions, prior-season 3-point data).
2. Skill-scoped Claude run + per-Skill bulk review.
3. #152 split + Evaluation Version publish.
4. Legend-ceiling engine fix ([#119](https://github.com/chrooks/Cornerstone/issues/119)).
5. One dev Snapshot draft: #130 HIGH-only recompute + new Skills + Chris's review + Legend pass → publish.
6. #119 Ringer 100 re-measure (+ pair-as-peak fallback). "Pair-as-peak" is a composite-level engine fallback
   for #119 (D6). It is not a §5 pair name and never reads a Player Archetype label (labels never enter `overall`).
7. Archetype engine + label override ([#17](https://github.com/chrooks/Cornerstone/issues/17) backend), then a
   second, archetype-only dev publish that freezes the labels and overrides with identical Skill tiers
   (default c.11: override writes need an open Snapshot draft).
8. Archetype display: `/sketch` → `/impeccable` → build.

### 9.3 Implementation notes logged in the ledger

- **Per-100 rates, not per-36.** Pace rides along in per-36 rates. The per-36 bars in §3.1 must be converted;
  re-check the anchors after the change. Rates use the Player's own `advanced.poss`. Each bar converts as
  b100 = b36 × 100 / P36, where P36 is the rotation pool's median possessions per 36 minutes; keep the per-36
  origin in a code comment. The classifier never reads `advanced.pace` (team context, D17).
- **Merge traded Players' Synergy rows.** NBA.com splits a traded Player's play types by team, and the pipeline
  keeps one row. Merge the per-team rows (GP-weighted) in `_df_to_player_dict`
  (`backend/services/nba_api_client.py`). Today 14 split feeds carry a PARTIAL flag, and 29 of 43 multi-team
  diet labels mix stints without a flag.
- **Stats window (retired, default c.21).** The preview counted per-team games to 2026-04-12 against a stats
  Snapshot that ends about 2026-04-05. The traded-Player merge plus the one full-season refetch put every stint's
  games inside the one final stats window, so this note no longer applies.
- **Minutes floors are disclosed (default c.21):** 24 mpg (load ladder), 20 mpg (rotation pool), 12 mpg
  (tracking-shot diets). They are disclosed here and in the offense why-line whenever a floor decides the role.
- **Assert Chris's six** (Luka, Jokić, SGA, Brunson, Trae Young, Cade) are Primary creator by the rules, with no
  override.
- **Rated-None definition** (#152 contract, defaults c.3 and c.16). A tier counts as a reviewed None only when
  `final_tier == 'None'` (the string, never a null) and the composite entry carries `human_reviewed: true`
  (§4.3). A missing key is not a None. Enforce the string check and the marker inside the classifier, not only
  in prose; never reuse a helper that treats `'None'` as unrated. Compositing does not copy `volume_gate_passed`
  and `data_missing` onto the composite entry: a negative needs a full read, which excludes the gated samples,
  and each claim None must be one Chris resolved himself.
- **Bulk-resolve guard** (#152 contract, #154, defaults c.1 and c.2). A bulk resolve blocks only `trust_stats`
  on the defensive keys (`point_of_attack_defender`, `off_ball_disruptor`, `versatile_defender`); a bulk
  `trust_stats` would copy a deployment prior into a tier a label reads. Bulk `trust_claude` stays allowed,
  because Claude's informed rating is the D19 source. The new per-Skill bulk action skips
  `human_decision_contradicted:*` flags, skips a flag that would write `'None'` for a Player whose four core
  defensive Skills are all `'None'`, and with `agreements_only` resolves only flags whose stat and Claude tiers
  match. Skipped flags need a one-by-one look. #154 blocks any resolve that writes `final_tier: null`.
- **Rim rule calibration** (#152 contract; parked post-launch, default c.18). The proposed `rim_protector`
  quality rule (rim FG% vs expected + BLK%, 150-FGA season sample floor, no per-game rim volume) is
  uncalibrated. It moves to [#157](https://github.com/chrooks/Cornerstone/issues/157), with the re-check of the
  36 manual-override rim tiers against it (8 disagree, for example Mitchell Robinson Capable vs Elite). The rim
  vs-expected stat is not in the `player_stats` blob today, so that work needs its own stats refetch. V1 Anchor
  labels read the existing `rim_protector` tier, which the #130 recompute refreshes and Chris reviews.
- **`versatile_defender`** keeps `always_flag_for_review`. Its sample column (`vd_poss`) reads the broken
  matchup data until #134. Its Claude guidance gains "includes defending bigs in the post" (default c.13).
- **Claude prompt for the defensive keys** (research): "rate what he can do on the ball if asked, not who his
  coach assigns."
- **Make-rate floor source (D23, decision d).** Career 3P% must come from a stored row: the prior-season
  `shooting_history.prior_fg3m` and `prior_fg3a` that the one refetch writes into the stats blob (§3.1).
  `players_service.get_or_fetch_career` fetches from NBA.com and inserts on a cache miss; the classifier and the
  publish freeze must never call it (the 2026-09-21 incident).

### 9.4 #17 build brief (AFK-ready inputs)

- **Seams (Q28 → A):**
  1. The archetype classifier as a pure function. pytest with named anchor Players (Appendix A).
  2. A repo Ringer 100 check against the published dev release (the #119 proof).
  3. The Lab and the admin review on https://cornerstone-dev.hestia.chrooks.com, driven headless.
- **Input:** one [Snapshot Player](../LEXICON.md): its stats blob, its [Skill Profile](../LEXICON.md) with tier
  sources, height, weight, listed position, `is_legend`, and any admin override.
- **Frozen output per Player (the approved plan's Contract):** `released_players.archetype_snapshot` holds
  `computed`, `rules_version`, `pair` (a pair key or null) and two ends. `offense` = `main`, `second`,
  `rule_main`, `source` (`rules` or `override`), `family` (`creator` or `exploiter`), `path` (`stats`,
  `stats_tiers` or `tiers`), `why`, `why_second`, `mark` (null, `low`, `partial` or `tiers_only`) and
  `empty_reason`. `defense` = `main`, `second`, `rule_main`, `source`, `read` (`full`, `low`, `none` or
  `legend`), `pending_review`, `why`, `why_second` and `empty_reason`. Roles are stored as keys (`def_anchor`).
- **API shape:** `player_archetype` = `pair_name`, `offense {main, second, empty_reason}`,
  `defense {main, second, empty_reason, pending_review}` and `mark` (display text or null). Each role is
  `{key, label, why, is_override}`. The key is omitted when the release has no archetype for that row.
- **Compute and store per Snapshot Release:** frozen into `released_players.archetype_snapshot` (jsonb) at publish
  by a never-block post-publish step (not on reactivate), not held in an in-memory cache. Stats and overrides are
  mutable, and Saved Teams keep their labels.
- **Invariants to test** (all proven in the preview classifiers):
  - Offense: the second role is never the main role, never from the main role's group, never Play finisher;
    it clears its own gate (strength ≥ 1 on the stats path); it is the strongest eligible role; only override
    rows differ from the rules; no label reads team data; "Transition engine" and "Primary scorer/facilitator"
    never appear; Volume scorer's family follows his diet.
  - Defense: 30 synthetic cases (including the Drummond, White and Draymond shapes); the exhaustive 5⁵ × 3 tier
    sweep; a negative is never hidden and its only partner is Possession ender; Neutral Defender only with no
    role, on a full read or under the thin-read rule (c.6); re-randomizing rebounder moves only Possession ender
    and Neutral Defender; re-randomizing deployment moves no label.
  - Cross-end: no end borrows the other end's labels; every Legend has both ends.
  - Pair names: at most one per Player; main roles only; never on Off-ball disruptor, a negative, Neutral
    Defender or the Empty State; no full-read gate (D23).
- **Preview code to port:** `docs/research/119/` — `offense.py`, `defense.py`, `tiers.py` (the loader that
  `defense.py` imports), `archetypes.py` and `pairnames.py`. They are research prototypes, a port reference only,
  not imported by the app. They do not run from `docs/`: their data inputs and the `roles2` loader that
  `tiers.py` imports are not committed, so the port rebuilds its inputs from the database. Never port the
  preview's proxy code (the `off_ball_disruptor` percentile proxy, the stand-in Legend split, the rim rule).
- **Display:** §6, after `/sketch`.

---

## 10. Open items

The plan approval (2026-09-21) settled the draft's items 1-28. Each decided rule now sits in the section it
governs. Only these stay open.

The plan still cites the draft's item numbers. They now live here: 1 → §4.3 and §6 (c.4); 2 → §3.2 usable entry
(c.20); 3 → §7 (c.5); 4 → §3.1 (D13); 5 → §4.1 and §4.2; 6, 7 → §7; 8 → §6 copy (c.19); 9, 10, 16 → §3.1
approved calibration; 11 → items 1-4 below; 12 → §3.1 size (decision g); 13-15, 25 → §3.2 approved calibration;
17 → §2.2; 18 → the #15 table at the top; 19 → §4.1; 20 → §7 (c.10); 21 → §8 and §9.4; 22 → items 8-9 below;
23 → §5 (c.7); 24 → §4.5 (c.6); 26 → §3.1 (decision d) and item 7 below; 27 → §9.4; 28 → done in the throughline.

**Display details, for Chris at the `/sketch` pass (#17 display milestone)**

1. Per-end Empty State copy (76 actives have an offense label but no defense label, 2 the reverse, 12 neither).
2. Whether a PARTIAL feed gets the thin-sample mark, and whether a Legend (always tiers) gets the tiers-only mark.
3. Whether an override shows as an override.
4. Whether the Panel shows second-role chips (default: yes, smaller). While a picker filter is active, at least
   the chip that matched it shows.
5. The pending-review line copy (default: "Defense label pending review", §6).
6. Any change to the tooltip copy and glosses (§6).

**Checks that wait for data (results, not decisions)**

7. The make-rate floor value, then a re-run of the shooter roles and the §5 counts with it (§3.1, #17 build).
8. After the #152 review: Derrick White's off-ball tier; the 24 of 57 active defense second roles that are
   Off-ball disruptor (all proxy today); Chet Holmgren's and Jaren Jackson Jr.'s real offense result (§4.1).
9. The #152 Legend pass: the Legend curation questions (Dirk, Wade, KG, Bird, Barkley, McGrady). The re-check
   of the 8 manual-override rim tiers moved to #157 with the rim rule (§9.3).

---

## Appendix A. Anchor table (preview, 2026-09-21)

Use as the pytest anchor list. Defense rows rest on the #152 proxies, so defense values will move after #152.
A row noted "NEG pending review" shows the negative the rules give once Chris reviews its claim Nones. Until
then the negative leaves the ranking and the end reads `pending_review` (§4.3): Drummond reads Possession ender
with no second role; Brunson, Sengun and Herro show the pending line. Legend rows 38 and 39 are preview only (§7).

| # | Player | Offense main (+ second) | Defense main (+ second) | Pair name (§5) | Note |
|---|---|---|---|---|---|
| 1 | Derrick White | Secondary creator (+ Pull-up shooter) | Point-of-attack defender (+ Switchable) | Two-Way Creator | OBD proxy None (p56.3 vs Capable cut p56.8) |
| 2 | Andre Drummond | Glass eater (+ Rim finisher) | Possession ender (+ Defensive target) | — | NEG pending review (D21): rim_protector |
| 3 | Nikola Jokić | Primary creator (+ Traditional post player) | Possession ender | — | |
| 4 | Karl-Anthony Towns | Play finisher | Possession ender | — | |
| 5 | Draymond Green | Connector (+ Floor spacer) | Assignment defender (+ Anchor) | Glue Guy | |
| 6 | Giannis Antetokounmpo | Primary creator (+ Traditional post player) | Switchable | Two-Way Star | post 1.27 vs Slasher 1.26 |
| 7 | Victor Wembanyama | Volume scorer | Anchor (+ Switchable) | Two-Way Star | family exploiter |
| 8 | OG Anunoby | Floor spacer | Assignment defender | 3-and-D Wing | |
| 9 | Scottie Barnes | Secondary creator | Assignment defender (+ Off-ball disruptor) | Two-Way Creator | |
| 10 | Evan Mobley | Rim finisher | Anchor (+ Switchable) | Lob-and-Block Big | |
| 11 | Luka Dončić | Primary creator (+ Pull-up shooter) | Neutral Defender | — | |
| 12 | Jalen Brunson | Primary creator (+ Pull-up shooter) | Cone | — | NEG pending review (D21): POA + OBD |
| 13 | Stephen Curry | Scorer/facilitator (+ Movement shooter) | Neutral Defender | — | |
| 14 | LeBron James | Scorer/facilitator | Neutral Defender | — | |
| 15 | Shai Gilgeous-Alexander | Primary creator (+ Pull-up shooter) | Point-of-attack defender | Two-Way Star | |
| 16 | Cade Cunningham | Primary creator (+ Pull-up shooter) | Assignment defender | Two-Way Star | |
| 17 | Trae Young | Primary creator (+ Pull-up shooter) | Empty State | — | no read |
| 18 | Anthony Edwards | Volume scorer (+ Pull-up shooter) | Point-of-attack defender | Two-Way Star | family creator |
| 19 | Kristaps Porziņģis | Stretch big (+ Volume scorer) | Anchor | 3-and-D Big | override; rules say Volume scorer; LOW read |
| 20 | Dejounte Murray | Secondary creator (+ Pull-up shooter) | Point-of-attack defender | Two-Way Creator | override; rules say Primary creator; no read |
| 21 | Lauri Markkanen | Volume scorer (+ Movement shooter) | Neutral Defender | — | family exploiter |
| 22 | Michael Porter Jr. | Volume scorer (+ Movement shooter) | Neutral Defender | — | family exploiter |
| 23 | Rudy Gobert | Rim finisher | Anchor | Lob-and-Block Big | |
| 24 | Bam Adebayo | Play finisher | Switchable | — | |
| 25 | Alperen Sengun | Fulcrum playmaker (+ Traditional post player) | Defensive target | — | NEG pending review (D21): rim_protector |
| 26 | Jrue Holiday | Secondary creator (+ Pull-up shooter) | Point-of-attack defender (+ Switchable) | Two-Way Creator | |
| 27 | Mikal Bridges | Floor spacer | Assignment defender | 3-and-D Wing | |
| 28 | Josh Hart | Connector | Neutral Defender | — | |
| 29 | Chet Holmgren | Play finisher | Anchor (+ Switchable) | — | |
| 30 | Domantas Sabonis | Fulcrum playmaker (+ Rim finisher) | Possession ender | — | LOW read |
| 31 | Anthony Davis | Volume scorer (+ Rim finisher) | Anchor | Two-Way Star | family exploiter; LOW read |
| 32 | Tyler Herro | Pull-up shooter | Cone | — | NEG pending review (D21): POA + OBD |
| 33 | Michael Jordan (Legend) | Primary creator (+ Slasher) | Assignment defender (+ Off-ball disruptor) | Two-Way Star | override; rules say Scorer/facilitator |
| 34 | Anthony Davis (Legend) | Volume scorer (+ Rim finisher) | Anchor (+ Switchable) | Two-Way Star | override; rules say Rim finisher |
| 35 | Magic Johnson (Legend) | Primary creator (+ Slasher) | Possession ender | — | |
| 36 | Kobe Bryant (Legend) | Primary creator (+ Pull-up shooter) | Assignment defender (+ Off-ball disruptor) | Two-Way Star | stand-in Legend split |
| 37 | Hakeem Olajuwon (Legend) | Scorer/facilitator (+ Traditional post player) | Anchor (+ Possession ender) | Two-Way Star | |
| 38 | Dirk Nowitzki (Legend) | Scorer/facilitator (+ Pull-up shooter) | Defensive target | — | Preview only: the rules now give Neutral Defender unless Chris sets a curated liability (§7, c.5) |
| 39 | Steve Nash (Legend) | Primary creator (+ Movement shooter) | Cone | — | Preview only: the rules now give Neutral Defender unless Chris sets a curated liability (§7, c.5) |
| 40 | Karl Malone (Legend) | Scorer/facilitator (+ Rim finisher) | Possession ender | — | Switchable only through Chris's Legend override (§7) |

## Appendix B. Preview counts (2026-09-21)

- **Actives (401):** second offense role 136; second defense role 57; a second role on both ends 23.
  Possession ender 9 (main 5, second 4). Neutral Defender 128. Defense Empty State 88. Offense Empty State 14.
  Negatives 25 (Cone 21, Defensive target 4); showable today under D21: 0.
- **Legends (36):** second offense role 36; second defense role 29; both ends 29. Possession ender 12 (main 2,
  second 10). Neutral Defender 0. Empty State 0 on either end.
- **Offense second roles (actives):** Pull-up shooter 45, Floor spacer 29, Rim finisher 15, Cutter 10,
  Movement shooter 9, Secondary creator 7, Slasher 6, Glass eater 6, Stretch big 4, Traditional post player 4,
  Volume scorer 1.
- **Defense second roles (actives):** Off-ball disruptor 24, Switchable 18, Point-of-attack defender 6,
  Possession ender 4, Anchor 4, Defensive target 1.
- **Offense confidence (actives):** ok 329, LOW 51, PARTIAL 19, override 2.
  **Defense read (actives):** full read 278 (25 of them negatives pending review), LOW read 73, no read 50.

## Changelog

- **2026-09-21, review against the approved plan.**
  - Header: decision (a) and c.5 win over the ledger lines they reopen (D7, D5).
  - §2.2: Point-of-attack defender keeps origin JKM in code.
  - §3.1: the make-rate floor reads only the two stored fields; no stored history means the season alone.
  - §3.2, §4.5, §6: LOW read defined (500+ minutes, not a full read), which closes the 1,000-minute,
    under-30-game gap; a negative that waits for review is never an empty ranking (c.4).
  - §3.2: Legend tiers are always usable. §4.3, §9.3: gated Nones are kept out by the full read and the marker,
    not a gate flag (c.16).
  - §5: fixed "each offense main belongs to at most one row" (the shooter mains sit in two rows).
  - §6: the Final Eval slot gets a small Signifier; a merged traded feed is not PARTIAL.
  - §7: an override's second role is recomputed against the override main.
  - §8: Anchor is also a Subscore example (`anchor_total`); Skill labels vs role labels (c.9).
  - §9.2: the refetch fixes and the second, archetype-only publish (c.11). §9.3: the per-100 conversion.
    §9.4: the frozen and API shapes from the plan; the prototypes do not run from `docs/`.
  - §10: a map from the draft's item numbers, which the plan cites. Appendix A: what a pending row shows.
- **2026-09-21, approval.** Chris approved the #119 ExecPlan with every recommendation: decisions (a)-(g) and
  defaults c.1-c.21. The spec moved from `.tasks/` into `docs/`.
  - Header: Status is Approved; new "Approval decisions" line. Lexicon links point at the repository
    `LEXICON.md`; global Lexicon terms are plain words; `.tasks/` paths are marked local and gitignored.
  - §3.1: D13 resolved (Advantage creator / Advantage exploiter; stored, not displayed in V1). The make-rate floor
    source, blend and value rule (decision d). Offense size keeps listed position (decision g). Approved
    calibration (c.13), including Play finisher's 4 guards and the taste edges.
  - §3.2: usable-entry rule (c.20); Neutral Defender and Empty State rules (c.5, c.6); approved calibration
    (c.13). The "What it says" columns are the tooltip copy (c.19).
  - §2.2, §2.6, §2.8, §4.2: Rim finisher flagged as ours until verified (c.13); the classifier bars approved
    (c.13); the Legend-negative exception to D5 (c.5).
  - §4.1: the Stretch big check for Chet Holmgren and Jaren Jackson Jr. §4.3: the `human_reviewed` marker (c.3),
    the non-claim rule (c.17), what shows while a negative waits for review (c.4). §4.5: the thin-read rule
    (c.6).
  - §5: no pair name for a Possession ender main (c.7).
  - §6: Final Eval placement (decision a: the label under the Build page's Player Shape and a tooltip on each Final
    Eval player slot; no per-player Player Shape on Final Eval). The pending-review line (c.4). Copy and glosses
    (c.19). `/sketch` runs in the #17 display milestone.
  - §7: Legend defense (c.5), where overrides live (c.10), Karl Malone (c.13), the Legend second-role rate (c.13).
  - §8: the code keys (`player_archetype`, `off_`, `def_`, `pair_`); the Anchor Lexicon line.
  - §9.3: the reviewed-None definition (c.3, c.16), the bulk-resolve guard (c.1, c.2), the rim rule parked to #157
    (c.18), the stats-window and minutes-floor notes (c.21), the make-rate floor source (decision d).
    §9.4: storage in `released_players.archetype_snapshot`; the prototype path is `docs/research/119/`.
  - §10: items 1-28 resolved into their sections. Only the `/sketch` display details and the data checks remain.
  - Appendix A: the "open item" notes point at §7.
- **2026-09-21, adversarial check against the Decision Ledger and #15.**
  - §5: filled in the pair names from D23 and D24 (it said "pending"). Rules, merges, no full-read gate, loose
    size words, preview counts (`docs/research/119/pairnames.py`). Appendix A gains a pair-name column.
  - §3.1: added the D23 make-rate floor to Movement shooter, Floor spacer and Stretch big (it was missing).
  - §1, §2.6: split D21 (reviewed None) from the classifier's own bars (full read, all four core Skills at None).
  - §2.3: Glue Guy is an approved pair name (D23), so it is no longer listed only as a parked trait.
  - §3.2: defense size no longer cites D17 (offense reads listed position, so D17 cannot forbid it).
  - §3.2, §4.5: "the chip names his nearest core Skill" was not a ledger decision; moved to the why-line.
  - §4.2: marked the defense "different Skill" second-role filter as a classifier default.
  - §7: marked the Legend-twin invariant as a generalization of the ledger's Anthony Davis rule.
  - §6: a pair-name filter matches main roles only (D22).
  - §8: added the "Anchor" name collision (Impact Trait, calibration anchor players, `noteFilters` key).
  - §9.2: "pair-as-peak" (D6 engine fallback) is not a §5 pair name.
  - §9.3, §9.4: career 3P% must come from a stored row, never `get_or_fetch_career`; the preview code in `/tmp`
    must move into `research/`.
  - Header: added the #15 roll-in (chart axes), met by the Player Shape. §10: added items 23-28.
