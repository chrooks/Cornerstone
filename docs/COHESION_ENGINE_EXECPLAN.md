# Build the Cohesion Engine — a new roster evaluation system for Cornerstone

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This document must be maintained in accordance with `~/.claude/PLAN.md`.

Design reference: `docs/SCORING_EVAL_DESIGN.md`
Implementation spec reference: `docs/SCORING_EVAL_IMPL_SPEC.md`
Prototype script: `scripts/compute_composites.py`


## Purpose / Big Picture

Cornerstone is an NBA roster builder where users pick a legendary cornerstone player, then fill 7 supporting slots to build a 9-player roster. The current evaluation engine (`backend/services/roster_evaluator/`) scores rosters on a 0-100 scale using 37 hand-written modifier functions that check for specific skill combinations. This engine has been through two iterations and has become difficult to tune and extend.

The new cohesion engine replaces it with a three-layer architecture: (1) compute 11 per-player composite scores from their 19-skill profiles, (2) evaluate lineup cohesion for every possible 5-man combination from the 9-player roster, (3) produce a 5-star roster rating plus 1-3 each of strengths, weaknesses, and suggestions. The composites are intuitive (Spacing, Finishing, Paint Touch, Anchor, Post Game, PnR Screener, Off-Ball Impact, Shot Creation, Rebounding, Transition), the lineup cohesion captures how players fit together (not just how good they are individually), and the notes system gives users actionable feedback at every step of roster construction — even with just 1 player selected.

After this change, a user building a roster will see a star rating (0-5) instead of a 0-100 score, receive more intuitive feedback about their lineup's strengths and gaps, and benefit from a system where defensive coverage is modeled as a continuous bell curve rather than binary height-hole checks. Developers will find the engine easier to tune because all constants live in a single `weights.py` file and the calibration UI (future work) can adjust them at runtime.

To verify the engine is working: start the Flask backend with `EVAL_ENGINE=cohesion` set in `backend/.env`, navigate to the builder at `http://localhost:3000/builder`, add players to a roster, and observe the new star rating, composite breakdowns, and structured notes in the evaluation panel. The existing engine continues to work when `EVAL_ENGINE=legacy` (the default).


## Progress

- [x] (2026-04-26) Phase 1: Foundation (types.py, weights.py, __init__.py)
- [x] (2026-04-26) Phase 2: Player-level computation (composites.py, bell_curve.py)
- [x] (2026-04-26) Phase 3: Lineup-level computation (synergies.py, ratios.py, accentuation.py, cohesion.py)
- [x] (2026-04-26) Phase 4: Roster scoring (roster.py)
- [ ] Phase 5: Notes system (notes.py)
- [ ] Phase 6: Claude narrative (team_description.py)
- [ ] Phase 7: API integration + frontend types
- [ ] Phase 8: Test suite


## Surprises & Discoveries

- Observation: This repository uses `CLAUDE.md` as the local agent instruction file rather than a project-level `AGENTS.md`.
  Evidence: `find . -name CLAUDE.md -print` returned `./CLAUDE.md`; `find .. -name AGENTS.md -print` did not return an AGENTS.md inside the `cornerstone` repository. The Phase 1 implementation followed `CLAUDE.md`'s backend testing guidance and the user-provided immutability rule.

- Observation: The referenced common Codex rule files in the user-provided AGENTS-style context are not present in this local environment.
  Evidence: Attempts to read `~/.codex/rules/common/coding-style.md`, `git-workflow.md`, `security.md`, `agents.md`, and `development-workflow.md` returned "No such file or directory." The active in-repo guidance came from `CLAUDE.md`, the ExecPlan, and the scoring specs.

- Observation: The distribution builder originally imported the Supabase client at `composites.py` module import time, which made pure formula tests load database dependencies unnecessarily.
  Evidence: The implementation now lazy-loads `get_supabase()` and `run_query()` only inside `build_distributions()`, so `compute_raw_composites()`, `normalize_composites()`, and `compute_player_composites()` can be imported and tested without touching the database client.

- Observation: The Phase 3 docs name several lineup subscores as "totals," but the rollup contract expects every subscore on a 0-10 scale.
  Evidence: `cohesion.py` computes player composite totals as lineup averages for `paint_touch_total`, `post_game_total`, `pnr_screener_total`, `anchor_total`, `rebounding`, and `transition`, then clamps each subscore to 0-10. This preserves bounded rollup behavior while still rewarding lineup-wide strength.

- Observation: Manual Phase 4 smoke checks without database-built percentile distributions produce low roster star ratings because theoretical-max fallback normalization is intentionally conservative for multiplicative composites.
  Evidence: A nine-player synthetic roster returned `star_rating=0.67`, `total_lineups=126`, and `median_score=1.02`. This validates the roster pipeline shape while confirming that meaningful real-player calibration still depends on `build_distributions()` or later integration with database data.


