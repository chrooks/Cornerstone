/**
 * diffColors.ts — Semantic colors for diff change types.
 *
 * These are WARM-FAMILY semantic colors intentionally distinct from the tier
 * palette (emerald/amber/violet). They apply to counts, bar segments, labels,
 * and icons only — never to tier chip backgrounds.
 *
 * Tier chips always use TIER_BADGE_CLASSES from lib/tiers.ts.
 */

import type { DiffChangeType } from "@/lib/types";

/** Hex values for change-type semantics (counts, bars, text badges). */
export const DIFF_CHANGE_COLORS: Record<DiffChangeType, string> = {
  /** Promotions: green-700 — positive movement */
  promotion: "#15803d",
  /** Demotions: red-700 — negative movement */
  demotion: "#b91c1c",
  /** New: heat-check orange — first appearance */
  new: "#fe6d34",
};

/** Tailwind text color classes for change-type labels and counts. */
export const DIFF_CHANGE_TEXT_CLASSES: Record<DiffChangeType, string> = {
  promotion: "text-green-700",
  demotion: "text-red-700",
  new: "text-[#fe6d34]",
};

/** Sign glyph + label so color is never the sole signal (WCAG AA). */
export const DIFF_CHANGE_LABEL: Record<DiffChangeType, { glyph: string; label: string }> = {
  promotion: { glyph: "+", label: "Promotion" },
  demotion: { glyph: "-", label: "Demotion" },
  new: { glyph: "•", label: "New" },
};
