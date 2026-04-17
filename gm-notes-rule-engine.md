# Feature: GM Notes Rule Engine + Final Eval

## Overview

Live GM Notes tab in the roster builder + a Final Eval page. Both powered by a
backend rule engine that evaluates a roster against the team-building heuristics doc.

---

## Requirements

### Live GM Notes
- Fires on player add/remove only (reorder is cosmetic, no re-eval)
- 500ms debounce
- Returns top 7 prioritized bullet notes with severity badges
- Notes name players currently in the roster — never suggest specific players to add
- Admin-only: collapsible debug trace panel in UI

### Final Eval
- New page: `/builder/evaluate` (reads same URL params as builder)
- Reached via "Evaluate Roster" button on builder page
- Full strengths + weaknesses breakdown, all notes (no cap)
- Stubbed "Save Roster" button (visible to logged-in users, disabled, "Coming soon" tooltip)
- Admin-only: debug trace panel same as live notes

### Rule Engine
- Backend-only: `backend/services/roster_evaluator/`
- All tunable weights in `weights.py` — no magic numbers in logic
- Every calculation returns `ScoreTrace` (score + components + multipliers + label)
- `POST /api/builder/evaluate` handles both `live` and `final` modes
- `debug=true` includes full traces in response (admin-gated in UI)

---

## File Structure

```
backend/
  api/
    builder.py                     # new blueprint
  services/
    roster_evaluator/
      __init__.py                  # exports evaluate_roster()
      weights.py                   # all tunable numbers
      types.py                     # ScoreTrace, Note, RosterEvaluation dataclasses
      player_scores.py             # per-player functions
      aggregates.py                # cross-roster functions
      rules.py                     # Phase 2 rule functions → Note | None
      evaluator.py                 # orchestrates all phases

frontend/
  app/builder/evaluate/
    page.tsx                       # final eval page
  components/builder/
    AssistantGmNotes.tsx           # updated: live call + debug panel
    FinalEvaluation.tsx            # new: strengths/weaknesses + save stub
  lib/
    api.ts                         # add evaluateRoster()
    types.ts                       # add Note, RosterEvaluation frontend types
```

---

## Data Model

### Input

```python
# Unified player shape (legend profile normalized to same format before Phase 1)
{
  "name": "Luka Doncic",
  "height": "6-7",        # used for size_modifier
  "skills": {
    "off_dribble_shooter": "Elite",
    "isolation_scorer": "Elite",
    "passer": "All-Time Great",
    # ... all 21 skills
  }
}
```

### Core Types

```python
@dataclass
class ScoreTrace:
    score: float
    components: dict[str, float]   # skill/factor → contribution
    multipliers: dict[str, float]  # name → multiplier applied
    label: str                     # human-readable summary for debug UI

@dataclass
class Note:
    severity: Literal["critical", "warning", "tip", "strength"]
    category: Literal["offense", "defense", "two_way", "roster_balance"]
    text: str                      # names players from current roster
    trace_key: str                 # links to which aggregate drove this note

@dataclass
class RosterEvaluation:
    notes: list[Note]
    player_traces: dict[str, dict] | None   # None when debug=False
    aggregate_traces: dict[str, ScoreTrace] | None
```

### Tier Weights

```python
TIER_WEIGHTS = {
    "None": 0,
    "Capable": 1,
    "Proficient": 2,
    "Elite": 3,
    "All-Time Great": 4,
}
```

---

## Implementation Phases

### Phase 0 — Types & Config

- `types.py`: `ScoreTrace`, `Note`, `RosterEvaluation` dataclasses
- `weights.py`: all tunable numbers grouped by category (no logic)
- `lib/types.ts`: mirror `Note` and `RosterEvaluation` on frontend

---

### Phase 1 — Per-Player Scores (`player_scores.py`)

Each function returns `ScoreTrace`. Computed before any cross-roster work.

#### `parse_height(height_str) → int`
`"6-3"` → 75 inches. Returns `None` if malformed — size_modifier skipped gracefully.

#### `size_modifier(player) → ScoreTrace`
- Scale height 72"–84" → 0.6–1.0
- `high_flyer` tier adds up to +0.2 (partially restores small-player defensive penalty)
- Applied to scale down each player's defensive skill contributions

#### `on_ball_scoring_threat(player) → ScoreTrace`
Weighted sum from `weights["on_ball_scoring"]`:
- `off_dribble_shooter`, `isolation_scorer` (1.0×)
- `mid_post_player`, `driver` (0.8×)
- `low_post_player` (0.7×)
- `crafty_finisher` (0.5×)
- `transition_threat` (0.4×) — dual on/off-ball skill, contributes here too

#### `gravity(player) → float`
`scale(on_ball_scoring_threat.score, 0.0, 1.0)` — derived, no trace needed.

#### `off_ball_gravity(player) → ScoreTrace`
- Spacing component: `spot_up_shooter * 1.0 + movement_shooter * 1.2`
- Cutting component: `cutter * 0.9 + vertical_spacer * 0.8 + high_flyer * 0.5`
- `transition_threat` also contributes (dual skill)
- Scaled 0.0–1.0

