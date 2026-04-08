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
import { cn } from "@/lib/utils";
import { SkillTierBadge } from "@/components/SkillTierBadge";
import { formatSalary, formatHeight, parseHeight, SKILL_LABELS } from "./playerFilters";
import { SKILL_TIERS, tierToNum, TIER_CONTEXT_COLORS, TIER_CONTEXT_ACTIVE } from "@/lib/tiers";
import type { SortKey } from "./SortControls";
import type { PlayerWithSkills } from "@/lib/types";
import type { SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// Developer-configurable constants
// ---------------------------------------------------------------------------

/** Default number of rows shown per page. */
export const DEFAULT_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const SKILL_ABBREV: Record<string, string> = {
  spot_up_shooter:         "Spot Up",
  off_dribble_shooter:     "Off Drib",
  offensive_rebounder:     "Off Reb",
  rebounder:               "Reb",
  rim_protector:           "Rim Prot",
  isolation_scorer:        "Iso",
  movement_shooter:        "Move Shoot",
  cutter:                  "Cutter",
  transition_threat:       "Trans",
  pnr_ball_handler:        "PnR BH",
  pnr_finisher:            "PnR Fin",
  crafty_finisher:         "Crafty",
  vertical_spacer:         "V-Space",
  screen_setter:           "Screener",
  passer:                  "Passer",
  mid_post_player:         "Mid Post",
  low_post_player:         "Lo Post",
  switchable_defender:     "Switch Def",
  point_of_attack_defender:"POA Def",
  high_flyer:              "Hi Fly",
};

// Ordered skill columns (mirrors SKILL_CATEGORIES in the player profile page)
const SKILL_COLUMN_KEYS = Object.keys(SKILL_ABBREV);

interface ColDef {
  key: string;
  label: string;
  defaultWidth: number;
  minWidth: number;
  sticky?: boolean;
}

// Non-skill columns (left side of table)
const META_COLUMNS: ColDef[] = [
  { key: "name",             label: "Name",     defaultWidth: 160, minWidth: 120, sticky: true },
  { key: "team",             label: "Team",     defaultWidth: 100, minWidth: 70 },
  { key: "position",        label: "Pos",      defaultWidth: 70,  minWidth: 50 },
  { key: "age",              label: "Age",      defaultWidth: 60,  minWidth: 50 },
  { key: "height",           label: "Ht",       defaultWidth: 70,  minWidth: 55 },
  { key: "weight",           label: "Wt",       defaultWidth: 70,  minWidth: 55 },
  { key: "salary",           label: "Salary",   defaultWidth: 90,  minWidth: 70 },
  { key: "elite_plus_count", label: "Elite+",   defaultWidth: 70,  minWidth: 55 },
];

const SKILL_COLUMNS: ColDef[] = SKILL_COLUMN_KEYS.map((key) => ({
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
// Helpers
// ---------------------------------------------------------------------------

function elitePlusCount(player: PlayerWithSkills): number {
  if (!player.skills) return 0;
  // >= 3 = Elite or better (Proficient=2, Elite=3, All-Time Great=4)
  return Object.values(player.skills).filter((t) => tierToNum(t) >= 3).length;
}

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
}: PlayerTableProps) {
  const router = useRouter();

  // Column widths — start from defaults
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c.defaultWidth])),
  );

  // Hidden columns — all visible by default
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
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
      if (!onSkillOverride) return; // feature disabled when prop is not provided
      e.preventDefault();
      e.stopPropagation();

      // Clamp position so the menu stays inside the viewport
      // (estimated menu size: 200px wide × 185px tall)
      const x = Math.min(e.clientX, window.innerWidth - 210);
      const y = Math.min(e.clientY, window.innerHeight - 195);

      const next = {
        open: true,
        x, y,
        playerId: player.id,
        playerName: player.name,
        skillKey,
        skillLabel: SKILL_LABELS[skillKey] ?? skillKey,
        currentTier: (player.skills?.[skillKey] as SkillTier) ?? undefined,
        saving: false,
      };
      console.log("[SkillMenu] opening context menu", next);
      setContextMenu(next);
    },
    [onSkillOverride],
  );

  // Called when the user picks a tier from the context menu
  const handleTierSelect = useCallback(
    async (tier: SkillTier) => {
      console.log("[SkillMenu] handleTierSelect called", { tier, contextMenu, hasOverride: !!onSkillOverride });
      if (!onSkillOverride) { console.warn("[SkillMenu] onSkillOverride is not set — aborting"); return; }
      if (contextMenu.saving) { console.warn("[SkillMenu] already saving — aborting"); return; }
      const { playerId, skillKey } = contextMenu;
      if (!playerId || !skillKey) { console.warn("[SkillMenu] empty playerId or skillKey — aborting", { playerId, skillKey }); return; }
      setContextMenu((prev) => ({ ...prev, saving: true }));
      try {
        console.log("[SkillMenu] calling onSkillOverride", { playerId, skillKey, tier });
        await onSkillOverride(playerId, skillKey, tier);
        console.log("[SkillMenu] onSkillOverride resolved OK");
      } catch (err) {
        console.error("[SkillMenu] onSkillOverride threw", err);
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
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Visible columns ──────────────────────────────────────────────────────

  const visibleColumns = ALL_COLUMNS.filter((c) => !hiddenColumns.has(c.key));

  // ── Cell renderers ───────────────────────────────────────────────────────

  const renderCell = (player: PlayerWithSkills, col: ColDef) => {
    switch (col.key) {
      case "name":
        return (
          <span className="font-medium text-foreground hover:underline">{player.name}</span>
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
        return <span className="tabular-nums">{formatSalary(player.salary)}</span>;
      case "elite_plus_count": {
        const count = elitePlusCount(player);
        return (
          <span className={cn("font-medium tabular-nums", count > 0 ? "text-emerald-700" : "text-muted-foreground")}>
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
    <div className="space-y-2">
      {/* Columns toggle button */}
      <div className="flex justify-end">
        <div className="relative">
          <button
            type="button"
            onClick={() => setColumnsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs rounded border border-input px-3 py-1.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            Columns {hiddenColumns.size > 0 && <span className="text-amber-600">({hiddenColumns.size} hidden)</span>}
          </button>

          {columnsOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-52 max-h-80 overflow-y-auto rounded-md border border-border bg-background shadow-md p-2 space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 px-1">
                Toggle Columns
              </div>
              {ALL_COLUMNS.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-muted cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(col.key)}
                    onChange={() => toggleColumn(col.key)}
                    className="rounded"
                  />
                  <span>{col.key === "name" ? "Name (locked)" : (SKILL_LABELS[col.key] ?? col.label)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table wrapper with horizontal scroll */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="border-collapse text-xs" style={{ tableLayout: "fixed", minWidth: "max-content" }}>
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
                      "cursor-pointer hover:bg-muted transition-colors",
                      isSorted && "text-foreground bg-muted",
                      col.sticky && "sticky left-0 z-20 bg-muted/60 border-r border-border",
                    )}
                    onClick={(e) => handleHeaderClick(e, col.key)}
                    title={`Sort by ${SKILL_LABELS[col.key] ?? col.label} (Shift+click for secondary sort)`}
                  >
                    <span className="truncate">{col.label}</span>
                    {getSortIndicator(col.key)}

                    {/* Resize handle — right edge of header */}
                    <span
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize group flex items-center justify-center"
                      onMouseDown={(e) => handleResizeMouseDown(e, col.key)}
                    >
                      <span className="h-4 w-px bg-border group-hover:bg-foreground/40 transition-colors" />
                    </span>
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
              players.map((player) => (
                <tr
                  key={player.id}
                  onClick={() => router.push(`/players/${player.id}`)}
                  className="border-b border-border hover:bg-muted/40 cursor-pointer transition-colors group"
                >
                  {visibleColumns.map((col) => {
                    const isSkillCol = SKILL_COLUMN_KEYS.includes(col.key);
                    return (
                      <td
                        key={col.key}
                        style={{ width: columnWidths[col.key] ?? col.defaultWidth }}
                        className={cn(
                          "px-2 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis",
                          col.sticky && "sticky left-0 z-10 bg-background group-hover:bg-muted border-r border-border transition-colors",
                          isSkillCol && onSkillOverride && "cursor-context-menu",
                        )}
                        onContextMenu={
                          isSkillCol
                            ? (e) => handleSkillContextMenu(e, player, col.key)
                            : undefined
                        }
                      >
                        {renderCell(player, col)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {totalCount === 0
            ? "No results"
            : `Showing ${startRow}–${endRow} of ${totalCount}`}
        </span>

        <div className="flex items-center gap-3">
          {/* Page size selector */}
          <label className="flex items-center gap-1">
            <span>Rows:</span>
            <select
              className="rounded border border-input bg-background px-1 py-0.5 text-foreground focus:outline-none"
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          {/* Prev / page indicator / Next */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="px-2 py-0.5 rounded border border-input disabled:opacity-40 hover:bg-muted transition-colors"
            >
              ‹
            </button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <button
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
