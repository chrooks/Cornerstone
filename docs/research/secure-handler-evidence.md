# Secure Handler (Ball Security) — Evidence Report

Research backing for the `secure_handler` Skill mapping (issue #41, AC1).
Compiled 2026-07-02 via web research. Grounds the choice of primary metric,
secondary metric, volume/role gates, and starting threshold values.

## 1. Turnover taxonomy: which metrics matter, and their flaws

**Raw TOV per game** — Universally treated as the *worst* signal of ball security. It rewards low-usage players who never touch the ball, and punishes high-volume creators. League turnover leaders every year are stars (LeBron, Harden, Luka, Dončić-tier creators), not careless players ([Basketball-Reference career TOV leaders](https://www.basketball-reference.com/leaders/tov_career.html), [ESPN turnover leaders](https://www.espn.com/nba/stats/player/_/stat/turnovers)). Use it only as raw input, never as the rating basis.

**TOV% (Dean Oliver / Basketball-Reference)** — `100 * TOV / (FGA + 0.44*FTA + TOV)`. The consensus "trustworthy" measure: it is tempo-free and normalized to the player's own possession usage, so it compares across pace, minutes, and volume ([Hudl: "Turnover Percentage: The Trustworthy Measurement for Ball Security"](https://www.hudl.com/blog/turnover-percentage-the-trustworthy-measurement-for-ball-security), [CaptainCalculator TOV%](https://captaincalculator.com/sports/basketball/turnover-percentage/)). One of Oliver's Four Factors ([Four Factors revisited, arXiv](https://arxiv.org/pdf/2305.13032)).
Criticisms:
- Denominator counts only *scoring-usage* possessions. A pure playmaker's passing workload isn't in the denominator, so pass-first guards look worse than their real per-touch security (their turnovers count, their assists don't).
- Treats all turnovers alike — bad pass, travel, offensive foul, strip — with no context on decision quality ([NBAstuffer](https://www.nbastuffer.com/analytics101/turnover-ratio/)).

**Turnover Ratio (NBA.com / Hollinger "TO Ratio")** — same idea but adds assists to the denominator: `100*TOV / (FGA + 0.44*FTA + AST + TOV)` ([NBAstuffer](https://www.nbastuffer.com/analytics101/turnover-ratio/)). This partially fixes the playmaker penalty — a useful variant since the blob has `ast`. Note the scale differs: league average TO Ratio runs lower (~9–10) than B-R TOV% (~12–13). Don't mix benchmarks between the two formulas.

**Turnovers per touch / per time of possession (tracking data)** — Second Spectrum tracking gives touches and time-of-possession, the most direct denominator for "how often does he cough it up when he actually has the ball" ([NBA.com touches stats](https://www.nba.com/stats/players/touches?dir=D&sort=TOUCHES), [Wikipedia: NBA player tracking](https://en.wikipedia.org/wiki/Player_tracking_(National_Basketball_Association)), [NBA.com on time of possession vs usage](https://www.nba.com/news/biggest-changes-usage-possession-time-2025-26)). Usage rate looks at how a possession *ends*; time of possession/touches capture how much the player *handles* the ball — two different things, and per-touch TOV separates the low-usage screener who still fumbles from the high-usage guard who doesn't. Weakness: touches vary hugely in risk (a pass-back handoff vs. a drive into traffic), so a connective-passing wing racks up cheap touches that dilute the rate.

**AST/TO ratio** — Fine for identifying good decision-makers among ball-handlers, but structurally biased ([Hudl](https://www.hudl.com/blog/turnover-percentage-the-trustworthy-measurement-for-ball-security), [48 Minutes: Assist/Bad-Pass ratio](https://fertyeightminutes.substack.com/p/redefining-passing-efficiency-the)):
- Penalizes non-passers: an elite-security scorer like prime KD posts a modest AST/TO despite good ball security.
- Conflates passing skill with turnover avoidance — the numerator is a playmaking stat, not a security stat.
- Overly broad "turnover" term: travels and offensive fouls count against a *passing* ratio.
- Small-sample distortion for low-assist players (fringe players top the leaderboards with 11–12:1 ratios on tiny volume — [StatMuse AST/TO leaders](https://www.statmuse.com/nba/ask?q=nba+assist/turnover+ratio+leaders+2024-25)).

**Usage-adjusted / positional-percentile variants** — [Cleaning the Glass](https://cleaningtheglass.com/stats/guide/game_detail_player) computes TOV% over used possessions and, critically, presents it as **percentiles within position groups** (point/combo/wing/forward/big) — the community-standard way to make turnover economy comparable across roles.

## 2. Usage adjustment: what the research says

- The **skill-curve** literature (Oliver; formalized by Goldman & Rao and the Berkeley SAG review) holds that efficiency declines as a player's possession load rises — marginal possessions are harder, so there is real extra value in carrying usage at flat efficiency ([Berkeley SAG: Conceptions of Usage Rate](https://sportsanalytics.studentorg.berkeley.edu/articles/conceptions-usage.html), [Goldman & Rao shot-policy framing via MDP paper](https://arxiv.org/pdf/1812.05170)).
- Turnover rate is **role-dependent, not a fixed trait**: Basketball-Reference found TOV% is the *second-least consistent* offensive rate stat when a player changes roles — turnover avoidance moves with usage context ([B-R Blog](https://www.basketball-reference.com/blog/index69a1.html?p=7220)).
- But the raw cross-sectional USG%→TOV% correlation among rotation players is **weak/insignificant** (r ≈ 0.09, p > 0.05 in a three-season study); elite very-high-usage players cluster at or below median TOV% ([Statathlon: The Burden of Usage](https://statathlon.com/usage-rate-true-shooting-percentage-turnover-rate/)). Interpretation: usage doesn't *doom* you to turnovers, but low-usage players achieve low TOV% cheaply.
- Practical consequence for a rating system, echoed by [NBAstuffer's usage-impact piece](https://www.nbastuffer.com/nba-usage-rate-impact-efficiency/): **low TOV% is only impressive conditional on handling volume.** Gate the skill on touches/usage/time-of-possession so a catch-and-shoot wing with 30 touches a game can't out-rate an engine guard, and give credit for *maintaining* low TOV% at high usage (that's the skill-curve payoff).

## 3. Positional norms

- Positional context is baked into best practice: Cleaning the Glass percentiles TOV% **within position groups** because raw rates differ by role ([CTG guide](https://cleaningtheglass.com/stats/guide/game_detail_player)).
- Directionally, from positional leaderboards ([Hollinger per-position tables](http://insider.espn.com/nba/hollinger/statistics/_/position/c), [NBA.com advanced by position](https://www.nba.com/stats/players/advanced?PerMode=Totals&PlayerPosition=G&dir=D&sort=AST_RATIO)):
  - **High-touch creators (PGs)** have the highest *per-possession-used* raw turnover counts but often fine TOV% because their denominator is huge; their AST-inclusive TO Ratio is flattering.
  - **Bigs / play-finishers** have low raw TOV but the **highest per-touch turnover rates** — post touches are contested, doubled, crowded-space touches. NBA.com tracks `post_touch_tov` separately for this reason ([NBA.com post-up play type](https://www.nba.com/stats/teams/playtype-post-up)); Synergy play-type possessions count turnovers per post-up/PnR possession ([Nylon Calculus on Synergy categories](https://fansided.com/2017/09/08/nylon-calculus-understanding-synergy-play-type-data/)).
  - Off-ball wings sit lowest on every rate — which is exactly the group a gate must handle.
- **League benchmarks:** individual/team TOV% (Oliver formula) averages ~12–14%; sub-11–12% is strong ball security, 15%+ is poor ([NBAstuffer](https://www.nbastuffer.com/analytics101/turnover-ratio/), [Hudl](https://www.hudl.com/blog/turnover-percentage-the-trustworthy-measurement-for-ball-security), [NBA.com team advanced](https://www.nba.com/stats/teams/advanced?dir=A&sort=TM_TOV_PCT)). A commonly cited rule: ~14% TOV% for a lead guard is fine; the same number from a low-touch center signals carelessness ([CTG positional framing](https://cleaningtheglass.com/stats/guide/game_detail_player)).

## 4. Concrete thresholds and player anchors

**(a) TOV% (Oliver formula, per B-R):**
- **Elite:** ≤ 10% *at meaningful usage*. Tyrese Haliburton 2024-25: **9.9% TOV% while averaging ~10 assists** — historically elite ([StatMuse Haliburton by season](https://www.statmuse.com/nba/ask/tyrese-haliburton-turnover-percentage-by-season); his arc: 16.7% → 13.3% → 12.3% → 9.9%). Career low-TOV% leaders are dominated by low-assist scorers/shooters (B-R leaderboard, ~7–9% range) — which is why the volume gate matters ([B-R career TOV% leaders](https://www.basketball-reference.com/leaders/tov_pct_career.html)).
- **Good/Proficient:** ~10.5–13%. Chris Paul, career **13.8% TOV%** with a **4.0:1 career AST/TO** and elite reputation ([StatMuse CP3](https://www.statmuse.com/nba/ask/how-many-turnovers-does-chris-paul-have-in-his-career)) — shows a heavy-playmaking role inflates Oliver TOV% (assists absent from denominator), so his AST-inclusive TO Ratio is the fairer lens. Mid-usage scorers like KD typically live ~11–13%.
- **Average:** ~13–14%. **Poor:** ≥ 15–16% (Haliburton's own worst year, 16.7%, was his "turnover problem" season).

**(b) Turnovers per 100 touches:** no published canonical cutoffs — NBA.com exposes touches and TOV but the community hasn't standardized a threshold ([NBA.com touches](https://www.nba.com/stats/players/touches?dir=D&sort=TOUCHES)). Derived from league data shapes (rotation players ≈ 1.5–2 TOV on 45–65 touches): **≤ ~2.5 per 100 touches elite, ~3–4 average, ≥ ~5 poor** — treat these as calibration starting points to verify against the blob distribution, not cited constants.

**(c) AST/TO:** ~2:1 is the traditional "good lead guard" bar; **3:1+ elite for PGs** (CP3 career ~4:1; Haliburton has run ~4–5:1 in his best seasons) ([TeamRankings AST/TO](https://www.teamrankings.com/nba/player-stat/assist-to-turnover-ratio), [Yahoo on Haliburton/CP3 10-assist-0-TO games](https://sports.yahoo.com/article/pacers-tyrese-haliburton-historic-stat-161256041.html)). For non-passers this metric is meaningless — apply only above a passing-volume floor.

---

## Recommended mapping

**Primary metric — usage-normalized TOV% (Oliver):** `tov / (fga + 0.44*fta + tov)`, all per-game fields available in the blob. It's the community-consensus ball-security measure and pace/volume-free.

**Secondary metric — turnovers per touch:** `tov / touches` (blob has `touches`). Catches the two failure modes TOV% misses: playmakers whose passing workload isn't in the Oliver denominator, and bigs whose low raw TOV hides bad per-touch hands. Optionally sanity-check bigs with `post_touch_tov`.

**Volume/role gates (critical — this is where low-usage players get filtered):**
- Gate on ball responsibility, not games: require e.g. `touches ≥ ~40/game` **or** `usage_rate ≥ ~18%` **or** `time_of_possession ≥ ~2 min/game` to qualify for Elite. Below the gate, cap at Capable — the evidence (skill curves, B-R role-consistency finding) says low TOV% without volume is cheap.
- Consider a *bump* path instead of a penalty: Elite requires low TOV% **and** the volume gate; a tier bump for maintaining Elite-band TOV% at very high usage (`usage_rate ≥ 28%`) mirrors the skill-curve literature.

**Rough thresholds (Oliver TOV% / TOV per 100 touches):**

| Tier | TOV% | TOV/100 touches | Gate |
|---|---|---|---|
| **Elite** | ≤ 10.5% | ≤ ~2.5 | touches ≥ ~40 or USG ≥ ~20% |
| **Proficient** | ≤ 12.5% | ≤ ~3.5 | touches ≥ ~30 |
| **Capable** | ≤ 14% (~league avg) | ≤ ~4.5 | minimal |

Use `ast/tov` only as a tier-bump condition for high-passing players (e.g., AST/TO ≥ 3.5 with `passes_made` or `ast` above a floor), never as the primary — the evidence is clear it punishes non-passers.

Anchors: Haliburton 24-25 (9.9% at 10 apg) = Elite; KD-type mid-usage scorer (~11–13%) = Proficient; league average ~13–14% = Capable boundary; 16%+ = below Capable. Calibrate the per-touch cutoffs against the blob's distribution before locking them — that column has no published canonical benchmarks.

**Sources:** [Hudl on TOV%](https://www.hudl.com/blog/turnover-percentage-the-trustworthy-measurement-for-ball-security) · [NBAstuffer TO Ratio](https://www.nbastuffer.com/analytics101/turnover-ratio/) · [Statathlon USG vs TOV%](https://statathlon.com/usage-rate-true-shooting-percentage-turnover-rate/) · [B-R Blog role consistency](https://www.basketball-reference.com/blog/index69a1.html?p=7220) · [Berkeley SAG usage/skill curves](https://sportsanalytics.studentorg.berkeley.edu/articles/conceptions-usage.html) · [Cleaning the Glass stat guide](https://cleaningtheglass.com/stats/guide/game_detail_player) · [StatMuse Haliburton](https://www.statmuse.com/nba/ask/tyrese-haliburton-turnover-percentage-by-season) · [StatMuse Chris Paul](https://www.statmuse.com/nba/ask/how-many-turnovers-does-chris-paul-have-in-his-career) · [NBA.com touches tracking](https://www.nba.com/stats/players/touches?dir=D&sort=TOUCHES) · [NBA.com time of possession](https://www.nba.com/news/biggest-changes-usage-possession-time-2025-26) · [48 Minutes Assist/Bad-Pass ratio](https://fertyeightminutes.substack.com/p/redefining-passing-efficiency-the) · [Nylon Calculus Synergy play types](https://fansided.com/2017/09/08/nylon-calculus-understanding-synergy-play-type-data/) · [Four Factors revisited (arXiv)](https://arxiv.org/pdf/2305.13032) · [B-R career TOV% leaders](https://www.basketball-reference.com/leaders/tov_pct_career.html)
