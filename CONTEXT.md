# Cornerstone

Cornerstone is the engine for the barbershop argument. It turns hypothetical roster debates ("$15 to build a starting five," "five eras of LeBron, which years?", "best roster around prime Hakeem?") into something you can build, test, and compare against others under the same rules.

The product evaluates NBA roster construction around a cornerstone player, with tooling for both user-facing team building and admin calibration of the cohesion engine.

## Language

**Team**:
The universal unit. Any group of 5 or more players submitted for evaluation, regardless of RuleSet. A Team is what the engine scores. Lineup, Rotation, and Roster are all specific sizes of Team.
_Avoid_: Using Lineup, Rotation, or Roster when the concept is size-agnostic

**Lineup**:
A 5-player Team. The atomic evaluation unit. The engine always scores at the Lineup level. Larger Teams are broken into Lineup Combinations.
_Avoid_: Rotation, Roster

**Rotation**:
A 9-player Team. The Standard RuleSet default: 1 mandatory Legend (Cornerstone) + 8 supporting players. Evaluated by its Lineup Combinations (C(9,5) = 126).
_Avoid_: Lineup, Roster

**Roster**:
A 12-player Team. A full squad. Evaluated by its Lineup Combinations (C(12,5) = 792).
_Avoid_: Lineup, Rotation

**Starting Lineup**:
The first five selected slots in a Rotation or Roster, used as the primary displayed Lineup.
_Avoid_: Best lineup

**Player**:
The universal individual unit. Every person in the system is a Player, whether active or legendary. A Player has an id, name, position, team, physical attributes, and a Skill Profile (which may be stat-derived or manually curated). In code, the shared representation is `PlayerWithSkills`. All Legends are Players; not all Players are Legends.
_Avoid_: Using Legend when the concept is type-agnostic

**Legend**:
A Player whose Skill Profile is manually curated rather than derived from the stat pipeline. Tagged `is_legend: true` in the data layer. Legends represent all-time greats evaluated on the same 21-skill taxonomy as active Players. In the Standard RuleSet, the Cornerstone must be a Legend.
_Avoid_: All-time great (as a data category; use Legend), historical player

**Cornerstone**:
The (ideally best) Player in the first slot of a Team. The Player you build the rest of the Team around. In the Standard RuleSet, the Cornerstone must be a Legend and is paid $54M.
_Avoid_: Star, anchor

**PlayerPool**:
An ordered collection of Players (which may include Legends) available for browsing and selection in a given context. A PlayerPool is the data input to the shared PlayerPool browser component: it is the `players` prop alongside configuration for which columns to display and which filters to expose in the search controls. In the Standard RuleSet, the PlayerPool is all active Players from the current season's Snapshot plus all Legends. Different surfaces render different PlayerPools with different configurations: the Legends picker renders a PlayerPool of only Legends with peak year and position columns; the builder picker renders active Players with salary and contract columns; the Players explorer renders the full pool with all columns and admin controls.
_Avoid_: Player list, available players

**SalaryCap**:
The total spending limit for a Team under a given RuleSet. In the Standard RuleSet, the SalaryCap is $195M ($54M consumed by the mandatory Legend Cornerstone, leaving $141M for supporting players). Not all RuleSets require a SalaryCap.
_Avoid_: Budget, cap (without context)

**RookieDeal**:
A player contract designation indicating below-market salary. In the Standard RuleSet, a maximum of 2 RookieDeal players are allowed per Team.
_Avoid_: Rookie contract (when referring to the builder constraint)

**Rotation Diagnostic**:
A calibration view that explains the rotation-level score before drilling into individual lineup combinations.
_Avoid_: Lineup diagnostic

**Lineup Combination**:
One five-player lineup generated from a rotation during full rotation evaluation.
_Avoid_: Permutation

**Versatility**:
The rotation-level variety of viable lineup archetypes.
_Avoid_: Archetype diversity in user-facing UI

