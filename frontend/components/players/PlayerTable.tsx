"use client";

/**
 * PlayerTable.tsx — Data table for the /players explorer.
 *
 * Features:
 *  - Sticky Name column (left)
 *  - Resizable columns (drag the right edge of any header)
 *  - Hideable columns (toggle via the Columns panel)
 *  - Sort by clicking a column header (Shift+click adds a secondary sort key)
 *  - SkillTierBadge cells for all 20 skill columns
 *  - Click a row → navigate to /players/[id]
 */

import { useRef, useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { formatSalary, formatHeight, SKILL_LABELS } from "./playerFilters";
import { PlayerRowView, skillCountAtOrAbove } from "@/components/players/PlayerView";
import { SKILL_TIERS, TIER_CONTEXT_COLORS, TIER_CONTEXT_ACTIVE } from "@/lib/tiers";
import { SKILL_ABBREV, PROFILE_SKILL_ORDER } from "@/lib/skills";
import type { SortKey } from "./SortControls";
import type { PlayerWithSkills } from "@/lib/types";
import type { SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// Developer-configurable constants
// ---------------------------------------------------------------------------

/** Default number of rows shown per page. */
export const DEFAULT_PAGE_SIZE = 8;

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

// SKILL_ABBREV imported from @/lib/skills

interface ColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  sticky?: boolean;
}

// Non-skill columns ordered by tier:
//   T1 (always visible): Name, Pos, Salary
//   T2 (high value):     Cap+, Pro+, Elite+, ATG+, Era, Team
//   T3 (nice-to-have):   Age, GP, Ht, Wt
const META_COLUMNS: ColDef[] = [
  // Tier 1 — always visible
  { key: "headshot",              label: "",        defaultWidth: 36,  minWidth: 36,  sticky: true },
  { key: "name",                  label: "Name",    defaultWidth: 160, minWidth: 120, sticky: true },
  { key: "position",              label: "Pos",     defaultWidth: 70,  minWidth: 50 },
  { key: "salary",                label: "Salary",  defaultWidth: 90,  minWidth: 70 },
  // Tier 2 — high value
  { key: "capable_plus_count",    label: "Cap+",    defaultWidth: 65,  minWidth: 50 },
  { key: "proficient_plus_count", label: "Pro+",    defaultWidth: 65,  minWidth: 50 },
  { key: "elite_plus_count",      label: "Elite+",  defaultWidth: 65,  minWidth: 50 },
  { key: "alltime_plus_count",    label: "ATG+",    defaultWidth: 65,  minWidth: 50 },
  { key: "peak_year",             label: "Era",     defaultWidth: 65,  minWidth: 50 },
  { key: "team",                  label: "Team",    defaultWidth: 100, minWidth: 70 },
  // Tier 3 — nice-to-have
  { key: "age",                   label: "Age",     defaultWidth: 60,  minWidth: 50 },
  { key: "games_played",          label: "GP",      defaultWidth: 60,  minWidth: 50 },
  { key: "height",                label: "Ht",      defaultWidth: 70,  minWidth: 55 },
  { key: "weight",                label: "Wt",      defaultWidth: 70,  minWidth: 55 },
];

// Skill columns follow profile display order (PUBLIC_SKILL_CATEGORIES grouping)
const SKILL_COLUMNS: ColDef[] = PROFILE_SKILL_ORDER.map((key) => ({
  key,
  label: SKILL_ABBREV[key],
  defaultWidth: 90,
  minWidth: 65,
}));

const ALL_COLUMNS: ColDef[] = [...META_COLUMNS, ...SKILL_COLUMNS];

// ---------------------------------------------------------------------------
// Skill tier context menu
// ---------------------------------------------------------------------------

// SKILL_TIERS, TIER_CONTEXT_COLORS, TIER_CONTEXT_ACTIVE imported from @/lib/tiers

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  playerId: string;
  playerName: string;
  skillKey: string;
  skillLabel: string;
  currentTier: SkillTier | undefined;
  saving: boolean;
}

