/**
 * diffLogic.ts — Pure helpers for diff preview math and filtering.
 *
 * Extracted so they can be unit-tested without mounting React components.
 */

import type { RunDiffChange, RunDiffPerSkill } from "@/lib/types";

/** Maximum rows rendered in the drill-down table before a "Show more" footer. */
export const VISIBLE_CAP = 250;

/** Proportional widths for the summary bar segments (0-1 each). Unchanged excluded. */
export interface BarSegments {
  promotions: number;
  demotions: number;
  new: number;
}

/**
 * Compute proportional bar segment widths for a per-skill summary row.
 * Denominator is promotions + demotions + new (unchanged excluded from bar).
 * Returns zeros when total changed is zero.
 */
export function calcBarSegments(perSkill: RunDiffPerSkill): BarSegments {
  const total = perSkill.promotions + perSkill.demotions + perSkill.new;
  if (total === 0) {
    return { promotions: 0, demotions: 0, new: 0 };
  }
  return {
    promotions: perSkill.promotions / total,
    demotions: perSkill.demotions / total,
    new: perSkill.new / total,
  };
}

export interface DrilldownFilters {
  skill?: string;
  changeType?: string;
  /** Case-insensitive contains-match against player name (falls back to id). */
  playerQuery?: string;
}

/**
 * Filter drill-down changes by optional skill, change_type, and player query.
 * All filters are additive (AND). The player query matches the display name
 * (and player_id as a fallback) case-insensitively.
 */
export function applyDrilldownFilters(
  changes: RunDiffChange[],
  filters: DrilldownFilters
): RunDiffChange[] {
  const query = filters.playerQuery?.toLowerCase() ?? "";
  return changes.filter((c) => {
    if (filters.skill && c.skill_name !== filters.skill) return false;
    if (filters.changeType && c.change_type !== filters.changeType) return false;
    if (query.length > 0) {
      const haystack = `${c.player_name ?? ""} ${c.player_id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
