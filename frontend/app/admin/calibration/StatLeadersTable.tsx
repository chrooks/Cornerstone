"use client";

/**
 * StatLeadersTable.tsx — Scrollable stat leaders table for the calibration panel.
 *
 * Column structure (left → right):
 *   1. Name      — sticky at left: 0, 160px wide
 *   2. Pos       — sticky at left: 160px, 56px wide
 *   3. Team      — sticky at left: 216px, 56px wide
 *   4. Active-skill stat columns (amber-tinted header, sticky, accumulating left offset)
 *   5. Remaining stat columns grouped by section (not sticky)
 *
 * Cells in active-skill columns are color-coded by whether the player meets
 * the Elite / Proficient / Capable threshold for that stat.
 */

import React, { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { PlayerStatRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatSortKey {
  key: string;
  dir: "asc" | "desc";
}

/** Threshold conditions for one stat at one tier level */
interface TierConditions {
  op: string;
  value: number;
}

/** For each stat key, per-tier condition arrays */
export type ThresholdMap = Record<string, Record<string, TierConditions[]>>;

/**
 * A computed stat definition from the active skill's rule.
 * e.g. passer_composite = potential_assists * 1 + secondary_assists * 1.5
 */
export interface ComputedStatDef {
  name: string;
  formula: "sum";
  components: Array<{ stat: string; weight: number }>;
}

interface StatLeadersTableProps {
  players: PlayerStatRow[];
  /** Full ordered list of stat column keys (all sections) */
  allStatKeys: string[];
  /** Stat keys used by the active skill — these become pinned columns */
  activeSkillStatKeys: Set<string>;
  /** Per-stat per-tier threshold conditions for the active skill */
  thresholdMap: ThresholdMap;
  /** Computed stat definitions from the active skill rule (e.g. passer_composite) */
  computedStatDefs: ComputedStatDef[];
  /** When true, use stabilized values (falling back to raw when absent) */
  showStabilized: boolean;
  /** Active sort keys (max 3) */
  sortKeys: StatSortKey[];
  /** Called when a column header is clicked; additive = shift was held */
  onHeaderClick: (key: string, additive: boolean) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Background color classes for tier-matched cells */
const TIER_CELL_BG: Record<string, string> = {
  Elite:      "bg-emerald-200",
  Proficient: "bg-sky-200",
  Capable:    "bg-amber-200",
};

/** Fixed pixel widths for the three sticky identity columns */
const NAME_WIDTH  = 160;
const POS_WIDTH   = 56;
const TEAM_WIDTH  = 56;
/** Width of each stat column */
const STAT_COL_W  = 80;

/** Left offsets for the three identity sticky columns */
const NAME_LEFT   = 0;
const POS_LEFT    = NAME_WIDTH;
const TEAM_LEFT   = NAME_WIDTH + POS_WIDTH;
/** Active-skill stat columns start immediately after team */
const PINNED_START = NAME_WIDTH + POS_WIDTH + TEAM_WIDTH;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Evaluate a single comparison operator. */
function evalOp(val: number, op: string, threshold: number): boolean {
  switch (op) {
    case ">=": return val >= threshold;
    case "<=": return val <= threshold;
    case ">":  return val > threshold;
    case "<":  return val < threshold;
    case "==": return val === threshold;
    default:   return false;
  }
}

/**
 * Determine which tier (if any) a value meets for a given stat key.
 * Checks Elite → Proficient → Capable in order; returns the first match.
 * A tier only "matches" if it has conditions AND the player meets all of them.
 */
function getCellTier(
  value: number | null,
  key: string,
  thresholdMap: ThresholdMap,
): "Elite" | "Proficient" | "Capable" | null {
  if (value === null || value === undefined) return null;
  for (const tier of ["Elite", "Proficient", "Capable"] as const) {
    const conds = thresholdMap[key]?.[tier] ?? [];
    if (conds.length > 0 && conds.every((c) => evalOp(value, c.op, c.value))) {
      return tier;
    }
  }
  return null;
}

/** Text color classes for the player name based on their overall skill tier. */
const TIER_NAME_COLOR: Record<string, string> = {
  Elite:      "text-emerald-700 font-semibold",
  Proficient: "text-sky-700 font-semibold",
  Capable:    "text-amber-700 font-semibold",
};

/**
 * Resolve a stat value for a player, handling "computed.*" keys by deriving
 * the value from the provided computed stat definitions.
 */
function resolveValue(
  player: PlayerStatRow,
  key: string,
  showStabilized: boolean,
  computedDefs: ComputedStatDef[],
): number | null {
  if (key.startsWith("computed.")) {
    const name = key.slice("computed.".length);
    const def = computedDefs.find((d) => d.name === name);
    if (!def) return null;
    let total = 0;
    for (const { stat, weight } of def.components) {
      const raw = player.stats[stat] ?? null;
      const v = showStabilized ? (player.stabilized[stat] ?? raw) : raw;
      if (v === null) return null;
      total += v * weight;
    }
    return total;
  }
  const raw = player.stats[key] ?? null;
  return showStabilized ? (player.stabilized[key] ?? raw) : raw;
}

/**
 * Estimate a player's overall tier for the active skill by checking whether
 * they satisfy the collected conditions for EVERY stat in each tier block.
 * This is an AND-based approximation — OR groups may cause under-reporting,
 * but it's a good-enough visual signal for calibration purposes.
 * Checks Elite → Proficient → Capable; returns the first full match.
 */
function getPlayerSkillTier(
  player: PlayerStatRow,
  thresholdMap: ThresholdMap,
  showStabilized: boolean,
  computedDefs: ComputedStatDef[],
): "Elite" | "Proficient" | "Capable" | null {
  for (const tier of ["Elite", "Proficient", "Capable"] as const) {
    // Collect every stat key that has conditions recorded for this tier
    const statKeys = Object.keys(thresholdMap).filter(
      (k) => (thresholdMap[k][tier]?.length ?? 0) > 0,
    );
    if (statKeys.length === 0) continue;

    // Player must satisfy ALL per-stat conditions for this tier
    const allPass = statKeys.every((key) => {
      const val = resolveValue(player, key, showStabilized, computedDefs);
      const conds = thresholdMap[key][tier] ?? [];
      return val !== null && conds.every((c) => evalOp(val, c.op, c.value));
    });

    if (allPass) return tier;
  }
  return null;
}

/**
 * Format a raw stat value for display.
 * - Percentage keys (_pct, _freq): multiply by 100, show 1 decimal + "%"
 * - Null / undefined: "—"
 * - Others: 2 decimal places
 */
function formatStatValue(key: string, value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const isPercent = key.endsWith("_pct") || key.endsWith("_freq");
  if (isPercent) return (value * 100).toFixed(1) + "%";
  return value.toFixed(2);
}

/**
 * Extract the section name from a "section.key" stat key.
 * Falls back to the full key if no dot is present.
 */
function getSection(statKey: string): string {
  const dotIdx = statKey.indexOf(".");
  return dotIdx >= 0 ? statKey.slice(0, dotIdx) : statKey;
}

/**
 * Human-readable label for a section name.
 * Converts snake_case to Title Case Words.
 */
function formatSection(section: string): string {
  return section
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Human-readable label for a stat key's leaf part.
 * Converts "box_score.pts" → "Pts", "play_type.isolation_ppp" → "Isolation Ppp"
 */
function formatStatKey(key: string): string {
  const leaf = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key;
  return leaf
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// StatLeadersTable
// ---------------------------------------------------------------------------

export function StatLeadersTable({
  players,
  allStatKeys,
  activeSkillStatKeys,
  thresholdMap,
  computedStatDefs,
  showStabilized,
  sortKeys,
  onHeaderClick,
}: StatLeadersTableProps) {
  // Split stat keys into pinned (active-skill) and the rest
  const pinnedKeys = useMemo(
    () => allStatKeys.filter((k) => activeSkillStatKeys.has(k)),
    [allStatKeys, activeSkillStatKeys],
  );
  const remainingKeys = useMemo(
    () => allStatKeys.filter((k) => !activeSkillStatKeys.has(k)),
    [allStatKeys, activeSkillStatKeys],
  );

  // Group remaining keys by their section for section header rows
  const remainingSections = useMemo(() => {
    const sectionsMap: Map<string, string[]> = new Map();
    for (const key of remainingKeys) {
      const section = getSection(key);
      if (!sectionsMap.has(section)) sectionsMap.set(section, []);
      sectionsMap.get(section)!.push(key);
    }
    return Array.from(sectionsMap.entries());
  }, [remainingKeys]);

  // Build a quick lookup: stat key → sort order index (for header indicator)
  const sortKeyIndex = useMemo(() => {
    const map: Record<string, number> = {};
    sortKeys.forEach((sk, i) => { map[sk.key] = i; });
    return map;
  }, [sortKeys]);

  // Build a lookup for direction by key
  const sortKeyDir = useMemo(() => {
    const map: Record<string, "asc" | "desc"> = {};
    sortKeys.forEach((sk) => { map[sk.key] = sk.dir; });
    return map;
  }, [sortKeys]);

  // Get the effective (possibly stabilized) value for a player/key combo.
  // For "computed.*" keys, derive the value on the fly from computedStatDefs
  // since these are never stored in player_stats (they're calculated by the skill engine).
  const getValue = (player: PlayerStatRow, key: string): number | null => {
    if (key.startsWith("computed.")) {
      const name = key.slice("computed.".length);
      const def = computedStatDefs.find((d) => d.name === name);
      if (!def) return null;
      // Only "sum" formula supported — sum weighted component stats
      let total = 0;
      for (const { stat, weight } of def.components) {
        const raw = player.stats[stat] ?? null;
        const compVal = showStabilized ? (player.stabilized[stat] ?? raw) : raw;
        if (compVal === null) return null; // missing component → can't compute
        total += compVal * weight;
      }
      return total;
    }
    if (showStabilized && player.stabilized[key] !== undefined) {
      return player.stabilized[key];
    }
    return player.stats[key] ?? null;
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  /** Render the sort indicator for a column header. */
  const renderSortIndicator = (key: string) => {
    const idx = sortKeyIndex[key];
    if (idx === undefined) return null;
    const dir = sortKeyDir[key];
    const arrow = dir === "asc" ? "▲" : "▼";
    return (
      <span className="ml-0.5 font-normal text-primary">
        {/* Show index superscript when multiple sort keys are active */}
        {sortKeys.length > 1 && (
          <sup className="text-[8px] mr-0.5">{idx + 1}</sup>
        )}
        {arrow}
      </span>
    );
  };

  /** Shared header cell click handler — passes shift key state up. */
  const handleHeaderClick = (e: React.MouseEvent, key: string) => {
    onHeaderClick(key, e.shiftKey);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (players.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No players loaded.
      </div>
    );
  }

  return (
    /*
     * Outer div: overflow-auto so the table scrolls both horizontally and
     * vertically while the sticky columns remain anchored.
     * border-spacing: 0 + border-collapse: separate keeps sticky borders clean.
     */
    <div className="overflow-auto h-full w-full">
      <table
        className="text-xs border-separate"
        style={{ borderSpacing: 0, minWidth: "100%" }}
      >
        <thead className="sticky top-0 z-20">
          {/* Section group header row */}
          <tr>
            {/* Identity column group header — empty */}
            <th
              colSpan={3}
              className="sticky bg-background border-b border-border"
              style={{ left: NAME_LEFT, zIndex: 30 }}
            />
            {/* Active-skill columns: no section header — they come first without one */}
            {pinnedKeys.map((key, idx) => (
              <th
                key={key}
                className="text-[10px] font-semibold text-amber-700 bg-muted border-b border-border border-l border-border px-1 py-0.5 text-center whitespace-nowrap sticky"
                style={{
                  left: PINNED_START + idx * STAT_COL_W,
                  zIndex: 25,
                  width: STAT_COL_W,
                  minWidth: STAT_COL_W,
                }}
              >
                {/* Label first pinned column with "Active Skill"; rest blank */}
                {idx === 0 ? "Active Skill" : ""}
              </th>
            ))}
            {/* Remaining columns grouped by section */}
            {remainingSections.map(([section, keys]) => (
              <th
                key={section}
                colSpan={keys.length}
                className="text-[10px] font-semibold text-muted-foreground bg-background border-b border-border border-l border-border px-1 py-0.5 text-center whitespace-nowrap"
                style={{ width: keys.length * STAT_COL_W }}
              >
                {formatSection(section)}
              </th>
            ))}
          </tr>

          {/* Column header row */}
          <tr>
            {/* Name — sticky at left: 0 */}
            <th
              className="sticky bg-background border-b border-border border-r border-border px-2 py-1 text-left font-semibold text-foreground whitespace-nowrap"
              style={{ left: NAME_LEFT, zIndex: 30, width: NAME_WIDTH, minWidth: NAME_WIDTH }}
            >
              Name
            </th>
            {/* Pos */}
            <th
              className="sticky bg-background border-b border-border border-r border-border px-1 py-1 text-center font-semibold text-foreground whitespace-nowrap"
              style={{ left: POS_LEFT, zIndex: 30, width: POS_WIDTH, minWidth: POS_WIDTH }}
            >
              Pos
            </th>
            {/* Team */}
            <th
              className="sticky bg-background border-b border-border border-r border-border px-1 py-1 text-center font-semibold text-foreground whitespace-nowrap"
              style={{ left: TEAM_LEFT, zIndex: 30, width: TEAM_WIDTH, minWidth: TEAM_WIDTH }}
            >
              Team
            </th>
            {/* Active-skill stat columns — sticky with amber tint */}
            {pinnedKeys.map((key, idx) => (
              <th
                key={key}
                onClick={(e) => handleHeaderClick(e, key)}
                title={key}
                className="sticky bg-muted border-b border-border border-l border-border px-1 py-1 text-center font-semibold text-muted-foreground whitespace-nowrap cursor-pointer hover:bg-muted/80 transition-colors select-none"
                style={{
                  left: PINNED_START + idx * STAT_COL_W,
                  zIndex: 25,
                  width: STAT_COL_W,
                  minWidth: STAT_COL_W,
                }}
              >
                <span className="truncate block max-w-[72px] mx-auto text-center">
                  {formatStatKey(key)}
                </span>
                {renderSortIndicator(key)}
              </th>
            ))}
            {/* Remaining stat columns */}
            {remainingKeys.map((key) => (
              <th
                key={key}
                onClick={(e) => handleHeaderClick(e, key)}
                title={key}
                className="bg-background border-b border-border border-l border-border px-1 py-1 text-center font-semibold text-foreground whitespace-nowrap cursor-pointer hover:bg-muted transition-colors select-none"
                style={{ width: STAT_COL_W, minWidth: STAT_COL_W }}
              >
                <span className="truncate block max-w-[72px] mx-auto text-center">
                  {formatStatKey(key)}
                </span>
                {renderSortIndicator(key)}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {players.map((player, rowIdx) => {
            // Compute the player's estimated overall tier for the active skill
            // so we can color their name row accordingly
            const playerTier = getPlayerSkillTier(player, thresholdMap, showStabilized, computedStatDefs);
            return (
            <tr
              key={player.id}
              className={cn(
                "group",
                rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
                "hover:bg-muted/40 transition-colors",
              )}
            >
              {/* Name — sticky; colored by the player's estimated tier for the active skill */}
              <td
                className={cn(
                  "sticky border-b border-border border-r border-border px-2 py-0.5 whitespace-nowrap overflow-hidden",
                  rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
                  playerTier ? TIER_NAME_COLOR[playerTier] : "font-medium text-foreground",
                )}
                style={{ left: NAME_LEFT, zIndex: 10, width: NAME_WIDTH, minWidth: NAME_WIDTH, maxWidth: NAME_WIDTH }}
              >
                <span className="block truncate" title={player.name}>
                  {player.name}
                </span>
              </td>
              {/* Position — sticky */}
              <td
                className={cn(
                  "sticky border-b border-border border-r border-border px-1 py-0.5 text-center text-muted-foreground whitespace-nowrap",
                  rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
                )}
                style={{ left: POS_LEFT, zIndex: 10, width: POS_WIDTH, minWidth: POS_WIDTH }}
              >
                {player.position ?? "—"}
              </td>
              {/* Team — sticky */}
              <td
                className={cn(
                  "sticky border-b border-border border-r border-border px-1 py-0.5 text-center text-muted-foreground whitespace-nowrap",
                  rowIdx % 2 === 0 ? "bg-background" : "bg-muted/20",
                )}
                style={{ left: TEAM_LEFT, zIndex: 10, width: TEAM_WIDTH, minWidth: TEAM_WIDTH }}
              >
                {player.team ?? "—"}
              </td>
              {/* Active-skill stat cells — color-coded by tier; always opaque so scrolled columns don't show through */}
              {pinnedKeys.map((key, idx) => {
                const val = getValue(player, key);
                const tier = getCellTier(val, key, thresholdMap);
                return (
                  <td
                    key={key}
                    className={cn(
                      "sticky border-b border-border border-l border-border/60 px-1 py-0.5 text-right font-mono whitespace-nowrap",
                      tier ? TIER_CELL_BG[tier] : "bg-muted",
                    )}
                    style={{
                      left: PINNED_START + idx * STAT_COL_W,
                      zIndex: 10,
                      width: STAT_COL_W,
                      minWidth: STAT_COL_W,
                    }}
                  >
                    {formatStatValue(key, val)}
                  </td>
                );
              })}
              {/* Remaining stat cells — no color coding, no stickiness */}
              {remainingKeys.map((key) => {
                const val = getValue(player, key);
                return (
                  <td
                    key={key}
                    className="border-b border-border border-l border-border/40 px-1 py-0.5 text-right font-mono text-muted-foreground whitespace-nowrap"
                    style={{ width: STAT_COL_W, minWidth: STAT_COL_W }}
                  >
                    {formatStatValue(key, val)}
                  </td>
                );
              })}
            </tr>
          );
          })}
        </tbody>
      </table>
    </div>
  );
}
