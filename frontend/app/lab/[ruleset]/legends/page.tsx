"use client";

/**
 * /lab/[ruleset]/legends — Cornerstone Picker
 *
 * Browse the Legend pool using the same FilterBar + SortControls
 * from the Players page. Two view modes: scouting report cards
 * (vertical stack) and table. Pick a Cornerstone to start a Build.
 */

import Link from "next/link";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { listLegends, getLegend } from "@/lib/api";
import { formatSkillName, PUBLIC_SKILL_CATEGORIES } from "@/lib/skills";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";
import { PlayerPoolBrowser, type PlayerPoolBrowserCounts, type PlayerPoolViewMode } from "@/components/players/PlayerPoolBrowser";
import { RandomPlayerButton } from "@/components/players/RandomPlayerButton";
import { SORT_FIELD_OPTIONS, type SortKey } from "@/components/players/SortControls";
import {
  AVAILABLE_FILTERS,
} from "@/components/players/playerFilters";
import type { LegendSummary, LegendDetail, LegendTier, PlayerWithSkills } from "@/lib/types";

/* ── Transform a LegendDetail into PlayerWithSkills so the shared
     filter/sort/table infra works without modification ── */
function legendToPlayerWithSkills(
  legend: LegendSummary,
  detail: LegendDetail | null,
): PlayerWithSkills {
  /* Convert legend profile (LegendTier) to PlayerSkillMap (string tiers) */
  const skills: Record<string, string> = {};
  if (detail) {
    for (const [key, tier] of Object.entries(detail.profile)) {
      if (tier) skills[key] = tier;
    }
  }

  return {
    id: legend.id,
    name: legend.name,
    team: legend.team,
    position: legend.position,
    age: legend.age,
    height: legend.height,
    weight: legend.weight,
    salary: null,
    games_played: null,
    minutes_per_game: null,
    season: legend.peak_year ? `${legend.peak_year}` : "",
    is_legend: true,
    peak_year: legend.peak_year,
    nba_api_id: legend.nba_api_id ?? null,
    skills: Object.keys(skills).length > 0 ? skills : null,
    flag_summary: { total: 0, unresolved: 0 },
  };
}

/* ── Tier badge — reuses canonical TIER_BADGE_CLASSES ── */
function TierBadge({ tier }: { tier: LegendTier }) {
  if (!tier) return null;
  const classes = TIER_BADGE_CLASSES[tier] ?? TIER_BADGE_CLASSES.None;
  return (
    <span className={`inline-flex px-2 py-0.5 text-[0.6875rem] font-medium rounded-sm ${classes}`}>
      {tier}
    </span>
  );
}

/* ── Breadcrumb ── */
function Breadcrumb({ ruleset }: { ruleset: string }) {
  const rulesetName = ruleset
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <nav id="legends-breadcrumb" aria-label="Lab navigation" className="flex items-center gap-2 text-[0.8125rem]">
      <Link href="/lab" className="text-[#0e0907]/45 hover:text-[#0e0907]/70 transition-colors">Lab</Link>
      <span className="text-[#0e0907]/25" aria-hidden="true">/</span>
      <Link href="/lab" className="text-[#0e0907]/45 hover:text-[#0e0907]/70 transition-colors">{rulesetName}</Link>
      <span className="text-[#0e0907]/25" aria-hidden="true">/</span>
      <span className="text-[#0e0907] font-medium">Pick Your Cornerstone</span>
    </nav>
  );
}