## Decision Log

- Decision: Use hybrid percentile normalization (60th percentile breakpoint) instead of theoretical max normalization.
  Rationale: Theoretical max normalization produced compressed scores for multiplicative composites (e.g., Jokic's paint touch was 1.8/10 despite being one of the best interior scorers alive). Percentile normalization against the full player pool (current + legends) gives natural meaning to the scale. The 60th percentile breakpoint allocates 40% of the 0-10 scale (6.0-10.0) to the top 40% of players, spreading the elite tier meaningfully. Pure percentile at 100th clustered everyone at 9+; 80th percentile still clustered at 8+; 70th percentile still had issues (Curry's post game was 7.0 from a tiny crafty_finisher contribution); 60th percentile produces the best spread.
  Date/Author: 2026-04-25, design session

- Decision: Split Big Man Score into three composites: Anchor, Post Game, PnR Screener.
  Rationale: A single composite couldn't distinguish Gobert (elite rim presence, zero post scoring) from Jokic (elite post scoring, moderate rim presence) from a pure screen-and-roll big. Gobert was scoring 7.2 "Post Game" entirely from PnR finishing, which felt wrong — he has zero traditional post moves. The split gives Gobert 0.0 Post Game and 7.4 PnR Screener, which matches reality.
  Date/Author: 2026-04-25, design session

- Decision: Remove crafty_finisher from Post Game composite.
  Rationale: Crafty finisher (floaters, layups) was giving Curry a 7.0 Post Game score despite having zero post skills. Crafty finishing is already captured in the Finishing composite, which feeds into Paint Touch. Post Game should be purely about traditional post moves (low_post + mid_post).
  Date/Author: 2026-04-25, design session

- Decision: Synergies modify skill tier values BEFORE composite computation (Option A), not after.
  Rationale: More accurate — a screen setter should boost a movement shooter's `movement_shooter` value specifically, not their entire Spacing composite (which would also boost spot_up_shooter undeservedly). Performance cost is negligible (6,300 simple arithmetic operations per roster evaluation).
  Date/Author: 2026-04-25, design session

- Decision: New engine lives in `cohesion_engine/` alongside existing `roster_evaluator/`. Engine toggle via env var.
  Rationale: Big bang swap after validation. The old engine stays untouched until the new one produces sensible results. An `EVAL_ENGINE` env var switches between them at the API layer.
  Date/Author: 2026-04-25, design session

- Decision: Cornerstone complement module (`cornerstone_complement.py`) is deprecated.
  Rationale: Its function (early-game suggestions) is fully replaced by Mode A notes + the accentuation system.
  Date/Author: 2026-04-25, design session

- Decision: Normalize Phase 3 "total" subscores as lineup averages rather than raw sums.
  Rationale: Raw sums of five normalized 0-10 player composites can reach 50, but `COHESION_ROLLUP_WEIGHTS` assumes each input is normalized to 0-1 by dividing the subscore by 10. Averaging keeps each total on the same 0-10 scale as ratios and defensive subscores without adding premature calibration constants.
  Date/Author: 2026-04-26, implementation

- Decision: Return an empty zero-score `LineupCohesion` for rosters with fewer than five players.
  Rationale: `RosterEvaluation.starting_lineup` is a required dataclass field, but lineups are only meaningful with five players. A zero placeholder keeps the API shape stable until Phase 5 adds Mode A notes for partial rosters.
  Date/Author: 2026-04-26, implementation


## Outcomes & Retrospective

- Phase 1 outcome: The new `backend/services/cohesion_engine/` package now exists with a public `evaluate_roster()` stub, frozen dataclasses for the planned response shapes, and a centralized `weights.py` containing the Phase 1 constants from `docs/SCORING_EVAL_IMPL_SPEC.md` sections 1-8 plus Layer 2 roster normalization constants. Initial tests cover dataclass construction, dataclass immutability, and the pinned weight values needed by later phases.
  Verification: `source backend/venv/bin/activate && python -m pytest backend/tests/test_cohesion_engine/ -v` passed with 12 tests. The requested import checks for `types.py` and `weights.py` also completed successfully.

