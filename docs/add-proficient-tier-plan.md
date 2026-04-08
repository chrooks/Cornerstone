# Add Proficient Tier — Implementation Plan

> **Status:** Approved  
> **Feature slug:** add-proficient-tier  
> **Date:** 2026-04-07

## Feature Overview

Add a fifth skill tier — "Proficient" — positioned between "Capable" and "Elite". The full ordered tier set becomes: `None → Capable → Proficient → Elite → All-Time Great`. The change is fully additive: no existing records change value, but all existing Capable/Elite composite ratings are queued in the review queue for human re-evaluation.

## Acceptance Criteria

1. The `SkillTier` TypeScript type includes "Proficient" as a valid value.
2. `SkillTierBadge` renders "Proficient" with a sky-blue color distinct from Capable (amber) and Elite (emerald).
3. `SkillTierSelector` displays all five tiers in order: All-Time Great / Elite / Proficient / Capable / None.
4. The Players Explorer filter "Proficient or higher" correctly filters players who have at least one skill at Proficient or above.
5. The Legends profile builder displays and allows selecting "Proficient" as a skill tier.
6. The stat engine evaluator can output "Proficient" when a skill rule's `tiers.proficient` block conditions are met.
7. Claude assessment prompts include "Proficient" as a valid tier and the response parser accepts it.
8. The compositing service correctly handles Proficient in disagreement diffs (diff=2 boundary unchanged).
9. All backend `_VALID_TIERS` sets accept "Proficient".
10. A database migration inserts pending review flags for all existing composite-profile skills currently rated Capable or Elite (flag_reason = `proficient_tier_review`).
11. No existing skill_flags or skill_profiles records are modified; the migration is purely additive.

## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Numeric tier ordering | None=0, Capable=1, Proficient=2, Elite=3, All-Time Great=4 | Maintains integer-rank comparisons in playerFilters.ts |
| Compositing diff threshold | Stay at diff=2 | User confirmed; Capable↔Elite is now a 2-tier gap (auto-flagged) |
| Existing data | Queue for human review via skill_flags (Option C) | Existing ratings were human-approved; a human should decide if Elite → Proficient |
| New data | Full pipeline (stat engine + Claude + compositing) with Proficient baked in | Forward-going accuracy |
| Stat engine | Walk order: `all-time great → elite → proficient → capable` | Additive; skills without a `proficient` block simply skip it |
| `tier_name.capitalize()` | "proficient".capitalize() = "Proficient" ✓ | No special-casing needed |
| "Elite+ Skills ≥" player filter | Update `>= 2` to `>= 3` | With renumbered tiers, must preserve "Elite or better" semantics |

## File Changes

### Modified Files

**Frontend**
- `frontend/lib/types.ts` — Add "Proficient" to `SkillTier` union (line 62) and `LegendTier` union (line 358)
- `frontend/components/SkillTierBadge.tsx` — Add Proficient entry to `tierClasses` with sky-100/sky-800/sky-200
- `frontend/components/SkillTierSelector.tsx` — Add "Proficient" to `TIERS` array and `tierStyles` with sky palette
- `frontend/components/players/playerFilters.ts` — 4 changes:
  1. Add "Proficient" to `SKILL_TIERS` constant
  2. Add `case "Proficient": return 2;` to `tierToNum()` and renumber Elite=3, All-Time Great=4
  3. Add `"Proficient or higher"` to `TIER_OPTIONS` and `case "Proficient or higher": return 2;` to `minTierNum()`
  4. Update "Elite+ Skills ≥" filter from `>= 2` to `>= 3`
- `frontend/app/legends/[legend_id]/page.tsx` — Add "Proficient" to `TIER_VALUES` array and `TIER_STYLES` map with sky palette

**Backend**
- `backend/services/skill_engine/evaluator.py` — 3 changes:
  1. Insert "Proficient" into `_TIER_ORDER` between "Elite" and "Capable": `["All-Time Great", "Elite", "Proficient", "Capable", "None"]`
  2. Update header comment to reflect new indices
  3. Add `"proficient"` to the tier walk loop: `["all-time great", "elite", "proficient", "capable"]`
- `backend/services/compositing.py` — Insert "Proficient" into `_TIER_ORDER` between "Capable" and "Elite" (ascending order): `["None", "Capable", "Proficient", "Elite", "All-Time Great"]`; update comment
- `backend/api/calibration.py` — Add "Proficient" to `_VALID_TIERS` set (line 76)
- `backend/api/review.py` — Add "Proficient" to `_VALID_TIERS` set (line 29); update two error message strings that enumerate valid tiers (lines 341 and 623)
- `backend/services/claude_assessment.py` — 3 changes:
  1. Update blind-assessment prompt (line 244): add "**Proficient**" to the tier list
  2. Update the per-skill response shape comment (line 409): `"tier": "None | Capable | Proficient | Elite"`
  3. Add "Proficient" to `valid_tiers` set (line 460)

