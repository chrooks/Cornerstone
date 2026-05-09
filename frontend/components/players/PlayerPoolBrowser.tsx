"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/lib/utils";
import { FilterBar } from "@/components/players/FilterBar";
import { PlayerCard } from "@/components/players/PlayerCard";
import { PlayerTable } from "@/components/players/PlayerTable";
import { SortControls } from "@/components/players/SortControls";
import {
  AVAILABLE_FILTERS,
  MAX_ACTIVE_FILTERS,
  type ActiveFilter,
  type FilterConnector,
  type FilterEntry,
  type ParenMarker,
  type PlayerFilterType,
} from "@/components/players/playerFilters";
import {
  filterPlayerPool,
  paginatePlayerPool,
  stableMultiSort,
} from "@/components/players/playerPoolPipeline";
import type { SortKey } from "@/components/players/SortControls";
import type { PlayerWithSkills, SkillTier } from "@/lib/types";

export type PlayerPoolViewMode = "table" | "cards" | "report";

export interface PlayerPoolFilterRequest {
  id: string;
  filterLabel: string;
  value: string;
  mode?: "append" | "replace-same-skill" | "remove-label-value";
}

export interface PlayerPoolBrowserCounts {
  totalCount: number;
  filteredCount: number;
  sortedCount: number;
  pageCount: number;
}

interface PlayerPoolBrowserProps {
  id: string;
  className?: string;
  players: PlayerWithSkills[];
  defaultSortKeys: SortKey[];
  defaultPageSize: number;
  pageSizeByView?: Partial<Record<PlayerPoolViewMode, number>>;
  pageSizeOptions: number[];
  viewModes: PlayerPoolViewMode[];
  defaultViewMode: PlayerPoolViewMode;
  defaultHiddenColumns?: string[];
  initialFilterEntries?: FilterEntry[];
  initialSortKeys?: SortKey[];
  availableFilters?: PlayerFilterType[];
  sortFieldOptions?: string[];
  cardGridClassName?: string;
  contentClassName?: string;
  emptyMessage: string;
  clearFiltersLabel?: string;
  persistViewModeKey?: string;
  hideViewToggleUntilReady?: boolean;
  filterRequest?: PlayerPoolFilterRequest | null;
  onFilterRequestHandled?: () => void;
  onFilterEntriesChange?: (entries: FilterEntry[]) => void;
  onSortKeysChange?: (keys: SortKey[]) => void;
  onCountsChange?: (counts: PlayerPoolBrowserCounts) => void;
  onVisiblePlayersChange?: (players: PlayerWithSkills[]) => void;
  onViewModeReadyChange?: (ready: boolean) => void;
  renderViewToggle?: (args: {
    viewMode: PlayerPoolViewMode;
    setViewMode: (mode: PlayerPoolViewMode) => void;
    ready: boolean;
  }) => React.ReactNode;
  renderCard?: (player: PlayerWithSkills) => React.ReactNode;
  renderReport?: (player: PlayerWithSkills) => React.ReactNode;
  getDisabledPlayerIds?: (players: PlayerWithSkills[]) => Set<string>;
  onSkillOverride?: (playerId: string, skillKey: string, tier: SkillTier) => Promise<void>;
  onRemoveManualPlayer?: (playerId: string) => void;
  onRowClick?: (player: PlayerWithSkills) => void;
  onRowDragStart?: (event: React.DragEvent, player: PlayerWithSkills) => void;
  onRowContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills) => void;
  onRowHover?: (player: PlayerWithSkills) => void;
  onRowHoverEnd?: () => void;
  highlightedPlayerId?: string | null;
  isAdmin?: boolean;
}

function nextFilterId(): string {
  return crypto.randomUUID();
}

