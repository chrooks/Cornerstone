# 0008 — Primary/depth blend weights are calibration judgments, not research-backed

- Status: accepted
- Date: 2026-07-30
- Issue: [#129](https://github.com/chrooks/Cornerstone/issues/129)

## Context

Several cohesion subscores share one blend pattern: score a lineup by its best
option, (sometimes) its second-best, and the lineup-wide average.

- `_collective_passing` (`cohesion.py`): `max(passer) * 0.6 + avg(passer) * 0.4`
- `_top_two_plus_depth` (`cohesion.py`): rebounding (45/35/20), perimeter and
  interior defense (60/30/10), post game (50/35/15), PnR handler (65/25/10),
  PnR screener (55/30/15) — defaults in `weights.py:283-319`.

The weights trace to commit `81bc9b5` ("Overhaul scoring model with PnR pairing,
depth weighting, and defensive saturation") — a calibration pass. ADRs 0005–0007
cite research about UI trust and glyph presentation, not the basketball validity
of these numbers. Issue #129 asked that this gap be either closed with research
or documented honestly.

## What public research does and doesn't support

A literature pass (2026-07-30) found directional support for the *shape* of the
pattern, and nothing for the specific numbers:

- Diminishing-returns work on team construction holds that overlapping elite
  skill on one lineup yields less than the sum of its parts, and that an
  effective lineup wants one excellent playmaker plus above-average depth —
  which is what `max()` (primary) blended with `avg()` (depth) encodes.
  ([nbacademic, player archetypes and team construction](https://nbacademic.wordpress.com/2017/06/14/nba-theory-player-archetypes-and-team-construction-part-1/))
- Modern passing metrics (creation volume/quality, on-ball share) distinguish
  primary creators from connectors, supporting a primary-weighted blend over a
  flat average. ([Basketball Index passing guide](https://www.bball-index.com/a-guide-to-passing-stats/),
  [The NBA Underground on contextualized playmaking](https://thenbaunderground.com/analytics/better-passing-stats))
- No published work pins a 0.6/0.4 (or 60/30/10, etc.) split for any of these
  subscores.

## Decision

The blend **pattern** (primary-weighted, depth-blended) is treated as
directionally sound per the above. The specific **weights** are calibration
judgments and are documented as such — no commissioned research, no retune
from this ADR.

## Ceiling and revision path

- Ceiling: the splits express intuition tuned against eyeball checks of known
  lineups, not fitted against outcome data. Rankings that hinge on small margins
  between saved teams inherit that softness.
- Any retune goes through the normal calibration workflow and ships as a new
  published evaluation version (ADR 0002) — never an in-place edit — so saved
  teams keep their scores.
- If lineup-level outcome data is ever ingested, fitting these weights against
  it supersedes this ADR.