### New Files

- `supabase/migrations/20260407000000_add_proficient_tier.sql` — Two parts:
  1. Update column comments on `skill_flags` and `skill_profiles` to list all 5 tiers
  2. Insert pending `skill_flags` rows for every composite-profile skill currently at Capable or Elite (re-evaluation queue)

## Data & API Changes

### New Migration (`20260407000000_add_proficient_tier.sql`)

```sql
-- Part 1: Update column comments to reflect 5 tiers
COMMENT ON COLUMN skill_flags.stat_rating   IS 'Tier from the stat engine: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.claude_rating IS 'Tier from Claude: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN skill_flags.resolved_value IS 'Manually resolved tier: None | Capable | Proficient | Elite | All-Time Great';
COMMENT ON COLUMN anchor_players.expected_tier IS 'Expected tier: None | Capable | Proficient | Elite | All-Time Great';

-- Part 2: Queue existing Capable/Elite composite ratings for human re-evaluation.
-- Both stat_rating and claude_rating are set to the current final_tier (they agreed or
-- the human resolved it to this value). The flag_reason distinguishes these from normal
-- disagreement flags.
INSERT INTO skill_flags (skill_profile_id, skill_name, stat_rating, claude_rating, flag_reason, notes)
SELECT
  sp.id,
  skill_entry.key                       AS skill_name,
  skill_entry.value->>'final_tier'      AS stat_rating,
  skill_entry.value->>'final_tier'      AS claude_rating,
  'proficient_tier_review'              AS flag_reason,
  'Proficient tier added — re-evaluate whether this skill should be Proficient' AS notes
FROM skill_profiles sp,
  jsonb_each(sp.profile) AS skill_entry(key, value)
WHERE
  sp.source = 'composite'
  AND skill_entry.value->>'final_tier' IN ('Capable', 'Elite')
  -- Skip skills that already have an open proficient_tier_review flag
  AND NOT EXISTS (
    SELECT 1 FROM skill_flags sf
    WHERE sf.skill_profile_id = sp.id
      AND sf.skill_name       = skill_entry.key
      AND sf.resolution IS NULL
      AND sf.flag_reason      = 'proficient_tier_review'
  );
```

### No API schema changes

The `resolved_value` and tier fields are plain `text` columns with no CHECK constraints (validated in application code). No endpoint signatures change; "Proficient" simply becomes an accepted value in existing validation sets.

## Testing Plan

### Unit Tests

- `backend/tests/test_skill_mapping_service.py` — Add test cases asserting `evaluate_skill` returns `"Proficient"` when the rule's `tiers.proficient` block is satisfied and `tiers.elite` is not
- `backend/tests/test_compositing_and_notability.py` — Add test cases for:
  - Capable vs Proficient (diff=1) → auto-accept lower
  - Capable vs Elite (diff=2) → flagged (now two-tier gap, was one-tier)
  - Proficient vs All-Time Great (diff=2) → flagged

### Integration Tests

- Verify `/api/skills/{player_id}/{skill_name}/set-tier` accepts `"Proficient"` as `resolved_value`
- Verify `/api/review/{player_id}/resolve` accepts `"Proficient"` as `resolved_value`

### E2E Tests

- Verify "Proficient" badge renders in sky-blue in the Players Explorer
- Verify "Proficient or higher" filter option appears and correctly filters the player table
- Verify SkillTierSelector in the review panel shows Proficient between Capable and Elite

## Manual Verification Steps

1. Start the dev server (`npm run dev` in `frontend/`).
2. Navigate to any player's skill profile — confirm existing tiers (Capable, Elite) still display correctly.
3. Open the review queue — confirm new "proficient_tier_review" flags appear for existing Capable/Elite ratings.
4. In a review flag, open the tier selector — confirm the order is: All-Time Great / Elite / Proficient / Capable / None.
5. Select "Proficient" and save — confirm the badge renders sky-blue.
6. Open Players Explorer → add a skill filter — confirm "Proficient or higher" appears in the tier dropdown.
7. Set a test player's skill to Proficient, then apply "Proficient or higher" filter — confirm they appear; apply "Elite or higher" — confirm they do NOT appear.
8. Open a Legends profile — confirm "Proficient" appears in the tier selector between Elite and Capable.
9. Verify Claude assessment: trigger a re-assessment on a skill — confirm the response can include "Proficient" without a validation error in the logs.

---

