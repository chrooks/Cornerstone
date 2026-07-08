# Engine explainability targets actionable causes, not auditability

**Status:** accepted
**Date:** 2026-07-08
**Related:** ADR 0006, `docs/research/lab-consequence-decision-weight.md`, CONTEXT.md (Software as Education, Partnership Model — global Lexicon)

## Context

Every nonlinearity the cohesion engine buys for evaluation quality (percentile
normalization, count gates, quality gates, bell curves, the viability
threshold) costs a rung of attribution. Building the Attribution Ledger (#93)
surfaced the tension directly: at what point does explainability outweigh
evaluation quality?

The founding frame is the barbershop argument — arguments run on legible
causes, not regression coefficients. The decision-weight research (XCOM)
shows trust dies at "arbitrary," not at "complex." Pokemon Showdown's
metagame is undecomposable, yet every individual loss is legible at the
moment it happens.

## Decision

1. **Explainability standard = actionable cause-naming.** When a mechanism
   affects a grade, the user must be able to see a named, believable
   basketball cause that points at an action ("×0.5 — only 1 shooter" →
   add a shooter). Users never need to audit the math; that access level is
   reserved for admin calibration tooling.
2. **Eval quality and explainability are not traded on one axis.** The engine
   may be arbitrarily nonlinear. The gate is per-mechanism: *a nonlinearity
   ships only with its explanation rung* — the labeled line, badge, or note
   that names its bite. A mechanism whose bite cannot be named must be cut,
   not hidden.
3. **No per-skill splits of normalized values, ever, for users.** Percentile
   normalization makes them non-quantities (ADR 0006); the driving-skill
   label carries the causal story and that is sufficient under this standard.
4. **Standing debt is named, not tolerated silently.** The Rotation Median
   currently fails the standard (an aggregate with no named cause). Its
   explanation rung (descriptive: viable-combo count, min/median/max) is owed,
   as is a per-combo ledger read for bench attribution.

## Considered options

- Full transparency (user-facing math audit) — rejected: teaches regression
  coefficients instead of basketball; the barbershop argument doesn't run on it.
- Capping engine complexity at what decomposes linearly — rejected: dumber
  engine teaches wrong basketball; betrays Software as Education from the
  other side.
- Trust-the-engine (no explanation) — rejected outright: authority overreach;
  unexplained harsh grades read as bugs (decision-weight research).

## Consequences

- Every future engine mechanism (e.g. #95 viability retune, #100 passing
  composite) carries an acceptance criterion: name your bite at the
  Touchpoint where it changes a grade.
- The Attribution Ledger's unevenness ("as decomposable as the formula, no
  further") is the intended equilibrium, not a gap to be closed with
  invented per-player numbers.
- Explanation rungs are product surface, not debug output — they get design
  attention (Signifiers, Progressive Disclosure) like any other Touchpoint.