function defaultViewToggle({
  viewMode,
  setViewMode,
  ready,
  viewModes,
  id,
}: {
  viewMode: PlayerPoolViewMode;
  setViewMode: (mode: PlayerPoolViewMode) => void;
  ready: boolean;
  viewModes: PlayerPoolViewMode[];
  id: string;
}) {
  if (!ready || viewModes.length <= 1) return null;

  return (
    <div id={`${id}-view-toggle`} className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
      {viewModes.map((mode, index) => (
        <button
          key={mode}
          id={`${id}-view-${mode}-btn`}
          type="button"
          onClick={() => setViewMode(mode)}
          className={cn(
            "px-3 py-1.5 capitalize transition-colors",
            index > 0 && "border-l border-border",
            viewMode === mode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {mode === "report" ? "Cards" : mode}
        </button>
      ))}
    </div>
  );
}

export function PlayerPoolBrowser({
  id,
  className = "space-y-4",
  players,
  defaultSortKeys,
  defaultPageSize,
  pageSizeByView,
  pageSizeOptions,
  viewModes,
  defaultViewMode,
  defaultHiddenColumns = [],
  initialFilterEntries = [],
  initialSortKeys,
  availableFilters = AVAILABLE_FILTERS,
  sortFieldOptions,
  cardGridClassName = "grid grid-cols-[repeat(auto-fill,_minmax(280px,_1fr))] gap-4",
  contentClassName,
  emptyMessage,
  clearFiltersLabel = "Clear filters",
  persistViewModeKey,
  hideViewToggleUntilReady = false,
  filterRequest,
  onFilterRequestHandled,
  onFilterEntriesChange,
  onSortKeysChange,
  onCountsChange,
  onVisiblePlayersChange,
  onViewModeReadyChange,
  renderViewToggle,
  renderCard,
  renderReport,
  getDisabledPlayerIds,
  onSkillOverride,
  onRemoveManualPlayer,
  onRowClick,
  onRowDragStart,
  onRowContextMenu,
  onRowHover,
  onRowHoverEnd,
  highlightedPlayerId,
  isAdmin,
}: PlayerPoolBrowserProps) {
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>(initialFilterEntries);
  const [nextConnector, setNextConnector] = useState<FilterConnector>("AND");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(defaultHiddenColumns),
  );
  const [sortKeys, setSortKeys] = useState<SortKey[]>(initialSortKeys ?? defaultSortKeys);
  const [viewMode, setViewModeState] = useState<PlayerPoolViewMode>(defaultViewMode);
  const [viewModeReady, setViewModeReady] = useState(!persistViewModeKey && !hideViewToggleUntilReady);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const handledFilterRequestIds = useRef(new Set<string>());
  const didNotifyInitialFilters = useRef(false);
  const didNotifyInitialSorts = useRef(false);

  useEffect(() => {
    if (!persistViewModeKey) {
      setViewModeReady(true);
      onViewModeReadyChange?.(true);
      return;
    }
    const stored = localStorage.getItem(persistViewModeKey);
    if (stored && viewModes.includes(stored as PlayerPoolViewMode)) {
      setViewModeState(stored as PlayerPoolViewMode);
    }
    setViewModeReady(true);
    onViewModeReadyChange?.(true);
  }, [onViewModeReadyChange, persistViewModeKey, viewModes]);

  const setViewMode = useCallback((mode: PlayerPoolViewMode) => {
    setViewModeState(mode);
    setPage(1);
    setPageSize(pageSizeByView?.[mode] ?? defaultPageSize);
    if (persistViewModeKey) localStorage.setItem(persistViewModeKey, mode);
  }, [defaultPageSize, pageSizeByView, persistViewModeKey]);

  const updateSortKeys = useCallback((keys: SortKey[]) => {
    setSortKeys(keys);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filterEntries, sortKeys]);

  useEffect(() => {
    setSortKeys((currentKeys) => {
      const visibleSortKeys = currentKeys.filter((key) => !hiddenColumns.has(key.field));
      if (visibleSortKeys.length === currentKeys.length) return currentKeys;
      return visibleSortKeys;
    });
  }, [hiddenColumns]);

  useEffect(() => {
    if (!didNotifyInitialFilters.current) {
      didNotifyInitialFilters.current = true;
      return;
    }
    onFilterEntriesChange?.(filterEntries);
  }, [filterEntries, onFilterEntriesChange]);

  useEffect(() => {
    if (!didNotifyInitialSorts.current) {
      didNotifyInitialSorts.current = true;
      return;
    }
    onSortKeysChange?.(sortKeys);
  }, [onSortKeysChange, sortKeys]);

  useEffect(() => {
    if (!filterRequest) return;
    if (handledFilterRequestIds.current.has(filterRequest.id)) return;
    handledFilterRequestIds.current.add(filterRequest.id);

    const filter = availableFilters.find((item) => item.label === filterRequest.filterLabel);
    if (!filter && filterRequest.mode !== "remove-label-value") {
      onFilterRequestHandled?.();
      return;
    }

    setFilterEntries((prev) => {
      if (filterRequest.mode === "remove-label-value") {
        return prev.filter((entry) => {
          if ("paren" in entry) return true;
          return !(entry.filter.label === filterRequest.filterLabel && entry.value === filterRequest.value);
        });
      }

      const pruned = filterRequest.mode === "replace-same-skill"
        ? prev.filter((entry) => {
            if ("paren" in entry) return true;
            if (entry.filter.label !== filterRequest.filterLabel) return true;
            return entry.value.split("|")[0] !== filterRequest.value.split("|")[0];
          })
        : prev;

      if (pruned.length >= MAX_ACTIVE_FILTERS) return pruned;
      if (!filter) return pruned;

      const entry: ActiveFilter = {
        id: nextFilterId(),
        filter,
        value: filterRequest.value,
        connector: nextConnector,
        negated: false,
      };
      return [...pruned, entry];
    });

    onFilterRequestHandled?.();
  }, [availableFilters, filterRequest, nextConnector, onFilterRequestHandled]);

  const filteredPlayers = useMemo(
    () => filterPlayerPool(players, filterEntries),
    [filterEntries, players],
  );
  const sortedPlayers = useMemo(
    () => stableMultiSort(filteredPlayers, sortKeys),
    [filteredPlayers, sortKeys],
  );
  const paginatedPlayers = useMemo(
    () => paginatePlayerPool(sortedPlayers, page, pageSize),
    [page, pageSize, sortedPlayers],
  );
  const disabledPlayerIds = useMemo(
    () => getDisabledPlayerIds?.(paginatedPlayers),
    [getDisabledPlayerIds, paginatedPlayers],
  );

  useEffect(() => {
    onCountsChange?.({
      totalCount: players.length,
      filteredCount: filteredPlayers.length,
      sortedCount: sortedPlayers.length,
      pageCount: paginatedPlayers.length,
    });
  }, [filteredPlayers.length, onCountsChange, paginatedPlayers.length, players.length, sortedPlayers.length]);

  useEffect(() => {
    // Expose filtered and sorted PlayerPool to page-level actions like random Cornerstone selection.
    onVisiblePlayersChange?.(sortedPlayers);
  }, [onVisiblePlayersChange, sortedPlayers]);

  const handleAddFilter = useCallback((filter: PlayerFilterType, value: string) => {
    if (filterEntries.length >= MAX_ACTIVE_FILTERS) return;
    const entry: ActiveFilter = {
      id: nextFilterId(),
      filter,
      value,
      connector: nextConnector,
      negated: false,
    };
    setFilterEntries((prev) => [...prev, entry]);
  }, [filterEntries.length, nextConnector]);

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

  const totalPages = Math.max(1, Math.ceil(sortedPlayers.length / pageSize));
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, sortedPlayers.length);

  const renderPagination = (paginationId: string, labelPrefix = "") => (
    <div id={paginationId} className="flex items-center justify-between text-xs text-muted-foreground">
      <span id={`${paginationId}-info`}>
        {sortedPlayers.length === 0
          ? "No results"
          : `${labelPrefix}${startRow}-${endRow} of ${sortedPlayers.length}`}
      </span>
      <div id={`${paginationId}-controls`} className="flex items-center gap-3">
        <label id={`${paginationId}-per-page-label`} className="flex items-center gap-1">
          <span id={`${paginationId}-per-page-text`}>Per page:</span>
          <select
            id={`${paginationId}-per-page`}
            className="rounded border border-input bg-background px-1 py-0.5 text-foreground focus:outline-none"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </label>
        <div id={`${paginationId}-page-controls`} className="flex items-center gap-1">
          <button
            id={`${paginationId}-prev-btn`}
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
          >
            ‹
          </button>
          <span id={`${paginationId}-page-indicator`} className="tabular-nums">
            {page} / {totalPages}
          </span>
          <button
            id={`${paginationId}-next-btn`}
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );

  const viewToggle = renderViewToggle
    ? renderViewToggle({ viewMode, setViewMode, ready: viewModeReady })
    : defaultViewToggle({ viewMode, setViewMode, ready: viewModeReady, viewModes, id });

  return (
    <div id={id} className={className}>
      {viewToggle}

      <FilterBar
        players={players}
        availableFilters={availableFilters}
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

      <SortControls
        sortKeys={sortKeys}
        onSortKeysChange={updateSortKeys}
        hiddenColumns={hiddenColumns}
        sortFieldOptions={sortFieldOptions}
      />

      <div id={`${id}-content`} className={contentClassName}>
        {viewMode === "table" ? (
          <PlayerTable
            players={paginatedPlayers}
            sortKeys={sortKeys}
            onSortKeysChange={updateSortKeys}
            totalCount={sortedPlayers.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            onSkillOverride={onSkillOverride}
            onRemoveManualPlayer={onRemoveManualPlayer}
            onRowClick={onRowClick}
            onRowDragStart={onRowDragStart}
            onRowContextMenu={onRowContextMenu}
            disabledPlayerIds={disabledPlayerIds}
            onRowHover={onRowHover}
            onRowHoverEnd={onRowHoverEnd}
            highlightedPlayerId={highlightedPlayerId}
            isAdmin={isAdmin}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
          />
        ) : viewMode === "cards" ? (
          <>
            <div id={`${id}-cards`} className={cardGridClassName}>
              {paginatedPlayers.map((player) => (
                renderCard ? renderCard(player) : <PlayerCard key={player.id} player={player} isAdmin={isAdmin} />
              ))}
              {paginatedPlayers.length === 0 && (
                <p id={`${id}-empty`} className="col-span-full text-center text-sm text-muted-foreground py-12">
                  {emptyMessage}
                </p>
              )}
            </div>
            {renderPagination(`${id}-cards-pagination`, "Showing ")}
          </>
        ) : (
          <>
            {sortedPlayers.length === 0 ? (
              <div id={`${id}-report-empty`} className="text-center py-16">
                <p className="text-[0.9375rem] text-[#0e0907]/40">{emptyMessage}</p>
                <button
                  id={`${id}-report-clear-filters`}
                  type="button"
                  onClick={handleClearFilters}
                  className="mt-3 text-[0.8125rem] font-medium text-[#fe6d34] hover:text-[#fe6d34]/70 transition-colors"
                >
                  {clearFiltersLabel}
                </button>
              </div>
            ) : (
              <div id={`${id}-reports`} className="flex flex-col gap-6">
                {sortedPlayers.map((player) => renderReport?.(player))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
