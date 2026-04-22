# Suggestion System — How Notes Are Generated

## Overview

The note system produces four severity levels: `critical`, `warning`, `suggestion`, `strength`.
Suggestions are the "directional" tier — they tell you what to add or reconsider, not what is broken.

---

## What Currently Triggers a Suggestion

There are two independent paths that produce a suggestion note.

### Path 1 — Negative modifier on a healthy dimension

Any modifier that fires with a *negative* delta (a penalty) on a dimension that is still
**healthy in the final score (≥ 55)** is downgraded to a suggestion.

Examples:
- `OFF_35` (2+ non-shooters) fires with -16 on spacing, but if spacing = 92 → suggestion, not warning
- `DEF_07` (offensive black hole) fires with -8 on spacing, but if spacing = 70 → suggestion

The severity ladder for negative notes:
```
final dimension score < 30   → critical
final dimension score < 55   → warning
final dimension score ≥ 55   → suggestion
```

Some modifiers have a `note_min_severity` override that prevents downgrading:
- `DEF_07` — always at least `warning` (a black hole is a structural floor concern)
- `OFF_12` — always at least `warning` (cutter without passer is structurally broken)
- `OFF_35` — always at least `warning` (non-shooter stacking is a floor-space signal)

### Path 2 — Absence modifier with a positive delta

Modifiers tagged `presence_type = "absence"` fire when something is *missing* from the roster.
If their delta is positive (a gap-compensation bonus), they are classified as suggestions —
directional recommendations for what to add.

| Modifier | Fires When | Suggests |
|----------|-----------|---------|
| `DEF_04` | No rim protector, 3+ versatile defenders | Add a rim protector |
| `DEF_05` | Height coverage gaps in 6'0"–7'2" window | Add a VD in that size range |
| `DEF_09` | No elite rebounder, < 3 capable rebounders | Add an elite or two capable rebounders |
| `OFF_01` | Spacing too thin for the offense to function | Add a shooter |
| `OFF_03` | 2+ movement shooters but no screen setter | Add a screen setter |
| `OFF_05` | Creation and spacing gap > 30 pts | Balance the weaker dimension |
| `OFF_09` | Only one creator on the roster | Add a secondary creator |
| `OFF_12` | Cutter(s) present, no passer | Add a passer |
| `OFF_13` | Cutter(s) present, spacing too low | Add a shooter to open lanes |
| `OFF_15` | Vertical spacer present, no lob passer | Add a passer or driver |
| `OFF_19` | Low post player, poor spacing | Add a floor spacer |
| `OFF_21` | Mid post player, poor spacing | Add a floor spacer |
| `OFF_23` | Iso scorer, poor spacing | Add a corner shooter |

### Suppression rules

In **live mode**, absence suggestions are suppressed when the supporting rotation
has fewer than `ABSENCE_NOTE_MIN_PLAYERS` (currently 3) players.
This prevents noise when the roster is too small to draw meaningful conclusions.

In **final mode**, all notes including absence suggestions always appear.

---

## What Does NOT Currently Trigger Suggestions

**The biggest gap: no suggestions fire with 0 supporting players.**

Even with a fully-profiled cornerstone (e.g. Durant — elite scorer, shooter, defender),
the system has nothing to evaluate against. Every modifier requires at least one
supporting player to produce output.

The result:
- Stage 0 (cornerstone only): no notes at all
- Stage 1 (1 supporting player): suppressed by `ABSENCE_NOTE_MIN_PLAYERS`
- Stage 2 (2 supporting players): still suppressed
- Stage 3+ (3 supporting players): suggestions start appearing

---

## Proposed: Cornerstone-Complement Suggestion Layer

The goal is to surface directional suggestions at every stage of the builder:

### Stage 0 — Cornerstone selected, no supporting players yet

Analyze the cornerstone's skill profile and produce archetype-level co-star recommendations.

For example, with **Durant** (Elite: driver, versatile_defender, spot_up_shooter; Proficient: passer):

> "Durant's elite off-ball scoring and perimeter defense pair best with an elite PnR ball handler
> as co-star — someone who can shoulder primary creation and use Durant off screens."

> "No rim protector on the roster — a shot-blocking co-star (Wembanyama, Gobert archetype)
> would anchor the interior Durant can't cover at 6'9"."

The suggestions are derived from gap analysis on the cornerstone's profile:
- **No creation skills** → suggest PnR handler or elite driver as co-star
- **No rim protection** → suggest rim protector
- **No passer skill** → suggest a pass-first co-star to enable off-ball actions
- **Elite on-ball skills** → suggest a spacer complement (off-ball wing, shooter)
- **Defensive weakness by height** → suggest a versatile defender in the gap range

### Stage 1 — One supporting player added

Shift from "co-star" framing to "3rd player / core-rounding" framing.
The suggestions now factor in what the co-star brought and what the core still needs.

### Stage 2 — Two supporting players added

Shift to "rotation rounding" framing. Absence modifiers now have enough context to fire
meaningfully. The cornerstone-complement layer steps back.

### Stage 3+ — Three or more supporting players

Current system takes over fully. Absence modifiers are no longer suppressed.
Cornerstone-complement layer is retired.

---

## Architecture

The cornerstone-complement layer would be a new module:
`backend/services/roster_evaluator/cornerstone_complement.py`

It takes `(cornerstone: dict, supporting_players: list[dict])` and returns `list[Note]`.
The evaluator calls it in early stages and merges the results into `all_notes`.

Key design: this module does NOT compute scores or run modifiers.
It is a pure profile analysis — looks at the cornerstone's skill taxonomy and
produces template-based archetype suggestions keyed to identified gaps.

The suggestions should:
- Be archetype-level, not player-specific (avoid recommending named players)
- Reference the cornerstone by name to feel personalized
- Shift framing as the roster fills ("co-star" → "third player" → "rotation piece")
- Not repeat gaps already addressed by existing supporting players

