"use client";

/**
 * PlayerPickerPanel.tsx — Right panel of the Team Builder.
 *
 * Full-featured player explorer: FilterBar + SortControls + PlayerTable/Cards.
 * Identical functionality to /players page but:
 *   - State is local (no URL sync — URL is owned by the builder for roster state)
 *   - No admin features (no skill override, no manual include/remove)
 *   - Legends excluded (activeRows only)
 *   - Row click fills the selected builder slot instead of navigating
 *   - Rows are draggable to builder slots
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PlayerTable, DEFAULT_PAGE_SIZE } from "@/components/players/PlayerTable";
import { PlayerCard } from "@/components/players/PlayerCard";
import { FilterBar } from "@/components/players/FilterBar";
import { SortControls } from "@/components/players/SortControls";
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
import type { SortKey } from "@/components/players/SortControls";
import type { PlayerWithSkills } from "@/lib/types";
import type { SuggestionFilter } from "@/lib/noteFilters";

// ---------------------------------------------------------------------------
// Sort comparator (mirrors players/page.tsx)
// ---------------------------------------------------------------------------

function compareByKey(a: PlayerWithSkills, b: PlayerWithSkills, key: SortKey): number {
  const dir = key.direction === "asc" ? 1 : -1;
  const getVal = (p: PlayerWithSkills): number | string | null => {
    switch (key.field) {
      case "name":             return p.name;
      case "team":             return p.team ?? "";
      case "position":         return POSITION_ORDER[p.position ?? ""] ?? 99;
      case "age":              return p.age;
      case "height":           return parseHeight(p.height);
      case "weight":           return p.weight;
      case "salary":           return p.salary;
      case "games_played":      return p.games_played;
      case "minutes_per_game": return p.minutes_per_game;
      case "capable_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 1).length : 0;
      case "proficient_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 2).length : 0;
      case "elite_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 3).length : 0;
      case "alltime_plus_count":
        return p.skills ? Object.values(p.skills).filter((t) => tierToNum(t) >= 4).length : 0;
      case "peak_year":        return p.peak_year ?? null;
      default:
        return p.skills ? tierToNum(p.skills[key.field]) : 0;
    }
  };
  const av = getVal(a);
  const bv = getVal(b);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
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
// PlayerPickerPanel
// ---------------------------------------------------------------------------

type ViewMode = "table" | "cards";

interface PlayerPickerPanelProps {
  players: PlayerWithSkills[];
  loading: boolean;
  error: string | null;
  /** IDs already in the roster — shown as "in roster" and not selectable. */
  rosterPlayerIds: Set<string>;
  /** Remaining salary budget. Players whose salary exceeds this are disabled. */
  remainingSalary: number;
  /** Currently selected slot (1-based). null = no active selection. Used only for the hint banner. */
  selectedSlot: number | null;
  /** Called on left-click — parent fills the appropriate slot. */
  onPlayerClick: (player: PlayerWithSkills) => void;
  /**
   * When set to a dollar amount, the panel programmatically adds a "Salary ≤ X" filter
   * entry using the existing filter system. Parent resets this to null after the effect fires.
   */
  salaryFilterTrigger?: number | null;
  /** Called after the salary filter has been injected — parent should reset trigger to null. */
  onSalaryFilterInjected?: () => void;
  /**
   * When set, the panel programmatically adds a "Skill = X at tier Y" filter entry — used by
   * the GM Notes suggestion-link flow. Parent resets this to null after the effect fires.
   */
  skillFilterTrigger?: SuggestionFilter | null;
  /** Called after the skill filter has been injected — parent should reset trigger to null. */
  onSkillFilterInjected?: () => void;
  /** Called on player row/card mouseenter — salary passed to gauge preview. */
  onPlayerHover?: (salary: number | null) => void;
  /** Called on player row/card mouseleave — clears gauge preview. */
  onPlayerHoverEnd?: () => void;
  /**
   * Player ID to visually highlight in the list — used by BuilderPage to mirror
   * the CourtLineup face hover into the picker list.
   */
  highlightedPlayerId?: string | null;
}

