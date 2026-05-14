# Handoff: Decouple Team Size from RuleSet

**Date:** 2026-05-13
**Branch:** main
**Scope:** Allow tagged RuleSets to offer a team size picker instead of requiring one RuleSet per size

---

## Context

Three Free For All RuleSets exist today — Lineup (5), Rotation (9), Roster (12) — that are identical except for `team_size`. This session verified the 12-man Roster end-to-end, fixed bugs across the eval page, profile, saved team detail, cohesion engine notes, and LLM prompt framing. Everything works, but the 1:1 coupling of team size to RuleSet is a design limitation:

- Users cannot filter Saved Teams by team size and RuleSet independently.
- Adding a new team size (e.g. 7-man) requires creating a new RuleSet row + migration.
- The Lab page shows three nearly identical cards for what is conceptually one format.

## Current Implementation Status

### Complete (this session)
- **Eval page** generalized for variable team sizes: `readSlotsFromParams` uses RuleSet `team_size`, portraits scale for >9 players, labels driven by `teamLabel` prop
- **Backend** slot validation raised to 12 in [`builder.py`](backend/api/builder.py) and [`rosters.py`](backend/api/rosters.py)
- **CohesionScoreDisplay** accepts `teamLabel` prop — "Roster Cohesion", "Roster Median", etc.
- **Cohesion notes** use generic "team" instead of "rotation" in [`notes.py`](backend/services/cohesion_engine/notes.py)
- **LLM prompt framing** — three-branch `_MEMO_FRAMINGS` dict in [`team_description.py`](backend/services/cohesion_engine/team_description.py):220 keyed on team_size (Lineup=high-pressure, Rotation=playoff, Roster=season) with TODO for `eval_context` field
- **Saved team detail** hides salary/cornerstone for FFA, shows RuleSet slug + version label instead of UUID
- **Profile cards** hide Salary Cap for FFA, shrink portraits for >9 players
- **Lab page** removed Players tab, fixed label spacing ("Player Pool", "Rookie Deal Limit", "Salary Cap")
- **Lineup score breakdown** filters Depth/Floor factors (only shows Lineup Strength + Versatility)

### Key commits
- `f17364c` — RuleSet slug + version label, Lab rule labels
- `9351444` — FFA salary/cornerstone hiding, profile card layout, Lab Players tab removal
- `da25270` — Eval page generalization, cohesion engine variable team sizes, LLM prompt framing

## Important Working Instructions

- **Extensibility over hardcoding** — when fixing Standard-RuleSet assumptions, make the fix work for any `rules_json` configuration, not just the known RuleSets.
- **FFA vs Roster distinction** — FFA = no salary cap, no explicit cornerstone, pool of all Players + Legends. Roster = 12-man team size. These are orthogonal axes. Bugs can be FFA-related, Roster-related, or both.
- **`eval_context` TODO** — [`team_description.py`](backend/services/cohesion_engine/team_description.py):224-227 has a TODO for re-keying `_MEMO_FRAMINGS` from `int` → `str` when `rules_json` gains an `eval_context` field. This supports future formats like Olympic 12-man rosters that need "tournament" framing instead of "season".
- **Don't define project Lexicon terms** — user already knows them.

## Next Steps

### 1. Design `allowed_team_sizes` in `rules_json`
Add an `allowed_team_sizes` array (e.g. `[5, 9, 12]`) to `rules_json`. When present, the Lab entry flow shows a team size selector instead of routing directly to build. When absent or single-valued, behavior is unchanged (current flow).

### 2. Add team size picker to Lab entry
After selecting a RuleSet with multiple allowed sizes, user picks a team size before entering the builder. The chosen size becomes a URL param or route segment that the builder reads.

### 3. Collapse FFA RuleSets
Replace three FFA rows with one row (`free-for-all`) that has `allowed_team_sizes: [5, 9, 12]`. Migration removes the three individual rows and creates the unified one.

### 4. Enable independent filtering
Saved Teams need to store the team size they were built at (currently derivable from player count). Profile and community views should support filtering by team size separately from RuleSet.

## Verification Baseline

```bash
cd backend && source venv/bin/activate && python -m pytest tests/ -q
cd frontend && npm run lint
```

Manual checks:
- Build and eval a 5-man, 9-man, and 12-man FFA team — all three should work end-to-end
- Saved team detail page hides salary/cornerstone for FFA
- Profile cards show correct layout for each team size
- Lab page shows Rules + Community tabs (no Players tab)
