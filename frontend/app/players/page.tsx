"use client";

/**
 * /players — Player Explorer page.
 *
 * Features:
 *  - Loads all qualifying players with embedded skill tiers via GET /api/players/bulk
 *  - Filter bar with per-filter AND/OR/NOT operators and drag-to-reorder pills
 *  - Multi-key sorting (up to 3 sort keys)
 *  - Table view (resizable/hideable columns) and Card view (top-6 skills)
 *  - Client-side pagination (all data loaded upfront, display is paged)
 *  - View mode (table/cards) persisted to localStorage
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, manualOverrideSkill } from "@/lib/api";
import { FilterBar } from "@/components/players/FilterBar";
import { SortControls } from "@/components/players/SortControls";
import { PlayerTable, DEFAULT_PAGE_SIZE } from "@/components/players/PlayerTable";
import { PlayerCard } from "@/components/players/PlayerCard";
import {
  evalFilterEntries,
  tierToNum,
  parseHeight,
  AVAILABLE_FILTERS,
  type FilterEntry,
  type FilterConnector,
  type PlayerFilterType,
  type ActiveFilter,
  type ParenMarker,
  MAX_ACTIVE_FILTERS,
  POSITION_ORDER,
} from "@/components/players/playerFilters";

// ---------------------------------------------------------------------------
// Legends toggle helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the filter entries contain a Legend=No pill,
 * which means legends are being actively excluded.
 */
function hasLegendsExcludeFilter(entries: FilterEntry[]): boolean {
  return entries.some(
    (e) => "filter" in e && e.filter.label === "Legend" && e.value === "No",
  );
}

/** Build a Legend=No filter entry to hide legends. */
function makeLegendsExcludeFilter(connector: FilterConnector): ActiveFilter {
  const legendFilter = AVAILABLE_FILTERS.find((f) => f.label === "Legend")!;
  return {
    id: crypto.randomUUID(),
    filter: legendFilter,
    value: "No",
    connector,
    negated: false,
  };
}
import type { SortKey } from "@/components/players/SortControls";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// View mode persistence key
// ---------------------------------------------------------------------------

const VIEW_MODE_KEY = "playersViewMode";
type ViewMode = "table" | "cards";

// ---------------------------------------------------------------------------
// Sort comparator — stable multi-key sort
// ---------------------------------------------------------------------------