- Phase 2 outcome: `backend/services/cohesion_engine/composites.py` now computes raw player composites using the validated formulas, normalizes via the cached 60th-percentile hybrid distribution when enough population data exists, falls back to theoretical max normalization for small or empty caches, builds distributions from current plus legend skill profiles, and returns `PlayerComposites` dataclasses. `backend/services/cohesion_engine/bell_curve.py` now computes defensive bell parameters, evaluates trapezoid/quadratic defensive value by target height, applies the RP-to-PD teammate boost without mutating input players, and computes lineup defensive coverage with diminishing stacking returns.
  Verification: `source backend/venv/bin/activate && python -m pytest backend/tests/test_cohesion_engine/ -v` passed with 29 tests. Manual smoke checks imported `compute_raw_composites`, `normalize_composites`, `compute_player_composites`, `compute_bell_params`, and `compute_lineup_defense`; constructing a sample `PlayerComposites` and evaluating a three-player defensive lineup both completed successfully.

- Phase 3 outcome: The lineup cohesion layer now exists. `synergies.py` applies all 12 Phase 3 synergy checks without mutating input players. `ratios.py` implements the harmonic-mean balance scores. `accentuation.py` computes strength amplification and weakness coverage from normalized player composites. `cohesion.py` orchestrates RP-to-PD boost, synergies, player composite computation, 13 bounded subscores, defensive coverage/gaps, accentuation, and weighted 0-5 lineup scoring.
  Verification: `source backend/venv/bin/activate && python -m pytest backend/tests/test_cohesion_engine/ -v` passed with 47 tests. `python -m py_compile` succeeded for `ratios.py`, `synergies.py`, `accentuation.py`, and `cohesion.py`. A manual `evaluate_lineup()` smoke check returned score `1.21`, all 13 expected subscore keys, and synergy IDs including `OFF-28`.

- Phase 4 outcome: `backend/services/cohesion_engine/roster.py` now implements the public roster evaluator. It computes base player composites, handles partial rosters without lineup scoring, evaluates all five-man combinations for rosters with at least five players, uses slot order for the starting lineup, computes starting-five/depth/archetype-diversity/floor breakdown values, and returns a `RosterEvaluation`. `backend/services/cohesion_engine/__init__.py` now re-exports the real `evaluate_roster()` implementation instead of the Phase 1 stub.
  Verification: `source backend/venv/bin/activate && python -m pytest backend/tests/test_cohesion_engine/ -v` passed with 52 tests. `python -m py_compile backend/services/cohesion_engine/roster.py backend/services/cohesion_engine/__init__.py` succeeded. Manual smoke checks confirmed a partial roster returns zero lineups and one base composite, while a nine-player roster returns `total_lineups=126`, a normalized star breakdown, and a 0-5 star rating.


## Code Review Findings

(To be populated after code review.)

### High Risk

### Medium Risk

### Low Risk


## Context and Orientation

The Cornerstone application is a three-layer NBA skill evaluation and roster builder platform. The tech stack is Next.js (frontend) + Flask (backend) + Supabase PostgreSQL (database).

The backend lives at `backend/`. The Flask app factory is in `backend/app.py`, which registers 11 blueprints including `api/builder.py` (the roster evaluation endpoint). All business logic lives in `backend/services/`.

The current evaluation engine is at `backend/services/roster_evaluator/` and contains these files:

- `evaluator.py` (770 lines) — 4-layer scoring pipeline orchestration. Public API: `evaluate_roster(players, mode, debug) -> RosterEvaluation`
- `modifiers.py` (1490 lines) — 37 interaction modifier functions (e.g., "rim protector amplifies perimeter defenders", "cutter without passer is penalized")
- `weights.py` — all tunable constants (tier values, slot weights, skill weights, modifier deltas)
- `types.py` — dataclasses: `Scores`, `Note`, `RosterEvaluation`, `ScoreTrace`
- `hard_checks.py` — validation checks (no paint, no creation, insufficient spacing)
- `optionality.py` — lineup flexibility and robustness scoring
- `cornerstone_complement.py` — early-game suggestions for cornerstone pairing
- `team_description.py` — Claude-generated team narrative

Player skills are stored in the `skill_profiles` table as JSONB. Each player has 19 skills, each rated as one of: "None", "Capable", "Proficient", "Elite", "All-Time Great". Skills are defined in `backend/services/skills.py` (the `ALL_SKILLS` list). The frontend mirrors these in `frontend/lib/skills.ts`.

The builder API endpoint is `POST /api/builder/evaluate` in `backend/api/builder.py`. It receives a list of player dicts (each with `name`, `slot`, `is_cornerstone`, `height`, and `skills` dict mapping skill names to tier strings) and returns a `RosterEvaluation`.

A prototype script at `scripts/compute_composites.py` has been validated against real player data. It contains working implementations of: all 11 composite formulas, hybrid percentile normalization with distribution building from the database, defensive bell curve parameter computation, the `defensive_value_at_height()` trapezoid function, and Excel output with conditional formatting. This script is the primary source to extract production code from.

