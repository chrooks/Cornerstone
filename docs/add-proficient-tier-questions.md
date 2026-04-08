# Add Proficient Tier — Clarifying Questions

> **Status:** Awaiting answers  
> **Feature:** Add a "Proficient" skill tier between Capable and Elite  
> **Date:** 2026-04-07

Please answer each question on the line below it. For follow-up questions, just ask in the chat.

---

## 1. UI & Visual Design

**Q1a: What color should "Proficient" use in the badge and selector?**

Current palette:
- All-Time Great → violet
- Elite → emerald (green)
- Capable → amber (yellow)
- None → slate (gray)

Proficient sits between amber and emerald. Common choices would be sky (light blue), cyan (teal), or blue.

> Why this matters: The color needs to feel visually ordered — someone should be able to glance at badges and sense the tier hierarchy. A warm→cool gradient (amber → sky/blue → emerald) reads intuitively.

Answer: Sky (light blue) — `sky-100/sky-800/sky-200` in Tailwind

---

## 2. Claude Assessments

**Q2a: Should Claude be allowed to return "Proficient" as a tier in its assessments?**

Currently `claude_assessment.py` tells Claude: _"Rate each skill at **None**, **Capable**, **Elite**, or **All-Time Great**"_ and validates responses against that set.

Options:
- **Yes** — Update the Claude prompts and `valid_tiers` set so Claude can output Proficient. This gives you 5-point resolution on Claude ratings.
- **No** — Keep Claude at 4 tiers (None/Capable/Elite/All-Time Great). Proficient would only be reachable via manual override or stat-engine output.

> Why this matters: If Claude can't return Proficient, it can never be the `claude_tier` in compositing — so an auto-accepted composite rating would never land at Proficient. It would still be reachable via manual override in the review/skills API.

Answer: yes

---

## 3. Stat Engine

**Q3a: Should the stat engine (evaluator.py) be able to output "Proficient", and if so, how?**

The evaluator walks tier conditions from highest to lowest (Elite → Capable → None). To have the stat engine return Proficient, you'd need to add a `proficient` condition block to skill definition JSONs.

Options:
- **Yes, add it as a valid output tier** — Skill JSONs can define a `proficient` block. Existing skills that don't define it simply won't hit it. The tier order becomes `Elite → Proficient → Capable → None`.
- **No** — Proficient is only for manual overrides and/or Claude ratings (if Q2a = Yes). The stat engine stays at 4 tiers.

> Why this matters: This determines whether any skill can organically land at Proficient without a human touching it.

Answer: yes

---

## 4. Compositing Disagreement Thresholds

**Q4a: With 5 tiers, should the "two-tier disagreement → flag" rule stay at a diff of 2, or should it change?**

Current compositing logic:
- Diff of 0 → auto-accept (agree)
- Diff of 1 → one-tier disagreement (auto-accept lower tier, unless low confidence → flag)
- Diff of 2+ → two-tier disagreement → always flag

With 5 tiers, a diff of 2 could mean e.g. Capable vs Elite (one tier apart under old system, two under new). The absolute positions shift.

> Why this matters: If you add Proficient between Capable and Elite, then Capable vs Elite now has a diff of 2 instead of 1. That means what was previously a one-tier disagreement (auto-accepted) becomes a two-tier disagreement (flagged). This could create a lot of new flags on existing data.

Options:
- **Keep diff=2 boundary** — Accept new flagging behavior; Capable vs Elite is now a two-tier gap.
- **Raise to diff=3** — Maintain the spirit of "must be very far apart to flag."
- **No change for now** — We're not running compositing on new data yet; revisit when needed.

Answer: Keep diff=2 boundary

---

## 5. Existing Data

**Q5a: Do any existing players/legends have ratings that need to be migrated or re-evaluated?**

The migration is purely additive (new tier string value). No existing records need to change — they stay at their current tier. Proficient only becomes reachable via new actions.

> Confirm this is correct, or note if any backdating/migration of existing records is desired.

Answer: A considerable amount of re-evaluation is needed actually. I'm willing to hear out suggestions on how to handle this

---

## 6. Filter / Explorer

**Q6a: Should "Proficient or higher" be added as a tier filter option in the Players Explorer?**

Currently the player explorer has: "Capable or higher", "Elite or higher", "All-Time Great".

With Proficient added, the natural set would be: "Capable or higher", "Proficient or higher", "Elite or higher", "All-Time Great".

Answer: Yes
