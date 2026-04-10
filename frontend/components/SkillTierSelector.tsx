"use client";

import { cn } from "@/lib/utils";
import { SKILL_TIERS, TIER_SELECTOR_STYLES } from "@/lib/tiers";
import type { SkillTier } from "@/lib/types";

interface SkillTierSelectorProps {
  value: SkillTier;
  onChange: (tier: SkillTier) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Segmented control for selecting a skill tier.
 * Tier list and colors are defined centrally in lib/tiers.ts.
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
      className={cn("flex flex-wrap gap-1", className)}
      role="radiogroup"
      aria-label="Skill tier"
    >
      {SKILL_TIERS.map((tier) => {
        const isActive = value === tier;
        const styles = TIER_SELECTOR_STYLES[tier];
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={disabled}
            onClick={() => onChange(tier)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md border transition-colors",
              isActive ? styles.active : styles.base,
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {tier}
          </button>
        );
      })}
    </div>
  );
}
