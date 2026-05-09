import Link from "next/link";

/* ── Sample data for the proof section ──
   Hardcoded realistic skill profiles to demonstrate the system visually.
   These are not fetched; they exist purely to "show, don't tell." */

const SAMPLE_SKILLS = [
  { name: "Isolation Scorer", tier: "Elite" as const },
  { name: "Off-Dribble Shooter", tier: "Proficient" as const },
  { name: "PnR Ball Handler", tier: "Elite" as const },
  { name: "Driver", tier: "All-Time Great" as const },
  { name: "Passer", tier: "Proficient" as const },
  { name: "Versatile Defender", tier: "Capable" as const },
  { name: "Perimeter Disruptor", tier: "Elite" as const },
  { name: "Rebounder", tier: "Capable" as const },
];

const TIER_STYLES: Record<string, string> = {
  "All-Time Great": "bg-violet-100 text-violet-800 border-violet-300",
  Elite: "bg-emerald-100 text-emerald-800 border-emerald-200",
  Proficient: "bg-sky-100 text-sky-800 border-sky-200",
  Capable: "bg-amber-100 text-amber-800 border-amber-200",
  None: "bg-slate-100 text-slate-500 border-slate-200",
};

const STEPS = [
  {
    number: "01",
    label: "Pick Your Rules",
    description:
      "Salary cap or free-for-all. Current players, all-time greats, or both. Choose a ruleset that defines the game.",
  },
  {
    number: "02",
    label: "Build Your Team",
    description:
      "Assemble your roster. Every player is profiled on the same skill taxonomy, so every pick has real tradeoffs.",
  },
  {
    number: "03",
    label: "Prove It",
    description:
      "The evaluation engine scores your build on skill coverage, synergy, and balance. Real basketball logic, not vibes.",
  },
];

/**
 * Landing page — brand surface.
 * Three sections: committed-amber hero, proof section with real skill data,
 * and a how-it-works sequence. "The Scouting Report" aesthetic.
 */