#### `effective_on_ball_threat(player) → ScoreTrace`
- `scoring = on_ball_scoring_threat.score`
- `passing_contribution = tier_weight("passer") * gravity`
- Components: scoring breakdown + "passer (gravity-gated)" separately
- Multipliers: `{"gravity": 0.82}`
- Captures: Cam Thomas (high scoring, low passing discount) vs Jokic (high scoring, passing fully unlocked)

#### `is_exclusively_onball(player) → bool`
Has ≥ Capable in any on-ball skill AND no off-ball skill ≥ Capable AND no shooting ≥ Capable.

#### `is_twoway(player) → bool`
≥ Capable in ≥1 offensive skill AND ≥1 of `perimeter_disruptor`, `versatile_defender`, `rim_protector`.

#### `is_offensive_blackhole(player) → bool`
No shooting ≥ Capable AND no creation ≥ Capable. Defensive-only player dragging spacing.

---

### Phase 2 — Cross-Roster Aggregates (`aggregates.py`)

Takes unified player list. Returns `dict[str, ScoreTrace]`.

#### `spacing_score`
```python
movement_raw  = skill_score(roster, "movement_shooter") * 2
spot_up_raw   = skill_score(roster, "spot_up_shooter") * 1
screen_mult   = scale(skill_score(roster, "screen_setter"), min=0.5, max=1.2)
effective     = (movement_raw * screen_mult) + spot_up_raw
```
Trace: components show raw values, multipliers show `screen_mult`.
Thresholds (tunable in weights.py): `< 3.0` = critical, `< 5.0` = warning.

#### `passer_compound_score`
```python
raw       = skill_score(roster, "passer")
compounded = raw ** 1.2   # non-linear stacking
```
Two elite passers >> 2× one elite passer.

#### `perimeter_compound_score`
```python
raw        = skill_score(roster, "perimeter_disruptor")
            + skill_score(roster, "versatile_defender") * 0.7
compounded = raw ** 1.3   # stronger compounding than passers (Thunder effect)
```

#### `defense_score`
```python
rim_score  = skill_score(roster, "rim_protector", size_weighted=True)
rim_mult   = scale(rim_score, 1.0, 1.4)   # rim anchor amplifies perimeter
defense    = (rim_score * rim_mult) + perimeter_compound + (versatile_score * 0.9)
```
Each player's defensive contributions scaled by `size_modifier(player)`.

#### `cutter_score`
Four gates compound:
```python
cutter_raw      = skill_score(roster, "cutter")
passer_mult     = scale(passer_compound_score, 0.2, 1.0)
spacing_mult    = scale(spacing_score, 0.3, 1.0)
screen_mult     = scale(skill_score(roster, "screen_setter"), 0.6, 1.0)
onball_grav_mult = scale(sum(gravity(p) for p in roster), 0.5, 1.0)
effective       = cutter_raw * passer_mult * spacing_mult * screen_mult * onball_grav_mult
```

#### `paint_touch_score`
Weighted count of players with ≥ Capable in: `driver`, `vertical_spacer`,
`mid_post_player`, `low_post_player`. Weighted by tier (Elite driver worth more than Capable mid-post).

#### `rebounding_covered → bool`
`elite_rebounder_count ≥ 1` OR `capable_rebounder_count ≥ 3`.

#### Boolean derived checks
- `lob_threat_active`: `vertical_spacer_best ≥ Capable` AND any player `passer ≥ Proficient` OR `driver ≥ Proficient`
- `pnr_synergy`: `pnr_ball_handler_best ≥ Proficient` AND `pnr_finisher_best ≥ Proficient`
- `transition_active`: `transition_count > 0` AND `passer_best ≥ Proficient`
- `movement_orphaned`: `movement_shooter_count > 0` AND `screen_setter_score == 0`

---

### Phase 3 — Rules (`rules.py`)

Each rule: `check_X(agg: dict, players: list) → Note | None`.
Players list available for naming in note text. Never suggest specific players to add.

#### Defense
| Rule | Condition | Severity |
|------|-----------|----------|
| `check_rim_anchor` | No rim ≥ Proficient AND versatile_count < 3 | Critical |
| `check_perimeter_compounding` | perimeter_compound_score below threshold | Warning |
| `check_defense_blackhole` | Player(s) no defensive floor, not Elite offense | Warning (named) |
| `check_offensive_blackhole` | Player(s) dragging spacing, good on defense | Warning (named) |
| `check_rebounding` | Not `rebounding_covered` | Warning |

#### Offense
| Rule | Condition | Severity |
|------|-----------|----------|
| `check_spacing_critical` | spacing_score < 3.0 | Critical |
| `check_spacing_warning` | spacing_score < 5.0 | Warning |
| `check_movement_orphaned` | movement shooters, no screens | Warning (names shooters) |
| `check_screen_cutter_gap` | cutters present, screen_setter_score low | Tip |
| `check_cutter_activation` | cutter_score gap vs raw cutter talent | Warning (names cutters) |
| `check_lob_threat_activation` | vertical spacer present, no lob thrower | Warning (names spacer) |
| `check_creator_floor` | creator_count == 0 | Critical |
| `check_creator_floor` | creator_count == 1 | Warning |
| `check_exclusively_onball_quality` | exclusively on-ball player, not Elite | Warning (named) |
| `check_pnr_synergy` | strong ball handler, weak finisher or vice versa | Tip |
| `check_transition` | transition threats, no playmaker passer | Tip |
| `check_paint_source` | paint_touch_score == 0 | Critical |

