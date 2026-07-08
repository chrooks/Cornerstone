/**
 * tiers.ts — Single source of truth for skill tier ordering and styling.
 *
 * Add a new tier here and all UI components pick it up automatically.
 * Import from this file instead of defining tier arrays or color maps locally.
 */

import type { SkillTier } from "./types";

/** All skill tiers ordered highest to lowest. */
export const SKILL_TIERS: SkillTier[] = [
  "All-Time Great",
  "Elite",
  "Proficient",
  "Capable",
  "None",
];

/** Convert a tier to a numeric rank for sorting/comparison (higher = better tier). */
export function tierToNum(tier: string | null | undefined): number {
  switch (tier) {
    case "All-Time Great": return 4;
    case "Elite":          return 3;
    case "Proficient":     return 2;
    case "Capable":        return 1;
    default:               return 0; // "None" or missing
  }
}

/** Tailwind classes for SkillTierBadge. */
export const TIER_BADGE_CLASSES: Record<SkillTier, string> = {
  "All-Time Great": "bg-violet-100 text-violet-800 border border-violet-300",
  Elite:            "bg-emerald-100 text-emerald-800 border border-emerald-200",
  Proficient:       "bg-sky-100 text-sky-800 border border-sky-200",
  Capable:          "bg-amber-100 text-amber-800 border border-amber-200",
  None:             "bg-slate-100 text-slate-500 border border-slate-200",
};

/** Base and active Tailwind classes for segmented tier selector buttons (SkillTierSelector, legends page). */
export const TIER_SELECTOR_STYLES: Record<SkillTier, { base: string; active: string }> = {
  "All-Time Great": {
    base:   "border-violet-200 text-violet-700 hover:bg-violet-50",
    active: "bg-violet-100 border-violet-400 text-violet-800 font-semibold",
  },
  Elite: {
    base:   "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    active: "bg-emerald-100 border-emerald-400 text-emerald-800 font-semibold",
  },
  Proficient: {
    base:   "border-sky-200 text-sky-700 hover:bg-sky-50",
    active: "bg-sky-100 border-sky-400 text-sky-800 font-semibold",
  },
  Capable: {
    base:   "border-amber-200 text-amber-700 hover:bg-amber-50",
    active: "bg-amber-100 border-amber-400 text-amber-800 font-semibold",
  },
  None: {
    base:   "border-slate-200 text-slate-500 hover:bg-slate-50",
    active: "bg-slate-100 border-slate-400 text-slate-700 font-semibold",
  },
};

/** Active class for inline tier picker buttons (player detail page, review page). */
export const TIER_PICKER_ACTIVE_CLASS: Record<SkillTier, string> = {
  "All-Time Great": "bg-violet-100 border-violet-300 text-violet-800",
  Elite:            "bg-emerald-100 border-emerald-300 text-emerald-800",
  Proficient:       "bg-sky-100 border-sky-300 text-sky-800",
  Capable:          "bg-amber-100 border-amber-300 text-amber-800",
  None:             "bg-slate-100 border-slate-300 text-slate-700",
};

/** Text-only classes for inline tier-colored labels (#105: ledger skill labels). */
export const TIER_TEXT_CLASSES: Record<SkillTier, string> = {
  "All-Time Great": "text-violet-700",
  Elite:            "text-emerald-700",
  Proficient:       "text-sky-700",
  Capable:          "text-amber-700",
  None:             "text-slate-500",
};

/** Text and hover classes for right-click context menu tier items (PlayerTable). */
export const TIER_CONTEXT_COLORS: Record<SkillTier, string> = {
  "All-Time Great": "text-violet-800 hover:bg-violet-50",
  Elite:            "text-emerald-800 hover:bg-emerald-50",
  Proficient:       "text-sky-700 hover:bg-sky-50",
  Capable:          "text-amber-800 hover:bg-amber-50",
  None:             "text-slate-500 hover:bg-slate-50",
};

/** Active/selected background for right-click context menu tier items (PlayerTable). */
export const TIER_CONTEXT_ACTIVE: Record<SkillTier, string> = {
  "All-Time Great": "bg-violet-100 ring-1 ring-violet-300",
  Elite:            "bg-emerald-100 ring-1 ring-emerald-200",
  Proficient:       "bg-sky-100 ring-1 ring-sky-200",
  Capable:          "bg-amber-100 ring-1 ring-amber-200",
  None:             "bg-slate-100 ring-1 ring-slate-200",
};
