# Lab Lifecycle Design Audit — vs. the Decision-Weight Research

*Generated: 2026-07-06 | Evidence: live UI screenshots (`lab-audit-screens/`) + code map | Flow: `/lab/standard/legends` → `build` → `eval`*

Audits the Lab against the six findings from [lab-juice-game-feel.md](./lab-juice-game-feel.md) and [lab-consequence-decision-weight.md](./lab-consequence-decision-weight.md). Roster used: 2001 Iverson cornerstone + Maxey, Amen Thompson, Durant, Murphy III, Camara, Porter Jr., George, Chandler ($194.1M of $195M cap).

## Audited Flow Map

| Touchpoint | Intent | Affordances | Signifiers & Feedback | Gaps observed |
|---|---|---|---|---|
| **Legends** (`01-legends.png`) | Pick a Cornerstone | Row/Card/Panel views, filter/sort, Random, "Select as Cornerstone", Inspect | Rich 21-skill tier panel per legend | No feedforward of what selecting costs ($54M slot) or seeds; selection navigates via `window.location.href` (full reload — Flow break) |
| **Build, empty** (`02`) | Start the Rotation | Slot strip with numbered OPEN slots, picker table | Empty [Feedback](../../CONTEXT.md) panel shows literal `0.00` dead stars; "What Drags: Only 1 player — need at least 5" | The `0.00` Empty State reads as failure, not invitation |
| **Build, picker hover** (`03`) | Weigh a candidate | Hover row → SalaryGauge ghost: `+$11M`, would-be-remaining | **The one existing feedforward Signifier — salary only** | No eval-impact preview: nothing says what Nesmith does to Build Cohesion |
| **Build, full** (`04`) | Tune the roster | Click/drag add, ✕ remove, slot swap, live eval (500ms debounce), Next Search suggestions with FILTER links, What Holds/What Drags | Live star badge (1.62), cap gauge, rookie-deal counter | Score updates with **no animation** (`transition-colors` only); no delta shown (was 1.55 → now 1.62? invisible); add/remove has no enter/exit feedback |
| **Eval** (`05-eval-full`) | Final read | Factor bars, 13 letter-graded subscores, accentuation, LLM Scouting Note, Pressure Points | Grades + exact values + `title` tooltips; narrative staggered behind spinner | Everything numeric renders **at once**; drilldown stops at subscore level — no per-player contribution anywhere |
| **Save** (`06`) | Commit | Single header button (`Sign In To Save` / `Save Team` → `Saving...` → `Saved`) | aria-live banner, saved-team link, Keep Tuning | **Zero ceremony**: no restating of eval, version pin, or leaderboard stakes; no undo anywhere in the flow |

## Six-Finding Gap Map

| Research finding | Present today? | Evidence |
|---|---|---|
| §1 Feedforward (preview before commit) | **Salary only.** Eval impact: absent | `03` ghost bar; `BuilderPlayerFit` shows qualitative "could feed" but no numeric team delta |
| §2 Instant acknowledgment (<100ms) | **Mostly yes** — roster is local state, updates synchronous; live eval debounced 500ms without blocking | `useRosterSlots.ts`, `useBuilderEvaluation.ts:156-170` |
| §3 Balatro stack (layered, delta-scaled, sequential) | **Absent.** Star badge swaps value silently; subscores land all at once | `CohesionScoreBadge.tsx` (no count-up), `CohesionScoreDisplay.tsx:248-408` |
| §4 Attribution (number explains itself) | **Half.** Subscore grades + tooltips + Pressure Points exist; **no per-player layer** — an F in Spacing next to Durant/Murphy is unexplained and reads as engine error | `05-eval-full`: Spacing F 5.7, Viable Combos 0/126 with no "why" path |
| §5 Transparent Friction at publish | **Absent.** Save is a bare button; drafting correctly frictionless but there's no undo history either | `EvaluatePage.tsx:457-484` — immediate save, no dialog |
| §6 Traps | **One live risk:** harsh unexplained grades are a *trust* failure adjacent to the lying-preview trap — the number isn't dishonest, but it's indefensible without attribution | `05`: 1.62★ / 0/126 viable for a KD+Maxey roster |

## Strongest Signifiers (keep)

- **Next Search suggestions with FILTER affordances** — the engine teaches what to look for and wires it to action. Genuine [Software as Education](../../CONTEXT.md).
- **Salary ghost preview on hover** — exactly the right feedforward shape; it just stops at salary.
- **What Holds / What Drags** — honest, cause-flavored feedback copy.
- **Letter grades + exact values together** — dual coding, tiers for scanning, decimals for truth.
- **Live eval on roster change** — the loop is already reactive; the raw material for juice exists.