#### Strengths (final mode only, `severity="strength"`)
- `check_elite_spacing` — spacing_score above strong threshold
- `check_defensive_depth` — defense_score above strong threshold
- `check_twoway_premium` — multiple two-way players
- `check_passer_abundance` — passer_compound_score high
- `check_pnr_excellence` — full PnR synergy with finisher complements

#### Priority ordering
High-flexibility skill gaps (passers, versatile defenders, rim protectors, movement shooters)
generate higher-severity notes than equivalent gaps in lower-flexibility skills.
Enforced via `SEVERITY_ORDER` in `weights.py`.

---

### Phase 4 — Evaluator + Blueprint

#### `evaluator.py`

```python
def evaluate_roster(
    players: list[dict],
    mode: Literal["live", "final"] = "live",
    debug: bool = False,
) -> RosterEvaluation:
    # Normalize: legend profile → same shape as PlayerWithSkills.skills
    players = [normalize_player(p) for p in players]

    # Phase 1
    player_traces = {p["name"]: compute_player_traces(p) for p in players}

    # Phase 2
    agg, agg_traces = compute_aggregates(players, player_traces)

    # Phase 3
    notes = [note for rule in ALL_RULES if (note := rule(agg, players))]
    if mode == "final":
        notes += [note for rule in STRENGTH_RULES if (note := rule(agg, players))]

    notes.sort(key=lambda n: SEVERITY_ORDER[n.severity])
    if mode == "live":
        notes = notes[:7]

    return RosterEvaluation(
        notes=notes,
        player_traces=player_traces if debug else None,
        aggregate_traces=agg_traces if debug else None,
    )
```

#### `api/builder.py`

```
POST /api/builder/evaluate
Body: {
  players: [...],       # list of unified player objects
  mode: "live"|"final",
  debug: bool           # admin-only; UI enforces, backend trusts
}
Returns: RosterEvaluation as JSON
Auth: none required
```

Register in `app.py` with prefix `/api/builder`.

---

### Phase 5 — Frontend: Live GM Notes
Use UI-UX Pro Max 

#### `lib/api.ts`
Add `evaluateRoster(payload: EvaluatePayload): Promise<RosterEvaluation>` using existing `apiFetch`.

#### `AssistantGmNotes.tsx`
- Replace static stub
- `useEffect` on `filledSlotCount` (not slot order) → debounced 500ms
- States: `idle` | `analyzing` | `ready` | `error`
- `analyzing` → skeleton bullets
- `ready` → severity-badged bullets:
  - Critical: red badge
  - Warning: amber badge
  - Tip: blue badge
- Admin-only: collapsible "Debug Traces" section at bottom, raw JSON formatted

---

### Phase 6 — Frontend: Final Eval Page
Use UI-UX Pro Max 

#### `app/builder/evaluate/page.tsx`
- Reads same URL params: `cornerstone`, `s1`–`s8`
- On mount: `evaluateRoster({ players, mode: "final", debug: isAdmin })`
- Layout:
  - Top: roster summary (player names/slots, read-only)
  - Two columns: **Strengths** (green) | **Areas to Address** (amber/red)
  - Tips section below columns
  - Admin debug panel (collapsed by default)
- "Save Roster" button: visible if `user` exists, `disabled`, tooltip "Coming soon"
- Back button: returns to `/builder?[same params]`

#### Builder page change
Add "Evaluate Roster" button below rotation slots. Navigates to `/builder/evaluate?[current params]`. Disabled until cornerstone + ≥1 slot filled.

---

## Dependency Order

```
Phase 0 (types/config)
  └─ Phase 1 (per-player scores)
       └─ Phase 2 (cross-roster aggregates)
            └─ Phase 3 (rules)
                 └─ Phase 4 (evaluator + blueprint)
                      ├─ Phase 5 (live GM Notes)
                      └─ Phase 6 (final eval page)
```

Phases 5 and 6 are independent of each other.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Weight tuning produces nonsensical notes early | Medium | Debug panel in UI from day one — tune before shipping |
| Height data missing/malformed for some players | Low | `parse_height` returns `None` → size_modifier skipped, no crash |
| 500ms debounce feels slow on fast slot changes | Low | Show "analyzing..." immediately on change |
| Legend profile shape differs from PlayerWithSkills.skills | Low | Normalize in evaluator before Phase 1 |
| Final eval URL params stale if user edits roster after navigating away | Low | Re-evaluate on each visit to `/builder/evaluate` |

---

## Open Questions / Future Scope

- Actual save-to-profile implementation (Phase 6 button stubbed)
- Weight tuning pass after initial implementation (use debug panel)
- Consider caching eval results keyed on roster hash to avoid redundant recomputation
