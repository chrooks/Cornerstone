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
import { useParams, useSearchParams } from "next/navigation";
import { listLegends, getLegend } from "@/lib/api";
import { PlayerPoolBrowser, type PlayerPoolBrowserCounts, type PlayerPoolViewMode } from "@/components/players/PlayerPoolBrowser";
import { RandomPlayerButton } from "@/components/players/RandomPlayerButton";
import { PlayerViewSizeToggle } from "@/components/players/PlayerView";
import { SORT_FIELD_OPTIONS, type SortKey } from "@/components/players/SortControls";
import {
  AVAILABLE_FILTERS,
} from "@/components/players/playerFilters";
import type { LegendSummary, LegendDetail, PlayerWithSkills } from "@/lib/types";

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

const LEGEND_FILTERS = AVAILABLE_FILTERS.filter(
  (filter) => !["Games Played", "MPG", "Legend"].includes(filter.label),
);
const LEGEND_SORT_FIELDS = SORT_FIELD_OPTIONS.filter(
  (field) => !["games_played", "minutes_per_game"].includes(field),
);
const LEGEND_HIDDEN_COLUMNS = ["games_played"];
const LEGENDS_ROW_PAGE_SIZE = 16;
const LEGENDS_CARD_PAGE_SIZE = 16;
const LEGENDS_PANEL_PAGE_SIZE = 8;

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
  const searchParams = useSearchParams();
  const handleRowClick = useCallback(
    (player: PlayerWithSkills) => {
      const params = new URLSearchParams();
      params.set("cornerstone", player.id);
      // Forward supporting player params from rebuild redirect (s2–s9)
      for (let slot = 2; slot <= 9; slot++) {
        const value = searchParams.get(`s${slot}`);
        if (value) params.set(`s${slot}`, value);
      }
      window.location.href = `/lab/${ruleset}/build?${params.toString()}`;
    },
    [ruleset, searchParams],
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
            defaultPageSize={LEGENDS_PANEL_PAGE_SIZE}
            defaultPageSizeByViewSize={{ row: LEGENDS_ROW_PAGE_SIZE, card: LEGENDS_CARD_PAGE_SIZE, panel: LEGENDS_PANEL_PAGE_SIZE }}
            pageSizeOptions={[8, 16, 32]}
            viewSizes={["row", "card", "panel"]}
            defaultViewSize="panel"
            defaultHiddenColumns={LEGEND_HIDDEN_COLUMNS}
            availableFilters={LEGEND_FILTERS}
            sortFieldOptions={LEGEND_SORT_FIELDS}
            emptyMessage="No legends match your filters."
            clearFiltersLabel="Clear filters"
            onCountsChange={setBrowserCounts}
            onVisiblePlayersChange={setVisibleLegendPlayers}
            onRowClick={handleRowClick}
            getPanelSkills={(player) => details[player.id]?.profile}
            getProfileLegendDetail={(player) => details[player.id] ?? null}
            getPrimaryActionLabel={() => "Select as Cornerstone"}
            onPrimaryAction={(player) => handleRowClick(player)}
            renderViewToggle={({ viewSize, setViewSize }) => (
              <PlayerViewSizeToggle
                id="legends-view-toggle"
                viewSize={viewSize}
                viewSizes={["row", "card", "panel"] as PlayerPoolViewMode[]}
                onViewSizeChange={setViewSize}
                activeClassName="bg-[#0e0907] text-[#f7f7f7]"
                inactiveClassName="text-[#0e0907]/45 hover:text-[#0e0907]/70 hover:bg-[#0e0907]/[0.04]"
                borderClassName="border-[#d9d0c9]"
              />
            )}
          />
        </div>
      )}
    </main>
  );
}
