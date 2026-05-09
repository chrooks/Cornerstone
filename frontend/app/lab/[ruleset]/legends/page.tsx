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
import { TIER_BADGE_CLASSES, tierToNum as libTierToNum } from "@/lib/tiers";
import { FilterBar } from "@/components/players/FilterBar";
import { SortControls, type SortKey } from "@/components/players/SortControls";
import { PlayerTable, DEFAULT_PAGE_SIZE } from "@/components/players/PlayerTable";
import {
  evalFilterEntries,
  type FilterEntry,
  type FilterConnector,
  type PlayerFilterType,
  type ActiveFilter,
  type ParenMarker,
  MAX_ACTIVE_FILTERS,
  POSITION_ORDER,
  parseHeight,
} from "@/components/players/playerFilters";
import type { LegendSummary, LegendDetail, LegendTier, PlayerWithSkills } from "@/lib/types";

/* ── View mode ── */
type ViewMode = "cards" | "table";

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

/* ── Sort comparator — mirrors Players page exactly ── */
function compareByKey(a: PlayerWithSkills, b: PlayerWithSkills, key: SortKey): number {
  const dir = key.direction === "asc" ? 1 : -1;

  const getVal = (p: PlayerWithSkills): number | string | null => {
    switch (key.field) {
      case "name":              return p.name;
      case "team":              return p.team ?? "";
      case "position":          return POSITION_ORDER[p.position ?? ""] ?? 99;
      case "age":               return p.age;
      case "height":            return parseHeight(p.height);
      case "weight":            return p.weight;
      case "salary":            return p.salary;
      case "games_played":      return p.games_played;
      case "minutes_per_game":  return p.minutes_per_game;
      case "peak_year":         return p.peak_year ?? null;
      default:
        /* Skill column — sort by tier numeric value */
        return p.skills ? libTierToNum(p.skills[key.field]) : 0;
    }
  };

  const av = getVal(a);
  const bv = getVal(b);

  /* Nulls always sort to the end regardless of direction */
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;

  if (typeof av === "string" && typeof bv === "string") {
    return av.localeCompare(bv) * dir;
  }
  return ((av as number) - (bv as number)) * dir;
}