**Lab**:
The full lifecycle of building and evaluating a Team. Encompasses the complete sequence: selecting a RuleSet, picking a Cornerstone, assembling the Build, and evaluating the result. Borrows from NBA 2K's MyLab/MyPlayer Builder nomenclature. A Lab session produces one Build under one RuleSet. Route structure: `/lab/<ruleset>/<step>` (e.g., `/lab/standard/legends`, `/lab/standard/build`, `/lab/standard/eval`).
_Avoid_: Session, game, match

**Build**:
The in-progress, pre-persistence state of an assembled Team in the Lab. A configuration of Cornerstone + supporting players being tested and iterated on before saving. Borrows from NBA 2K nomenclature where a "build" is a configuration of attributes before it becomes a usable entity.
_Avoid_: Draft, assembly

**RuleSet**:
A published configuration that defines the constraints of a Lab session. Analogous to Pokemon Showdown's metagames/tiers (OU, UU, Ubers, etc.): each RuleSet defines a different game with different constraints, and Teams built under different RuleSets are not directly comparable. Includes: Team size, SalaryCap (if any), Cornerstone rules, PlayerPool source, RookieDeal limit, and any additional restrictions. RuleSets appear as selectable cards at `/lab/` (the Lab entry point). Expect 2-10 RuleSets at any given time.
_Avoid_: Mode, settings, config, tier (use RuleSet to avoid confusion with skill Tiers)

**Standard RuleSet** (initial):
- 9 players (Rotation)
- 1 mandatory Legend as Cornerstone ($54M)
- SalaryCap: $195M ($141M effective after Cornerstone)
- PlayerPool: current season Snapshot + Legend pool
- Max 2 RookieDeal players
_Avoid_: Default rules

**PlayerView**:
The visual representation of a single Player at a given size. Four sizes: Row, Card, Panel, and Profile. All four sizes render the same Player data (`PlayerWithSkills`); they differ only in how much space they use, how much of the Skill Profile they reveal, and how much interaction they support. A PlayerPoolBrowser renders a collection of PlayerViews at the active size.
_Avoid_: PlayerCard, PlayerRow, LegendCard as independent unrelated components

**Row**:
The compact PlayerView size for dense scanning in tables and pickers. A Row keeps the Player on one horizontal line and prioritizes identity, position, salary or era context, and compact skill summaries. Used by table views in the Players explorer, Legends picker, and Build picker.
_Avoid_: Table row, PlayerRow

**Card**:
The medium PlayerView size for grid browsing. A Card is standalone and shows Player identity, physical attributes, salary or era context, top skills, and a primary action or click target. Used by card views in the Players explorer and Build picker.
_Avoid_: PlayerCard as a separate concept

**Panel**:
The large PlayerView size for comparison and selection surfaces. A Panel has enough room for identity, key context, tier counts, call-to-action, and categorized Skill Profile detail without taking over the whole page. Used by the Legends picker scouting report layout.
_Avoid_: Report, LegendCard, scouting card

**Profile**:
The full PlayerView size for complete inspection. A Profile shows the full Player record and Skill Profile with the same information architecture as the Player profile page. It may render as a standalone page or as a dismissible full-screen modal when the user needs profile depth without leaving the current flow.
_Avoid_: Modal-only profile, profile card

**Skill Profile**:
A Player's complete dictionary of Skills at their evaluated Tier. Generated from the Player's stat Snapshot via the skill pipeline (for active Players) or manually curated (for Legends).
_Avoid_: Skill set (ambiguous with the general concept of "skills")

**Impact Trait**:
A normalized player-level basketball effect produced from a Player's Skill Profile. Skills describe what a Player possesses; Impact Traits describe what those Skills can add to a Lineup before full Lineup context is applied. Examples: Spacing, Rim Pressure, Shot Creation, Anchor, Perimeter Defense.
_Avoid_: composite, channel, dimension, attribute

**Snapshot**:
A point-in-time capture of a Player's stats used as input to the skill pipeline. A Snapshot is an internal pipeline input; it may be used to produce a Snapshot Release, but not every Snapshot is necessarily published for users to build against.
_Avoid_: Stats, raw stats, Snapshot Release when referring only to pipeline input

