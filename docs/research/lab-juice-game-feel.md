# Lab Game Feel & Juice: Research Report (Axis 1 of 2)

*Generated: 2026-07-05 | Sources: 44 | Confidence: High on principles & timing values, Medium on menu-game specifics*

> Axis 1 of a two-part research pass for making the Lab build → eval loop feel responsive and game-y.
> This half covers **responsiveness and "juice" — immediate feedback when the user acts**.
> The sibling report ([lab-consequence-decision-weight.md](./lab-consequence-decision-weight.md)) covers consequence communication and decision weight.

## Executive Summary

Game feel research converges on a clear stack: acknowledge every action within ~100ms, layer redundant feedback channels (motion + color + sound) on one event, scale feedback magnitude to event magnitude, and let the interface visibly remember what just happened. Balatro is the definitive proof that a spreadsheet-shaped game can feel alive — its five stacked feedback layers on every scoring event are the closest existing blueprint for Cornerstone's eval moment. The empirical literature says juice reliably improves visual appeal and engagement but only modestly, and only when coherent — habituation research and the Robinhood confetti settlement both warn that juice attached to the wrong event (or repeated identically forever) backfires. The leading cause of "dry" feel is sluggish response, not missing particles: responsiveness is architecture (optimistic updates) before it is animation.

## 1. Core Game-Feel Principles