The full design is documented in two files:
- `docs/SCORING_EVAL_DESIGN.md` — architecture, composite formulas, bell curve rules, synergy table, cohesion subscores, roster scoring, notes system, API response shape
- `docs/SCORING_EVAL_IMPL_SPEC.md` — every TBD pinned down: normalization approach, sub-composite reference convention, cohesion rollup weights, bell curve function pseudocode, ratio mechanics, synergy scale factors, accentuation thresholds, defensive thresholds, module structure, dataclass definitions, note templates


## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Normalization method | Hybrid percentile (60th breakpoint) | Theoretical max compressed multiplicative composites; pure percentile clustered at top |
| Sub-composite references | Always raw (pre-normalization) | Normalized values are squished by division; raw keeps formula math consistent |
| Synergy timing | Before composite computation (modify skill tiers) | More accurate than modifying finished composites |
| Multiplier bounds | `max(1, 1 + scale × value)` pattern | Unbounded multipliers produced 20× ranges; bounded to 1.0-4.0× |
| Bell curve shape | Trapezoid with quadratic taper | Matches hand-drawn curves; flat near center, steep at edges |
| Roster scoring | 4-factor weighted sum | Starting 5 (0.45), depth (0.25), archetype diversity (0.20), median floor (0.10) |
| Notes system | Two modes (Mode A: 1-4 players, Mode B: 5+) | Lineup cohesion requires 5 players; partial rosters need composite-based notes |
| Engine migration | Env var toggle, old engine preserved | Safe validation period before committing to swap |
| Composite count | 11 (was 10, split Big Man into Anchor + Post Game + PnR Screener) | Gobert/Jokic archetype distinction |


## File Changes

### New Files

- `backend/services/cohesion_engine/__init__.py` — package init, re-exports `evaluate_roster()`
- `backend/services/cohesion_engine/types.py` — frozen dataclasses: `PlayerComposites`, `LineupCohesion`, `Note`, `RosterEvaluation`
- `backend/services/cohesion_engine/weights.py` — single source of truth for all tunable constants
- `backend/services/cohesion_engine/composites.py` — composite formulas, normalization, distribution building
- `backend/services/cohesion_engine/bell_curve.py` — defensive bell curve params, value-at-height, lineup defense scoring
- `backend/services/cohesion_engine/synergies.py` — 12 lineup synergy checks, skill-level boosts/penalties
- `backend/services/cohesion_engine/ratios.py` — harmonic mean ratio scoring with dead zones
- `backend/services/cohesion_engine/accentuation.py` — strength amplification and weakness coverage scoring
- `backend/services/cohesion_engine/cohesion.py` — per-lineup orchestration: synergies → composites → subscores → cohesion score
- `backend/services/cohesion_engine/roster.py` — 126-lineup evaluation, 4-factor star rating
- `backend/services/cohesion_engine/notes.py` — Mode A/B note generation with templates and priority sorting
- `backend/services/cohesion_engine/team_description.py` — Claude narrative adapted for new data shapes
- `backend/tests/test_cohesion_engine/` — full test suite (unit + integration)

### Modified Files

- `backend/api/builder.py` — add engine toggle (`EVAL_ENGINE` env var) and new response serialization
- `frontend/lib/types.ts` — add `Cohesion*` interfaces for new response shape (additive, no breaking changes)

### Deleted Files

- None (old engine preserved until validation complete)


## Data & API Changes

No database schema changes. No new migrations. All computation is in-memory.

The `POST /api/builder/evaluate` endpoint gains a new response shape when `EVAL_ENGINE=cohesion`:

    {
      "success": true,
      "data": {
        "star_rating": 4.2,
        "star_rating_breakdown": {
          "starting_5": 0.85,
          "depth": 0.72,
          "archetype_diversity": 0.60,
          "floor": 0.78
        },
        "starting_lineup": {
          "cohesion_score": 4.1,
          "subscores": {
            "spacing_creation_ratio": 7.8,
            "spacing_paint_touch_ratio": 6.5,
            "paint_touch_total": 8.2,
            "post_game_total": 5.1,
            "pnr_screener_total": 6.0,
            "anchor_total": 6.8,
            "collective_passing": 7.5,
            "rebounding": 5.9,
            "transition": 6.3,
            "rebound_transition_ratio": 5.5,
            "rebounding_spacing_deficit": 0,
            "defensive_coverage": 8.1,
            "defensive_gaps": 0
          },
          "accentuation": {
            "strength_amplification": 3.2,
            "weakness_coverage": 2.1
          }
        },
        "player_composites": [
          {
            "player_id": "uuid",
            "name": "Player Name",
            "base": {
              "spacing": 8.5, "finishing": 3.0, "paint_touch": 6.2,
              "anchor": 0.0, "post_game": 0.0, "pnr_screener": 0.0,
              "off_ball_impact": 7.1, "shot_creation": 9.0,
              "rebounding": 0.0, "transition": 4.5
            }
          }
        ],
        "lineup_summary": {
          "total_lineups": 126,
          "viable_lineups": 28,
          "median_score": 3.8,
          "archetype_labels": ["offensive", "defensive", "transition", "balanced"]
        },
        "notes": [
          {"type": "strength", "category": "spacing", "severity": 0.9, "text": "..."},
          {"type": "weakness", "category": "defense_gap", "severity": 0.7, "text": "..."},
          {"type": "suggestion", "category": "anchor", "severity": 0.7, "text": "..."}
        ],
        "team_description": "Claude-generated narrative..."
      }
    }

