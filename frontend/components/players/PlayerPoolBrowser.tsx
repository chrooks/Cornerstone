"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/lib/utils";
import { getLegend, getPlayerProfile, getPlayerStats } from "@/lib/api";
import { FilterBar } from "@/components/players/FilterBar";
import { PlayerTable } from "@/components/players/PlayerTable";
import { SortControls } from "@/components/players/SortControls";
import {
  PlayerProfileModal,
  PlayerView,
  PlayerViewSizeToggle,
  legendDetailToPlayerProfile,
  playerWithSkillsToProfile,
  type PlayerViewSize,
} from "@/components/players/PlayerView";
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
import type { LegendDetail, PlayerProfile, PlayerWithSkills, SkillTier } from "@/lib/types";

const CURRENT_SEASON = "2025-26";

export type { PlayerViewSize };
export type PlayerPoolViewMode = PlayerViewSize;

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
  defaultPageSizeByViewSize?: Partial<Record<PlayerViewSize, number>>;
  pageSizeOptions: number[];
  viewSizes: PlayerViewSize[];
  defaultViewSize: PlayerViewSize;
  viewSize?: PlayerViewSize;
  onViewSizeChange?: (size: PlayerViewSize) => void;
  defaultHiddenColumns?: string[];
  initialFilterEntries?: FilterEntry[];
  initialSortKeys?: SortKey[];
  availableFilters?: PlayerFilterType[];
  sortFieldOptions?: string[];
  cardGridClassName?: string;
  panelListClassName?: string;
  contentClassName?: string;
  tableRootClassName?: string;
  tableWrapperClassName?: string;
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
    viewSize: PlayerViewSize;
    setViewSize: (size: PlayerViewSize) => void;
    ready: boolean;
  }) => React.ReactNode;
  getDisabledPlayerIds?: (players: PlayerWithSkills[]) => Set<string>;
  /**
   * Player IDs to render muted/de-emphasized (dimmed) but still interactive —
   * e.g. excluded-from-snapshot rows in the draft Player Pool. Distinct from
   * disabled, which is non-interactive.
   */
  getMutedPlayerIds?: (players: PlayerWithSkills[]) => Set<string>;
  getPanelSkills?: (player: PlayerWithSkills) => Record<string, string | null | undefined> | null | undefined;
  getProfileLegendDetail?: (player: PlayerWithSkills) => LegendDetail | null | undefined;
  getPrimaryActionLabel?: (player: PlayerWithSkills, viewSize: PlayerViewSize) => string | undefined;
  onPrimaryAction?: (player: PlayerWithSkills, viewSize: PlayerViewSize) => void;
  onSkillOverride?: (playerId: string, skillKey: string, tier: SkillTier) => Promise<void>;
  onRemoveManualPlayer?: (playerId: string) => void;
  onRowClick?: (player: PlayerWithSkills) => void;
  onRowDragStart?: (event: React.DragEvent, player: PlayerWithSkills) => void;
  onRowContextMenu?: (event: React.MouseEvent, player: PlayerWithSkills) => void;
  onRowHover?: (player: PlayerWithSkills) => void;
  onRowHoverEnd?: () => void;
  renderPlayerFit?: (player: PlayerWithSkills, context: {
    surface: "panel" | "profile";
    dismissProfile?: () => void;
  }) => React.ReactNode;
  highlightedPlayerId?: string | null;
  isAdmin?: boolean;
}

function nextFilterId(): string {
  return crypto.randomUUID();
}

function defaultViewToggle({
  viewSize,
  setViewSize,
  ready,
  viewSizes,
  id,
}: {
  viewSize: PlayerViewSize;
  setViewSize: (size: PlayerViewSize) => void;
  ready: boolean;
  viewSizes: PlayerViewSize[];
  id: string;
}) {
  if (!ready || viewSizes.length <= 1) return null;

  return (
    <PlayerViewSizeToggle
      id={`${id}-view-toggle`}
      viewSize={viewSize}
      viewSizes={viewSizes}
      onViewSizeChange={setViewSize}
      ready={ready}
    />
  );
}

