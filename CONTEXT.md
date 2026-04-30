# Cornerstone

Cornerstone evaluates NBA roster construction around a cornerstone player, with tooling for both user-facing team building and admin calibration of the cohesion engine.

## Language

**Lineup**:
A five-player group evaluated as a single on-court unit.
_Avoid_: Rotation, roster

**Rotation**:
A selected group of at least five players whose five-player lineup combinations are evaluated together.
_Avoid_: Lineup

**Starting Lineup**:
The first five selected rotation slots used as the primary displayed lineup.
_Avoid_: Best lineup

**Roster**:
The complete team construction concept in the builder, including the cornerstone and supporting rotation.
_Avoid_: Lineup

**Team**:
An informal synonym for the selected builder roster or calibration rotation, depending on context.
_Avoid_: Use Rotation or Roster when precision matters.

**Rotation Diagnostic**:
A calibration view that explains the rotation-level score before drilling into individual lineup combinations.
_Avoid_: Lineup diagnostic

**Lineup Combination**:
One five-player lineup generated from a rotation during full rotation evaluation.
_Avoid_: Permutation

**Versatility**:
The rotation-level variety of viable lineup archetypes.
_Avoid_: Archetype diversity in user-facing UI

## Relationships

- A **Rotation** contains one or more **Lineups**.
- A **Lineup** contains exactly five players.
- A **Rotation** with exactly five players has exactly one **Lineup**.
- A **Rotation** with more than five players is evaluated by its five-player lineup combinations.
- The **Starting Lineup** is the first five selected slots in a **Rotation**.
- A **Team** may refer informally to either a **Roster** or a **Rotation**.
- A **Rotation Diagnostic** summarizes rotation-level factors before showing one selected **Lineup Combination**.
- **Lineup Combinations** are ranked by cohesion score descending in calibration diagnostics.
- A **Rotation Diagnostic** result is self-contained and includes backend-scored player composites plus every scored **Lineup Combination**.
- The maximum visible **Rotation** size is configurable and should track the builder's current rotation-slot limit.

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
- The current builder rotation-slot limit is 9, but that number is a rule/configuration value rather than a permanent domain definition.