**Snapshot Release**:
A published, user-visible version of the PlayerPool, Player metadata, salaries, Snapshots, and Skill Profiles used for building and evaluating Teams. Snapshot Releases are immutable once published so a Saved Team can always be understood in the evaluation context that existed when it was saved.
_Avoid_: update, data refresh, release, version when referring to the user-facing evaluation context

**Canonical Player**:
The stable identity of a Player across Snapshot Releases. Used to connect the same real person across trades, waives, salary changes, team changes, role changes, and Skill Profile updates.
_Avoid_: player row, current player record

**Snapshot Player**:
A Player as they existed in one Snapshot Release, including team, position, salary, Snapshot-derived metadata, and Skill Profile at that point in time.
_Avoid_: current player, player version

**Saved Team**:
A persisted Team owned by a user, tied to the RuleSet and Snapshot Release it was built under. Saved Teams are private by default unless a later publishing workflow explicitly changes visibility.
_Avoid_: saved roster, saved build

**Evaluation Version**:
A versioned snapshot of how the engine interprets Player data when scoring a Team. Each Evaluation Version freezes both the **taxonomy** (Skill list, Impact Trait list, Subscore tree, scoring rules) and the **values** (Tier numeric values, composite coefficients, amplitude maps, normalization maxes, boost factors), along with **formula handler references** that name which registered code implementation each Subscore/Impact Trait uses. Evaluation Version is separate from Snapshot Release: the Snapshot Release says which Player data was used; the Evaluation Version says how the engine interpreted that data. Saved Teams are bound to the Evaluation Version they were scored under and never silently re-score when a newer Version publishes; instead they are reopened as a Build in the Lab after a compat check.
_Avoid_: algorithm version, model version unless specifically referring to an AI model; weights table (Evaluation Version is more than weights)

**Formula Handler**:
A named, code-resident implementation of a scoring formula (e.g., `spacing_v1`, `pnr_screener_v1`). The evaluator dispatches by handler name, which is recorded in each Evaluation Version's formula_refs. Adding a new formula primitive requires a code release that registers a new handler; reusing an existing handler across Versions is pure data.
_Avoid_: function, formula, formula module (when referring to the registered named binding)

**Subscore**:
A composite scoring dimension produced by a Formula Handler from Player Skill Profiles within a Lineup. Subscores roll up into the Lineup score. Examples: spacing, paint_touch, anchor, shot_creation, perimeter_defense.
_Avoid_: composite (in user-facing language), score component, dimension

**Subscore Tree**:
The hierarchical grouping of Subscores into categories (e.g., offense, defense) used for display and rollup. Restructuring the Subscore Tree is a taxonomy mutation that lands as a new Evaluation Version.
_Avoid_: subscore categories (when referring to the data structure)

## Relationships

### Team hierarchy
- **Team** is the universal concept. **Lineup** (5), **Rotation** (9), and **Roster** (12) are size-specific Team types.
- A **Lineup** is the atomic evaluation unit. All larger Teams are broken into **Lineup Combinations** (all C(N,5) combinations of 5 from N players).
- The **Starting Lineup** is the first five selected slots in any Team larger than 5.
- A **Cornerstone** occupies the first slot. In the Standard RuleSet, it must be a Legend.

### Engine
- The engine always evaluates at the **Lineup** level. A 5-player Team = 1 Lineup. A 9-player Team = C(9,5) = 126 Lineup Combinations. A 12-player Team = C(12,5) = 792 Lineup Combinations.
- **Lineup Combinations** are ranked by cohesion score descending.
- A **Rotation Diagnostic** summarizes rotation-level factors before showing one selected **Lineup Combination**.

### Lab lifecycle
- A **Lab** session follows a fixed sequence: RuleSet selection → Cornerstone selection → Build assembly → Evaluation.
- Route structure: `/lab/` (RuleSet picker) → `/lab/<ruleset>/legends` → `/lab/<ruleset>/build` → `/lab/<ruleset>/eval`
- A **Lab** session produces one **Build** under one **RuleSet**.
- Auth can occur at any point in the Lab lifecycle. The current Build persists through authentication.

