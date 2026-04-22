import Link from "next/link";

/**
 * Public landing page — the entry point for unauthenticated visitors.
 * Introduces the Cornerstone concept and links to the public-facing pages.
 * Phase 3 of the auth & public UI plan.
 */
export default function LandingPage() {
  return (
    <main id="landing-page" className="max-w-4xl mx-auto px-4 py-16 space-y-16">
      {/* Hero */}
      <section id="landing-hero" className="text-center space-y-4">
        <h1 id="landing-title" className="text-4xl font-bold tracking-tight">
          Cornerstone
        </h1>
        <p id="landing-subtitle" className="text-lg text-muted-foreground max-w-xl mx-auto">
          Evaluate NBA players on 21 basketball skills and build the perfect
          8-man roster around an all-time great cornerstone legend.
        </p>
        <div id="landing-cta" className="flex items-center justify-center gap-4 pt-2">
          <Link
            id="landing-cta-players"
            href="/players"
            className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-80 transition-opacity"
          >
            Browse Players
          </Link>
          <Link
            id="landing-cta-builder"
            href="/builder"
            className="px-5 py-2.5 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            Build a Roster →
          </Link>
        </div>
      </section>

      {/* Feature cards */}
      <section id="landing-features" className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div id="landing-feature-skills" className="rounded-lg border bg-card p-6 space-y-2">
          <div className="text-2xl">📊</div>
          <h3 className="font-semibold text-sm">21-Skill Taxonomy</h3>
          <p className="text-xs text-muted-foreground">
            Every player is evaluated on perimeter shooting, creation, finishing,
            playmaking, physicality, and defense using a stat-driven pipeline
            cross-checked by AI.
          </p>
        </div>
        <div id="landing-feature-legends" className="rounded-lg border bg-card p-6 space-y-2">
          <div className="text-2xl">★</div>
          <h3 className="font-semibold text-sm">All-Time Greats</h3>
          <p className="text-xs text-muted-foreground">
            36 legendary players hand-profiled on the same taxonomy — from Jordan
            to Jokić — so you can compare eras on equal footing.
          </p>
        </div>
        <div id="landing-feature-builder" className="rounded-lg border bg-card p-6 space-y-2">
          <div className="text-2xl">🏀</div>
          <h3 className="font-semibold text-sm">Roster Builder</h3>
          <p className="text-xs text-muted-foreground">
            Pick a cornerstone legend, then fill out an 8-man roster within a
            salary cap — optimising for skill coverage and roster balance.
          </p>
        </div>
      </section>
    </main>
  );
}
