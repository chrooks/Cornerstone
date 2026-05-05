/**
 * roster-utils.ts — Shared utilities for roster URL encoding and payload construction.
 *
 * Used by both BuilderPage (interactive editing) and EvaluatePage (read-only evaluation).
 * Single source of truth for how roster state maps to/from URL params and API payloads.
 */

import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { LegendDetail, PlayerWithSkills } from "@/lib/types";

// ---------------------------------------------------------------------------
// URL param helpers
// ---------------------------------------------------------------------------

/**
 * Reads all slot positions from URL params.
 * Supports two formats:
 *   New:    s1..s8 encode all slot positions (cornerstone at its actual slot)
 *   Legacy: cornerstone always in slot 1, s2..s8 for the player slots
 */
export function readSlotsFromParams(
  params: URLSearchParams,
  cornerstoneId: string | null,
  playerMap: Map<string, PlayerWithSkills>,
): (PlayerWithSkills | null)[] {
  const slots: (PlayerWithSkills | null)[] = Array(MAX_ROSTER_SLOTS).fill(null);

  if (params.has("s1")) {
    // New format: all slots explicitly encoded as s1..sN
    for (let i = 1; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = playerMap.get(id) ?? null;
    }
  } else {
    // Legacy format: cornerstone implicit in slot 1, players in s2..sN
    if (cornerstoneId) slots[0] = playerMap.get(cornerstoneId) ?? null;
    for (let i = 2; i <= MAX_ROSTER_SLOTS; i++) {
      const id = params.get(`s${i}`);
      if (id) slots[i - 1] = playerMap.get(id) ?? null;
    }
  }

  return slots;
}

/** Serializes the full slot lineup to URL params (new s1..sN format). */
export function buildSlotsParams(
  cornerstoneId: string | null,
  allSlots: (PlayerWithSkills | null)[],
): URLSearchParams {
  const params = new URLSearchParams();
  if (cornerstoneId) params.set("cornerstone", cornerstoneId);
  allSlots.forEach((p, i) => {
    if (p) params.set(`s${i + 1}`, p.id);
  });
  return params;
}

// ---------------------------------------------------------------------------
// API payload construction
// ---------------------------------------------------------------------------

/**
 * Build the player payload for POST /api/builder/evaluate.
 *
 * The cornerstone legend gets slot=0, is_cornerstone=true.
 * Supporting players from allSlots get slot=index+1, is_cornerstone=false.
 * Legend entries in allSlots are skipped (the legend is represented by legendDetail).
 */
export function buildPlayerPayload(
  allSlots: (PlayerWithSkills | null)[],
  legendDetail: LegendDetail,
) {
  const result: Array<{
    name: string;
    slot: number;
    is_cornerstone: boolean;
    height: string | null;
    skills: Record<string, string>;
  }> = [];

  // Cornerstone legend always goes as slot=0, is_cornerstone=true
  result.push({
    name: legendDetail.name,
    slot: 0,
    is_cornerstone: true,
    height: legendDetail.height,
    skills: Object.fromEntries(
      Object.entries(legendDetail.profile).map(([k, v]) => [k, v ?? "None"]),
    ),
  });

  // Supporting players from allSlots (0-indexed in array → slot = index + 1)
  allSlots.forEach((p, index) => {
    if (p === null || p.is_legend) return;
    result.push({
      name: p.name,
      slot: index + 1,
      is_cornerstone: false,
      height: p.height,
      skills: (p.skills ?? {}) as Record<string, string>,
    });
  });

  return result;
}
