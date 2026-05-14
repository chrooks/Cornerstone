"use client";

import Link from "next/link";
import { useState, useCallback, useEffect, type KeyboardEvent } from "react";
import { listRuleSets, getCommunityStats } from "@/lib/api";
import { teamLabelForSize } from "@/lib/builder-config";
import { resolveRuleSetRules } from "@/lib/rulesets";
import type { RuleSetSummary, CommunityStatsMap } from "@/lib/types";

/* ── Tab type for the notebook-style RuleSet cards ── */
type TabId = "rules" | "community";

/* ── RuleSet data model ──
   Each RuleSet defines the constraints for a Lab session.
   Standard is active; others are coming soon placeholders. */
interface RuleSetDef {
  slug: string;
  name: string;
  subtitle: string;
  status: "active" | "coming_soon" | "archived";
  cornerstoneSource: "legend" | "all";
  rules: {
    teamSize: number;
    allowedTeamSizes: number[];
    teamLabel: string;
    salaryCap: string;
    cornerstoneRule: string;
    playerPool: string;
    rookieDealLimit: number;
  };
  community: {
    teamsBuilt: number;
    topCornerstone: string;
    avgScore: number | null;
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function formatSalaryCap(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "None";
  return `$${Math.round(value / 1_000_000)}M`;
}

function mapRuleSetSummary(
  ruleSet: RuleSetSummary,
  communityStats?: CommunityStatsMap,
): RuleSetDef {
  const rules = ruleSet.rules ?? {};
  const resolvedRules = resolveRuleSetRules(rules);
  const isStandard = ruleSet.slug === "standard";
  const stats = communityStats?.[ruleSet.slug];
  return {
    slug: ruleSet.slug,
    name: ruleSet.name,
    subtitle: ruleSet.description ?? "RuleSet details are being prepared.",
    status: ruleSet.status,
    cornerstoneSource: resolvedRules.cornerstoneSource,
    rules: {
      teamSize: resolvedRules.teamSize,
      allowedTeamSizes: resolvedRules.allowedTeamSizes,
      teamLabel: resolvedRules.teamLabel,
      salaryCap: asString(rules.salary_cap_display, formatSalaryCap(rules.salary_cap)),
      cornerstoneRule: asString(rules.cornerstone_rule, isStandard ? "1 Legend required ($54M)" : "Any Player, any slot"),
      playerPool: asString(rules.player_pool, isStandard ? "Current Snapshot + Legends" : "PlayerPool details pending"),
      rookieDealLimit: asNumber(rules.rookie_deal_limit, 0),
    },
    community: {
      teamsBuilt: stats?.team_count ?? 0,
      topCornerstone: stats?.top_cornerstone ?? "-",
      avgScore: stats?.avg_score ?? null,
    },
  };
}

/* ── Notebook tab labels ── */
const TABS: { id: TabId; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "community", label: "Community" },
];

/* ── Rules tab content: displays RuleSet constraints as a structured list ── */
function RulesPanel({ rs }: { rs: RuleSetDef }) {
  const teamSizeValue = rs.rules.allowedTeamSizes.length > 1
    ? rs.rules.allowedTeamSizes.map((size) => `${teamLabelForSize(size)} (${size})`).join(" / ")
    : `${rs.rules.teamSize} players`;
  const items = [
    { label: "Team Size", value: teamSizeValue, mono: `${rs.rules.teamSize}` },
    { label: "Format", value: rs.rules.teamLabel },
    { label: "Salary Cap", value: rs.rules.salaryCap },
    { label: "Cornerstone", value: rs.rules.cornerstoneRule },
    { label: "Player Pool", value: rs.rules.playerPool },
    { label: "Rookie Deal Limit", value: rs.rules.rookieDealLimit === 0 ? "None" : `${rs.rules.rookieDealLimit} max` },
  ];

  return (
    <dl id={`ruleset-${rs.slug}-rules`} className="grid grid-cols-1 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-baseline justify-between gap-4 py-1.5 border-b border-[#d9d0c9]/60 last:border-b-0"
        >
          {/* Constraint label in Geist label weight */}
          <dt className="text-[0.8125rem] font-medium tracking-[0.01em] text-[#0e0907]/55 shrink-0">
            {item.label}
          </dt>
          {/* Constraint value in Geist body or mono for numbers */}
          <dd className="text-[0.8125rem] text-[#0e0907] text-right">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Community tab content: team count, top cornerstone, average score ── */
function CommunityPanel({ rs }: { rs: RuleSetDef }) {
  if (rs.community.teamsBuilt === 0) {
    return (
      <div id={`ruleset-${rs.slug}-community`}>
        <p className="text-[0.8125rem] text-[#0e0907]/40 italic">
          No Teams built yet. Be the first.
        </p>
      </div>
    );
  }

  return (
    <div id={`ruleset-${rs.slug}-community`} className="flex flex-col gap-4">
      {/* Stat readouts */}
      <div className="flex gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-[#0e0907]/45">
            Teams Built
          </span>
          <span className="font-mono text-xl tabular-nums text-[#0e0907]">
            {rs.community.teamsBuilt}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-[#0e0907]/45">
            Avg Score
          </span>
          <span className="font-mono text-xl tabular-nums text-[#0e0907]">
            {rs.community.avgScore != null ? rs.community.avgScore.toFixed(1) : "—"}
          </span>
        </div>
      </div>

      {/* Top Cornerstone callout */}
      <div className="flex flex-col gap-1">
        <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/45 uppercase">
          Most Popular Cornerstone
        </span>
        <span className="text-[0.9375rem] font-semibold text-[#0e0907]">
          {rs.community.topCornerstone}
        </span>
      </div>
    </div>
  );
}

/* ── Single RuleSet card with notebook bookmark tabs ── */
function RuleSetCard({ rs }: { rs: RuleSetDef }) {
  const [activeTab, setActiveTab] = useState<TabId>("rules");
  const [selectedTeamSize, setSelectedTeamSize] = useState(rs.rules.teamSize);
  const isComingSoon = rs.status === "coming_soon";
  const hasTeamSizeChoices = rs.rules.allowedTeamSizes.length > 1;
  const selectedTeamLabel = teamLabelForSize(selectedTeamSize);
  const entryHref = `${rs.cornerstoneSource === "all" ? `/lab/${rs.slug}/build` : `/lab/${rs.slug}/legends`}${
    hasTeamSizeChoices ? `?team_size=${selectedTeamSize}` : ""
  }`;

  /* Arrow key navigation between tabs (roving tabindex pattern) */
  const handleTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (isComingSoon) return;
      const tabIds = TABS.map((t) => t.id);
      const currentIdx = tabIds.indexOf(activeTab);
      let nextIdx = currentIdx;

      if (e.key === "ArrowRight") {
        nextIdx = (currentIdx + 1) % tabIds.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (currentIdx - 1 + tabIds.length) % tabIds.length;
      } else {
        return;
      }

      e.preventDefault();
      setActiveTab(tabIds[nextIdx]);
      /* Focus the newly active tab button */
      const nextButton = document.getElementById(
        `ruleset-${rs.slug}-tab-${tabIds[nextIdx]}`
      );
      nextButton?.focus();
    },
    [activeTab, isComingSoon, rs.slug]
  );

  /* Determine card top-left rounding: remove it only when the first tab is active */
  const firstTabActive = activeTab === TABS[0].id;

  return (
    <article
      id={`ruleset-card-${rs.slug}`}
      className={`flex flex-col ${isComingSoon ? "opacity-55 pointer-events-none" : ""}`}
      aria-label={`${rs.name} RuleSet`}
    >
      {/* ── Bookmark tabs protruding above the card ── */}
      <div className="flex" role="tablist" aria-label={`${rs.name} card tabs`}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`ruleset-${rs.slug}-tab-${tab.id}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`ruleset-${rs.slug}-panel-${tab.id}`}
              onClick={() => !isComingSoon && setActiveTab(tab.id)}
              onKeyDown={handleTabKeyDown}
              className={`
                relative px-4 py-2 text-[0.8125rem] font-medium tracking-[0.01em]
                border border-b-0 rounded-t-[4px] transition-colors duration-150
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ffa05c]
                ${
                  isActive
                    ? "bg-[#f7f7f7] text-[#0e0907] border-[#d9d0c9] z-10"
                    : "bg-[#ebe7e4] text-[#0e0907]/45 border-[#d9d0c9]/60 hover:text-[#0e0907]/65 hover:bg-[#efebe8]"
                }
              `}
              /* Offset inactive tabs down slightly for the "behind" effect */
              style={{
                marginBottom: isActive ? "-1px" : "0",
                paddingBottom: isActive ? "calc(0.5rem + 1px)" : "0.5rem",
              }}
              tabIndex={isActive ? 0 : -1}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Card body: border connects to the active tab.
           Top-left corner is sharp only when the first tab is active
           (so the tab visually merges with the card edge). ── */}
      <div
        className={`border border-[#d9d0c9] rounded-lg bg-[#f7f7f7] flex flex-col flex-1 ${
          firstTabActive ? "rounded-tl-none" : ""
        }`}
      >
        {/* Card header: RuleSet name, subtitle, status badge */}
        <div className="px-5 pt-5 pb-4 border-b border-[#d9d0c9]/60">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3
                id={`ruleset-${rs.slug}-name`}
                className="text-[1.125rem] font-semibold leading-[1.3] text-[#0e0907]"
              >
                {rs.name}
              </h3>
              <p className="text-[0.8125rem] leading-relaxed text-[#0e0907]/55 max-w-[28ch]">
                {rs.subtitle}
              </p>
            </div>

            {/* Status badge */}
            <span
              id={`ruleset-${rs.slug}-status`}
              className={`
                inline-flex shrink-0 px-2 py-0.5 text-[0.6875rem] font-medium tracking-[0.02em] uppercase rounded-sm border
                ${
                  rs.status === "active"
                    ? "bg-[#ffa05c]/15 text-[#a34400] border-[#ffa05c]/30"
                    : "bg-[#0e0907]/[0.04] text-[#0e0907]/40 border-[#0e0907]/10"
                }
              `}
            >
              {rs.status === "active" ? "Active" : "Coming Soon"}
            </span>
          </div>
        </div>

        {/* Tab panel content area */}
        <div className="px-5 py-4 flex-1">
          {TABS.map((tab) => (
            <div
              key={tab.id}
              id={`ruleset-${rs.slug}-panel-${tab.id}`}
              role="tabpanel"
              aria-labelledby={`ruleset-${rs.slug}-tab-${tab.id}`}
              hidden={activeTab !== tab.id}
            >
              {tab.id === "rules" && <RulesPanel rs={rs} />}
              {tab.id === "community" && <CommunityPanel rs={rs} />}
            </div>
          ))}
        </div>

        {/* CTA footer */}
        <div className="px-5 pb-5 pt-2 mt-auto space-y-3">
          {rs.status === "active" && hasTeamSizeChoices && (
            <div id={`ruleset-${rs.slug}-team-size-picker`} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-[#0e0907]/45">
                  Team Size
                </span>
                <span className="font-mono text-[0.75rem] tabular-nums text-[#0e0907]/55">
                  {selectedTeamSize}
                </span>
              </div>
              <div className="grid grid-cols-3 border border-[#d9d0c9] bg-[#ebe7e4]">
                {rs.rules.allowedTeamSizes.map((size) => {
                  const selected = selectedTeamSize === size;
                  return (
                    <button
                      key={size}
                      id={`ruleset-${rs.slug}-size-${size}`}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedTeamSize(size)}
                      className={`
                        px-2.5 py-2 text-[0.75rem] font-medium transition-colors duration-150
                        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#ffa05c]
                        ${selected
                          ? "bg-[#0e0907] text-[#f8f3f1]"
                          : "border-l border-[#d9d0c9] first:border-l-0 text-[#0e0907]/55 hover:bg-[#f7f7f7] hover:text-[#0e0907]"}
                      `}
                    >
                      {teamLabelForSize(size)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {rs.status === "active" ? (
            <Link
              id={`ruleset-${rs.slug}-cta`}
              href={entryHref}
              className="
                inline-flex items-center px-5 py-2.5 rounded-md
                bg-[#ffa05c] text-[#0e0907] text-[0.8125rem] font-medium tracking-[0.01em]
                transition-all duration-150
                hover:bg-[#fe6d34]
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c]
              "
            >
              Enter {selectedTeamLabel} &rarr;
            </Link>
          ) : (
            <span
              className="
                inline-flex items-center px-5 py-2.5 rounded-md
                bg-[#0e0907]/[0.06] text-[#0e0907]/30 text-[0.8125rem] font-medium tracking-[0.01em]
                cursor-not-allowed
              "
              aria-disabled="true"
            >
              Coming Soon
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * /lab — RuleSet Picker
 *
 * Entry point to the Lab lifecycle. Users pick a RuleSet (format/metagame)
 * before entering the build flow. Each RuleSet defines different constraints
 * for assembling and evaluating a Team.
 *
 * Design: notebook-tab cards on a warm paper background.
 * Inspired by Pokemon Showdown's tier picker.
 */
export default function LabPage() {
  const [rulesets, setRulesets] = useState<RuleSetDef[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;

    const safeStats = getCommunityStats().catch(
      () => ({ success: false, data: null, error: null }) as const,
    );
    Promise.all([listRuleSets(), safeStats])
      .then(([rulesetsRes, statsRes]) => {
        if (!alive) return;
        if (rulesetsRes.success && rulesetsRes.data) {
          const communityStats = statsRes.success ? statsRes.data ?? undefined : undefined;
          setRulesets(rulesetsRes.data.map((rs) => mapRuleSetSummary(rs, communityStats)));
          setLoadState("ready");
          return;
        }
        setLoadState("error");
      })
      .catch(() => {
        if (alive) setLoadState("error");
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main id="lab-page" className="min-h-[calc(100vh-48px)]">
      {/* ── Page header ── */}
      <section id="lab-header" className="max-w-screen-xl mx-auto px-6 pt-12 pb-8 md:pt-16 md:pb-10">
        {/* Eyebrow */}
        <span className="inline-block font-mono text-xs tracking-[0.08em] uppercase text-[#0e0907]/40 mb-3">
          Choose Your Format
        </span>

        {/* Page title in Space Grotesk headline */}
        <h1
          id="lab-title"
          className="font-display text-[clamp(1.5rem,2vw+0.5rem,2.25rem)] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0e0907]"
        >
          The Lab
        </h1>

        {/* Subtitle */}
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-[#0e0907]/55 max-w-lg">
          Each RuleSet defines a different game with different constraints. Teams built under different RuleSets are not directly comparable. Pick your format.
        </p>
      </section>

      {/* ── RuleSet card grid ── */}
      <section
        id="lab-rulesets"
        className="max-w-screen-xl mx-auto px-6 pb-16 md:pb-24"
      >
        {loadState === "loading" && (
          <div id="lab-rulesets-loading" className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-80 animate-pulse rounded-md border border-[#d9d0c9] bg-[#f7f7f7]" />
            ))}
          </div>
        )}
        {loadState === "error" && (
          <div id="lab-rulesets-error" className="rounded-md border border-[#d9d0c9] bg-[#f7f7f7] p-5 text-sm text-[#0e0907]/65">
            RuleSets could not be loaded. Check the backend and migration status.
          </div>
        )}
        {loadState === "ready" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
            {rulesets.map((rs) => (
              <RuleSetCard key={rs.slug} rs={rs} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
