"use client";

/**
 * DiffTierDelta — renders old chip -> arrow -> new chip for a change row.
 *
 * Reuses TIER_BADGE_CLASSES from lib/tiers.ts for tier chip colors.
 * For "new" changes, old chip shows muted "none" text.
 */

import { cn } from "@/lib/utils";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";
import type { SkillTier } from "@/lib/types";

interface DiffTierDeltaProps {
  oldTier: string | null;
  newTier: string;
}

function TierChip({ tier, muted }: { tier: string; muted?: boolean }) {
  const badgeClass =
    TIER_BADGE_CLASSES[tier as SkillTier] ?? "bg-slate-100 text-slate-500 border border-slate-200";

  if (muted) {
    return (
      <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-400 italic">
        none
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded",
        badgeClass
      )}
    >
      {tier}
    </span>
  );
}

export function DiffTierDelta({ oldTier, newTier }: DiffTierDeltaProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {oldTier === null ? (
        <TierChip tier="none" muted />
      ) : (
        <TierChip tier={oldTier} />
      )}
      <span className="text-neutral-400 text-[10px] select-none" aria-hidden="true">
        &rarr;
      </span>
      <TierChip tier={newTier} />
    </span>
  );
}
