"use client";

/**
 * PlayerPickerPanel.tsx — Right panel of the Build page.
 *
 * Full-featured PlayerPool browser: FilterBar + SortControls + PlayerTable/Cards.
 * Same filtering/sorting infrastructure as /players page but:
 *   - State is local (no URL sync — URL is owned by the builder for roster state)
 *   - No admin features
 *   - Legends excluded (activeRows only)
 *   - Row click fills the selected builder slot instead of navigating
 *   - Rows are draggable to Build slots
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  PlayerPoolBrowser,
  type PlayerPoolFilterRequest,
  type PlayerPoolViewMode,
} from "@/components/players/PlayerPoolBrowser";
import { PlayerViewSizeToggle, type PlayerViewSize } from "@/components/players/PlayerView";
import { DEFAULT_MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";
import type { SuggestionFilter } from "@/lib/noteFilters";

/** Default page sizes for each view in the builder picker. */
const ROW_DEFAULT_PAGE_SIZE = 32;
const CARDS_DEFAULT_PAGE_SIZE = 16; // 4 rows × 4 columns
const PANELS_DEFAULT_PAGE_SIZE = 8;

/** Columns hidden by default in the builder picker — Tier 3 starts collapsed. */
const PICKER_HIDDEN_COLUMNS = [
  // Tier 3 — nice-to-have. Height stays visible after Team before skill columns.
  "age", "games_played", "weight",
];

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
   * When set, the panel programmatically adds a "Skill = X at tier Y" filter entry.
   * Used by the Feedback suggestion-link flow. Parent resets this to null after the effect fires.
   */
  skillFilterTrigger?: SuggestionFilter | null;
  /** Called after the skill filter has been injected — parent should reset trigger to null. */
  onSkillFilterInjected?: () => void;
  /** Called on player row/card mouseenter — salary passed to gauge preview. */
  onPlayerHover?: (salary: number | null) => void;
  /** Called on player row/card mouseleave — clears gauge preview. */
  onPlayerHoverEnd?: () => void;
  /** Builder-specific content for Panel/Profile inspection surfaces. */
  renderPlayerFit?: (player: PlayerWithSkills, context: {
    surface: "panel" | "profile";
    inBuild: boolean;
    canAddToBuild: boolean;
    addToBuild: () => void;
    dismissProfile?: () => void;
  }) => ReactNode;
  /**
   * Player ID to visually highlight in the list — used by BuilderPage to mirror
   * the CourtLineup face hover into the picker list.
   */
  highlightedPlayerId?: string | null;
  /** Max roster slots from rules_json. */
  maxRosterSlots?: number;
  /** When true, profile links route to /admin/players/[id]. */
  isAdmin?: boolean;
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
  renderPlayerFit,
  maxRosterSlots = DEFAULT_MAX_ROSTER_SLOTS,
  highlightedPlayerId,
  isAdmin,
}: PlayerPickerPanelProps) {
  const [filterRequest, setFilterRequest] = useState<PlayerPoolFilterRequest | null>(null);
  const [viewSize, setViewSize] = useState<PlayerViewSize>("row");
  const hasAvailableBuildSlot = rosterPlayerIds.size < maxRosterSlots;

  // ── Hint banner dismissal (persisted) ────────────────────────────────────
  const HINT_STORAGE_KEY = "cornerstone:picker-hint-dismissed";
  const [hintDismissed, setHintDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HINT_STORAGE_KEY) === "1";
  });
  const dismissHint = useCallback(() => {
    setHintDismissed(true);
    localStorage.setItem(HINT_STORAGE_KEY, "1");
  }, []);

  // ── Salary filter injection ───────────────────────────────────────────────
  useEffect(() => {
    if (salaryFilterTrigger == null) return;
    setFilterRequest({
      id: crypto.randomUUID(),
      filterLabel: "Salary",
      value: `≤|${(salaryFilterTrigger / 1_000_000).toFixed(1)}`,
      mode: "append",
    });
  }, [salaryFilterTrigger]);

  // ── Skill filter injection — Feedback suggestion link ───────────────────
  useEffect(() => {
    if (!skillFilterTrigger) return;
    setFilterRequest({
      id: crypto.randomUUID(),
      filterLabel: "Skill",
      value: `${skillFilterTrigger.skill}|${skillFilterTrigger.tier}`,
      mode: "replace-same-skill",
    });
  }, [skillFilterTrigger]);

  // ── Unavailability check — in roster OR would exceed salary cap ───────────
  const isUnavailable = useCallback((player: PlayerWithSkills): boolean => {
    if (rosterPlayerIds.has(player.id)) return true;
    if (!hasAvailableBuildSlot) return true;
    if (player.salary != null && player.salary > remainingSalary) return true;
    return false;
  }, [hasAvailableBuildSlot, rosterPlayerIds, remainingSalary]);

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  const handleRowDragStart = useCallback((e: React.DragEvent, player: PlayerWithSkills) => {
    if (isUnavailable(player)) { e.preventDefault(); return; }
    e.dataTransfer.setData("application/builder-player", JSON.stringify(player));
    e.dataTransfer.effectAllowed = "copy";
  }, [isUnavailable]);

  /* Left-click — fill first free slot (skip if unavailable) */
  const handleRowClick = useCallback((player: PlayerWithSkills) => {
    if (isUnavailable(player)) return;
    onPlayerClick(player);
  }, [isUnavailable, onPlayerClick]);

  const handleFilterRequestHandled = useCallback(() => {
    if (filterRequest?.filterLabel === "Salary") onSalaryFilterInjected?.();
    if (filterRequest?.filterLabel === "Skill") onSkillFilterInjected?.();
    setFilterRequest(null);
  }, [filterRequest, onSalaryFilterInjected, onSkillFilterInjected]);

  const handlePlayerHover = useCallback((player: PlayerWithSkills) => {
    onPlayerHover?.(player.salary ?? null);
  }, [onPlayerHover]);

  const handlePlayerHoverEnd = useCallback(() => {
    onPlayerHoverEnd?.();
  }, [onPlayerHoverEnd]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div id="player-picker-panel" className="flex flex-col h-full gap-1.5 min-h-0">

      {/* Header — title + player count + view toggle */}
      <div id="player-picker-header" className="flex items-center justify-between flex-wrap gap-2 flex-shrink-0">
        <div>
          <h2 id="player-picker-title" className="text-[1.125rem] font-semibold text-[#0e0907]">Players</h2>
        </div>
        {!loading && !error && (
          <PlayerViewSizeToggle
            id="player-picker-view-toggle"
            viewSize={viewSize}
            viewSizes={["row", "card", "panel"] as PlayerPoolViewMode[]}
            onViewSizeChange={setViewSize}
            className="self-end rounded-sm text-[0.8125rem]"
            activeClassName="bg-[#0e0907] text-[#f7f7f7]"
            inactiveClassName="text-[#0e0907]/45 hover:text-[#0e0907]/70 hover:bg-[#0e0907]/[0.04]"
            borderClassName="border-[#d9d0c9]"
          />
        )}

      </div>

      {/* Hint banner — warm background, dismissable */}
      {!hintDismissed && (
        <div
          id="player-picker-selection-hint"
          className="flex-shrink-0 flex items-center justify-between text-[0.8125rem] text-[#0e0907]/45 bg-[#f0f0f0] border border-[#d9d0c9]/60 rounded-sm px-3 py-1.5"
        >
          <span>
            Left-click to add · Right-click or inspect icon for Profile · Click remaining salary to filter
            {selectedSlot != null && selectedSlot !== 1 && (
              <span className="ml-2 text-[#ffa05c] font-medium">→ Slot {selectedSlot} selected</span>
            )}
          </span>
          <button
            id="player-picker-hint-dismiss"
            type="button"
            onClick={dismissHint}
            className="ml-2 text-[#0e0907]/30 hover:text-[#0e0907]/60 transition-colors flex-shrink-0"
            title="Dismiss hint"
          >
            ×
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div id="player-picker-loading" className="flex-1 space-y-2 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-9 bg-[#0e0907]/[0.04] rounded-sm" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div id="player-picker-error" className="rounded-md bg-[#e53e3e]/10 border border-[#e53e3e]/20 p-3 text-[0.9375rem] text-[#e53e3e]">
          {error}
        </div>
      )}

      {/* Table / Cards — scrollable content */}
      {!loading && !error && (
        <PlayerPoolBrowser
          id="player-picker-browser"
          className="flex flex-col gap-1.5 flex-1 min-h-0"
          players={players}
          defaultSortKeys={[{ field: "name", direction: "asc" }]}
          defaultPageSize={ROW_DEFAULT_PAGE_SIZE}
          defaultPageSizeByViewSize={{ row: ROW_DEFAULT_PAGE_SIZE, card: CARDS_DEFAULT_PAGE_SIZE, panel: PANELS_DEFAULT_PAGE_SIZE }}
          pageSizeOptions={[8, 16, 32]}
          viewSizes={["row", "card", "panel"]}
          defaultViewSize="row"
          viewSize={viewSize}
          onViewSizeChange={setViewSize}
          defaultHiddenColumns={PICKER_HIDDEN_COLUMNS}
          cardGridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          panelListClassName="flex flex-col gap-3"
          contentClassName="flex-1 overflow-hidden min-h-0"
          tableRootClassName="flex h-full min-h-0 flex-col"
          tableWrapperClassName="min-h-0 flex-1 overflow-auto"
          emptyMessage="No players match the current filters."
          filterRequest={filterRequest}
          onFilterRequestHandled={handleFilterRequestHandled}
          getDisabledPlayerIds={(visiblePlayers) =>
            new Set(visiblePlayers.filter(isUnavailable).map((player) => player.id))
          }
          onRowClick={handleRowClick}
          onRowDragStart={handleRowDragStart}
          onRowHover={onPlayerHover ? handlePlayerHover : undefined}
          onRowHoverEnd={onPlayerHoverEnd ? handlePlayerHoverEnd : undefined}
          highlightedPlayerId={highlightedPlayerId}
          isAdmin={isAdmin}
          getPrimaryActionLabel={(player) => isUnavailable(player) ? undefined : "Add to Rotation"}
          onPrimaryAction={(player) => handleRowClick(player)}
          renderPlayerFit={(player, context) => renderPlayerFit?.(player, {
            ...context,
            inBuild: rosterPlayerIds.has(player.id),
            canAddToBuild: !isUnavailable(player),
            addToBuild: () => handleRowClick(player),
          })}
          renderViewToggle={() => null}
        />
      )}
    </div>
  );
}