const CLOSED_MENU: ContextMenuState = {
  open: false, x: 0, y: 0,
  playerId: "", playerName: "", skillKey: "", skillLabel: "",
  currentTier: undefined, saving: false,
};

// ---------------------------------------------------------------------------
// PlayerTable
// ---------------------------------------------------------------------------

interface PlayerTableProps {
  players: PlayerWithSkills[];
  sortKeys: SortKey[];
  onSortKeysChange: (keys: SortKey[]) => void;
  /** Total number of players after filtering (for pagination display). */
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /**
   * When provided, right-clicking a skill cell shows a tier-edit context menu.
   * The callback receives the player id, skill key, and chosen tier — the caller
   * is responsible for the API call and optimistic state update.
   *
   * TODO: gate this behind an admin mode check in the parent before passing the prop.
   */
  onSkillOverride?: (playerId: string, skillKey: string, tier: SkillTier) => Promise<void>;
  /** When provided, manually-included players show a remove button next to their name. */
  onRemoveManualPlayer?: (playerId: string) => void;
  /**
   * When provided, clicking a row calls this instead of navigating to /players/[id].
   * Used by the builder's player picker panel to fill a roster slot.
   */
  onRowClick?: (player: PlayerWithSkills) => void;
  /**
   * When provided, rows are draggable and this is called on drag start.
   * Used by the builder's player picker panel for drag-to-slot.
   */
  onRowDragStart?: (e: React.DragEvent, player: PlayerWithSkills) => void;
  /**
   * When provided, right-clicking a row calls this instead of the default context menu.
   * Used by the builder's player picker panel to open the player profile page.
   */
  onRowContextMenu?: (e: React.MouseEvent, player: PlayerWithSkills) => void;
  /**
   * Player IDs that should be rendered as disabled (dimmed, unclickable).
   * Used by the builder to mark rostered players and over-budget players.
   */
  disabledPlayerIds?: Set<string>;
  /**
   * Player IDs to render muted/dimmed but still interactive (e.g. excluded
   * from snapshot). Distinct from disabled, which is non-interactive.
   */
  mutedPlayerIds?: Set<string>;
  /** Called on row mouseenter — used by builder picker to preview cap impact in gauge. */
  onRowHover?: (player: PlayerWithSkills) => void;
  /** Called on row mouseleave — clears gauge preview. */
  onRowHoverEnd?: () => void;
  /**
   * Player ID to visually highlight — the row is drawn with an amber tint even
   * when it's disabled. Used by the builder to mirror CourtLineup face hovers.
   */
  highlightedPlayerId?: string | null;
  /** When true, row clicks navigate to /admin/players/[id] instead of /players/[id]. */
  isAdmin?: boolean;
  /** Column keys to hide by default (uncontrolled mode). */
  initialHiddenColumns?: string[];
  /** Controlled hidden columns — when provided, PlayerTable defers to parent state. */
  hiddenColumns?: Set<string>;
  /** Callback when user toggles column visibility (controlled mode). */
  onHiddenColumnsChange?: (hidden: Set<string>) => void;
  /** Optional root sizing class for embedded table surfaces. */
  rootClassName?: string;
  /** Optional scroll-frame class for embedded table surfaces. */
  wrapperClassName?: string;
}

