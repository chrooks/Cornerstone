# Team Shape renders engine truth on the shared axis vocabulary

**Status:** accepted
**Date:** 2026-07-06
**Related research:** `docs/research/team-shape-design-frame.md`, `docs/research/lab-consequence-decision-weight.md`, `docs/research/lab-design-audit.md`

## Context

The Team Shape makes cohesion legible as a radar-style glyph in the Lab. The naive versions all lie: summing Player Shapes into a team silhouette contradicts the engine's nonlinear math (synergies, bell curves, accentuation); overlaying Player composites on team spokes compares league percentiles against Lineup formula outputs — same 0–10 scale, incomparable semantics; and axes that exist for teams but not players (e.g. `collective_passing`) force either holes or relabeled lookalike numbers. The decision-weight research (XCOM's fudged hit chances) shows a preview or visualization that disagrees with the engine's real output destroys trust in the entire readout.

## Decision

1. The Team Shape's spokes are the engine's actual Lineup Subscores — never derived, summed, or invented geometry. Solid outline = Starting Lineup; ghost outline = median of **viable** Lineup Combinations only (no viable lineups → no ghost, with an explicit "0 viable" badge).
2. Axes are restricted to the ~11 Subscores that have a matching Player composite, arranged in three equal-angle arcs mirroring the Subscore Tree (offense / defense / rebounding-transition).
3. Player Shapes (league-percentile composites) render **adjacent** to the Team Shape, never superimposed on it. A contribution overlay in true spoke units waits for the per-player breakdown API (#93).
4. `collective_passing` earns its spoke only when a player-level passing composite exists (derivable from the Passer skill; rides an Evaluation Version). Filed as a fast-follow rather than blocking the first slice.

## Considered options

- Sum-of-player-shapes team glyph — rejected: visually "full" shapes could score badly; dishonest by construction.
- Best team axes regardless of player vocabulary — rejected: holes or fake values in Player Shapes.
- Percentile overlay with disambiguating tooltips — rejected: honest in the fine print, misleading at the glance that shapes exist to serve.

## Consequences

- The spoke set becomes user-learned vocabulary; changing it is a taxonomy mutation that should ride Evaluation Versions like Subscore Tree changes.
- Playmaking is absent from the glyph until the player passing composite lands — a deliberate honest omission, not an oversight.
- Any future preview/ghost variant (e.g. hover feedforward from #92) inherits the same constraint: render only real engine output.
