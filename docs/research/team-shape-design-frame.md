# Team Shape — Design Frame

*From /idea-to-design, 2026-07-06. Decisions locked with Chris; grounded in docs/research/lab-juice-game-feel.md, lab-consequence-decision-weight.md, lab-design-audit.md.*

## Locked decisions

1. **The team shape IS the engine's Lineup subscores** rendered as a radar glyph — never a sum of player shapes, never invented geometry. Honest by construction.
2. **Two concentric outlines**: Starting Lineup solid + Rotation-median ghost. The gap between them is Depth/Floor made visible.
3. **Axes = the ~8–10 magnitude subscores, semantically arranged** (offense arc top-right, defense arc bottom-left; fixed order everywhere). Ratio subscores are excluded — balance is what the shape shows implicitly. Final axis list validated against real score distributions.
4. **Beachhead placement: hero of the Build Feedback panel**, replacing the star badge + subscore text wall (star score becomes a caption). Court strip and picker untouched in slice 1.

## Intent

See your Team's identity form as you build it. Cohesion stops being a number you're told and becomes a shape you watch grow, lean, and cave — in the same visual language basketball fans already read (draft radars, 2K attribute wheels).

## Target User

The barbershop-argument fan mid-Build in the Lab: basketball-fluent, not necessarily stat-fluent. Secondary: the theorycrafter who wants to interrogate the engine (served by deeper disclosure rungs, not the default view).

## User Growth Arc

1. **First Build**: reads only size and gaps — "my shape is lopsided, no left side" (defense).
2. **Few Builds in**: knows the axes by position; sees a swap move specific vertices; starts predicting which vertex a Player will fill before hovering.
3. **Fluent**: recognizes Player silhouettes as archetypes ("that's a 3&D shape"), reasons about fit in shape-language — has internalized the engine's cohesion model. Software as Education: the glyph teaches the taxonomy.

## Design Boundary

- The glyph **renders** engine truth; it never approximates, extrapolates, or decorates it.
- The engine judges; the user decides. The shape shows what *is*, Next Search suggests what *could help* — neither auto-picks.
- No geometry exists that doesn't correspond to a real number in the evaluate response.

## Honest Signifiers

- Every vertex = an actual subscore value from the last real eval; hover any vertex → value + plain-language label.
- Ghost outline = the real Rotation median, labeled as such.
- While the live eval recomputes (500ms debounce + request), the shape shows a subtle "recomputing" state — it never fake-morphs ahead of the engine.
- If/when hover-preview ships (#92), a ghosted candidate shape appears ONLY if it comes from the real preview path — the §6 "lying preview" trap is the standing constraint.

## Transparent Friction

- The shape updates only when the engine actually re-evaluates; the recomputing shimmer makes the engine's work visible instead of pretending instant omniscience.
- Under-filled Builds show a partial/dashed shape ("not yet scorable") rather than a fake full glyph — replaces the dead `0.00` empty state (#90) with an honest one.

## Progressive Disclosure

1. **Default**: team glyph (solid + ghost) + star caption. That's it.
2. **Hover a vertex** → subscore value, grade, one-line meaning.
3. **Hover/select a Player** (court slot or picker row) → that Player's Shape shown *adjacent* (identity glyph, league-percentile composites — never superimposed on the team spokes, the scales aren't comparable).
4. **Click a vertex** → per-player contribution drilldown, and eventually a contribution overlay in true spoke units — both depend on #93's per-player breakdown API.
5. **Expert**: arc isolation toggle; per-Lineup-Combination shapes (the 126) — later, if ever.

**Surface rollout (grill decision):** Build Feedback panel first, then Final Eval (same component, heading/replacing the subscore tile wall). Saved Teams, Community leaderboard, and picker/Profile mini-glyphs follow only after Mom-Test evidence that users read the shape — then roll out broadly ("the shape is the brand").

**Grill amendments (2026-07-06):** axes = 11 shared keys in three arcs mirroring the Subscore Tree (offense 6 / defense 2 / rebounding-transition 3), equal angular span per arc; ghost hidden with an explicit "0 viable" badge when no viable Lineup Combinations exist (ghost = median of viable only, per roster.py); viability harshness filed as #95; the passing spoke ships later — a player-level passing composite (from the Passer skill, riding an Evaluation Version) earns `collective_passing` its spoke as a fast-follow, so the glyph never shows a team number players can't be compared on. Decisions recorded in ADR 0005 (docs/adr/0005-team-shape-renders-engine-truth.md).

## First Vertical Slice

**Render the team glyph in the Feedback panel from the existing evaluate response.** The live eval already returns Lineup subscores and Rotation medians (the panel prints them as text today), so slice 1 is frontend-only:

- Radar glyph with the chosen axes, semantic arc arrangement, solid Starting Lineup + ghost median outlines.
- Vertex hover tooltips (value + label).
- Star score as caption beneath.
- Replaces the subscore text list in the panel (text remains on the Final Eval page untouched).
- `prefers-reduced-motion` honored from day one.

Demoable: build a Rotation, watch the shape exist; swap a bench player, see the ghost move on the next eval. No player overlays, no morph animation, no preview — those are slices 2+.

**Slice 2 (candidate)**: morph animation on eval change (composes with #88's delta/count-up on the caption). **Slice 3 (candidate)**: player silhouette overlay on hover/select. **Slice 4**: mini-glyphs on picker cards / court slots — the bigger builder re-layout decision.

## Risks / Open Questions

- **Axis distribution check**: an axis where everyone scores ~5 adds noise; needs a pass over real composite/subscore distributions before the axis list is final.
- **Live-mode response shape**: confirm `mode:"live"` evaluate returns rotation medians (final mode does; verify live parity) — determines whether the ghost needs a backend touch.
- **Defense arc thinness**: fewer defensive axes could make defense-tilted teams look smaller than they are; may need arc-span weighting. Design-time decision with real data.
- **Panel width**: the glyph must stay legible at the Feedback panel's ~35% width and in the mobile tab view.
- **Relationship to #88/#89**: compose, don't duplicate — #88's count-up lives on the caption, shape morph is its own slice; #89's staggered reveal may become "vertices land in sequence."
- **Archetype vocabulary (#15)** is an enricher, not a blocker: shapes work unnamed; named silhouettes come when the taxonomy lands.
- **Mom Test validation**: watch a non-technical user swap a player — do they look at the shape unprompted? Can they say why the team got worse without reading text?

## Handoff

When ready for UI execution, invoke `/impeccable` with this frame plus the audit's timing values (lab-juice-game-feel.md §2). Before that: `/to-issues` to file slice 1 (and reshape #88/#89/#90/#93 relations) under milestone #6, and a `/scope` pass on slice 1 to size the axis-selection work.