## Code Review Findings
*(Populated after code review — leave blank)*

### Medium Risk

### Low Risk

---

## Code Review Findings (2026-04-07)

### Fixed Automatically (HIGH)

**`evaluator.py` — `collect_condition_results()` and `_collect_driving_stats()` did not include `"proficient"` in their tier iteration loops**

Both helper functions iterated `["elite", "capable"]` and were not updated when `"proficient"` was added to the main `evaluate_skill()` tier walk. This caused two concrete functional regressions:

1. `collect_condition_results()` — The calibration UI condition breakdown silently omitted all conditions defined under `tiers.proficient` in a skill rule. A skill rule with only a `proficient` block would show no conditions in the calibration panel.
2. `_collect_driving_stats()` — Driving stats were not collected for any stat paths referenced exclusively in a `proficient` tier block, making the review queue transparency panel incomplete for Proficient-rated skills.

**Fix applied**: Both loops updated from `["elite", "capable"]` to `["all-time great", "elite", "proficient", "capable"]`, matching the main evaluator walk order.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/backend/services/skill_engine/evaluator.py`, lines 317 and 378.

---

### Medium Risk

**`compositing.py` — `_FLAG_REASONS` frozenset is dead code and does not include `"proficient_tier_review"`**

`_FLAG_REASONS` is defined at module level but is never referenced anywhere in the file — no validation, no membership check. The migration introduces a new `flag_reason = 'proficient_tier_review'` that the review queue API will surface to users, but `_FLAG_REASONS` does not document this new value. Either wire `_FLAG_REASONS` into flag insertion validation or remove it to avoid confusing future maintainers.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/backend/services/compositing.py`, line 59.

**`claude_assessment.py` — The per-skill JSON schema comment in `build_claude_prompt` omits `"All-Time Great"`**

The inline schema example shows `"tier": "None | Capable | Proficient | Elite"` but does not include `"All-Time Great"`. This was a pre-existing omission, but adding `"Proficient"` made the schema comment more prominent. Claude is instructed to use `"All-Time Great"` in prose but the JSON schema example will confuse any engineer reading the prompt for valid values. Update to `"None | Capable | Proficient | Elite | All-Time Great"`.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/backend/services/claude_assessment.py`, line 409.

**Migration — `skill_flags.stat_rating` / `skill_flags.claude_rating` are set to the existing `final_tier`, not separately sourced**

In the migration's INSERT, both `stat_rating` and `claude_rating` are populated from `skill_entry.value->>'final_tier'`. For skills that were auto-accepted with a one-tier disagreement (stat=Elite, claude=Capable → final=Capable), this loses the original disagreement signal. The review queue will show both ratings as identical, which may mislead reviewers into thinking stat and Claude agreed. Consider whether this is acceptable or whether the original `stat_tier` / `claude_tier` values should be read from the composite JSONB (`skill_entry.value->>'stat_tier'` and `skill_entry.value->>'claude_tier'`) instead.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/supabase/migrations/20260407000000_add_proficient_tier.sql`, lines 20-21.

**No tests added for the new tier path in the stat engine or compositing service**

The testing plan calls for new test cases in `test_skill_mapping_service.py` and `test_compositing_and_notability.py`, but no tests were added in this changeset. The Capable↔Elite gap is now a 2-tier diff (auto-flagged), which changes compositing behavior for any existing test fixtures that assumed Capable/Elite was a 1-tier disagreement. Those tests will pass a wrong assumption until updated.

---

### Low Risk

**`evaluator.py` — Pre-existing `capitalize()` bug on `"all-time great"` produces `"All-time great"` (not `"All-Time Great"`)**

`tier_name.capitalize()` at line 128 produces the wrong casing for `"all-time great"` — Python's `str.capitalize()` only uppercases the first character. This bug predates this change and is not introduced here. The new `"proficient"` case capitalizes correctly. However, since the tier walk now explicitly includes `"all-time great"`, a skill rule that defines only an `all-time great` block would incorrectly record tier as `"All-time great"` in the DB (failing validation downstream). Recommend replacing `tier_name.capitalize()` with a lookup dict or a `title()` call.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/backend/services/skill_engine/evaluator.py`, line 128.

**`playerFilters.ts` — `minTierNum()` default case still returns `1` (Capable)**

The `default` branch of `minTierNum()` returns `1` (Capable), which acts as a silent fallback for any unrecognized tier option string. This is unchanged from before and is a low risk, but if a new tier option is added without a corresponding case, filtering will silently include "Capable or higher" behavior instead of failing visibly.

File: `/Users/cdbrooks/Development/Software/Repositories/cornerstone/frontend/components/players/playerFilters.ts`, line 267.
