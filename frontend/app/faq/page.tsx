import Link from "next/link";
import type { Metadata } from "next";
import type { SkillTier } from "@/lib/types";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";

export const metadata: Metadata = {
  title: "FAQ · Cornerstone",
  description:
    "How Cornerstone works. The engine, the Skills, the RuleSets, and why Saved Teams stay honest across versions.",
};

/* ── Tier chip — server-safe inline version of SkillTierBadge ── */
function TierChip({ tier }: { tier: SkillTier }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[0.6875rem] font-medium rounded-sm whitespace-nowrap ${TIER_BADGE_CLASSES[tier]}`}
    >
      {tier}
    </span>
  );
}

/* ── Engine chain nodes ── */
const ENGINE_CHAIN: ReadonlyArray<{ anchor: string; label: string }> = [
  { anchor: "stats",      label: "Stats" },
  { anchor: "skills",     label: "Skills" },
  { anchor: "traits",     label: "Impact Traits" },
  { anchor: "subscores",  label: "Lineup Subscores" },
  { anchor: "lineup",     label: "Lineup" },
  { anchor: "combos",     label: "Lineup Combos" },
  { anchor: "cohesion",   label: "Cohesion Score" },
];

/* ── Table of contents — flat anchor list ── */
const TOC: ReadonlyArray<{ id: string; label: string }> = [
  { id: "what",          label: "What is Cornerstone?" },
  { id: "chain",         label: "The engine chain" },
  { id: "skills",        label: "What is a Skill?" },
  { id: "derived",       label: "How are Skills derived?" },
  { id: "traits",        label: "What is an Impact Trait?" },
  { id: "subscores",     label: "What is a Lineup Subscore?" },
  { id: "lineup-roster", label: "Lineup vs Rotation vs Roster" },
  { id: "cohesion",      label: "What is a Cohesion Score?" },
  { id: "versioning",    label: "RuleSets, Snapshot Releases, Evaluation Versions" },
  { id: "misc",          label: "More questions" },
];

/* ── FAQ misc list (Q / A pairs) ── */
const MISC_QA: ReadonlyArray<{ q: string; a: React.ReactNode }> = [
  {
    q: "Why is the Cornerstone Player worth $54M?",
    a: "Roughly the max contract a generational anchor commands in the modern NBA cap structure. The number anchors the rest of the cap math: it is large enough that the Cornerstone is the most expensive piece on the team by a wide margin, and small enough that there is real money left over for eight supporting Players. It is a deliberate constraint, not a market quote.",
  },
  {
    q: "What does the salary cap mean, and where does each Player's number come from?",
    a: "Active Players use their real NBA contract for the current season. Legends are assigned a Cornerstone-equivalent figure for the $54M anchor slot, or a tier-based estimate when slotted into a supporting role. The cap forces tradeoffs: you cannot stack four max Players on one roster and call it a hypothetical.",
  },
  {
    q: "Why 21 Skills and not 50?",
    a: "21 is the smallest number that still describes a modern Player honestly. Fewer and the model collapses different roles into the same bucket. More and the Skills start overlapping, which makes evaluation noisier rather than sharper. The taxonomy is treated as immutable: adding or removing a Skill requires a database migration and a new Evaluation Version.",
  },
  {
    q: "Can a Player be All-Time Great in a Skill that did not exist in their era?",
    a: "Yes. Jerry West was an All-Time Great shot maker decades before the three-point line was added in 1979. The Skill taxonomy describes basketball ability, not era-specific stat categories. Where Claude assessment and stat thresholds disagree on era-bound questions, the disagreement gets flagged for manual review rather than silently averaged.",
  },
  {
    q: "How often does the Player Pool update?",
    a: (
      <>
        Whenever a new Snapshot Release is published. A Snapshot Release freezes the Player Pool, Skill Profiles, contracts, and team assignments at one moment. New stats and contract changes accumulate in a draft Snapshot, get reviewed, then publish as the next Release. See <a href="#versioning" className="text-[#fe6d34] hover:underline">RuleSets, Snapshot Releases, Evaluation Versions</a>.
      </>
    ),
  },
  {
    q: "Can I export or share my Saved Team?",
    a: "Saved Teams have public share links. Anyone with the link sees the Team, its RuleSet, its Snapshot Release, and its Evaluation Version. The scoring stays reproducible because all three contexts are pinned. CSV or other exports are not built yet.",
  },
  {
    q: "What is the difference between Lineup, Rotation, and Roster evaluation?",
    a: (
      <>
        <strong>Lineup</strong> evaluates the five Players on the floor at once: spacing, rim pressure, defensive coverage, the things that matter for a single possession. <strong>Rotation</strong> evaluates playable depth across the Lineup Combos a coach can actually deploy, including matchup flexibility. <strong>Roster</strong> evaluates the full Saved Team, including bench fit and structural redundancy. Each mode rolls up from the same Skill Profiles but weights them differently.
      </>
    ),
  },
  {
    q: "Why doesn't a specific Player have Skill X?",
    a: "Either their stats did not clear the volume gate for that Skill in the current Snapshot Release, or the stat thresholds and Claude assessment disagreed and the disagreement is still in the review queue. Player Skill Profiles update with each Snapshot Release, so a Skill that did not appear last cycle may appear in the next one.",
  },
  {
    q: "What if I disagree with a rating?",
    a: "Ratings are opinions backed by math. The math is published. If you think a Player's Skill Profile is wrong, the most useful disagreement points at a specific Skill Tier and explains which stat threshold or basketball judgment should change. That is what the admin review queue exists to settle.",
  },
];

/**
 * FAQ Surface — explains the Cornerstone engine at product level.
 * Server component. No client interactions in v1; anchors handle navigation.
 */
export default function FAQPage() {
  return (
    <main id="faq-page">
      {/* ════════════════════════════════════════════════════════════
          HEADER — Editorial intro, no hero card
          ════════════════════════════════════════════════════════════ */}
      <header
        id="faq-header"
        className="border-b border-border bg-card"
      >
        <div className="max-w-screen-xl mx-auto px-6 py-16 md:py-20">
          <span
            id="faq-eyebrow"
            className="inline-block font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground mb-4"
          >
            FAQ &middot; Field Guide &middot; The Engine, Explained
          </span>
          <h1
            id="faq-title"
            className="font-display text-[clamp(2.25rem,4vw+1rem,3.75rem)] font-bold leading-[1.05] tracking-[-0.02em] text-foreground max-w-3xl"
            style={{ textWrap: "balance" }}
          >
            How the argument
            <br />
            actually gets settled.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground max-w-[65ch]">
            Cornerstone turns hypothetical roster debates into something you can build and score against shared rules. This page walks through the engine end to end: how Stats become Skills, how Skills feed Impact Traits, and how that chain produces the final Cohesion Score on every Saved Team.
          </p>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════
          BODY — Sticky TOC (desktop) + long-form article
          ════════════════════════════════════════════════════════════ */}
      <div className="max-w-screen-xl mx-auto px-6 py-16 md:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-[14rem_1fr] gap-12 lg:gap-16">

          {/* ── Sticky TOC ── */}
          <aside
            id="faq-toc"
            aria-label="Table of contents"
            className="lg:sticky lg:top-20 lg:self-start"
          >
            <span className="font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
              Contents
            </span>
            <ol id="faq-toc-list" className="mt-3 space-y-2 text-sm">
              {TOC.map((item, i) => (
                <li key={item.id} className="flex gap-3">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground/60 select-none w-5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <a
                    id={`faq-toc-link-${item.id}`}
                    href={`#${item.id}`}
                    className="text-muted-foreground hover:text-foreground transition-colors leading-snug"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ol>
          </aside>

          {/* ── Article content ── */}
          <article id="faq-article" className="min-w-0">

            {/* ─────────────── 01 — What is Cornerstone? ─────────────── */}
            <section
              id="what"
              aria-labelledby="what-heading"
              className="scroll-mt-20"
            >
              <SectionNumber>01</SectionNumber>
              <h2
                id="what-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                What is Cornerstone?
              </h2>
              <Prose>
                <p>
                  Cornerstone is the engine for the barbershop argument. &quot;$15 to build a starting five.&quot; &quot;Five eras of LeBron, which years?&quot; &quot;Best roster around prime Hakeem?&quot; Every basketball fan has had the conversation. Cornerstone is the place where the argument has rules, math, and a shared scoreboard.
                </p>
                <p>
                  The original spark was JJ Redick&apos;s <em>Old Man and the Three</em> &quot;Build the Perfect Team Around X Legend&quot; series. Pick a Legend. Build the supporting cast that fits their game, their era, their weaknesses. The Cornerstone Player ($54M anchor) and the supporting cap structure are direct descendants of that format.
                </p>
                <p>
                  From there the product borrows shamelessly:
                </p>
                <ul>
                  <li>
                    <strong>Pokemon Showdown</strong> for the format-first mindset. Every Team is built and scored under a specific RuleSet, the way every Showdown team is built under a specific metagame tier. Comparisons stay apples-to-apples.
                  </li>
                  <li>
                    <strong>NBA 2K MyBuilder / Lab</strong> for the nomenclature. The Lab is where you experiment. A Build is a configuration in progress. Skill Tiers are ratings.
                  </li>
                  <li>
                    <strong>Basketball GM</strong> for the running-engine ethos. A real simulator underneath, exposed honestly to a knowledgeable audience, without fluff.
                  </li>
                </ul>
              </Prose>
            </section>

            {/* ─────────────── 02 — Engine chain ─────────────── */}
            <section
              id="chain"
              aria-labelledby="chain-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>02</SectionNumber>
              <h2
                id="chain-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                The engine chain.
              </h2>
              <Prose>
                <p>
                  Every Cohesion Score traces back through the same pipeline. Each node feeds the next. Click a node to jump to its section.
                </p>
              </Prose>

              {/* Flow diagram — horizontal on desktop, vertical on mobile */}
              <ol
                id="faq-engine-chain"
                aria-label="Engine pipeline"
                className="mt-8 flex flex-col lg:flex-row lg:flex-wrap lg:items-stretch gap-2"
              >
                {ENGINE_CHAIN.map((node, i) => (
                  <li key={node.anchor} className="flex flex-col lg:flex-row items-stretch">
                    <a
                      href={`#${node.anchor}`}
                      className="group flex items-center justify-center min-h-[3rem] px-4 py-2.5 rounded-md border border-border bg-background text-sm font-medium text-foreground transition-colors hover:border-[#fe6d34] hover:bg-[#fe6d34]/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe6d34]"
                    >
                      <span className="font-mono text-[0.625rem] text-muted-foreground mr-2 tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {node.label}
                    </a>
                    {i < ENGINE_CHAIN.length - 1 && (
                      <span
                        aria-hidden="true"
                        className="flex items-center justify-center text-muted-foreground/50 select-none px-2 lg:px-2 py-1 lg:py-0"
                      >
                        {/* Down on mobile, right on desktop */}
                        <span className="lg:hidden">↓</span>
                        <span className="hidden lg:inline">→</span>
                      </span>
                    )}
                  </li>
                ))}
              </ol>

              {/* Atmospheric callout — barbershop framing */}
              <Callout label="The argument, made explicit">
                Every claim about a team — &quot;they have no rim protection,&quot; &quot;the spacing is broken,&quot; &quot;they cannot get a shot in the half court&quot; — lives somewhere in this chain. The job of the engine is to turn those gut reads into something you can point at.
              </Callout>
            </section>

            {/* ─────────────── 03 — What is a Skill? ─────────────── */}
            <section
              id="skills"
              aria-labelledby="skills-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>03</SectionNumber>
              <h2
                id="skills-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                What is a Skill?
              </h2>
              <Prose>
                <p>
                  A Skill is one atomic basketball ability. Cornerstone maintains a fixed taxonomy of 21 Skills. Every Player gets a rating in every Skill, and that rating lives on one of five Skill Tiers:
                </p>
              </Prose>

              <ul
                id="faq-tier-ladder"
                className="mt-6 flex flex-wrap items-center gap-2"
              >
                {(["All-Time Great", "Elite", "Proficient", "Capable", "None"] as const).map((tier) => (
                  <li key={tier}>
                    <TierChip tier={tier} />
                  </li>
                ))}
              </ul>

              <Prose>
                <p className="mt-6">
                  Skills cover the obvious categories — Isolation Scorer, Rim Protector, Defensive Rebounding — and the less obvious ones a single box-score column cannot capture, like PnR Ball Handler, Off-Ball Mover, and Versatile Defender. Together the 21 Skills form a Player&apos;s Skill Profile.
                </p>
              </Prose>
            </section>

            {/* ─────────────── 04 — How Skills are derived ─────────────── */}
            <section
              id="derived"
              aria-labelledby="derived-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>04</SectionNumber>
              <h2
                id="derived-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                How are Skills derived?
              </h2>
              <Prose>
                <p>
                  Two independent passes look at every Player. They are designed to disagree.
                </p>
                <ol>
                  <li>
                    <strong>Statistical thresholds.</strong> A rules engine reads the Player&apos;s recent stats and grades each Skill against tunable volume gates and tier criteria. Per-game divisors, multi-season blending, and stabilization smoothing are all part of the math.
                  </li>
                  <li>
                    <strong>Claude assessment.</strong> The same Player is sent to Claude with their context (stats, role, history). Claude returns its own Skill Tiers for the full 21-Skill taxonomy.
                  </li>
                </ol>
                <p>
                  The two passes are then merged. Where they agree, the rating auto-accepts. Where they disagree, a flag is opened on the admin review queue. The disagreement is the signal: it is exactly where stats and basketball judgment disagree about what a Player is.
                </p>
                <p>
                  The thresholds are tunable, not hard-coded. Calibration runs as its own admin workflow inside a draft Snapshot context, so retuning never silently re-scores live Saved Teams.
                </p>
              </Prose>
            </section>

            {/* ─────────────── 05 — Impact Traits ─────────────── */}
            <section
              id="traits"
              aria-labelledby="traits-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>05</SectionNumber>
              <h2
                id="traits-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                What is an Impact Trait?
              </h2>
              <Prose>
                <p>
                  An Impact Trait sits between a Player&apos;s Skill Profile and the Lineup math. It is a derived, normalized signal that captures a specific way a Player affects what is happening on the floor — for example, PnR Ball Handler, Rim Pressure, or Versatility.
                </p>
                <p>
                  Impact Traits exist because raw Skill Tiers do not slot directly into Lineup-level questions. A Lineup needs to know &quot;how much shot creation does this group have,&quot; not &quot;what tier is each individual&apos;s Scorer Skill.&quot; Traits do that translation.
                </p>
              </Prose>
            </section>

            {/* ─────────────── 06 — Lineup Subscores ─────────────── */}
            <section
              id="subscores"
              aria-labelledby="subscores-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>06</SectionNumber>
              <h2
                id="subscores-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                What is a Lineup Subscore?
              </h2>
              <Prose>
                <p>
                  A Lineup Subscore measures one component of how a five-Player Lineup is likely to perform. Cornerstone tracks subscores for offensive concepts like spacing and rim pressure, defensive concepts like perimeter disruption and rim protection, and transition concepts like rebounding and pace.
                </p>
                <p>
                  Each subscore is computed from the Lineup&apos;s combined Impact Traits, with weights tuned by Evaluation Version. Subscores are the unit at which a result becomes interpretable — they are what feeds the GM Note and the visual score breakdown after evaluation.
                </p>
              </Prose>
            </section>

            {/* ─────────────── 07 — Lineup vs Rotation vs Roster ─────────────── */}
            <section
              id="lineup-roster"
              aria-labelledby="lineup-roster-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>07</SectionNumber>
              <h2
                id="lineup-roster-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                Lineup vs Rotation vs Roster.
              </h2>
              <Prose>
                <p>
                  Three nested layers, all built from the same Skill Profiles:
                </p>
                <dl className="not-prose mt-6 grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
                  <ScopeCard
                    label="Lineup"
                    size="5"
                    summary="The five Players on the floor at one time."
                    detail="Evaluates a single possession. Spacing, rim pressure, defensive coverage."
                  />
                  <ScopeCard
                    label="Rotation"
                    size="8 to 10"
                    summary="The playable Lineup Combos a coach can actually deploy."
                    detail="Evaluates depth, matchup flexibility, and how Lineup Combos hand off between starters and bench."
                  />
                  <ScopeCard
                    label="Roster"
                    size="Full Saved Team"
                    summary="The complete Build, including bench and structural redundancy."
                    detail="Evaluates fit across the whole Team, including what happens when the eighth Player has to play 20 minutes."
                  />
                </dl>
              </Prose>
            </section>

            {/* ─────────────── 08 — Cohesion Score ─────────────── */}
            <section
              id="cohesion"
              aria-labelledby="cohesion-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>08</SectionNumber>
              <h2
                id="cohesion-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                What is a Cohesion Score?
              </h2>
              <Prose>
                <p>
                  The Cohesion Score is the final scalar a Saved Team carries. It rolls up Lineup Subscores across Lineup Combos, weighted by how often a coach would actually deploy each Combo. Higher means the Team fits together. Lower means the pieces fight each other.
                </p>
                <p>
                  A Cohesion Score is not a prediction of wins. It is a measure of structural fit under the rules of a specific RuleSet and Evaluation Version. Two Teams with the same Cohesion Score under the same RuleSet should feel comparably well-constructed; the same Team scored under a different RuleSet may look completely different, and that is the point.
                </p>
              </Prose>
            </section>

            {/* ─────────────── 09 — Versioning ─────────────── */}
            <section
              id="versioning"
              aria-labelledby="versioning-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>09</SectionNumber>
              <h2
                id="versioning-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                RuleSets, Snapshot Releases, Evaluation Versions.
              </h2>
              <Prose>
                <p>
                  Three orthogonal axes of context. Every Saved Team holds all three and never loses them.
                </p>
                <dl className="not-prose mt-6 space-y-6">
                  <VersionRow
                    label="RuleSet"
                    summary="The format."
                    detail="Defines the rules of a Build: salary cap, Team size, eligible Player Pool (current Players, all-time greats, free-for-all). Picking a RuleSet is like picking a Pokemon Showdown tier. Different RuleSets produce different games."
                  />
                  <VersionRow
                    label="Snapshot Release"
                    summary="The Player Pool, frozen."
                    detail="An immutable record of the Player Pool, Skill Profiles, contracts, and team assignments at one moment. New stats and corrections accumulate in a draft Snapshot, get reviewed, then publish as the next Release. Saved Teams hold their original Snapshot Release reference, so historical Builds keep their original meaning forever."
                  />
                  <VersionRow
                    label="Evaluation Version"
                    summary="The scoring engine, versioned."
                    detail="The weights, Subscores, and rules that score a Build. Tuning the engine creates a new Evaluation Version rather than overwriting the last one. Saved Teams record which Evaluation Version scored them, so a Team scored last year stays explainable even after the engine moves on."
                  />
                </dl>
              </Prose>

              <Callout label="Saved Teams are time capsules">
                A Saved Team is never just a list of Players. It is the Players, the RuleSet that constrained the Build, the Snapshot Release that defined who those Players were, and the Evaluation Version that scored them. Re-running an old Saved Team in a new version is a deliberate action, not an accident.
              </Callout>
            </section>

            {/* ─────────────── 10 — Misc FAQ ─────────────── */}
            <section
              id="misc"
              aria-labelledby="misc-heading"
              className="scroll-mt-20 mt-20"
            >
              <SectionNumber>10</SectionNumber>
              <h2
                id="misc-heading"
                className="font-display text-[clamp(1.75rem,2vw+1rem,2.5rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3"
              >
                More questions.
              </h2>

              <dl id="faq-misc-list" className="mt-8 divide-y divide-border border-y border-border">
                {MISC_QA.map((item, i) => (
                  <div
                    key={i}
                    id={`faq-misc-item-${i + 1}`}
                    className="py-6 grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-3 md:gap-8"
                  >
                    <dt className="font-mono text-[0.6875rem] tracking-[0.05em] uppercase text-muted-foreground md:pt-1">
                      Q{String(i + 1).padStart(2, "0")}
                    </dt>
                    <dd className="min-w-0">
                      <p className="font-display text-lg font-semibold leading-snug text-foreground tracking-[-0.005em]">
                        {item.q}
                      </p>
                      <div className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground max-w-[68ch]">
                        {item.a}
                      </div>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* ─────────────── Bottom CTA ─────────────── */}
            <section
              id="faq-outro"
              className="mt-20 pt-12 border-t border-border"
            >
              <p className="font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
                Now go build something
              </p>
              <h2 className="font-display text-[clamp(1.75rem,2vw+1rem,2.25rem)] font-semibold leading-[1.1] tracking-[-0.01em] text-foreground mt-3 max-w-2xl">
                Reading about the engine is the warmup.
                <br />
                The argument lives in the Lab.
              </h2>
              <div className="mt-8 flex items-center gap-3">
                <Link
                  id="faq-cta-lab"
                  href="/lab"
                  className="inline-flex items-center px-5 py-2.5 rounded-md bg-[#0e0907] text-[#ffa05c] text-sm font-medium tracking-[0.01em] transition-all duration-150 hover:bg-[#0e0907]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
                >
                  Enter the Lab
                </Link>
                <Link
                  id="faq-cta-players"
                  href="/players"
                  className="inline-flex items-center px-5 py-2.5 rounded-md border border-[#0e0907]/25 text-foreground text-sm font-medium tracking-[0.01em] transition-all duration-150 hover:bg-[#0e0907]/10 hover:border-[#0e0907]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
                >
                  Browse Players
                </Link>
              </div>
            </section>
          </article>
        </div>
      </div>
    </main>
  );
}

/* ─── Small server-side helpers ─── */

function SectionNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-[#fe6d34]">
      Section {children}
    </span>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 max-w-[68ch] text-[0.9375rem] leading-relaxed text-muted-foreground space-y-4 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-2 [&_em]:italic [&_a]:text-[#fe6d34] [&_a]:underline [&_a:hover]:no-underline">
      {children}
    </div>
  );
}

function Callout({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="note"
      aria-label={label}
      className="mt-10 px-6 py-6 md:px-8 md:py-8 rounded-md bg-[#ffa05c]/15 border border-[#ffa05c]/30"
    >
      <span className="block font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-[#0e0907]/60 mb-2">
        {label}
      </span>
      <p className="font-display text-lg md:text-xl leading-snug text-[#0e0907] tracking-[-0.005em] max-w-[55ch]">
        {children}
      </p>
    </aside>
  );
}

function ScopeCard({
  label,
  size,
  summary,
  detail,
}: {
  label: string;
  size: string;
  summary: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase text-muted-foreground">
        {size}
      </span>
      <dt className="font-display text-xl font-semibold text-foreground mt-1 tracking-[-0.005em]">
        {label}
      </dt>
      <dd className="mt-3 text-[0.9375rem] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{summary}</span>{" "}
        {detail}
      </dd>
    </div>
  );
}

function VersionRow({
  label,
  summary,
  detail,
}: {
  label: string;
  summary: string;
  detail: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-2 md:gap-8">
      <dt className="font-display text-lg font-semibold text-foreground tracking-[-0.005em] md:pt-0.5">
        {label}
      </dt>
      <dd className="text-[0.9375rem] leading-relaxed text-muted-foreground max-w-[68ch]">
        <span className="font-medium text-foreground">{summary}</span> {detail}
      </dd>
    </div>
  );
}