function stableMultiSort(players: PlayerWithSkills[], keys: SortKey[]): PlayerWithSkills[] {
  if (keys.length === 0) return players;
  return [...players].sort((a, b) => {
    for (const key of keys) {
      const cmp = compareByKey(a, b, key);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
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

/* ── Unique filter ID counter ── */
let _filterId = 0;
function nextFilterId(): string {
  return `lf-${++_filterId}`;
}

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

  /* ── Filter state (same shape as Players page) ── */
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>([]);
  const [nextConnector, setNextConnector] = useState<FilterConnector>("AND");

  /* ── Sort state ── */
  const [sortKeys, setSortKeys] = useState<SortKey[]>([
    { field: "name", direction: "asc" },
  ]);

  /* ── View mode ── */
  const [viewMode, setViewMode] = useState<ViewMode>("cards");

  /* ── Pagination (for table view) ── */
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

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

  /* ── Derived data: filter → sort → paginate ── */
  const filteredPlayers = useMemo(() => {
    if (filterEntries.length === 0) return playersProjection;
    return playersProjection.filter((p) => evalFilterEntries(p, filterEntries));
  }, [playersProjection, filterEntries]);

  const sortedPlayers = useMemo(
    () => stableMultiSort(filteredPlayers, sortKeys),
    [filteredPlayers, sortKeys],
  );

  const paginatedPlayers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedPlayers.slice(start, start + pageSize);
  }, [sortedPlayers, page, pageSize]);

  /* Reset page on filter/sort change */
  useEffect(() => { setPage(1); }, [filterEntries, sortKeys]);

  /* ── Filter handlers (same as Players page) ── */
  const handleAddFilter = useCallback(
    (filter: PlayerFilterType, value: string) => {
      if (filterEntries.length >= MAX_ACTIVE_FILTERS) return;
      const entry: ActiveFilter = {
        id: nextFilterId(),
        filter,
        value,
        connector: nextConnector,
        negated: false,
      };
      setFilterEntries((prev) => [...prev, entry]);
    },
    [filterEntries.length, nextConnector],
  );

  const handleRemoveFilter = useCallback((index: number) => {
    setFilterEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleConnector = useCallback((index: number) => {
    setFilterEntries((prev) =>
      prev.map((entry, i) =>
        i !== index ? entry : { ...entry, connector: entry.connector === "AND" ? "OR" : "AND" },
      ),
    );
  }, []);

  const handleToggleNegated = useCallback((index: number) => {
    setFilterEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== index || "paren" in entry) return entry;
        return { ...entry, negated: !entry.negated };
      }),
    );
  }, []);

  const handleReorderFilters = useCallback((oldIndex: number, newIndex: number) => {
    setFilterEntries((prev) => {
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      return next;
    });
  }, []);

  const handleAddParens = useCallback(() => {
    if (filterEntries.length + 2 > MAX_ACTIVE_FILTERS) return;
    const open: ParenMarker = { id: nextFilterId(), paren: "(", connector: nextConnector };
    const close: ParenMarker = { id: nextFilterId(), paren: ")", connector: "AND" };
    setFilterEntries((prev) => [...prev, open, close]);
  }, [filterEntries.length, nextConnector]);

  const handleClearFilters = useCallback(() => setFilterEntries([]), []);

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
                {filteredPlayers.length === playersProjection.length
                  ? `${playersProjection.length} legends`
                  : `${filteredPlayers.length} of ${playersProjection.length} legends`}
              </p>
            )}
          </div>

          {/* View toggle */}
          <div id="legends-view-toggle" className="flex rounded-md border border-[#d9d0c9] overflow-hidden text-xs font-medium">
            <button
              id="legends-view-table-btn"
              type="button"
              onClick={() => setViewMode("table")}
              className={cn(
                "px-3 py-1.5 transition-colors",
                viewMode === "table"
                  ? "bg-[#0e0907] text-[#f7f7f7]"
                  : "text-[#0e0907]/45 hover:text-[#0e0907]/70 hover:bg-[#0e0907]/[0.04]",
              )}
            >
              Table
            </button>
            <button
              id="legends-view-cards-btn"
              type="button"
              onClick={() => setViewMode("cards")}
              className={cn(
                "px-3 py-1.5 border-l border-[#d9d0c9] transition-colors",
                viewMode === "cards"
                  ? "bg-[#0e0907] text-[#f7f7f7]"
                  : "text-[#0e0907]/45 hover:text-[#0e0907]/70 hover:bg-[#0e0907]/[0.04]",
              )}
            >
              Cards
            </button>
          </div>
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
          {/* ── Filter bar (reused from Players page) ── */}
          <FilterBar
            players={playersProjection}
            filters={filterEntries}
            nextConnector={nextConnector}
            onAddFilter={handleAddFilter}
            onRemoveFilter={handleRemoveFilter}
            onToggleConnector={handleToggleConnector}
            onToggleNegated={handleToggleNegated}
            onReorderFilters={handleReorderFilters}
            onSetNextConnector={setNextConnector}
            onClearFilters={handleClearFilters}
            onAddParens={handleAddParens}
          />

          {/* ── Sort controls ── */}
          <SortControls sortKeys={sortKeys} onSortKeysChange={setSortKeys} />

          {/* ── Content: table or card stack ── */}
          {viewMode === "table" ? (
            <PlayerTable
              players={paginatedPlayers}
              sortKeys={sortKeys}
              onSortKeysChange={setSortKeys}
              totalCount={sortedPlayers.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onRowClick={handleRowClick}
            />
          ) : (
            <>
              {sortedPlayers.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-[0.9375rem] text-[#0e0907]/40">No legends match your filters.</p>
                  <button
                    type="button"
                    onClick={handleClearFilters}
                    className="mt-3 text-[0.8125rem] font-medium text-[#fe6d34] hover:text-[#fe6d34]/70 transition-colors"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {sortedPlayers.map((player) => {
                    const legend = legends.find((l) => l.id === player.id);
                    if (!legend) return null;
                    return (
                      <ScoutingReportCard
                        key={legend.id}
                        legend={legend}
                        detail={details[legend.id] ?? null}
                        ruleset={ruleset}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