## Weakest Signifiers

1. **No eval delta anywhere.** The single number that would carry decision weight — "this add moved you 1.55 → 1.62" — is never shown, before or after a change.
2. **Subscore grades are dead ends.** F in Spacing has no hover path to per-player causes; the engine can't defend itself.
3. **Score changes are silent.** No count-up, flash, or pulse; the most important state change in the product is visually indistinguishable from a re-render.
4. **Save carries no weight.** The one genuinely committing act looks like any other button.
5. **Empty-state `0.00`** frames the start as failure.

## Progressive Disclosure Risks

- Eval page fires all 13 subscores + 4 factors + accentuation simultaneously — novices get the Chernev overload case; a staggered reveal (§3) doubles as sequencing.
- Attribution depth (per-player causes) is missing entirely, so experts hit a ceiling — the opposite failure for the other segment.

## Transparent Friction Opportunities

- **Save & Publish ceremony**: restate final eval, RuleSet Version + Evaluation Version pin, leaderboard consequence, action-labeled buttons.
- **Cornerstone removal** clears the whole roster (`useRosterSlots.ts:143-149`) — today it's instant. This is the one *drafting* act destructive enough to earn an NN/g consequence-restating confirm ("Remove Iverson — clears all 8 other slots").

## Design Boundary Violations

- **Unexplained harsh grades overclaim authority.** 0/126 viable combos with no drill-down asserts a verdict the user can't interrogate — weakens agency and invites distrust of the whole engine. Attribution (§4) is the fix, not softening the scores.

## Mom Test Notes

- Watch, don't ask: give a non-technical user the build page and ask them to make the team better. Do they ever notice the score changed? (Predicts §3 value.)
- After an eval: "Why is Spacing an F?" If they can't answer from the screen, attribution is missing. (Predicts §4 value.)
- At save: "What just happened? Can you change the team now?" (Tests whether commit weight and version pinning are legible.)

## Ranked Fixes

| # | Fix | Research | Type | Effort |
|---|---|---|---|---|
| 1 | **Eval delta on change**: after live eval returns, show `1.55 → 1.62 (+0.07)` with odometer roll + delta-scaled flash on the star badge; keep a fading delta badge on changed subscores (permanence) | §3 | Interaction | S-M |
| 2 | **Eval-impact hover preview**: extend the existing salary-ghost pattern to Build Cohesion — hover a picker player → ghosted projected star delta + top 2 subscore movers. Needs a preview-mode evaluate call (or client approximation); must match the real eval exactly (§6 trap 1) | §1 | Interaction + API | M-L |
| 3 | **Per-player attribution layer**: subscore tile → expand/hover → per-player contributions with the driving skill/synergy named; show engine nonlinearities as labeled line items | §4 | Interaction + API | M-L |
| 4 | **Sequential eval reveal**: on eval page (and on live-eval updates), land factor bars/subscores staggered 60-100ms with a pulse, total last | §3 | Interaction | S |
| 5 | **Save & Publish ceremony**: full-screen or modal moment restating eval, versions, leaderboard stakes; action-labeled buttons | §5 | Interaction | S-M |
| 6 | **Cornerstone-removal confirm** restating "clears all 8 slots" | §5 | Copy + interaction | S |
| 7 | **Empty-state reframe**: replace `0.00` dead stars with a build-progress framing ("4 more for a viable Lineup") | Empty State | Copy + layout | S |
| 8 | **Frequency-scaled subtlety**: full reveal sequence on first eval, short form (flash + roll) on subsequent tweaks | §3/§6 trap 3 | Interaction | S (rides on #1/#4) |

Fixes 1 + 4 are the highest leverage per effort: the live-eval loop and all the data already exist; this is presentation only.

## Handoff

`/impeccable` brief when ready: implement fixes 1, 4, 7, 8 (presentation-only tier) in `components/builder/` — `CohesionScoreBadge.tsx`, `BuilderFeedbackPanel.tsx`, `CohesionScoreDisplay.tsx`. Respect `prefers-reduced-motion` (swap roll/flash for instant value + color). Timing values and library options (Motion `AnimateNumber`) are in [lab-juice-game-feel.md](./lab-juice-game-feel.md) §2. Fixes 2, 3, 5 need backend/API design first — candidates for `/scope`.

## Methodology

Screenshots captured headlessly via Playwright against the live dev servers (frontend :3002, backend :5001), roster injected through the URL-synced `s1..s9` params (`lib/roster-utils.ts`). Screenshot script: session scratchpad `lab-screens.mjs`. Code evidence from `components/builder/*` and `lib/hooks/*` (paths cited inline).
