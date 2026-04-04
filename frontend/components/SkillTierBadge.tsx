"use client";

import { cn } from "@/lib/utils";
import type { SkillTier } from "@/lib/types";

interface SkillTierBadgeProps {
  tier: SkillTier;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Colored badge displaying a skill tier: violet=All-Time Great, green=Elite, yellow=Capable, muted=None. */
export function SkillTierBadge({ tier, size = "md", className }: SkillTierBadgeProps) {
  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 rounded",
    md: "text-xs px-2 py-1 rounded-md",
    lg: "text-sm px-3 py-1 rounded-md font-medium",
  };

  const tierClasses: Record<SkillTier, string> = {
    "All-Time Great": "bg-violet-100 text-violet-800 border border-violet-300",
    Elite: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    Capable: "bg-amber-100 text-amber-800 border border-amber-200",
    None: "bg-slate-100 text-slate-500 border border-slate-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium whitespace-nowrap",
        sizeClasses[size],
        tierClasses[tier],
        className
      )}
    >
      {tier}
    </span>
  );
}