export function PlayerTable({
  players,
  sortKeys,
  onSortKeysChange,
  totalCount,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onSkillOverride,
  onRemoveManualPlayer,
  onRowClick,
  onRowDragStart,
  onRowContextMenu,
  disabledPlayerIds,
  mutedPlayerIds,
  onRowHover,
  onRowHoverEnd,
  highlightedPlayerId,
  isAdmin,
  initialHiddenColumns,
  hiddenColumns: controlledHidden,
  onHiddenColumnsChange,
  rootClassName,
  wrapperClassName,
}: PlayerTableProps) {
  const router = useRouter();

  // Column widths — start from defaults
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c.defaultWidth])),
  );

  // Hidden columns — controlled or uncontrolled
  const [internalHidden, setInternalHidden] = useState<Set<string>>(
    () => new Set(initialHiddenColumns ?? []),
  );
  const hiddenColumns = controlledHidden ?? internalHidden;
  const setHiddenColumns = onHiddenColumnsChange ?? setInternalHidden;
  const [columnsOpen, setColumnsOpen] = useState(false);

  // Context menu for right-click skill tier editing
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(CLOSED_MENU);

  // Close context menu on Escape key (outside clicks handled by the backdrop div)
  useEffect(() => {
    if (!contextMenu.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(CLOSED_MENU); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contextMenu.open]);

  // Right-click handler for skill cells — opens the tier edit menu
  const handleSkillContextMenu = useCallback(
    (e: React.MouseEvent, player: PlayerWithSkills, skillKey: string) => {
      // Legend rows have no player profile — skill overrides are not supported for them
      if (player.is_legend) return;
      if (!onSkillOverride) return; // feature disabled when prop is not provided
      e.preventDefault();
      e.stopPropagation();

      // Clamp position so the menu stays inside the viewport
      // (estimated menu size: 200px wide × 185px tall)
      const x = Math.min(e.clientX, window.innerWidth - 210);
      const y = Math.min(e.clientY, window.innerHeight - 195);

      setContextMenu({
        open: true,
        x, y,
        playerId: player.id,
        playerName: player.name,
        skillKey,
        skillLabel: SKILL_LABELS[skillKey] ?? skillKey,
        currentTier: (player.skills?.[skillKey] as SkillTier) ?? undefined,
        saving: false,
      });
    },
    [onSkillOverride],
  );

  // Called when the user picks a tier from the context menu
  const handleTierSelect = useCallback(
    async (tier: SkillTier) => {
      if (!onSkillOverride) return;
      if (contextMenu.saving) return;
      const { playerId, skillKey } = contextMenu;
      if (!playerId || !skillKey) return;
      setContextMenu((prev) => ({ ...prev, saving: true }));
      try {
        await onSkillOverride(playerId, skillKey, tier);
      } catch {
        // onSkillOverride is responsible for surfacing errors to the user
      } finally {
        setContextMenu(CLOSED_MENU);
      }
    },
    [onSkillOverride, contextMenu],
  );

  // Resize state stored in refs to avoid re-renders during drag
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // ── Resize handlers ──────────────────────────────────────────────────────

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent, colKey: string) => {
      if (resizingCol.current) return; // guard against simultaneous resize drags
      e.preventDefault();
      e.stopPropagation(); // don't trigger sort
      resizingCol.current = colKey;
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = columnWidths[colKey] ?? 100;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizingCol.current) return;
        const col = ALL_COLUMNS.find((c) => c.key === resizingCol.current);
        const minW = col?.minWidth ?? 50;
        const newWidth = Math.max(minW, resizeStartWidth.current + (ev.clientX - resizeStartX.current));
        setColumnWidths((prev) => ({ ...prev, [resizingCol.current!]: newWidth }));
      };

      const handleMouseUp = () => {
        resizingCol.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [columnWidths],
  );

  // ── Sort handlers ────────────────────────────────────────────────────────

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent, field: string) => {
      const existing = sortKeys.find((k) => k.field === field);
      if (e.shiftKey) {
        // Shift+click: add as secondary sort (or toggle direction if already there)
        if (existing) {
          onSortKeysChange(
            sortKeys.map((k) =>
              k.field === field ? { ...k, direction: k.direction === "asc" ? "desc" : "asc" } : k,
            ),
          );
        } else if (sortKeys.length < 3) {
          onSortKeysChange([...sortKeys, { field, direction: "desc" }]);
        }
      } else {
        // Regular click: set as primary sort (reset others)
        if (existing) {
          onSortKeysChange([{ field, direction: existing.direction === "asc" ? "desc" : "asc" }]);
        } else {
          onSortKeysChange([{ field, direction: "desc" }]);
        }
      }
    },
    [sortKeys, onSortKeysChange],
  );

  // ── Column toggle ────────────────────────────────────────────────────────

  const toggleColumn = (key: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHiddenColumns(next);
  };

  // ── Visible columns ──────────────────────────────────────────────────────

  const visibleColumns = ALL_COLUMNS.filter((c) => !hiddenColumns.has(c.key));

  // ── Cell renderers ───────────────────────────────────────────────────────

  const renderCell = (player: PlayerWithSkills, col: ColDef) => {
    switch (col.key) {
      case "headshot":
        return (
          <PlayerHeadshot nba_api_id={player.nba_api_id} size={24} name={player.name} />
        );
      case "name":
        if (player.is_legend) {
          return (
            <span className="font-medium text-foreground">
              <span className="text-amber-500 mr-1" aria-label="Legend">★</span>
              {player.name}
            </span>
          );
        }
        return (
          <span className="flex items-center gap-1.5">
            {/* In builder picker (onRowClick present), row click handles navigation — no Link needed */}
            {onRowClick ? (
              <span className="font-medium text-foreground">{player.name}</span>
            ) : (
              <Link
                href={isAdmin ? `/admin/players/${player.id}` : `/players/${player.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-foreground hover:underline"
              >
                {player.name}
              </Link>
            )}
            {/* Remove button for manually-included players (0 games, forced into pool) */}
            {player.manually_included && onRemoveManualPlayer && (
              <button
                id={`remove-manual-player-${player.id}`}
                type="button"
                title="Remove from player pool"
                onClick={(e) => { e.stopPropagation(); onRemoveManualPlayer(player.id); }}
                className="text-muted-foreground/50 hover:text-destructive transition-colors text-[10px] leading-none"
              >
                ✕
              </button>
            )}
          </span>
        );
      case "peak_year":
        return (
          <span className="text-muted-foreground tabular-nums">
            {player.peak_year ?? "—"}
          </span>
        );
      case "team":
        return <span className="text-muted-foreground">{player.team ?? "—"}</span>;
      case "position":
        return <span>{player.position ?? "—"}</span>;
      case "age":
        return <span>{player.age ?? "—"}</span>;
      case "height":
        return <span>{formatHeight(player.height) || "—"}</span>;
      case "weight":
        return <span>{player.weight != null ? `${player.weight}` : "—"}</span>;
      case "salary":
        return (
          <span className="tabular-nums">
            {formatSalary(player.salary)}
            {player.is_rookie_deal && (
              <span className="ml-1.5 text-[0.6875rem] text-[#f3a181]/60 font-medium" title="This player is currently on their rookie deal">RD</span>
            )}
          </span>
        );
      case "games_played":
        return <span className="tabular-nums text-muted-foreground">{player.games_played ?? "—"}</span>;
      case "capable_plus_count": {
        const count = skillCountAtOrAbove(player, 1);
        return (
          <span className={cn("font-medium tabular-nums", count > 0 ? "text-sky-700" : "text-muted-foreground")}>
            {count}
          </span>
        );
      }
      case "proficient_plus_count": {
        const count = skillCountAtOrAbove(player, 2);
        return (
          <span className={cn("font-medium tabular-nums", count > 0 ? "text-blue-700" : "text-muted-foreground")}>
            {count}
          </span>
        );
      }
      case "elite_plus_count": {
        const count = skillCountAtOrAbove(player, 3);
        return (
          <span className={cn("font-medium tabular-nums", count > 0 ? "text-emerald-700" : "text-muted-foreground")}>
            {count}
          </span>
        );
      }
      case "alltime_plus_count": {
        const count = skillCountAtOrAbove(player, 4);
        return (
          <span className={cn("font-medium tabular-nums", count > 0 ? "text-amber-600" : "text-muted-foreground")}>
            {count}
          </span>
        );
      }
      default: {
        // Skill column
        const tier = player.skills?.[col.key];
        if (!tier || tier === "None") return <span className="text-muted-foreground/40">—</span>;
        return <SkillTierBadge tier={tier as SkillTier} size="sm" />;
      }
    }
  };

  // ── Sort indicator ───────────────────────────────────────────────────────

  const getSortIndicator = (field: string) => {
    const idx = sortKeys.findIndex((k) => k.field === field);
    if (idx === -1) return null;
    const key = sortKeys[idx];
    return (
      <span className="ml-1 text-[10px] text-muted-foreground tabular-nums">
        {key.direction === "asc" ? "▲" : "▼"}
        {sortKeys.length > 1 && <sup>{idx + 1}</sup>}
      </span>
    );
  };

  // ── Pagination ───────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalCount);

  return (
    <div id="player-table-root" className={rootClassName}>
      {/* Table wrapper with horizontal scroll */}
      <div id="player-table-wrapper" className={cn("overflow-x-auto rounded-lg border border-border", wrapperClassName)}>
        <table id="player-table" className="border-collapse text-xs" style={{ tableLayout: "fixed", minWidth: "max-content" }}>
          <thead>
            <tr className="bg-muted/60 border-b border-border">
              {visibleColumns.map((col) => {
                const width = columnWidths[col.key] ?? col.defaultWidth;
                const isSorted = sortKeys.some((k) => k.field === col.key);
                return (
                  <th
                    key={col.key}
                    style={{ width, minWidth: col.minWidth }}
                    className={cn(
                      "relative select-none px-2 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap",
                      col.key !== "headshot" && "cursor-pointer hover:bg-muted transition-colors",
                      isSorted && "text-foreground bg-muted",
                      col.sticky && "sticky left-0 z-20 bg-muted/60 border-r border-border",
                    )}
                    onClick={col.key !== "headshot" ? (e) => handleHeaderClick(e, col.key) : undefined}
                    title={col.key !== "headshot" ? `Sort by ${SKILL_LABELS[col.key] ?? col.label} (Shift+click for secondary sort)` : undefined}
                  >
                    <span className="truncate">{col.label}</span>
                    {col.key !== "headshot" && getSortIndicator(col.key)}

                    {/* Resize handle — right edge of header (not on headshot column) */}
                    {col.key !== "headshot" && (
                      <span
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize group flex items-center justify-center"
                        onMouseDown={(e) => handleResizeMouseDown(e, col.key)}
                      >
                        <span className="h-4 w-px bg-border group-hover:bg-foreground/40 transition-colors" />
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {players.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  No players match the current filters.
                </td>
              </tr>
            ) : (
              players.map((player) => {
                const isLegend = player.is_legend === true;
                const isDisabled = disabledPlayerIds?.has(player.id) ?? false;
                const isMuted = mutedPlayerIds?.has(player.id) ?? false;
                // onRowClick overrides navigation (used by builder picker); blocked for disabled rows
                // Admin users navigate to /admin/players/[id]; everyone else to /players/[id]
                const profilePath = isAdmin ? `/admin/players/${player.id}` : `/players/${player.id}`;
                const handleRowClick = onRowClick
                  ? isDisabled ? undefined : () => onRowClick(player)
                  : isLegend
                  ? undefined
                  : (e: React.MouseEvent) => {
                      if (e.metaKey || e.ctrlKey) {
                        window.open(profilePath, "_blank");
                        return;
                      }
                      router.push(profilePath);
                    };
                const isHighlighted = highlightedPlayerId != null && highlightedPlayerId === player.id;
                return (
                  <PlayerRowView
                    key={player.id}
                    player={player}
                    columns={visibleColumns}
                    columnWidths={columnWidths}
                    disabled={isDisabled}
                    muted={isMuted}
                    highlighted={isHighlighted}
                    clickable={!!onRowClick}
                    legend={isLegend}
                    onDragStart={onRowDragStart && !isDisabled ? (event) => onRowDragStart(event, player) : undefined}
                    onClick={handleRowClick}
                    onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(event, player) : undefined}
                    onHover={onRowHover ? () => onRowHover(player) : undefined}
                    onHoverEnd={onRowHoverEnd}
                    onSkillContextMenu={handleSkillContextMenu}
                    onSkillOverrideEnabled={!!onSkillOverride}
                    renderCell={renderCell}
                  />
              );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div id="player-table-pagination" className="flex items-center justify-between text-xs text-muted-foreground">
        <span id="player-table-pagination-info">
          {totalCount === 0
            ? "No results"
            : `Showing ${startRow}–${endRow} of ${totalCount}`}
        </span>

        <div className="flex items-center gap-3">
          {/* Columns toggle — inline with pagination controls */}
          <div className="relative">
            <button
              id="player-table-columns-btn"
              type="button"
              onClick={() => setColumnsOpen((v) => !v)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Toggle column visibility"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Columns{hiddenColumns.size > 0 && <span className="text-amber-600"> ({hiddenColumns.size})</span>}
            </button>

            {columnsOpen && (
              <div id="player-table-columns-panel" className="absolute right-0 bottom-full mb-1 z-50 w-52 max-h-80 overflow-y-auto rounded-sm border border-border bg-background shadow-md p-2 space-y-1">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                  Toggle Columns
                </div>
                {ALL_COLUMNS.filter((col) => col.key !== "headshot").map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-1 py-0.5 rounded-sm hover:bg-muted cursor-pointer text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded-sm"
                    />
                    <span>{col.key === "name" ? "Name (locked)" : (SKILL_LABELS[col.key] ?? col.label)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Page size selector */}
          <label className="flex items-center gap-1">
            <span>Rows:</span>
            <select
              id="player-table-page-size"
              className="rounded border border-input bg-background px-1 py-0.5 text-foreground focus:outline-none"
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
            >
              {[8, 16, 32, 64].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          {/* Prev / page indicator / Next */}
          <div className="flex items-center gap-1">
            <button
              id="player-table-prev-btn"
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
            >
              ‹
            </button>
            <span id="player-table-page-indicator" className="tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              id="player-table-next-btn"
              type="button"
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* ── Skill tier context menu (right-click on skill cells) ── */}
      {contextMenu.open && (
        <>
          {/* Full-screen backdrop — clicking outside the menu closes it without
              interfering with the menu's own click handlers */}
          <div
            className="fixed inset-0 z-[9998]"
            onMouseDown={() => setContextMenu(CLOSED_MENU)}
          />
        <div
          id="player-table-context-menu"
          role="menu"
          aria-label={`Edit ${contextMenu.skillLabel} tier for ${contextMenu.playerName}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-[9999] w-48 rounded-lg border border-border bg-background shadow-lg py-1 text-xs"
        >
          {/* Header */}
          <div className="px-3 py-1.5 border-b border-border">
            <div className="font-semibold text-foreground truncate">{contextMenu.skillLabel}</div>
            <div className="text-muted-foreground truncate">{contextMenu.playerName}</div>
          </div>

          {/* Tier options */}
          <div className="py-1">
            {SKILL_TIERS.map((tier) => {
              const isCurrent = contextMenu.currentTier === tier ||
                (!contextMenu.currentTier && tier === "None");
              return (
                <button
                  key={tier}
                  type="button"
                  role="menuitem"
                  disabled={contextMenu.saving}
                  onClick={() => handleTierSelect(tier)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    TIER_CONTEXT_COLORS[tier],
                    isCurrent && TIER_CONTEXT_ACTIVE[tier],
                  )}
                >
                  {isCurrent && (
                    <span className="text-[10px]">✓</span>
                  )}
                  {!isCurrent && <span className="w-[14px]" />}
                  <span className="font-medium">{tier}</span>
                </button>
              );
            })}
          </div>

          {/* Loading overlay */}
          {contextMenu.saving && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70">
              <span className="text-muted-foreground">Saving…</span>
            </div>
          )}
        </div>
        </>
      )}
    </div>
  );
}