export function PlayerPoolBrowser({
  id,
  className = "space-y-4",
  players,
  defaultSortKeys,
  defaultPageSize,
  defaultPageSizeByViewSize,
  pageSizeOptions,
  viewSizes,
  defaultViewSize,
  viewSize: controlledViewSize,
  onViewSizeChange,
  defaultHiddenColumns = [],
  initialFilterEntries = [],
  initialSortKeys,
  availableFilters = AVAILABLE_FILTERS,
  sortFieldOptions,
  cardGridClassName = "grid grid-cols-[repeat(auto-fill,_minmax(280px,_1fr))] gap-4",
  panelListClassName = "flex flex-col gap-6",
  contentClassName,
  tableRootClassName,
  tableWrapperClassName,
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
  getDisabledPlayerIds,
  getMutedPlayerIds,
  getPanelSkills,
  getProfileLegendDetail,
  getPrimaryActionLabel,
  onPrimaryAction,
  onSkillOverride,
  onRemoveManualPlayer,
  onRowClick,
  onRowDragStart,
  onRowContextMenu,
  onRowHover,
  onRowHoverEnd,
  renderPlayerFit,
  highlightedPlayerId,
  isAdmin,
}: PlayerPoolBrowserProps) {
  const initialPageSize = defaultPageSizeByViewSize?.[defaultViewSize] ?? defaultPageSize;
  const [filterEntries, setFilterEntries] = useState<FilterEntry[]>(initialFilterEntries);
  const [nextConnector, setNextConnector] = useState<FilterConnector>("AND");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(defaultHiddenColumns),
  );
  const [sortKeys, setSortKeys] = useState<SortKey[]>(initialSortKeys ?? defaultSortKeys);
  const [internalViewSize, setInternalViewSize] = useState<PlayerViewSize>(defaultViewSize);
  const viewSize = controlledViewSize ?? internalViewSize;
  const [viewModeReady, setViewModeReady] = useState(!persistViewModeKey && !hideViewToggleUntilReady);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [profilePlayer, setProfilePlayer] = useState<PlayerWithSkills | null>(null);
  const [profileBoxStats, setProfileBoxStats] = useState<Record<string, number | null> | null>(null);
  const profileCache = useRef(new Map<string, PlayerProfile>());
  const profileBoxStatsCache = useRef(new Map<string, Record<string, number | null> | null>());
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
    if (stored && viewSizes.includes(stored as PlayerViewSize)) {
      if (onViewSizeChange) {
        onViewSizeChange(stored as PlayerViewSize);
      } else {
        setInternalViewSize(stored as PlayerViewSize);
      }
    }
    setViewModeReady(true);
    onViewModeReadyChange?.(true);
  }, [onViewModeReadyChange, onViewSizeChange, persistViewModeKey, viewSizes]);

  const setViewSize = useCallback((size: PlayerViewSize) => {
    if (onViewSizeChange) {
      onViewSizeChange(size);
    } else {
      setInternalViewSize(size);
    }
    setPage(1);
    if (persistViewModeKey) localStorage.setItem(persistViewModeKey, size);
  }, [onViewSizeChange, persistViewModeKey]);

  const updateSortKeys = useCallback((keys: SortKey[]) => {
    setSortKeys(keys);
  }, []);

  const openProfile = useCallback(async (player: PlayerWithSkills) => {
    const cachedProfile = profileCache.current.get(player.id);
    const cachedBoxStats = profileBoxStatsCache.current.get(player.id);
    const optimisticProfile = cachedProfile ?? playerWithSkillsToProfile(player);

    setProfileModalOpen(true);
    setProfile(optimisticProfile);
    setProfilePlayer(player);
    setProfileBoxStats(cachedBoxStats ?? null);
    setProfileLoading(false);
    setProfileError(null);

    if (cachedProfile && profileBoxStatsCache.current.has(player.id)) return;

    setProfileLoading(true);

    try {
      if (player.is_legend) {
        const providedDetail = getProfileLegendDetail?.(player);
        const detail = providedDetail ?? (await getLegend(player.id)).data;
        const legendProfile = legendDetailToPlayerProfile(player, detail ?? null);
        profileCache.current.set(player.id, legendProfile);
        profileBoxStatsCache.current.set(player.id, null);
        setProfile(legendProfile);
        setProfileBoxStats(null);
        return;
      }

      const [profileRes, statsRes] = await Promise.all([
        getPlayerProfile(player.id, CURRENT_SEASON),
        getPlayerStats(player.id, CURRENT_SEASON),
      ]);
      if (!profileRes.success || !profileRes.data) {
        setProfileError(profileRes.error ?? "Failed to load full player profile");
        return;
      }
      profileCache.current.set(player.id, profileRes.data);
      profileBoxStatsCache.current.set(
        player.id,
        statsRes.success ? statsRes.data?.box_score ?? null : null,
      );
      setProfile(profileRes.data);
      setProfileBoxStats(statsRes.success ? statsRes.data?.box_score ?? null : null);
    } catch {
      setProfileError("Failed to load full player profile");
    } finally {
      setProfileLoading(false);
    }
  }, [getProfileLegendDetail]);

  const closeProfile = useCallback(() => {
    setProfileModalOpen(false);
    setProfileLoading(false);
    setProfileError(null);
    setProfile(null);
    setProfilePlayer(null);
    setProfileBoxStats(null);
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
  const mutedPlayerIds = useMemo(
    () => getMutedPlayerIds?.(paginatedPlayers),
    [getMutedPlayerIds, paginatedPlayers],
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
    ? renderViewToggle({ viewSize, setViewSize, ready: viewModeReady })
    : defaultViewToggle({ viewSize, setViewSize, ready: viewModeReady, viewSizes, id });

  const renderCollectionView = () => {
    if (viewSize === "row") {
      return (
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
          onRowClick={onRowClick ?? openProfile}
          onRowDragStart={onRowDragStart}
          onRowContextMenu={onRowContextMenu ?? ((event, player) => {
            event.preventDefault();
            openProfile(player);
          })}
          disabledPlayerIds={disabledPlayerIds}
          mutedPlayerIds={mutedPlayerIds}
          onRowHover={onRowHover}
          onRowHoverEnd={onRowHoverEnd}
          highlightedPlayerId={highlightedPlayerId}
          isAdmin={isAdmin}
          hiddenColumns={hiddenColumns}
          onHiddenColumnsChange={setHiddenColumns}
          rootClassName={tableRootClassName}
          wrapperClassName={tableWrapperClassName}
        />
      );
    }

    const collectionId = viewSize === "card" ? `${id}-cards` : `${id}-panels`;
    const collectionClassName = viewSize === "card" ? cardGridClassName : panelListClassName;

    return (
      <>
        <div id={collectionId} className={collectionClassName}>
          {paginatedPlayers.map((player) => {
            const disabled = disabledPlayerIds?.has(player.id) ?? false;
            const muted = mutedPlayerIds?.has(player.id) ?? false;
            const highlighted = highlightedPlayerId != null && highlightedPlayerId === player.id;
            return (
              <PlayerView
                key={player.id}
                size={viewSize}
                player={player}
                skills={viewSize === "panel" ? getPanelSkills?.(player) : undefined}
                disabled={disabled}
                muted={muted}
                highlighted={highlighted}
                primaryActionLabel={getPrimaryActionLabel?.(player, viewSize)}
                onPrimaryAction={onPrimaryAction ? (item) => onPrimaryAction(item, viewSize) : undefined}
                onOpenProfile={openProfile}
                onDragStart={onRowDragStart}
                onContextMenu={onRowContextMenu ?? ((event, item) => {
                  event.preventDefault();
                  openProfile(item);
                })}
                onHover={onRowHover}
                onHoverEnd={onRowHoverEnd}
                fitContent={renderPlayerFit?.(player, { surface: "panel" })}
              />
            );
          })}
          {paginatedPlayers.length === 0 && (
            <p id={`${id}-${viewSize}-empty`} className={cn(viewSize === "card" && "col-span-full", "text-center text-sm text-muted-foreground py-12")}>
              {emptyMessage}
            </p>
          )}
        </div>
        {paginatedPlayers.length === 0 && (
          <button
            id={`${id}-${viewSize}-clear-filters`}
            type="button"
            onClick={handleClearFilters}
            className="mx-auto block text-[0.8125rem] font-medium text-[#fe6d34] hover:text-[#fe6d34]/70 transition-colors"
          >
            {clearFiltersLabel}
          </button>
        )}
        {renderPagination(`${id}-${viewSize}-pagination`, "Showing ")}
      </>
    );
  };

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

      <div
        id={`${id}-content`}
        className={cn(
          contentClassName,
          viewSize !== "row" && "min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1",
        )}
      >
        {renderCollectionView()}
      </div>

      {profileModalOpen && (
        <PlayerProfileModal
          profile={profile}
          boxStats={profileBoxStats}
          loading={profileLoading}
          error={profileError}
          onDismiss={closeProfile}
          fitContent={profilePlayer ? renderPlayerFit?.(profilePlayer, { surface: "profile", dismissProfile: closeProfile }) : null}
        />
      )}
    </div>
  );
}