/* ── Scouting report card — horizontal layout for card view ── */
function ScoutingReportCard({
  legend,
  detail,
  ruleset,
}: {
  legend: LegendSummary;
  detail: LegendDetail | null;
  ruleset: string;
}) {
  const tierCounts = useMemo(() => {
    if (!detail) return null;
    const counts: Record<string, number> = {};
    Object.values(detail.profile).forEach((tier) => {
      if (tier) counts[tier] = (counts[tier] || 0) + 1;
    });
    return counts;
  }, [detail]);

  return (
    <article
      id={`legend-card-${legend.id}`}
      className="border border-[#d9d0c9] rounded-lg bg-[#f7f7f7]"
    >
      <div className="flex flex-col lg:flex-row">
        {/* Left column: identity + CTA */}
        <div className="lg:w-[280px] xl:w-[320px] shrink-0 px-6 py-6 lg:border-r border-b lg:border-b-0 border-[#d9d0c9]/60 flex flex-col">
          {/* Player headshot from NBA.com */}
          <PlayerHeadshot
            nba_api_id={legend.nba_api_id}
            size={80}
            name={legend.name}
            className="mb-4 border border-[#d9d0c9]/60"
          />

          <h3 className="text-[1.25rem] font-semibold leading-[1.2] text-[#0e0907]">{legend.name}</h3>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {legend.position && <span className="text-[0.8125rem] font-medium text-[#0e0907]/55">{legend.position}</span>}
            {legend.team && (
              <>
                <span className="text-[#0e0907]/20" aria-hidden="true">&middot;</span>
                <span className="text-[0.8125rem] text-[#0e0907]/55">{legend.team}</span>
              </>
            )}
          </div>

          {/* Physical attributes */}
          <div className="flex flex-col gap-1 mt-4">
            {legend.peak_year && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/40">Peak Year</span>
                <span className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{legend.peak_year}</span>
              </div>
            )}
            {legend.age && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/40">Peak Age</span>
                <span className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{legend.age}</span>
              </div>
            )}
            {legend.height && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/40">Height</span>
                <span className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{legend.height}</span>
              </div>
            )}
            {legend.weight && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.6875rem] font-medium tracking-[0.01em] text-[#0e0907]/40">Weight</span>
                <span className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]">{legend.weight} lbs</span>
              </div>
            )}
          </div>

          {/* Tier summary badges */}
          {tierCounts && (
            <div className="flex items-center gap-2 flex-wrap mt-5">
              {(["All-Time Great", "Elite", "Proficient", "Capable"] as const).map((tier) =>
                tierCounts[tier] ? (
                  <span key={tier} className="flex items-center gap-1">
                    <TierBadge tier={tier} />
                    <span className="font-mono text-[0.6875rem] tabular-nums text-[#0e0907]/40">{tierCounts[tier]}</span>
                  </span>
                ) : null
              )}
            </div>
          )}

          {/* CTA */}
          <div className="mt-6 lg:mt-auto lg:pt-6">
            <Link
              id={`legend-select-${legend.id}`}
              href={`/lab/${ruleset}/build?cornerstone=${legend.id}`}
              className="inline-flex items-center px-5 py-2.5 rounded-md bg-[#ffa05c] text-[#0e0907] text-[0.8125rem] font-medium tracking-[0.01em] transition-all duration-150 hover:bg-[#fe6d34] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffa05c]"
            >
              Select as Cornerstone &rarr;
            </Link>
          </div>
        </div>

        {/* Right column: full Skill Profile by category */}
        <div className="flex-1 px-6 py-6 min-w-0">
          {detail ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-5">
              {Object.entries(PUBLIC_SKILL_CATEGORIES).map(([category, skills]) => (
                <div key={category}>
                  <h4 className="text-[0.6875rem] font-medium tracking-[0.03em] uppercase text-[#0e0907]/35 mb-2">{category}</h4>
                  <div className="flex flex-col gap-1">
                    {skills.map((skillKey) => {
                      const tier = detail.profile[skillKey];
                      return (
                        <div key={skillKey} className="flex items-center justify-between gap-2 py-0.5">
                          <span className="text-[0.8125rem] text-[#0e0907]/60 truncate">{formatSkillName(skillKey)}</span>
                          {tier ? <TierBadge tier={tier} /> : <span className="text-[0.6875rem] text-[#0e0907]/20 italic">--</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <div className="h-3 w-20 rounded-sm bg-[#0e0907]/[0.06] animate-pulse" />
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="h-5 rounded-sm bg-[#0e0907]/[0.04] animate-pulse" />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

const LEGEND_FILTERS = AVAILABLE_FILTERS.filter(
  (filter) => !["Games Played", "MPG", "Legend"].includes(filter.label),
);
const LEGEND_SORT_FIELDS = SORT_FIELD_OPTIONS.filter(
  (field) => !["games_played", "minutes_per_game"].includes(field),
);
const LEGEND_HIDDEN_COLUMNS = ["games_played"];
const LEGENDS_PAGE_SIZE = 16;

/* ── Main page component ── */
export default function LegendsPage() {
  const params = useParams();
  const ruleset = (params.ruleset as string) ?? "standard";

  /* ── Data state ── */
  const [legends, setLegends] = useState<LegendSummary[]>([]);
  const [details, setDetails] = useState<Record<string, LegendDetail>>({});
  const [loading, setLoading] = useState(true);

  /* ── PlayerWithSkills projection for filter/sort infra ── */
  const playersProjection = useMemo(() => {
    return legends.map((l) => legendToPlayerWithSkills(l, details[l.id] ?? null));
  }, [legends, details]);

  /* ── Sort state ── */
  const defaultSortKeys: SortKey[] = [{ field: "alltime_plus_count", direction: "desc" }];
  const [browserCounts, setBrowserCounts] = useState<PlayerPoolBrowserCounts>({
    totalCount: 0,
    filteredCount: 0,
    sortedCount: 0,
    pageCount: 0,
  });
  const [visibleLegendPlayers, setVisibleLegendPlayers] = useState<PlayerWithSkills[]>([]);

  /* ── Fetch legends on mount ── */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await listLegends();
      if (!cancelled && res.success && res.data) {
        setLegends(res.data);
        setLoading(false);

        /* Fetch full profiles in parallel */
        const detailResults = await Promise.all(
          res.data.map((l) => getLegend(l.id))
        );
        if (!cancelled) {
          const detailMap: Record<string, LegendDetail> = {};
          detailResults.forEach((r) => {
            if (r.success && r.data) detailMap[r.data.id] = r.data;
          });
          setDetails(detailMap);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  /* ── Row click in table → navigate to build with this cornerstone ── */
  const handleRowClick = useCallback(
    (player: PlayerWithSkills) => {
      window.location.href = `/lab/${ruleset}/build?cornerstone=${player.id}`;
    },
    [ruleset],
  );

  return (
    <main id="legends-page" className="min-h-[calc(100vh-48px)]">
      {/* ── Header ── */}
      <section id="legends-header" className="max-w-screen-xl mx-auto px-6 pt-8 pb-6 md:pt-12 md:pb-8">
        <Breadcrumb ruleset={ruleset} />

        <div className="flex items-center justify-between gap-4 flex-wrap mt-4">
          <div>
            <h1
              id="legends-title"
              className="font-display text-[clamp(1.5rem,2vw+0.5rem,2.25rem)] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0e0907]"
            >
              Pick Your Cornerstone
            </h1>
            {!loading && (
              <p className="text-[0.8125rem] text-[#0e0907]/45 mt-1">
                {browserCounts.filteredCount === browserCounts.totalCount
                  ? `${browserCounts.totalCount} legends`
                  : `${browserCounts.filteredCount} of ${browserCounts.totalCount} legends`}
              </p>
            )}
          </div>
          {!loading && (
            <RandomPlayerButton
              id="legends-random-cornerstone-btn"
              players={visibleLegendPlayers}
              label="Random Cornerstone"
              emptyLabel="No Legends"
              onPick={handleRowClick}
            />
          )}
        </div>
      </section>

      {/* ── Loading state ── */}
      {loading && (
        <div className="max-w-screen-xl mx-auto px-6 space-y-3 animate-pulse">
          <div className="h-10 bg-[#0e0907]/[0.04] rounded-lg" />
          <div className="h-8 bg-[#0e0907]/[0.04] rounded-lg w-1/2" />
          <div className="h-64 bg-[#0e0907]/[0.04] rounded-lg" />
        </div>
      )}

      {!loading && (
        <div className="max-w-screen-xl mx-auto px-6 pb-16 md:pb-24 space-y-4">
          <PlayerPoolBrowser
            id="legends-pool-browser"
            players={playersProjection}
            defaultSortKeys={defaultSortKeys}
            defaultPageSize={LEGENDS_PAGE_SIZE}
            pageSizeOptions={[8, 16, 32]}
            viewModes={["report", "table"]}
            defaultViewMode="report"
            defaultHiddenColumns={LEGEND_HIDDEN_COLUMNS}
            availableFilters={LEGEND_FILTERS}
            sortFieldOptions={LEGEND_SORT_FIELDS}
            emptyMessage="No legends match your filters."
            clearFiltersLabel="Clear filters"
            onCountsChange={setBrowserCounts}
            onVisiblePlayersChange={setVisibleLegendPlayers}
            onRowClick={handleRowClick}
            renderViewToggle={({ viewMode, setViewMode }) => (
              <div id="legends-view-toggle" className="flex w-fit rounded-md border border-[#d9d0c9] overflow-hidden text-xs font-medium">
                {(["table", "report"] as PlayerPoolViewMode[]).map((mode, index) => (
                  <button
                    key={mode}
                    id={`legends-view-${mode === "report" ? "cards" : mode}-btn`}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      "px-3 py-1.5 transition-colors",
                      index > 0 && "border-l border-[#d9d0c9]",
                      viewMode === mode
                        ? "bg-[#0e0907] text-[#f7f7f7]"
                        : "text-[#0e0907]/45 hover:text-[#0e0907]/70 hover:bg-[#0e0907]/[0.04]",
                    )}
                  >
                    {mode === "report" ? "Cards" : "Table"}
                  </button>
                ))}
              </div>
            )}
            renderReport={(player) => {
              const legend = legends.find((item) => item.id === player.id);
              if (!legend) return null;
              return (
                <ScoutingReportCard
                  key={legend.id}
                  legend={legend}
                  detail={details[legend.id] ?? null}
                  ruleset={ruleset}
                />
              );
            }}
          />
        </div>
      )}
    </main>
  );
}