The existing response shape for `EVAL_ENGINE=legacy` (default) is unchanged.


## Plan of Work

The work is organized into 8 phases. Phases 1 through 4 must be completed sequentially (each depends on the prior). Phases 5 and 6 can run in parallel after Phase 4. Phase 7 depends on Phases 4-6. Phase 8 (tests) should be written alongside each phase.

Within phases, some modules can be built in parallel: `composites.py` and `bell_curve.py` in Phase 2; `synergies.py`, `ratios.py`, and `accentuation.py` in Phase 3 (but `cohesion.py` must come last since it orchestrates the others).


### Milestone 1: Foundation and Player Composites (Phases 1-2)

After this milestone, the engine can compute and display 11 normalized composite scores for any player in the database, plus their defensive bell curve parameters. This is the same functionality as the prototype script (`scripts/compute_composites.py`) but structured as a proper Python package with typed dataclasses.

To verify: import `cohesion_engine.composites` in a Python shell, call `build_distributions("2025-26")` to cache the normalization distributions, then call `compute_player_composites(skills_dict)` for a known player and compare outputs against the script's results.

Phase 1 creates three files. `types.py` defines frozen dataclasses: `PlayerComposites` (11 composite fields + 6 bell curve param fields), `LineupCohesion` (score + subscores dict + synergies list + accentuation), `Note` (type/category/severity/raw_value/text), and `RosterEvaluation` (star_rating + breakdown + lineup data + composites + notes + narrative). `weights.py` consolidates every tunable constant from the design and impl spec into a single file organized by section: tier values, composite formula coefficients, bell curve extension tables, synergy scale factors, cohesion rollup weights, ratio constants, accentuation thresholds, note thresholds, and Layer 2 normalization constants. `__init__.py` stubs the public `evaluate_roster()` function.

Phase 2 creates two files. `composites.py` extracts `compute_raw_composites()`, `normalize_composites()`, `_percentile_normalize()`, and `build_distributions()` from the prototype script. The key adaptation is importing constants from `weights.py` instead of defining them inline, accepting an optional synergy-boosted skills dict as input (for lineup-context composites later), and returning `PlayerComposites` dataclass instances. The distribution cache is module-level, built on first call and invalidatable. `bell_curve.py` extracts `defensive_value_at_height()` and `compute_bell_params()` from the script, then adds new functions: `compute_lineup_defense()` which evaluates all 5 players' curves at each height inch from 6'0" to 7'4" (72 to 88 inches) with diminishing stacking returns (1st defender full value, 2nd 50%, 3rd 25%, 4th+ 10%), and `apply_rp_pd_boost()` which boosts teammates' perimeter disruptor tier when an Elite+ rim protector is in the lineup.


### Milestone 2: Lineup Cohesion (Phase 3)

After this milestone, the engine can take a 5-player lineup and produce a single cohesion score (0-5) with 13 subscores, a list of fired synergies, and accentuation scores. This is the core of the new system — the piece that doesn't exist in the prototype script.

To verify: construct a known 5-player lineup (e.g., Curry/LeBron/Gobert/Jokic/Wemby), call `evaluate_lineup(players)`, and inspect the returned `LineupCohesion` object. All 13 subscores should be present and within 0-10. Synergies should fire for known conditions (e.g., PnR handler + finisher should trigger OFF-28). Accentuation should reward complementary pairings (Curry's spacing + Jokic's paint touch).

`synergies.py` implements 12 synergy checks. Each check inspects the 5-player lineup for a specific condition (e.g., "screen setter and movement shooter on distinct players"), then modifies the relevant player's skill tier value using the formula `effective = base × (1 + scale_factor × provider_tier_value)` for boosts or `effective = base / (1 + scale_factor × severity)` for penalties. The function returns new player dicts (immutable — never mutate originals) plus a list of synergy IDs that fired. The trickiest synergy is OFF-13 (cutter penalized when lineup spacing is low) because it references lineup spacing before composites are computed — it uses a raw estimate: sum of `movement_shooter` + `spot_up_shooter` tier values across the lineup, with threshold < 15.0. OFF-37 is flag-only (no skill modification, just included in the synergy list).

