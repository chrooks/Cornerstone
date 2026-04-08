"use client";

import { cn } from "@/lib/utils";
import { TIER_BADGE_CLASSES } from "@/lib/tiers";
import type { SkillTier } from "@/lib/types";

interface SkillTierBadgeProps {
  tier: SkillTier;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Colored badge displaying a skill tier. Colors are defined centrally in lib/tiers.ts. */
export function SkillTierBadge({ tier, size = "md", className }: SkillTierBadgeProps) {
  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 rounded",
    md: "text-xs px-2 py-1 rounded-md",
    lg: "text-sm px-3 py-1 rounded-md font-medium",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium whitespace-nowrap",
        sizeClasses[size],
        TIER_BADGE_CLASSES[tier],
        className
      )}
    >
      {tier}
    </span>
  );
}
