# Attribution Ledger mirrors formula structure, not marginal impact

**Status:** accepted
**Date:** 2026-07-07
**Related:** issue #93, ADR 0005, `docs/research/lab-consequence-decision-weight.md` §2 §4, `docs/research/lab-design-audit.md` fix 3

## Context

A harsh Subscore grade (F in Spacing next to Durant, an unexplained 0.0 in PnR Pairing) reads as an engine bug when the eval stops at the Subscore level. #93 adds a per-player drilldown — but the engine's formulas are not sums: top-two-plus-depth role weighting, quality gates, ratio balances, bell curves, and synergy boosts mean a "per-player contribution" is not a native quantity. Any drilldown must satisfy the reconciliation criterion (lines sum to the total, no unexplained gap) without inventing numbers the engine never computed (ADR 0005's constraint).

## Decision

1. **Ledger = captured intermediates.** Each Formula Handler emits its Attribution Ledger alongside its score: per-player input lines (player, driving Skill, role weight, value) plus labeled adjustment lines (bell-curve normalization, gates, synergy boosts, ratio balance, transition boost). Lines reconcile to the total by construction because they *are* the computation. Gates render as explicit lines ("screener quality ≤ 0 → zeroed"), not hidden multipliers.
2. **No marginal or proportional attribution.** Leave-one-out deltas don't sum to the total; proportional splits lie about gated/ratio formulas. Both manufacture per-player numbers the engine never produced.
3. **Ledgers ride the evaluate response** (`subscore_breakdowns` keyed by Subscore key), computed for the **Starting Lineup only**. Lineup Combinations stay score-only; a separate drilldown endpoint would be a second source of truth that must reproduce the eval exactly (the XCOM trap).
4. **Three UI surfaces, one component:** click-to-expand on Final Eval Subscore tiles, Team Shape vertex click opening the same ledger, and the Contribution Overlay — player-select highlight marking that player's ledger input value on each spoke. Stacked spoke segments rejected: negative adjustments and gates cannot stack honestly.
5. **Viability explanation is out of scope** — "0/126 viable" is a roster-level threshold question and rides #95, not the Subscore ledger.

## Considered options

- Marginal (leave-one-out) attribution — rejected: violates reconciliation, 5× eval cost per subscore.
- Proportional share of inputs — rejected: dishonest for gated/ratio formulas (everyone "contributes" to a zeroed score).
- Stacked spoke segments on the Team Shape — rejected: incoherent for negative/multiplicative adjustments.
- Separate drilldown endpoint — rejected: must re-run the eval and bit-match it; second source of truth.

## Consequences

- The drilldown is only as decomposable as the formula: adjustment-heavy Subscores (Defensive Coverage, ratio Subscores) show thin player lines and fat adjustment lines. That unevenness is accepted as honesty, not fixed with fudged splits.
- Every Formula Handler grows a breakdown-emission responsibility; new handlers must emit ledgers to be drilldown-eligible.
- The ledger schema becomes part of the evaluate response Contract that the Contribution Overlay and any future preview features consume.