`ratios.py` implements `ratio_score(a, b, dead_zone=0.2, asymmetric=False)` which uses harmonic mean as a base, applies a dead zone (no penalty within ±20% of balance), and optionally penalizes one direction 2× harder. Four wrapper functions apply specific ratio logic: `spacing_creation_ratio` (symmetric), `spacing_paint_touch_ratio` (asymmetric — paint touch exceeding spacing penalized harder), `rebound_transition_ratio` (symmetric), and `rebounding_spacing_deficit_ratio` (only fires when spacing < 5.0).

`accentuation.py` implements `compute_accentuation(lineup_composites)` which returns two scores: strength amplification and weakness coverage. For each player, it identifies their top 3 normalized composites above a 7.5 threshold (minimum 1, always use best even if nothing qualifies). For each qualifying composite, it checks a bidirectional complementary pairs table (e.g., Spacing ↔ Paint Touch, Shot Creation ↔ Off-Ball Impact, Shot Creation ↔ PnR Screener) for teammates who have the complementary composite as a strength. Credit is proportional to both players' composite values. Weakness coverage inverts this: bottom 3 composites below 2.5, check if teammates compensate.

`cohesion.py` orchestrates the full per-lineup evaluation in 7 steps: (1) apply RP→PD boost, (2) apply synergies to get boosted skill dicts, (3) compute composites from boosted skills for each player, (4) normalize all composites, (5) sum/ratio into 13 cohesion subscores, (6) compute defensive coverage from bell curves, (7) compute accentuation, (8) apply cohesion rollup weights to produce a single 0-5 lineup score, (9) assign archetype labels from top 2-3 subscores. Returns a `LineupCohesion` dataclass.


### Milestone 3: Roster Scoring and Notes (Phases 4-5)

After this milestone, the engine can take a full 9-player roster and produce a `RosterEvaluation` with star rating, breakdown, notes, and per-player composites. This is the complete backend computation — everything except the Claude narrative and API integration.

To verify: call `evaluate_roster(players)` with 9 players and inspect the result. Star rating should be 0.0-5.0. Notes should include 1-3 strengths, weaknesses, and suggestions. Also test with 1-4 players to verify Mode A notes fire (composite-based, no lineup cohesion).

`roster.py` implements the public `evaluate_roster(players, mode="live")` function. It first computes base composites (no synergies) for all players — these go in the response for display. If fewer than 5 players, it skips lineup evaluation and delegates to Mode A notes. With 5+ players, it generates all C(9,5)=126 five-man combinations using `itertools.combinations`, evaluates each through `evaluate_lineup()`, then computes the 4-factor star rating: starting lineup cohesion (slots 1-5, weight 0.45) normalized by dividing by 5.0, depth (count of lineups scoring >= 3.5 stars, normalized via `min(1.0, count / 40)`), archetype diversity (distinct archetype labels across viable lineups, divided by total possible labels), and floor (median cohesion score, normalized same as starting lineup). Final star rating = `5.0 × (0.45 × start + 0.25 × depth + 0.20 × diversity + 0.10 × floor)`.

`notes.py` implements `generate_notes(players, composites, pipeline_data=None)` with two internal paths. Mode A (1-4 players) identifies strengths from high individual composites (>= 8.0 or stacking 2+ players >= 6.0), weaknesses from missing/zero composites and bell curve gaps, and maps each weakness to a suggestion using the template table in the impl spec. Mode B (5+ players) reads from the full pipeline output: top subscores and synergy observations for strengths, bottom subscores and ratio penalties for weaknesses, archetype-mapped suggestions. Both modes return 1-3 of each note type, sorted by severity, with deduplication (same archetype not suggested twice).


### Milestone 4: Integration (Phases 6-7)

After this milestone, the new engine is accessible through the existing API endpoint with an environment variable toggle.

To verify: set `EVAL_ENGINE=cohesion` in `backend/.env`, start the Flask server with `python -m flask run --port=5001`, send a `POST /api/builder/evaluate` request with a roster, and verify the response matches the new shape. Then set `EVAL_ENGINE=legacy` and verify the old response shape still works.

`team_description.py` adapts the existing Claude narrative prompt from `roster_evaluator/team_description.py` to consume composites and subscores instead of dimension scores and modifiers. The Anthropic client setup, model choice, and GM-memo voice are ported directly. The `_build_prompt()` function is rewritten. Degrades gracefully (returns None on failure).

`builder.py` modifications: add `EVAL_ENGINE = os.environ.get("EVAL_ENGINE", "legacy")` at module level. In the evaluate endpoint, branch on this value to call either `roster_evaluator.evaluate_roster()` or `cohesion_engine.evaluate_roster()`. Add a `_serialize_cohesion_evaluation()` function for the new response shape. The old code path is untouched.

