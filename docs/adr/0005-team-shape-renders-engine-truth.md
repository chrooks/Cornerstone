# Team Shape renders engine truth on the shared axis vocabulary

**Status:** accepted
**Date:** 2026-07-06
**Related research:** `docs/research/team-shape-design-frame.md`, `docs/research/lab-consequence-decision-weight.md`, `docs/research/lab-design-audit.md`

## Context

The Team Shape makes cohesion legible as a radar-style glyph in the Lab. The naive versions all lie: summing Player Shapes into a team silhouette contradicts the engine's nonlinear math (synergies, bell curves, accentuation); overlaying Player composites on team spokes compares league percentiles against Lineup formula outputs — same 0–10 scale, incomparable semantics; and axes that exist for teams but not players (e.g. `collective_passing`) force either holes or relabeled lookalike numbers. The decision-weight research (XCOM's fudged hit chances) shows a preview or visualization that disagrees with the engine's real output destroys trust in the entire readout.

## Decision

1. The Team Shape's spokes are the engine's actual Lineup Subscores — never derived, summed, or invented geometry. Solid outline = Starting Lineup; ghost outline = median of **viable** Lineup Combinations only (no viable lineups → no ghost, with an explicit "0 viable" badge).
2. Axes are restricted to the 12 Subscores that have a matching Player composite, arranged in three equal-angle arcs mirroring the Subscore Tree (offense / defense / rebounding-transition). *(Amended 2026-07-16 — was ~11 before the `passing` composite landed; see Amendment below.)*
3. Player Shapes (league-percentile composites) render **adjacent** to the Team Shape, never superimposed on it. A contribution overlay in true spoke units waits for the per-player breakdown API (#93).
4. `collective_passing` earns its spoke only when a player-level passing composite exists (derivable from the Passer skill; rides an Evaluation Version). Filed as a fast-follow rather than blocking the first slice. **This condition is now met (2026-07-16, #100) — see Amendment below.**

## Considered options

- Sum-of-player-shapes team glyph — rejected: visually "full" shapes could score badly; dishonest by construction.
- Best team axes regardless of player vocabulary — rejected: holes or fake values in Player Shapes.
- Percentile overlay with disambiguating tooltips — rejected: honest in the fine print, misleading at the glance that shapes exist to serve.

## Consequences

- The spoke set becomes user-learned vocabulary; changing it is a taxonomy mutation that should ride Evaluation Versions like Subscore Tree changes.
- Playmaking is absent from the glyph until the player passing composite lands — a deliberate honest omission, not an oversight.
- Any future preview/ghost variant (e.g. hover feedforward from #92) inherits the same constraint: render only real engine output.

## Amendment — 2026-07-16 (#100): the Passing spoke lands

Decision point 4's condition is met, not reversed — so this is an in-place amendment and the status stays **accepted**.

- **New composite.** A player-level `passing` composite now exists: `passing = passer` tier value alone, percentile-normalized against the league like every other composite. It deliberately mirrors the single ingredient of the team-level `_collective_passing` subscore. Steady Hand already owns the `ball_security` spoke, so the Passer skill is not reused there — no double-counting across adjacent spokes.
- **12th spoke.** The offense arc now reads **Spacing, Creation, Rim, Post, Off-Ball, Passing, Ball Sec** (`Passing` inserted between Off-Ball and Ball Sec — nothing else moves, preserving the user-learned axis order). Defense and rebounding/transition arcs are unchanged. The axis vocabulary is 12 spokes.
- **Two-key axis (honest naming both sides).** The glyph axis keeps the team subscore key `collective_passing` and gains an optional `playerKey: "passing"`. The team spoke reads `collective_passing`; player-side consumers read `playerKey ?? key`. This avoids a nonsensical "Collective Passing" bar on an individual player card while keeping the team subscore honestly named.
- **Pre-#100 versions render a gap, never a fake 0.** On an Evaluation Version whose declarative `composite_formulas` blob predates `passing`, the player composite is `None` and the player spoke draws as an honest gap. The team spoke always has data — `_collective_passing` is version-independent engine code. (Versions with no `composite_formulas` at all compute `passing` via the hardcoded path, so the spoke fills immediately.)
- **Evaluation Version.** The `passing` composite formula rides a new Evaluation Version. Canonical formula (from `formula_export.export_formulas`):

  ```json
  "passing": {
    "factors": [{ "type": "skill", "key": "passer", "coefficient": 1.0 }],
    "amplifiers": [],
    "depends_on": []
  }
  ```

  Published dev version id: _pending M3 publish on the dev stack — record here once published._
- **Attribution.** No change needed — `collective_passing → ["passer"]` was already wired in `cohesion_engine/attribution.py` (`COMPOSITE_DRIVING_SKILLS`), so the spoke's Attribution Ledger (ADR 0006/0007) ships with it.