export default function LandingPage() {
  return (
    <main id="landing-page">
      {/* ════════════════════════════════════════════════════════════
          SECTION 1: HERO — Committed amber surface
          ════════════════════════════════════════════════════════════ */}
      <section
        id="landing-hero"
        className="relative overflow-hidden bg-[#ffa05c]"
      >
        {/* Subtle court-line texture overlay */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, #0e0907 0px, #0e0907 1px, transparent 1px, transparent 80px), repeating-linear-gradient(0deg, #0e0907 0px, #0e0907 1px, transparent 1px, transparent 80px)",
          }}
        />

        <div className="relative max-w-screen-xl mx-auto px-6 py-24 md:py-32 lg:py-40">
          {/* Left-aligned layout — not a centered stack */}
          <div className="max-w-2xl">
            {/* Eyebrow label */}
            <span
              id="landing-eyebrow"
              className="inline-block font-mono text-xs tracking-[0.08em] uppercase text-[#0e0907]/60 mb-4"
            >
              Build a team &middot; Test the hypothetical &middot; Settle the debate
            </span>

            {/* Hero headline — Space Grotesk display */}
            <h1
              id="landing-title"
              className="font-display text-[clamp(2.5rem,5vw+1rem,4.5rem)] font-bold leading-[1.05] tracking-[-0.02em] text-[#0e0907]"
              style={{ textWrap: "balance" }}
            >
              What if you could
              <br />
              prove it?
            </h1>

            {/* Supporting line — Geist body */}
            <p
              id="landing-subtitle"
              className="mt-5 text-[0.9375rem] leading-relaxed text-[#0e0907]/75 max-w-lg"
            >
              Turn any hypothetical team into something you can actually
              test. Pick the rules. Build it. See how it scores.
            </p>

            {/* CTAs */}
            <div id="landing-cta" className="flex items-center gap-3 mt-8">
              <Link
                id="landing-cta-builder"
                href="/builder"
                className="inline-flex items-center px-5 py-2.5 rounded-md bg-[#0e0907] text-[#ffa05c] text-sm font-medium tracking-[0.01em] transition-all duration-150 hover:bg-[#0e0907]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
              >
                Build a Roster
              </Link>
              <Link
                id="landing-cta-players"
                href="/players"
                className="inline-flex items-center px-5 py-2.5 rounded-md border border-[#0e0907]/25 text-[#0e0907] text-sm font-medium tracking-[0.01em] transition-all duration-150 hover:bg-[#0e0907]/10 hover:border-[#0e0907]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0e0907]"
              >
                Browse Players
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SECTION 2: PROOF — "Show, don't tell"
          Real skill badges and stat readouts demonstrate the system.
          ════════════════════════════════════════════════════════════ */}
      <section
        id="landing-proof"
        className="max-w-screen-xl mx-auto px-6 py-20 md:py-28"
      >
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16 items-start">
          {/* Left column — explanatory text */}
          <div className="max-w-md">
            <span className="font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
              The System
            </span>
            <h2
              id="landing-proof-heading"
              className="font-display text-[clamp(1.5rem,2vw+0.5rem,2.25rem)] font-semibold leading-[1.15] tracking-[-0.01em] mt-3"
            >
              Not vibes. Not box scores.
              <br />
              Skill profiles.
            </h2>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-muted-foreground max-w-sm">
              Every active player is evaluated on 21 basketball skills using
              statistical thresholds cross-checked by AI assessment. Agreements
              auto-accept. Disagreements get flagged for manual review.
            </p>

            {/* Stat readouts — monospaced data */}
            <div className="flex gap-8 mt-8">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-muted-foreground">
                  Skills
                </span>
                <span className="font-mono text-2xl tabular-nums text-foreground">
                  21
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-muted-foreground">
                  Legends
                </span>
                <span className="font-mono text-2xl tabular-nums text-foreground">
                  36
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-muted-foreground">
                  Tiers
                </span>
                <span className="font-mono text-2xl tabular-nums text-foreground">
                  5
                </span>
              </div>
            </div>
          </div>

          {/* Right column — sample skill profile card */}
          <div
            id="landing-proof-card"
            className="border border-border rounded-lg bg-card p-6"
          >
            {/* Card header — player identity */}
            <div className="flex items-baseline justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Sample Player Profile
                </h3>
                <span className="text-xs text-muted-foreground">
                  Guard &middot; 27.4 PPG &middot; 6.2 APG
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground tracking-wider">
                2024-25
              </span>
            </div>

            {/* Skill badge grid — the real visual proof */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {SAMPLE_SKILLS.map((skill) => (
                <div
                  key={skill.name}
                  className="flex flex-col gap-1 p-2.5 rounded-md border border-border bg-background"
                >
                  <span className="text-[0.6875rem] font-medium text-muted-foreground leading-tight">
                    {skill.name}
                  </span>
                  <span
                    className={`inline-flex self-start px-2 py-0.5 text-[0.6875rem] font-medium rounded-sm border ${TIER_STYLES[skill.tier]}`}
                  >
                    {skill.tier}
                  </span>
                </div>
              ))}
            </div>

            {/* Card footer — subtle link */}
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                8 of 21 skills shown
              </span>
              <Link
                href="/players"
                className="text-xs font-medium text-[#fe6d34] hover:text-[#fe6d34]/80 transition-colors"
              >
                Explore all profiles →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════
          SECTION 3: HOW IT WORKS — Three numbered steps
          ════════════════════════════════════════════════════════════ */}
      <section
        id="landing-how-it-works"
        className="border-t border-border bg-card"
      >
        <div className="max-w-screen-xl mx-auto px-6 py-20 md:py-28">
          <span className="font-mono text-xs tracking-[0.08em] uppercase text-muted-foreground">
            How It Works
          </span>
          <h2
            id="landing-how-heading"
            className="font-display text-[clamp(1.5rem,2vw+0.5rem,2.25rem)] font-semibold leading-[1.15] tracking-[-0.01em] mt-3 mb-12"
          >
            Three moves. One roster.
          </h2>

          {/* Steps — staggered layout, not identical cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {STEPS.map((step, i) => (
              <div
                key={step.number}
                id={`landing-step-${step.number}`}
                className={`flex flex-col ${
                  i === 1 ? "md:mt-6" : i === 2 ? "md:mt-12" : ""
                }`}
              >
                {/* Step number — mono, large, amber-tinted */}
                <span className="font-mono text-[2.5rem] font-bold leading-none tracking-tight text-[#ffa05c]/40 select-none">
                  {step.number}
                </span>
                <h3 className="text-base font-semibold text-foreground mt-3">
                  {step.label}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mt-2 max-w-xs">
                  {step.description}
                </p>
              </div>
            ))}
          </div>

          {/* Final CTA */}
          <div className="mt-16 pt-8 border-t border-border">
            <Link
              id="landing-final-cta"
              href="/builder"
              className="inline-flex items-center px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium tracking-[0.01em] transition-all duration-150 hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Start Building →
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