Frontend type additions in `frontend/lib/types.ts`: add `CohesionNote`, `CohesionPlayerComposites`, `CohesionLineupData`, `CohesionRosterEvaluation` interfaces. Prefix with "Cohesion" to avoid collision during migration. Do not modify existing interfaces.


## Concrete Steps

All commands should be run from the repository root: `/Users/cdbrooks/Development/Software/Repositories/cornerstone`.

    # Create the package directory
    mkdir -p backend/services/cohesion_engine
    mkdir -p backend/tests/test_cohesion_engine

    # Activate the backend virtual environment (required for all Python commands)
    source backend/venv/bin/activate

    # After implementing each phase, run the test suite
    python -m pytest backend/tests/test_cohesion_engine/ -v

    # After all phases, verify the full pipeline with real data
    python -c "
    from backend.services.cohesion_engine import evaluate_roster
    # ... construct test roster and call evaluate_roster()
    "

    # After Phase 7, test the API endpoint
    EVAL_ENGINE=cohesion python -m flask run --port=5001
    # In another terminal:
    curl -X POST http://localhost:5001/api/builder/evaluate \
      -H 'Content-Type: application/json' \
      -d '{"players": [...], "mode": "live"}'


## Validation and Acceptance

The engine is accepted when:

1. `evaluate_roster()` with 9 players returns a `RosterEvaluation` with `star_rating` between 0.0 and 5.0
2. All 11 composites match the prototype script's outputs for Curry, LeBron, Gobert, Jokic, Wembanyama, and Vassell (regression test)
3. Defensive bell curves produce expected shapes: Brunson (0.5 amplitude, ±1" range), Wiggins (3.5 amplitude, 6'1"-7'2"), Gobert (3.5 amplitude, 6'10"-7'7"), Wembanyama (4.0 amplitude, 6'7"-7'4" clamped)
4. Synergies fire correctly: OFF-28 triggers when PnR handler + finisher are on distinct players, OFF-12 triggers when cutter has no passer, OFF-37 flags single-passer lineups
5. Mode A notes work with 1-4 players: single player returns strengths + weaknesses + suggestions based on their composites
6. Mode B notes work with 5+ players: lineup-level observations including ratio imbalances and defensive gaps
7. `POST /api/builder/evaluate` returns the new response shape when `EVAL_ENGINE=cohesion` and the old shape when `EVAL_ENGINE=legacy`
8. Full 126-lineup evaluation completes in <100ms (generous target; impl spec says <50ms)
9. Test coverage >= 80% across `backend/services/cohesion_engine/`

### Manual Verification Steps

1. Set `EVAL_ENGINE=cohesion` in `backend/.env`
2. Start backend: `cd backend && source venv/bin/activate && python -m flask run --port=5001`
3. Start frontend: `cd frontend && npm run dev`
4. Navigate to `http://localhost:3000/builder`
5. Add a cornerstone (e.g., LeBron James) — observe Mode A notes appear (strengths: passing, transition; weaknesses: spacing, anchor)
6. Add 4 more players to fill slots 1-5 — observe transition from Mode A to Mode B notes with lineup-level observations
7. Fill all 9 slots — observe star rating, composite breakdowns for each player, and full notes panel
8. Swap a player — observe star rating and notes update reflecting the change


## Testing Plan

### Unit Tests

- `test_composites.py` — `compute_raw_composites()` with known player profiles (6 players from script validation), dependency ordering, percentile normalization edge cases (empty distribution, single player, zero values), theoretical max fallback
- `test_bell_curve.py` — `compute_bell_params()` against Brunson/Wiggins/Clingan/Garrett archetypes, `defensive_value_at_height()` at flat-top/taper/outside positions, cross-direction extensions, `apply_rp_pd_boost()` immutability
- `test_synergies.py` — each of 12 synergies in isolation, boost formula tier scaling, penalty formula bounds, OFF-13 raw spacing threshold, OFF-37 flag-only, immutability
- `test_ratios.py` — balanced inputs (~10.0), dead zone, asymmetric penalty, edge cases (both zero, one zero)
- `test_accentuation.py` — strength identification, complementary pair matching, weakness coverage, fallback when nothing above threshold

### Integration Tests

- `test_cohesion.py` — `evaluate_lineup()` end-to-end with known 5-player lineup, all 13 subscores present and within 0-10, synergies correctly modify composites
- `test_roster.py` — `evaluate_roster()` with 1, 3, 5, and 9 players, Mode A/B switching, 4-factor breakdown, star rating 0.0-5.0
- `test_notes.py` — Mode A single player, Mode B full roster, deduplication, priority ordering

### E2E Tests

- `test_builder_api_cohesion.py` — `POST /api/builder/evaluate` returns new response shape with engine toggle, backward compatibility with legacy engine


## Idempotence and Recovery

All phases create new files — no existing files are modified until Phase 7. Running any phase multiple times overwrites the same files safely. The distribution cache rebuilds on server start; if it fails (database unreachable), the engine falls back to theoretical max normalization. The engine toggle defaults to "legacy", so deploying the new code without setting the env var changes nothing for existing users.


## Artifacts and Notes

The prototype script output for the 5 reference players (with 60th percentile hybrid normalization):

    Curry:     Spacing=10.0 Finishing=7.7 PaintTouch=5.8 Anchor=0.0 PostGame=0.0
               PnRScreener=0.0 OffBall=10.0 ShotCreation=9.1 Rebounding=0.0 Transition=6.3

    LeBron:    Spacing=5.6 Finishing=8.9 PaintTouch=7.0 Anchor=6.2 PostGame=6.8
               PnRScreener=0.0 OffBall=8.9 ShotCreation=8.0 Rebounding=6.0 Transition=10.0

    Gobert:    Spacing=0.0 Finishing=0.0 PaintTouch=5.2 Anchor=8.5 PostGame=0.0
               PnRScreener=7.4 OffBall=1.1 ShotCreation=2.5 Rebounding=8.9 Transition=0.0

    Jokic:     Spacing=7.1 Finishing=7.7 PaintTouch=7.8 Anchor=7.0 PostGame=10.0
               PnRScreener=10.0 OffBall=9.1 ShotCreation=9.9 Rebounding=8.9 Transition=6.6

    Wemby:     Spacing=6.4 Finishing=7.7 PaintTouch=7.7 Anchor=10.0 PostGame=7.4
               PnRScreener=6.8 OffBall=6.9 ShotCreation=7.9 Rebounding=8.1 Transition=6.4

These are the regression targets for Phase 2 tests. Note: the Shot Creation values will shift slightly once the 0.3× spacing coefficient is applied in the production code (the script has been updated but distributions may recompute differently).


## Interfaces and Dependencies

Python dependencies: no new packages required. The engine uses only standard library (`itertools`, `copy`, `math`, `logging`) plus the existing `supabase` client for distribution building.

In `backend/services/cohesion_engine/composites.py`, define:

    def compute_raw_composites(skills: dict[str, str]) -> dict[str, float]:
        """Compute all 11 raw composites from a skill tier dict. Returns {composite_name: raw_value}."""

    def normalize_composites(raw: dict[str, float]) -> dict[str, float]:
        """Normalize raw composites to 0-10 using cached percentile distributions."""

    def build_distributions(season: str) -> dict[str, list[float]]:
        """Build and cache sorted composite distributions from all players in the DB."""

    def compute_player_composites(skills: dict[str, str], player_id: str, name: str, height_inches: int | None) -> PlayerComposites:
        """Full pipeline: raw composites + normalization + bell curve params → PlayerComposites dataclass."""

In `backend/services/cohesion_engine/bell_curve.py`, define:

    def defensive_value_at_height(target_height: int, amplitude: float, peak_center: int, range_down: int, range_up: int, flat_top_down: int, flat_top_up: int) -> float:
        """Trapezoid with quadratic taper. Returns defensive value (0-4) at a specific height inch."""

    def compute_bell_params(skills: dict[str, str], height_inches: int) -> dict:
        """Compute bell curve parameters for a player. Returns dict with amplitude, peak_center, ranges, flat_tops."""

    def apply_rp_pd_boost(lineup: list[dict]) -> list[dict]:
        """Boost teammates' PD tier when Elite+ RP is present. Returns new list (immutable)."""

    def compute_lineup_defense(lineup: list[dict]) -> tuple[float, float, list[int]]:
        """Compute defensive coverage, gap penalty, and gap positions for a 5-man lineup."""

In `backend/services/cohesion_engine/synergies.py`, define:

    def apply_synergies(lineup: list[dict]) -> tuple[list[dict], list[str]]:
        """Apply all 12 synergy checks. Returns (boosted player dicts, list of fired synergy IDs)."""

In `backend/services/cohesion_engine/cohesion.py`, define:

    def evaluate_lineup(players: list[dict]) -> LineupCohesion:
        """Full per-lineup evaluation: synergies → composites → subscores → cohesion score."""

In `backend/services/cohesion_engine/roster.py`, define:

    def evaluate_roster(players: list[dict], mode: str = "live") -> RosterEvaluation:
        """Public API. Evaluate a roster of 1-9 players. Returns star rating, notes, composites."""