function compareByKey(a: PlayerWithSkills, b: PlayerWithSkills, key: SortKey): number {
  const dir = key.direction === "asc" ? 1 : -1;

  const getVal = (p: PlayerWithSkills): number | string | null => {
    switch (key.field) {
      case "name":             return p.name;
      case "team":             return p.team ?? "";
      // Use numeric order so PG < G < SG < GF < SF < F < PF < FC < C.
      // Unknown positions sort last (99).
      case "position":         return POSITION_ORDER[p.position ?? ""] ?? 99;
      case "age":              return p.age;
      case "height":           return parseHeight(p.height);
      case "weight":           return p.weight;
      case "salary":           return p.salary;
      case "minutes_per_game": return p.minutes_per_game;
      case "capable_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 1).length : 0;
      case "proficient_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 2).length : 0;
      case "elite_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 3).length : 0;
      case "alltime_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 4).length : 0;
      case "peak_year":
        return p.peak_year ?? null;
      default:
        // Skill column — sort by tier numeric value
        return p.skills ? tierToNum(p.skills[key.field]) : 0;
    }
  };

  const av = getVal(a);
  const bv = getVal(b);

  // Nulls always sort to the end regardless of direction
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

// ---------------------------------------------------------------------------
// Unique ID generator for filter entries
// ---------------------------------------------------------------------------

/** Use crypto.randomUUID() to avoid hot-reload counter resets colliding with existing filter IDs. */
function nextFilterId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// PlayersPage
// ---------------------------------------------------------------------------

export default function PlayersPage() {
  const searchParams = useSearchParams();

  // ── Data ──────────────────────────────────────────────────────────────────
  const [players, setPlayers] = useState<PlayerWithSkills[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state ──────────────────────────────────────────────────────────
  // Pre-seed from URL: /players?team=LAL opens with that team filter active
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>(() => {
    const teamParam = searchParams.get("team");
    if (!teamParam) return [];
    const teamFilter = AVAILABLE_FILTERS.find((f) => f.label === "Team");
    if (!teamFilter) return [];
    const entry: ActiveFilter = {
      id: crypto.randomUUID(),
      filter: teamFilter,
      value: teamParam,
      connector: "AND",
      negated: false,
    };
    return [entry];
  });
  const [nextConnector, setNextConnector] = useState<FilterConnector>("AND");

  // Legends are visible when no NOT-team=Legends filter is active.
  // This is derived from filterEntries so the switch always reflects filter state.
  const legendsVisible = !hasLegendsExcludeFilter(filterEntries);

  const handleToggleLegends = useCallback(() => {
    if (legendsVisible) {
      // Hide legends: add NOT-team=Legends pill
      if (filterEntries.length < MAX_ACTIVE_FILTERS) {
        setFilterEntries((prev) => [...prev, makeLegendsExcludeFilter(nextConnector)]);
      }
    } else {
      // Show legends: remove all Legend=No pills
      setFilterEntries((prev) =>
        prev.filter(
          (e) => !("filter" in e && e.filter.label === "Legend" && e.value === "No"),
        ),
      );
    }
  }, [legendsVisible, filterEntries, nextConnector]);

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: "name", direction: "asc" }]);

  // ── View state ────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [viewModeReady, setViewModeReady] = useState(false); // suppress hydration flicker

  // ── Pagination state ──────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // ── Load players on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    listPlayersWithSkills()
      .then((res) => {
        if (res.success && res.data) {
          setPlayers(res.data);
        } else {
          setError(res.error ?? "Failed to load players");
        }
      })
      .catch(() => setError("Failed to load players"))
      .finally(() => setLoading(false));
  }, []);

  // ── Skill tier override (right-click edit in table) ──────────────────────
  //
  // TODO: gate this behind an admin mode check before passing to PlayerTable.
  //   e.g. const isAdmin = useAdminMode();
  //        onSkillOverride={isAdmin ? handleSkillOverride : undefined}
  const handleSkillOverride = useCallback(
    async (playerId: string, skillKey: string, tier: SkillTier) => {
      const res = await manualOverrideSkill(playerId, { skill_name: skillKey, resolved_value: tier });
      if (!res.success) return;
      setPlayers((prev) =>
        prev.map((p) =>
          p.id !== playerId
            ? p
            : { ...p, skills: { ...(p.skills ?? {}), [skillKey]: tier } },
        ),
      );
    },
    [],
  );

  // ── Restore view mode from localStorage (client-only) ────────────────────
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "table" || stored === "cards") setViewMode(stored);
    setViewModeReady(true);
  }, []);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  };

  // ── Derived data (memoized) ───────────────────────────────────────────────

  // 1. Filter
  const filteredPlayers = useMemo(() => {
    if (filterEntries.length === 0) return players;
    return players.filter((p) => evalFilterEntries(p, filterEntries));
  }, [players, filterEntries]);

  // 2. Sort
  const sortedPlayers = useMemo(
    () => stableMultiSort(filteredPlayers, sortKeys),
    [filteredPlayers, sortKeys],
  );

  // 3. Paginate
  const paginatedPlayers = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedPlayers.slice(start, start + pageSize);
  }, [sortedPlayers, page, pageSize]);

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [filterEntries, sortKeys]);

  // ── Filter handlers ───────────────────────────────────────────────────────

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
    // Both ActiveFilter and ParenMarker have a `connector` field — one branch handles both
    setFilterEntries((prev) =>
      prev.map((entry, i) =>
        i !== index
          ? entry
          : { ...entry, connector: entry.connector === "AND" ? "OR" : "AND" },
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
      {/* ── Page header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Players</h1>
          {!loading && (
            <p className="text-sm text-muted-foreground">
              {filteredPlayers.length === players.length
                ? `${players.length} players`
                : `${filteredPlayers.length} of ${players.length} players`}
            </p>
          )}
        </div>

        {/* Legends toggle */}
        <button
          id="legends-toggle"
          type="button"
          role="switch"
          aria-checked={legendsVisible}
          onClick={handleToggleLegends}
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <span
            className={cn(
              "relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200",
              legendsVisible ? "bg-foreground" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform duration-200",
                legendsVisible ? "translate-x-4" : "translate-x-0",
              )}
            />
          </span>
          Legends
        </button>

        {/* View mode toggle — hidden until localStorage is read to avoid hydration flash */}
        {viewModeReady && (
          <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => handleViewModeChange("table")}
              className={cn(
                "px-3 py-1.5 transition-colors",
                viewMode === "table"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => handleViewModeChange("cards")}
              className={cn(
                "px-3 py-1.5 border-l border-border transition-colors",
                viewMode === "cards"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              Cards
            </button>
          </div>
        )}
      </div>

      {/* ── Loading / error states ── */}
      {loading && (
        <div className="space-y-3 animate-pulse">
          <div className="h-10 bg-muted rounded-lg" />
          <div className="h-8 bg-muted rounded-lg w-1/2" />
          <div className="h-64 bg-muted rounded-lg" />
        </div>
      )}

      {!loading && error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* ── Filter bar ── */}
          <FilterBar
            players={players}
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

          {/* ── Table or Cards ── */}
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
              onSkillOverride={handleSkillOverride}
            />
          ) : (
            <>
              {/* Card grid — auto-fill responsive columns */}
              <div className="grid grid-cols-[repeat(auto-fill,_minmax(280px,_1fr))] gap-4">
                {paginatedPlayers.map((player) => (
                  <PlayerCard key={player.id} player={player} />
                ))}
                {paginatedPlayers.length === 0 && (
                  <p className="col-span-full text-center text-sm text-muted-foreground py-12">
                    No players match the current filters.
                  </p>
                )}
              </div>

              {/* Pagination for cards view */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {sortedPlayers.length === 0
                    ? "No results"
                    : `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sortedPlayers.length)} of ${sortedPlayers.length}`}
                </span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1">
                    <span>Per page:</span>
                    <select
                      className="rounded border border-input bg-background px-1 py-0.5 text-foreground focus:outline-none"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {[12, 24, 48, 96].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      ‹
                    </button>
                    <span className="tabular-nums">
                      {page} / {Math.max(1, Math.ceil(sortedPlayers.length / pageSize))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(Math.ceil(sortedPlayers.length / pageSize), p + 1))}
                      disabled={page >= Math.ceil(sortedPlayers.length / pageSize)}
                      className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