- **Swink's definition**: game feel is "real-time control of virtual objects in a simulated space, with interactions emphasized by polish." Three building blocks: real-time control, simulated space, and polish effects that emphasize interaction without changing the underlying simulation ([Game Feel ch.1, Swink](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf); [Game feel — Wikipedia](https://en.wikipedia.org/wiki/game_feel)).
- **Swink's 100ms correction cycle**: "real-time" means the system responds within one perception-decision-action loop, under ~100ms. Feedback slower than this stops feeling like *you* caused it ([Game Feel ch.1](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf); converges with [NN/g response time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)).
- **Polish sells physicality with minimal cues** — the smallest clues that sell a robust sense of physical interaction, not maximal decoration ([Liz England's review](https://lizengland.com/blog/review-game-feel-by-steve-swink/); [critpoints](https://critpoints.net/2020/05/23/you-dont-know-what-game-feel-is-read-the-damn-book-please/)).
- **"Juice it or lose it" (Jonasson & Purho, 2012)**: juice = "constant and bountiful user feedback... maximum output for minimum input." The talk iteratively adds tweening, scale/stretch, color, particles, screen shake, and pitch-varied sound to a working Breakout clone — juice is added *on top of a thing that already works*, never load-bearing ([Indie Hackers summary](https://www.indiehackers.com/post/juice-it-or-lose-it-adding-game-feel-to-your-thing-cfb6f494e3); [Brad Woods](https://garden.bradwoods.io/notes/design/juice)).
- **"The Art of Screenshake" (Nijman, 2013)**: ~30 ordered tricks including impact effects, knockback, **permanence** (traces of past actions remain on screen), camera lerp, screen shake, **sleep/hitstop** (a few frames of pause on impact) ([trick list/transcript](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/); [talk video](https://www.youtube.com/watch?v=AJdEqssNZ-U)). Rotation matters: "a few tenths of a degree of rotation reads as force"; shake should come in distinct magnitudes — small for routine actions, large for real events ([valdemird, via search excerpt](https://valdemird.com/blog/game-feel-on-the-web/)).
- **What makes an action feel consequential at the moment of input** (synthesis across the canon):
  1. Acknowledgment within ~100ms.
  2. *Redundant* feedback — multiple simultaneous channels (motion + sound + color) for one action.
  3. *Proportionality* — feedback magnitude scales with event magnitude.
  4. *Permanence* — the world visibly remembers the action.
  5. Non-linear motion (ease/springs) that implies mass.
  ([Brad Woods](https://garden.bradwoods.io/notes/design/juice); [6 Mistakes That'll Drain the Juice — Game Developer](https://www.gamedeveloper.com/design/6-mistakes-that-ll-drain-the-juice-out-of-your-game))
- **Newer academic work (2019–2026)**: Hicks et al. define juiciness as "coherent design of game mechanics and visuals, while providing confirmatory, explicit and ambient feedback" — coherence, not quantity, is the operative word ([Lincoln thesis 2020](https://eprints.lincoln.ac.uk/id/eprint/48516/); [Good Game Feel framework, DiGRA](https://dl.digra.org/index.php/dl/article/view/936)). A 2025 study extended juice to non-game interactive infographics — directly relevant to Cornerstone: juicy versions showed a slight engagement advantage but inconsistent retention effects ([Juicy or Dry?, arXiv 2506.17011](https://arxiv.org/abs/2506.17011)).

## 2. Micro-Feedback Technique Catalog and Parameters

**Duration bands** ([NN/g animation duration](https://www.nngroup.com/articles/animation-duration/)):

| Change type | Duration |
|---|---|
| Simple state feedback (toggle, value flash) | ~100ms |
| Modal/panel-scale changes | 200–300ms |
| Large cross-screen movement | ≤400ms (500ms "starts to feel like a real drag") |
| Entrances vs exits | entrances slightly longer (~300ms) than exits (~200–250ms) |

- "The more frequent the animation, the more subtle and shorter you'll want it to be" ([NN/g](https://www.nngroup.com/articles/animation-duration/)).
- **Material Design corroborates**: ~200ms standard transitions, ~300ms screen transitions, desktop 150–200ms (desktop faster than mobile) ([Material m2 Speed](https://m2.material.io/design/motion/speed.html); [m3 easing & duration](https://m3.material.io/styles/motion/easing-and-duration)).
- **Easing**: linear motion "looks weird and unnatural"; **ease-out for entrances** (fast start = responsive), ease-in for exits; easing gives motion "a sense of weight" ([NN/g](https://www.nngroup.com/articles/animation-duration/)). Springs (physics-based, no fixed duration) are the modern web default for interruptible motion ([Motion docs](https://motion.dev/docs/react-animate-number); [Val Head](https://valhead.com/2016/05/05/how-fast-should-your-ui-animations-be/)).
- **Number count-ups / odometer rolls**: digits roll independently like slot-machine reels with staggered timing (Balatro's chip counter) ([Blake Crosley — Balatro](https://blakecrosley.com/guides/design/balatro)). Web equivalents: [Motion `AnimateNumber`](https://motion.dev/docs/react-animate-number) (spring ticker, 2.5kb), [BuildUI animated counter recipe](https://buildui.com/recipes/animated-counter), [CountUp.js](https://github.com/inorganik/countUp.js), [Odometer](https://npm-compare.com/countup.js,odometer).
- **Screen/element shake as a data channel**: Balatro scales shake to score magnitude — small ~2px, medium ~4px, large ~8px plus rotation — so players read hand value before the number lands ([Blake Crosley](https://blakecrosley.com/guides/design/balatro)). On web: CSS keyframe translate on a container, gated by `prefers-reduced-motion`.
- **Hitstop/sleep**: tens of ms of freeze on impact makes a hit feel weighty ([Art of Screenshake](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/)). Web analog: pause an in-flight count-up ~50–100ms when a big delta lands (designer-consensus timing, not measured research).
- **Scale/flash/pulse**: squash-and-stretch (flatten on impact, stretch on rebound) implies mass ([valdemird](https://valdemird.com/blog/game-feel-on-the-web/)); brief background-color flash then fade is the classic DOM "value changed" cue.
- **Sound**: pitch variation is the highest-leverage audio trick — Balatro plays a rising note per scoring card (C-D-E-F-G), sfx "tweaked according to their values" ([Blake Crosley](https://blakecrosley.com/guides/design/balatro); [Indieklem](https://indieklem.substack.com/p/20-a-look-at-100-interface-games)). Web: [Howler.js](https://howlerjs.com/) (7kb, sprite sheets = zero-latency named UI sounds); browsers require a user gesture before audio, and users must get mute control ([MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)).
- **Particles**: color-matched bursts from the element that caused the event (Balatro's chips burst from scored cards) ([Blake Crosley](https://blakecrosley.com/guides/design/balatro)); on web, canvas-confetti or short-lived positioned DOM sprites.
- **Priority rule**: juice the *moment-to-moment* interactions (add/remove player, score change) before rare milestones — Mario 64 polishes running/jumping, not the ending ([Brad Woods](https://garden.bradwoods.io/notes/design/juice)).

## 3. Menu-Driven Strategy/Simulation Games

- **Balatro is the definitive case study** for making a pure-interface, spreadsheet-shaped game feel alive. Five stacked feedback layers on every scoring event: card animation (spring bounce), rolling chip counter, screen effects (shake scaled to magnitude, CRT scanline pulse), color-matched particles, layered audio (rising pitch per card, "ka-ching" for multipliers, bass at thresholds). "Strip Balatro's animations and sounds and you have a calculator; the juice IS the game" ([Blake Crosley](https://blakecrosley.com/guides/design/balatro)).
- **Sequencing as explanation**: Jokers activate left-to-right, each with its own pulse and a running-total update — sequential animation "replaces a 10-page tutorial with 300ms of sequential animation" by showing *causality*. Number-jump frequency syncs with audio pitch ([Blake Crosley](https://blakecrosley.com/guides/design/balatro); [Balatro Design Analysis — cccChoice](https://medium.com/@yyh19971004/balatro-design-analysis-visual-packaging-and-interactive-feedback-cc6fa6a65370)).
- **100%-interface games generally** (Balatro, In Other Waters, Papers Please): three levers — (1) sfx paired to every animation and tweaked to values, (2) aesthetic cohesion ("one palette, one style, one consistency" — the interface *is* the game world), (3) UI-as-mechanic ([Indieklem](https://indieklem.substack.com/p/20-a-look-at-100-interface-games)).
- **Negative evidence from Civ/Paradox**: community feedback stresses that in click-heavy strategy games "the UI cannot feel sluggish anywhere, otherwise it wears down the player with hundreds to thousands of micro delays"; missing hover/selection feedback is the top complaint ([Paradox forums](https://forum.paradoxplaza.com/forum/threads/ui-feedback-in-comparison-to-civ-5.1624268/)). Per-click responsiveness compounds because click volume is enormous.
- **Football Manager**: a "spreadsheet simulator" whose entire loop routes through one Continue button ([SI manual](https://community.sports-interactive.com/sigames-manual/football-manager-2024/the-user-interface-r4951/)); FM26's UI rework drew "no immersion" backlash ([FM26 feedback thread](https://community.sports-interactive.com/forums/topic/594137-official-football-manager-26-feedback-thread/page/68/)). No good formal design writing found on *how* FM juices menus — see Gaps.
- **NBA 2K MyTeam pack openings** stage rarity reveals as theatrical sequences (escalating reveal animation) ([NBA 2K25 Courtside Report](https://nba.2k.com/2k25/courtside-report/myteam/)) — anticipation-then-reveal structure, not raw speed, is the juice. Observational; thin sourcing.

## 4. HCI Evidence and Failure Thresholds

- **Nielsen's three limits** (rooted in Miller 1968 and Card et al. 1991): **0.1s** = feels instantaneous, direct manipulation; **1s** = flow of thought stays unbroken though delay is noticed; **10s** = attention limit, needs progress feedback ([NN/g Response Time Limits](https://www.nngroup.com/articles/response-times-3-important-limits/); [NN/g Powers of 10](https://www.nngroup.com/articles/powers-of-10-time-scales-in-ux/)). Research-backed and stable for 50+ years.
- **Doherty threshold (~400ms)**: from Doherty & Thadani, IBM Systems Journal 1982. Widely cited via [Laws of UX](https://lawsofux.com/doherty-threshold/), but the original productivity-causation evidence is questioned; treat as folklore-adjacent heuristic.
- **Does juice actually improve experience? (empirical)**:
  - Hicks et al. 2019 (CHI PLAY, n=40 + n=32): visual embellishments reliably improve *visual appeal*; effects on felt competence appear only in specific circumstances ([Juicy Game Design](https://dl.acm.org/doi/abs/10.1145/3311350.3347171); [thesis](https://eprints.lincoln.ac.uk/id/eprint/48516/)).
  - Kao 2018 tested juiciness levels in an action RPG — effects present but non-monotonic ([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1875952118300879)). Single-source, not deep-read.
  - 2025 infographics study: juicy versions slightly higher engagement; retention mixed — the dry version won one recall test ([arXiv 2506.17011](https://arxiv.org/abs/2506.17011)).
- **Habituation/feedback fatigue**: repeated exposure to identical stimuli reduces response — users mentally mute repetitive celebratory feedback ([Sarah Doody](https://www.sarahdoody.com/the-danger-of-habitutation-in-ux/)); animation should be subtle, brief, and purpose-driven or it raises cognitive load ([NN/g Role of Animation](https://www.nngroup.com/articles/animation-purpose-ux/)); "if something is an ordinary occurrence, it does not need an extraordinary response" ([UX Collective](https://uxdesign.cc/the-over-confetti-ing-of-digital-experiences-af523745db19)).
- **Accessibility**: excessive motion/flashing/parallax can trigger vestibular problems, nausea, migraines; respect `prefers-reduced-motion` ([NN/g](https://www.nngroup.com/articles/animation-duration/)).

## 5. Web Prior Art and Implementation Stack

- **Duolingo**: "a gamification engine that happens to teach languages" — every animation A/B-tested; semantic color system (green success, orange streak, yellow XP); micro-feedback per answer, celebration reserved for lesson completion ([Blake Crosley — Duolingo](https://blakecrosley.com/guides/design/duolingo); [Medium](https://medium.com/@Bundu/little-touches-big-impact-the-micro-interactions-on-duolingo-d8377876f682)).
- **Robinhood confetti — the cautionary tale**: Massachusetts regulators cited confetti-on-trade as gamification manipulating inexperienced investors; removed March 2021; **$7.5M** settlement ([CNBC](https://www.cnbc.com/2021/03/31/robinhood-gets-rid-of-confetti-feature-amid-scrutiny-over-gamification.html); [Yale Law Journal](https://www.yalelawjournal.org/forum/on-confetti-regulation-the-wrong-way-to-regulate-gamified-investing); [Vinson & Elkins](https://www.velaw.com/insights/game-over-robinhood-pays-7-5-million-to-resolve-gamification-securities-violations/)). Lesson: juice attached to the *act of transacting* rather than to information reads as manipulation; celebrate understanding, not spending.
- **Linear**: perceived speed as *architecture* — local-first sync engine, optimistic writes, UI updates instantly with background reconciliation ([How's Linear so fast](https://1023jack.com/general/how-s-linear-so-fast-a-technical-breakdown/); [Reverse engineering Linear's sync magic](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/)). For Cornerstone: the eval call is server-side, so the *acknowledgment* (slot fills, chip animates in <100ms) must be optimistic even if the score takes longer.
- **Rauno Freiberg craft principles**: apply feedback *on touch/click, not on completion*; "high-frequency interactions shouldn't animate" — novelty diminishes with repetition; directional motion communicates source relationships ([rauno.me](https://rauno.me/craft/interaction-design)). Emil Kowalski's animations.dev is the current practitioner canon ([emilkowal.ski](https://emilkowal.ski/)).
- **Sleeper**: fantasy sports differentiated on design + notification experience + personality layers on top of stats ([DraftKick](https://draftkick.com/blog/story-of-sleeper/)). Single-source, observational.
- **Library stack**: [Motion `AnimateNumber`](https://motion.dev/docs/react-animate-number) for spring-tickered scores; [BuildUI counter recipe](https://buildui.com/recipes/animated-counter); [CountUp.js](https://github.com/inorganik/countUp.js)/[react-countup](https://www.npmjs.com/package/react-countup); [Odometer](https://npm-compare.com/countup.js,odometer); [Howler.js](https://howlerjs.com/) for sprite-based UI sound; CSS `linear()`/spring easings for flash/shake; `prefers-reduced-motion` gate over all of it.

## Pattern Catalog for the Lab

| Pattern | Example | Principle | Web implementation note |
|---|---|---|---|
| **Instant acknowledgment before evaluation** | Linear optimistic writes | Action acknowledged <100ms even when the real result is slower | On add/remove: slot fills, card snaps with ~150–200ms ease-out spring immediately; eval score updates when server returns. Never gate the drop animation on the API. |
| **Odometer score roll** | Balatro chip counter | A number that *travels* to its new value dramatizes the delta | Motion `AnimateNumber` or BuildUI recipe; spring or 300–600ms ease-out; longer roll for bigger deltas |
| **Delta-proportional emphasis** | Balatro shake tiers (2/4/8px) | Feedback magnitude = event magnitude; intensity becomes readable data | 3 tiers: small delta = color flash only; medium = flash + pulse (scale 1.0→1.05→1.0, ~200ms); large = container shake 4–8px + fractional rotation, ~300ms |
| **Sequential cause-reveal** | Balatro jokers firing left-to-right | Staggered animation shows *why* the number changed — feedback doubles as explanation | Stagger subscore rows updating 60–100ms apart, each pulsing as it lands, total under ~1s |
| **Color state flash** | Stock tickers; Duolingo semantic colors | Brief semantic color marks *what changed and in which direction* | Background flash green/red then fade ~400–500ms; semantic, not decorative |
| **Squash-and-stretch on placement** | Juice it or lose it | Deformation on impact implies mass — the player card "lands" | Scale y 1→0.9→1 with overshoot spring on drop, ~250ms; transform-only |
| **Pitch-laddered sound** | Balatro rising note per card | Rising pitch encodes accumulation | Howler sprite; pitch up per consecutive positive event; user-gesture unlock + visible mute; default subtle |
| **Hitstop on big events** | Nijman sleep frames | A beat of stillness before a big reveal amplifies weight | Pause the count-up ~80ms when a threshold crosses, then resume with a pulse |
| **Permanence** | Art of Screenshake | The interface remembers recent actions — consequence lingers | Last-changed subscore keeps a fading highlight or small delta badge (+2.3) for a few seconds |
| **Ambient life** | 100%-interface games | Zero motion = dead spreadsheet | Very slow gradient/particle drift behind the eval panel; must survive `prefers-reduced-motion` |
| **Frequency-scaled subtlety** | Rauno: high-frequency actions don't animate | The 50th player-swap must not replay the first swap's fanfare | Full sequence on first eval; subsequent updates use short form (flash + roll only); celebration tiers reserved for record scores |
| **Reduced-motion gate** | NN/g accessibility | Vestibular safety; forces a non-motion fallback to exist | `@media (prefers-reduced-motion: reduce)`: swap shake/roll for instant value + color flash |

## Evidence vs Folklore

| Claim | Status |
|---|---|
| <100ms feels instantaneous/self-caused; ~1s keeps flow; ~10s attention limit | **Research-backed** (Miller 1968, Card et al. 1991, [NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/)) |
| UI animation sweet spot 100–500ms; ease-out entrances; frequent = shorter | **Expert synthesis with perception-research grounding** ([NN/g](https://www.nngroup.com/articles/animation-duration/), Material Design) |
| Doherty 400ms boosts productivity | **Cited-everywhere but questioned** — use as heuristic only ([Laws of UX](https://lawsofux.com/doherty-threshold/)) |
| Juice increases visual appeal/engagement | **Research-backed, modest effect** ([Hicks et al. 2019](https://dl.acm.org/doi/abs/10.1145/3311350.3347171); [arXiv 2025](https://arxiv.org/abs/2506.17011)) |
| Juice improves competence/retention/learning | **Mixed/unsupported** — dry sometimes wins recall ([arXiv 2506.17011](https://arxiv.org/abs/2506.17011)) |
| Shake magnitudes, hitstop frames, rotation-reads-as-force, pitch ladders | **Designer consensus** — no controlled studies; validated by shipped hits |
| "More juice = more fun, always" | **Folklore, contradicted** — habituation + Hicks's coherence definition cut against it |
| Repeated identical celebrations lose effect (habituation) | **Research-backed psychology applied to UX** ([Sarah Doody](https://www.sarahdoody.com/the-danger-of-habitutation-in-ux/); [NN/g](https://www.nngroup.com/articles/animation-purpose-ux/)) |
| Kao 2018 action-RPG juiciness effects | **Single-source, not deep-read** — unverified detail |

## Failure Modes

- **Juice masking a broken core**: "play your game with the juice turned off" — if the eval logic isn't trusted, polish makes distrust worse ([Wayline](https://www.wayline.io/blog/the-seductive-squeeze-when-juice-in-game-development-becomes-a-crutch)).
- **False feedback**: satisfying feedback for an event the user believes shouldn't have happened destroys the illusion ([Wayline](https://www.wayline.io/blog/the-seductive-squeeze-when-juice-in-game-development-becomes-a-crutch)).
- **Reactiveness over responsiveness**: pouring effort into effect magnitude while input latency stays high — the leading cause of "dry" feel is sluggish response, not missing particles ([Wayline](https://www.wayline.io/blog/the-seductive-squeeze-when-juice-in-game-development-becomes-a-crutch); [Game Developer](https://www.gamedeveloper.com/design/6-mistakes-that-ll-drain-the-juice-out-of-your-game)).
- **Dishonest juice**: celebrating the *transaction* rather than the outcome — Robinhood's confetti became a regulatory exhibit ([Yale LJ](https://www.yalelawjournal.org/forum/on-confetti-regulation-the-wrong-way-to-regulate-gamified-investing)). For Cornerstone: juice the *evaluation insight*, never nudge toward roster churn for its own sake.
- **Feedback fatigue / over-confetti-ing**: ordinary events with extraordinary responses train users to ignore all feedback ([UX Collective](https://uxdesign.cc/the-over-confetti-ing-of-digital-experiences-af523745db19)).
- **Visual noise destroying clarity**: motion pulls the eye instinctively — animate the wrong thing and hierarchy collapses ([Game Developer](https://www.gamedeveloper.com/design/6-mistakes-that-ll-drain-the-juice-out-of-your-game); [Calabro](https://trevorcalabro.substack.com/p/most-ui-animations-shouldnt-exist)).
- **Animation-added latency**: juice that blocks the next action is negative juice ([rauno.me](https://rauno.me/craft/interaction-design); [NN/g](https://www.nngroup.com/articles/animation-duration/)).
- **Accessibility harm**: shake/flash without a `prefers-reduced-motion` path ([NN/g](https://www.nngroup.com/articles/animation-duration/)).

## Key Takeaways

- Responsiveness is architecture first: optimistic acknowledgment <100ms on every add/remove, before any animation work.
- Steal Balatro's five-layer stack for the eval moment; sequence subscore updates so the feedback *explains* the score.
- Scale feedback to delta size — three tiers, from color flash to shake — so intensity itself carries information.
- Shorten/silence feedback on repeat actions; save ceremony for record scores.
- Never juice the transaction (Robinhood); juice the insight. Gate everything behind `prefers-reduced-motion`.

## Sources

1. [Game Feel ch.1 — Steve Swink (PDF)](http://mycours.es/gamedesign2014/files/2014/10/Game-Feel-Steve-Swink-chapter-1.pdf) — canonical definition, 100ms correction cycle.
2. [Game feel — Wikipedia](https://en.wikipedia.org/wiki/game_feel) — Swink's three building blocks.
3. [Review: Game Feel — Liz England](https://lizengland.com/blog/review-game-feel-by-steve-swink/) — practitioner reading.
4. [You don't know what Game Feel is — critpoints](https://critpoints.net/2020/05/23/you-dont-know-what-game-feel-is-read-the-damn-book-please/) — corrective essay.
5. [The Art of Screenshake trick list/transcript](https://theengineeringofconsciousexperience.com/jan-willem-nijman-vlambeer-the-art-of-screenshake/) — ordered trick list.
6. [Nijman — The art of screenshake (video)](https://www.youtube.com/watch?v=AJdEqssNZ-U) — primary talk.
7. [Juice it or lose it — Indie Hackers summary](https://www.indiehackers.com/post/juice-it-or-lose-it-adding-game-feel-to-your-thing-cfb6f494e3) — techniques applied outside games.
8. [Game feel on the web — valdemird](https://valdemird.com/blog/game-feel-on-the-web/) — juice-to-web translation (fetch blocked; via search excerpts).
9. [Balatro: Juicy Feedback in a Poker Roguelike — Blake Crosley](https://blakecrosley.com/guides/design/balatro) — five-layer breakdown with pixel/pitch parameters.
10. [Balatro Design Analysis — cccChoice](https://medium.com/@yyh19971004/balatro-design-analysis-visual-packaging-and-interactive-feedback-cc6fa6a65370) — audiovisual synchronization.
11. [A look at 100%-interface games — Indieklem](https://indieklem.substack.com/p/20-a-look-at-100-interface-games) — pure-UI games.
12. [Juice — Brad Woods' garden](https://garden.bradwoods.io/notes/design/juice) — best web-native juice catalog.
13. [6 Mistakes That'll Drain the Juice — Game Developer](https://www.gamedeveloper.com/design/6-mistakes-that-ll-drain-the-juice-out-of-your-game) — anti-patterns.
14. [When Juice Becomes a Crutch — Wayline](https://www.wayline.io/blog/the-seductive-squeeze-when-juice-in-game-development-becomes-a-crutch) — responsiveness vs reactiveness.
15. [Response Time Limits — NN/g](https://www.nngroup.com/articles/response-times-3-important-limits/) — 0.1/1/10s canon.
16. [Executing UX Animations: Duration — NN/g](https://www.nngroup.com/articles/animation-duration/) — 100–500ms bands, easing, accessibility.
17. [The Role of Animation and Motion in UX — NN/g](https://www.nngroup.com/articles/animation-purpose-ux/) — purpose-driven animation.
18. [Material Design — Speed](https://m2.material.io/design/motion/speed.html) — platform duration standards.
19. [Doherty Threshold — Laws of UX](https://lawsofux.com/doherty-threshold/) — 400ms heuristic + provenance.
20. [Juicy Game Design (CHI PLAY 2019) — Hicks et al.](https://dl.acm.org/doi/abs/10.1145/3311350.3347171) — controlled studies.
21. [Juicy Game Design thesis — Lincoln](https://eprints.lincoln.ac.uk/id/eprint/48516/) — empirical juiciness framework.
22. [Good Game Feel framework — DiGRA](https://dl.digra.org/index.php/dl/article/view/936) — 17-developer survey.
23. [Juicy or Dry? (arXiv 2506.17011, 2025)](https://arxiv.org/abs/2506.17011) — juice in interactive infographics.
24. [The effects of juiciness in an action RPG — Kao](https://www.sciencedirect.com/science/article/pii/S1875952118300879) — juiciness-level experiment (not deep-read).
25. [Robinhood removes confetti — CNBC](https://www.cnbc.com/2021/03/31/robinhood-gets-rid-of-confetti-feature-amid-scrutiny-over-gamification.html).
26. [On "Confetti Regulation" — Yale Law Journal](https://www.yalelawjournal.org/forum/on-confetti-regulation-the-wrong-way-to-regulate-gamified-investing).
27. [Robinhood $7.5M settlement — Vinson & Elkins](https://www.velaw.com/insights/game-over-robinhood-pays-7-5-million-to-resolve-gamification-securities-violations/).
28. [Duolingo: Gamification as Design Language — Blake Crosley](https://blakecrosley.com/guides/design/duolingo).
29. [Duolingo micro-interactions — Medium](https://medium.com/@Bundu/little-touches-big-impact-the-micro-interactions-on-duolingo-d8377876f682).
30. [How's Linear so fast — 1023jack](https://1023jack.com/general/how-s-linear-so-fast-a-technical-breakdown/).
31. [Reverse engineering Linear's sync magic — marknotfound](https://marknotfound.com/posts/reverse-engineering-linears-sync-magic/).
32. [Invisible Details of Interaction Design — rauno.me](https://rauno.me/craft/interaction-design).
33. [The Story of Sleeper — DraftKick](https://draftkick.com/blog/story-of-sleeper/).
34. [AnimateNumber — Motion docs](https://motion.dev/docs/react-animate-number).
35. [Animated Counter recipe — BuildUI](https://buildui.com/recipes/animated-counter).
36. [CountUp.js — GitHub](https://github.com/inorganik/countUp.js).
37. [Howler.js](https://howlerjs.com/).
38. [Web Audio API best practices — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices).
39. [The danger of habituation — Sarah Doody](https://www.sarahdoody.com/the-danger-of-habitutation-in-ux/).
40. [The over-confetti-ing of digital experiences — UX Collective](https://uxdesign.cc/the-over-confetti-ing-of-digital-experiences-af523745db19).
41. [Most UI Animations Shouldn't Exist — Trevor Calabro](https://trevorcalabro.substack.com/p/most-ui-animations-shouldnt-exist).
42. [Civ UI feedback thread — Paradox forums](https://forum.paradoxplaza.com/forum/threads/ui-feedback-in-comparison-to-civ-5.1624268/) — sluggish menu UI compounds.
43. [How fast should your UI animations be? — Val Head](https://valhead.com/2016/05/05/how-fast-should-your-ui-animations-be/).
44. [MyTEAM Courtside Report — NBA 2K25](https://nba.2k.com/2k25/courtside-report/myteam/) — pack-reveal staging (observational).

## Methodology

Research agent using WebSearch + WebFetch (no firecrawl/exa MCP configured). 2–3 keyword variations per sub-question; ~44 unique sources, 12 deep-read. Sub-questions: (1) core game-feel canon, (2) micro-feedback catalog with timing parameters, (3) juice in menu-driven strategy/management games, (4) HCI evidence and failure thresholds, (5) web prior art and library stack.

## Gaps

- **FM / Civ / Paradox menu-juice specifics**: almost no formal design writing; this leg rests on Balatro and the 100%-interface essay, plus Civ-forum negative evidence.
- **NBA 2K menu/pack UI**: marketing pages only; observational.
- **Sleeper**: no serious design teardown; single-source.
- **Two fetch failures**: valdemird.com (403 — used via search excerpts) and gamejuice.co.uk (403); Jonasson/Purho ordering comes from secondary summaries.
- **Count-up timing norms**: no research-grade guidance on ideal count-up duration; catalog values extrapolated from NN/g bands + Balatro observation.