export function PlayerPickerPanel({
  players,
  loading,
  error,
  rosterPlayerIds,
  remainingSalary,
  selectedSlot,
  onPlayerClick,
  salaryFilterTrigger,
  onSalaryFilterInjected,
  skillFilterTrigger,
  onSkillFilterInjected,
  onPlayerHover,
  onPlayerHoverEnd,
  highlightedPlayerId,
}: PlayerPickerPanelProps) {
  // ── View mode ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // ── Filter state ──────────────────────────────────────────────────────────
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>([]);
  const [nextConnector, setNextConnector] = useState<FilterConnector>("AND");

  // ── Sort state ────────────────────────────────────────────────────────────
  const [sortKeys, setSortKeys] = useState<SortKey[]>([{ field: "name", direction: "asc" }]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Reset page on filter/sort change
  useEffect(() => { setPage(1); }, [filterEntries, sortKeys]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (filterEntries.length === 0) return players;
    return players.filter((p) => evalFilterEntries(p, filterEntries));
  }, [players, filterEntries]);

  // ── Salary filter injection ───────────────────────────────────────────────
  // When parent triggers a salary filter (via salary gauge click), inject it as
  // a real filter entry into the existing filter system so it shows in FilterBar.
  useEffect(() => {
    if (salaryFilterTrigger == null) return;
    const salaryFilter = AVAILABLE_FILTERS.find((f) => f.label === "Salary");
    if (!salaryFilter) return;
    if (filterEntries.length >= MAX_ACTIVE_FILTERS) return;
    const entry: ActiveFilter = {
      id: crypto.randomUUID(),
      filter: salaryFilter,
      // NumericFilter value format: "op|value_in_millions" — operator must be unicode ≤
      value: `≤|${(salaryFilterTrigger / 1_000_000).toFixed(1)}`,
      connector: nextConnector,
      negated: false,
    };
    setFilterEntries((prev) => [...prev, entry]);
    onSalaryFilterInjected?.();
  // Only run when trigger changes — not on every filterEntries/nextConnector change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaryFilterTrigger]);

  // ── Skill filter injection — GM Notes suggestion link ───────────────────
  // When parent triggers a {skill, tier} filter from a clicked suggestion note,
  // inject it into the existing filter system. Replaces any prior skill filter
  // for the SAME skill so repeated clicks don't pile up duplicates.
  useEffect(() => {
    if (!skillFilterTrigger) return;
    const skillFilter = AVAILABLE_FILTERS.find((f) => f.label === "Skill");
    if (!skillFilter) return;
    const encodedValue = `${skillFilterTrigger.skill}|${skillFilterTrigger.tier}`;
    setFilterEntries((prev) => {
      // Drop any existing Skill entry pinned to this same skill (any tier) so we don't duplicate
      const pruned = prev.filter((e) => {
        if ("paren" in e) return true;
        if (e.filter.label !== "Skill") return true;
        const prevSkill = e.value.split("|")[0];
        return prevSkill !== skillFilterTrigger.skill;
      });
      if (pruned.length >= MAX_ACTIVE_FILTERS) return pruned;
      const entry: ActiveFilter = {
        id: crypto.randomUUID(),
        filter: skillFilter,
        value: encodedValue,
        connector: nextConnector,
        negated: false,
      };
      return [...pruned, entry];
    });
    onSkillFilterInjected?.();
  // Only run when trigger identity changes — not on every filterEntries/nextConnector change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillFilterTrigger]);

  const sorted = useMemo(() => stableMultiSort(filtered, sortKeys), [filtered, sortKeys]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // ── Filter handlers ───────────────────────────────────────────────────────
  const handleAddFilter = useCallback(
    (filter: PlayerFilterType, value: string) => {
      if (filterEntries.length >= MAX_ACTIVE_FILTERS) return;
      const entry: ActiveFilter = {
        id: crypto.randomUUID(),
        filter,
        value,
        connector: nextConnector,
        negated: false,
      };
      setFilterEntries((prev) => [...prev, entry]);
    },
    [filterEntries.length, nextConnector],
  );

  const handleRemoveFilter = useCallback(
    (index: number) => setFilterEntries((prev) => prev.filter((_, i) => i !== index)),
    [],
  );

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
    const open: ParenMarker = { id: crypto.randomUUID(), paren: "(", connector: nextConnector };
    const close: ParenMarker = { id: crypto.randomUUID(), paren: ")", connector: "AND" };
    setFilterEntries((prev) => [...prev, open, close]);
  }, [filterEntries.length, nextConnector]);

  const handleClearFilters = useCallback(() => setFilterEntries([]), []);

  // ── Unavailability check — in roster OR would exceed salary cap ───────────
  const isUnavailable = useCallback((player: PlayerWithSkills): boolean => {
    if (rosterPlayerIds.has(player.id)) return true;
    if (player.salary != null && player.salary > remainingSalary) return true;
    return false;
  }, [rosterPlayerIds, remainingSalary]);

  // Disabled player IDs — rostered or over remaining salary budget
  const disabledPlayerIds = useMemo(
    () => new Set(paginated.filter(isUnavailable).map((p) => p.id)),
    [paginated, isUnavailable],
  );

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleRowDragStart = useCallback((e: React.DragEvent, player: PlayerWithSkills) => {
    if (isUnavailable(player)) { e.preventDefault(); return; }
    e.dataTransfer.setData("application/builder-player", JSON.stringify(player));
    e.dataTransfer.effectAllowed = "copy";
  }, [isUnavailable]);

  // ── Left-click — fill first free slot (skip if unavailable) ──────────────
  const handleRowClick = useCallback((player: PlayerWithSkills) => {
    if (isUnavailable(player)) return;
    onPlayerClick(player);
  }, [isUnavailable, onPlayerClick]);

  // ── Right-click — open player profile in new tab with from=builder marker ──
  const handleRowContextMenu = useCallback((e: React.MouseEvent, player: PlayerWithSkills) => {
    e.preventDefault();
    window.open(`/players/${player.id}?from=builder`, "_blank");
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div id="player-picker-panel" className="flex flex-col h-full gap-2 min-h-0">

      {/* Header */}
      <div id="player-picker-header" className="flex items-center justify-between flex-wrap gap-2 flex-shrink-0">
        <div>
          <h2 id="player-picker-title" className="text-sm font-semibold text-foreground">Players</h2>
          {!loading && (
            <p id="player-picker-count" className="text-xs text-muted-foreground">
              {filtered.length === players.length
                ? `${players.length} players`
                : `${filtered.length} of ${players.length} players`}
            </p>
          )}
        </div>

        {/* View toggle */}
        <div id="player-picker-view-toggle" className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
          <button
            id="player-picker-cards-btn"
            type="button"
            onClick={() => setViewMode("cards")}
            className={cn(
              "px-3 py-1.5 transition-colors",
              viewMode === "cards"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Cards
          </button>
          <button
            id="player-picker-table-btn"
            type="button"
            onClick={() => setViewMode("table")}
            className={cn(
              "px-3 py-1.5 border-l border-border transition-colors",
              viewMode === "table"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            Table
          </button>
        </div>
      </div>

      {/* Hint: left-click fills slot, right-click opens profile */}
      <div
        id="player-picker-selection-hint"
        className="flex-shrink-0 text-xs text-muted-foreground bg-muted/40 border border-border rounded-md px-3 py-1.5"
      >
        Hint: Left-click to add · Right-click to open profile · Click remaining salary to filter players you cannot afford
        {selectedSlot != null && selectedSlot !== 1 && (
          <span className="ml-2 text-blue-600 font-medium">→ Slot {selectedSlot} selected</span>
        )}
      </div>

      {/* Filter bar */}
      {!loading && !error && (
        <div className="flex-shrink-0">
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
        </div>
      )}

      {/* Sort controls */}
      {!loading && !error && (
        <div className="flex-shrink-0">
          <SortControls sortKeys={sortKeys} onSortKeysChange={setSortKeys} />
        </div>
      )}

      {/* Loading / error */}
      {loading && (
        <div id="player-picker-loading" className="flex-1 space-y-2 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted rounded" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div id="player-picker-error" className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table / Cards — scrollable */}
      {!loading && !error && (
        <div id="player-picker-list" className="flex-1 overflow-auto min-h-0">
          {viewMode === "table" ? (
            <PlayerTable
              players={paginated}
              sortKeys={sortKeys}
              onSortKeysChange={setSortKeys}
              totalCount={sorted.length}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              onRowClick={handleRowClick}
              onRowDragStart={handleRowDragStart}
              onRowContextMenu={handleRowContextMenu}
              disabledPlayerIds={disabledPlayerIds}
              onRowHover={onPlayerHover ? (player) => onPlayerHover(player.salary ?? null) : undefined}
              onRowHoverEnd={onPlayerHoverEnd}
              highlightedPlayerId={highlightedPlayerId}
            />
          ) : (
            <>
              <div id="player-picker-cards" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {paginated.map((player) => {
                  const isHighlighted = highlightedPlayerId != null && highlightedPlayerId === player.id;
                  return (
                  <div
                    key={player.id}
                    id={`player-card-${player.id}`}
                    draggable
                    onDragStart={(e) => handleRowDragStart(e, player)}
                    onClick={() => handleRowClick(player)}
                    onContextMenu={(e) => handleRowContextMenu(e, player)}
                    onMouseEnter={onPlayerHover ? () => onPlayerHover(player.salary ?? null) : undefined}
                    onMouseLeave={onPlayerHoverEnd}
                    className={cn(
                      "cursor-pointer rounded-lg transition-shadow",
                      isUnavailable(player) && !isHighlighted ? "opacity-40 pointer-events-none" : "",
                      // CourtLineup face hover → cross-highlight even on disabled cards
                      isHighlighted && "!opacity-100 ring-2 ring-amber-400/80 shadow-[0_0_12px_rgba(251,191,36,0.3)]",
                    )}
                  >
                    <PlayerCard player={player} />
                  </div>
                  );
                })}
                {paginated.length === 0 && (
                  <p className="col-span-full text-center text-sm text-muted-foreground py-6">
                    No players match the current filters.
                  </p>
                )}
              </div>

              {/* Cards pagination */}
              <div id="player-picker-cards-pagination" className="flex items-center justify-between text-xs text-muted-foreground mt-3">
                <span>
                  {sorted.length === 0
                    ? "No results"
                    : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, sorted.length)} of ${sorted.length}`}
                </span>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded border border-input bg-background px-1 py-0.5 focus:outline-none"
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  >
                    {[12, 24, 48].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2 py-0.5 rounded border border-input disabled:opacity-40"
                  >‹</button>
                  <span>{page} / {Math.max(1, Math.ceil(sorted.length / pageSize))}</span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(Math.ceil(sorted.length / pageSize), p + 1))}
                    disabled={page >= Math.ceil(sorted.length / pageSize)}
                    className="px-2 py-0.5 rounded border border-input disabled:opacity-40"
                  >›</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
