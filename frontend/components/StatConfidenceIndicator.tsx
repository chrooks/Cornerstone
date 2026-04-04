"use client";

import { cn } from "@/lib/utils";
import type { StatConfidence } from "@/lib/types";

interface StatConfidenceIndicatorProps {
  confidence: StatConfidence;
  showLabel?: boolean;
  className?: string;
}

const confidenceConfig: Record<StatConfidence, { color: string; label: string; title: string }> = {
  high: {
    color: "bg-emerald-500",
    label: "High",
    title: "High confidence — well-sampled stats with strong signal",
  },
  moderate: {
    color: "bg-amber-400",
    label: "Moderate",
    title: "Moderate confidence — stats may be thin or volatile",
  },
  low: {
    color: "bg-red-400",
    label: "Low",
    title: "Low confidence — limited sample or noisy underlying stats",
  },
};

/**
 * Small dot with tooltip indicating the reliability of the underlying stats.
 * Used in skill profile cards and the review panel.
 */
export function StatConfidenceIndicator({
  confidence,
  showLabel = false,
  className,
}: StatConfidenceIndicatorProps) {
  const config = confidenceConfig[confidence];

  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      title={config.title}
    >
      <span
        className={cn("inline-block size-2 rounded-full flex-shrink-0", config.color)}
        aria-label={`${config.label} confidence`}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground">{config.label}</span>
      )}
    </span>
  );
}
