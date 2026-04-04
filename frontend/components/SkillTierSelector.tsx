"use client";

import { cn } from "@/lib/utils";
import type { SkillTier } from "@/lib/types";

interface SkillTierSelectorProps {
  value: SkillTier;
  onChange: (tier: SkillTier) => void;
  disabled?: boolean;
  className?: string;
}

const TIERS: SkillTier[] = ["All-Time Great", "Elite", "Capable", "None"];

const tierStyles: Record<SkillTier, { base: string; active: string }> = {
  "All-Time Great": {
    base: "border-violet-200 text-violet-700 hover:bg-violet-50",
    active: "bg-violet-100 border-violet-400 text-violet-800 font-semibold",
  },
  Elite: {
    base: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    active: "bg-emerald-100 border-emerald-400 text-emerald-800 font-semibold",
  },
  Capable: {
    base: "border-amber-200 text-amber-700 hover:bg-amber-50",
    active: "bg-amber-100 border-amber-400 text-amber-800 font-semibold",
  },
  None: {
    base: "border-slate-200 text-slate-500 hover:bg-slate-50",
    active: "bg-slate-100 border-slate-400 text-slate-700 font-semibold",
  },
};

/**
 * Three-segment control for selecting a skill tier (None / Capable / Elite).
 * Reused in the calibration anchor form, review panel overrides, and legends editor.
 */
export function SkillTierSelector({
  value,
  onChange,
  disabled = false,
  className,
}: SkillTierSelectorProps) {
  return (
    <div
      className={cn("inline-flex rounded-md border border-border overflow-hidden", className)}
      role="radiogroup"
      aria-label="Skill tier"
    >
      {TIERS.map((tier, i) => {
        const isActive = value === tier;
        const styles = tierStyles[tier];
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(tier)}
            className={cn(
              "px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors",
              isActive ? styles.active : styles.base,
              disabled && "opacity-50 cursor-not-allowed",
              i === 0 && "rounded-l-md",
              i === TIERS.length - 1 && "rounded-r-md"
            )}
          >
            {tier}
          </button>
        );
      })}
    </div>
  );
}
