# Secure Handler skill — TOV% primary, per-touch secondary, AST/TO rejected as primary

**Status:** accepted
**Date:** 2026-07-02
**Related issue:** #41 Add Ball Security stat-derived Skill mapping in draft Snapshot workflow
**Related research:** `docs/research/secure-handler-evidence.md`

## Context

Issue #41 adds a dedicated stat-derived Skill for ball security, replacing the
passer-proxy input behind the Ball Security Impact Trait. The mapping had to be
research-backed (AC1) and guard against over-promoting low-usage Players (AC2).

Three candidate metric families existed, each with a known failure mode:

- **Raw turnovers per game** rewards players who never touch the ball and
  punishes high-volume creators — league TOV leaders are stars, not careless
  players.
- **AST/TO ratio** conflates passing skill with turnover avoidance and
  structurally punishes non-passers (an elite-security scorer like prime Durant
  posts a modest AST/TO).
- **Oliver TOV%** (`tov / (fga + 0.44*fta + tov)`) is the community-consensus
  ball-security measure, but its denominator counts only scoring usage — pure
  playmakers look worse than their real per-touch security — and it misses
  fumble-prone bigs whose low raw TOV hides bad per-touch hands.

The skill-curve literature (Oliver; Goldman & Rao) adds one more constraint:
low TOV% is only impressive conditional on handling volume, so a role/usage
gate is load-bearing, not optional.

## Decision

The new Skill is keyed **`secure_handler`** ("Secure Handler"), following the
player-archetype-noun convention for Skills; the Impact Trait keeps the
team-quality key `ball_security`.

The mapping Contract:

1. **Primary metric: Oliver TOV%**, expressed as threshold-JSONB
   `computed_stats` (a `sum` for the denominator, then a `ratio`) — no engine
   code change, no new stat fetching.
2. **Secondary metric: turnovers per 100 touches** (`tov / touches`), catching
   the two failure modes TOV% misses (playmakers and fumble-prone bigs).
3. **Volume gate:** Elite requires ball responsibility — touches ≥ ~30/game or
   usage_rate ≥ ~18%. Low-usage players cap lower rather than being excluded.
4. **Tier bumps:** Elite-band TOV% at usage ≥ ~28% (skill-curve credit), and
   AST/TO ≥ ~3.5 above a passing-volume floor (credits playmakers whose Oliver
   TOV% understates them).
5. **AST/TO is rejected as a primary metric** — bump-only.
6. **Confidence bucket: HIGH** — turnover economy is fully stat-measured;
   Claude assessment is not called for this skill. Downgrade to MODERATE later
   if composite review shows systematic misreads.

Starting tier bands (tuned live in draft-Snapshot calibration, not fixed here):
Elite ≤ 10.5% TOV%, Proficient ≤ 12.5%, Capable ≤ 14%; per-touch ≤ 2.5 / 3.5 /
4.5 per 100 touches. Player anchors: Haliburton 2024-25 (9.9% TOV% at ~10 apg)
= Elite; league average ~13–14% = Capable boundary.

The per-touch cutoffs have no published canonical benchmarks — they are derived
starting points to verify against the Snapshot blob distribution during
calibration.

## Consequences

- The Ball Security Impact Trait reads the `secure_handler` tier when present,
  falling back to the legacy passer/pnr_ball_handler/driver proxy only for
  Skill Profiles that lack the skill (unbackfilled Legends). Proxy retirement
  is a data event (backfill completion), not a code release.
- Legends backfill is deferred to a follow-up issue; the fallback covers the
  transition window.
- The skill participates only in the `ball_security` trait — no synergy rules,
  accentuation entries, or other composite coefficients in this slice.
- Adding the 22nd skill is a taxonomy mutation and ships as a new Evaluation
  Version.