### Player hierarchy
- **Player** is the universal individual unit. **Legend** is a subtype of Player with a manually curated Skill Profile.
- All Legends are Players. The shared code representation is `PlayerWithSkills` (with `is_legend: true` for Legends).
- A **PlayerPool** is a collection of Players (including Legends) passed as data to a PlayerPoolBrowser.
- A **PlayerView** renders one Player at a configurable size: **Row**, **Card**, **Panel**, or **Profile**. A PlayerPoolBrowser renders a collection of PlayerViews at the active size.
- Different surfaces render different PlayerPools with different column/filter configurations: the Legends picker uses a PlayerPool of only Legends; the builder picker uses active Players minus rostered ones.

### RuleSet governs the Build
- A **RuleSet** defines: Team size, **SalaryCap**, **Cornerstone** rules, **PlayerPool**, **RookieDeal** limit.
- Every **Saved Team** is associated with the **RuleSet** it was built under.
- The **PlayerPool** available in the builder is determined by the active **RuleSet**.
- A **Skill Profile** is generated from a **Snapshot** via the stat pipeline (for active Players) or manually curated (for Legends).
- An **Impact Trait** is derived from a **Skill Profile** and describes the basketball effect those Skills can create before Lineup context, synergy, and rollup scoring are applied.

### Saved Team persistence
- A **Saved Team** persists a valid **Team** under one **RuleSet** and one **Snapshot Release**.
- A **Saved Team** preserves slot order so the **Starting Lineup** remains recoverable.
- A **Saved Team** should preserve enough original evaluation context to explain what the Team meant when it was saved, even if future Snapshot Releases change Player metadata, salaries, or Skill Profiles.

### Snapshot Releases
- A **Snapshot** is pipeline input; a **Snapshot Release** is the published evaluation context users build against.
- A **Snapshot Release** defines which PlayerPool, Player metadata, salaries, Snapshots, and Skill Profiles are active for user-facing Team building.
- A **Snapshot Player** belongs to one **Snapshot Release** and represents a **Canonical Player** at that point in time.
- Saved Teams do not silently mutate when a newer **Snapshot Release** is published. They may be re-evaluated under a newer Snapshot Release through an explicit user action.

## Example dialogue

> **Dev:** "Should the calibration page evaluate this as a lineup or a rotation?"
> **Domain expert:** "If exactly five players are selected, treat it as a Lineup. If more than five are selected, treat it as a Rotation and evaluate all five-player combinations."

## Flagged ambiguities

- "full rotation evaluation" was resolved as evaluating all five-player combinations from a selected **Rotation**, while preserving the first five slots as the **Starting Lineup** for primary display.
- "team", "roster", and "rotation" are sometimes used interchangeably in conversation; resolved: use **Rotation** for calibration evaluation precision and **Roster** for the builder's full team construction.
- "permutations" was resolved as **Lineup Combinations** because lineup order does not change the cohesion calculation.
- "builder final eval" reuse was resolved as reusing the deterministic cohesion rotation rollup, not generating a team narrative in calibration.
- Calibration rotation diagnostics default to the **Starting Lineup**, even though the **Lineup Combination** navigator is sorted by score rank.
- Calibration rotation navigator arrows move through **Lineup Combinations** in score-rank order.
- The backend key `archetype_diversity` is labeled as **Versatility** in user-facing calibration diagnostics.
- The current builder rotation-slot limit is 9, but that number is a rule/configuration value rather than a permanent domain definition. This will be governed by **RuleSet** once implemented.
- The current builder constraints (9-man roster, $195M cap, $54M cornerstone, 36 legends, 2024-25 player pool) represent the initial "Standard" **RuleSet**. A "Free For All" RuleSet is planned as the second option.
- The pre-persistence state of an assembled roster is a **Build**. Resolved: borrows from NBA 2K nomenclature where a "build" is a configuration of attributes before it becomes a usable player. Same thought exercise: assembling a hypothetical configuration, testing it, iterating. Large audience overlap expected between Cornerstone users and 2K MyPlayer builders.
