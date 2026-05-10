"use client";

import { cn } from "@/lib/utils";

export interface CohesionScoreBreakdownItem {
  label: string;
  value: number;
}

interface CohesionScoreBadgeProps {
  id: string;
  value: number;
  ariaLabel: string;
  breakdown?: CohesionScoreBreakdownItem[];
  tooltipTitle?: string;
  precision?: number;
  featured?: boolean;
  className?: string;
}

export function CohesionScoreBadge({
  id,
  value,
  ariaLabel,
  breakdown = [],
  tooltipTitle = "Score breakdown",
  precision = 1,
  featured = false,
  className,
}: CohesionScoreBadgeProps) {
  const starFillPct = Math.min(100, Math.max(0, (value / 5) * 100));
  const tooltipId = `${id}-tooltip`;

  return (
    <div id={id} className={cn("group/cohesion-score relative inline-flex justify-end", className)}>
      <button
        id={`${id}-btn`}
        type="button"
        className={cn(
          "rounded-sm border px-3 py-2 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(0.74_0.16_55)]",
          featured
            ? "border-[oklch(0.78_0.08_62)] bg-[oklch(0.91_0.06_64)] hover:bg-[oklch(0.88_0.075_64)]"
            : "border-transparent hover:border-[oklch(0.83_0.02_62)] hover:bg-[oklch(0.94_0.035_64)]"
        )}
        aria-describedby={breakdown.length > 0 ? tooltipId : undefined}
        aria-label={ariaLabel}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "relative block font-mono leading-none tracking-[0.08em]",
              featured ? "text-2xl" : "text-xl"
            )}
          >
            <span className="text-[oklch(0.76_0.025_62)]">★★★★★</span>
            <span
              className="absolute inset-y-0 left-0 overflow-hidden whitespace-nowrap text-[oklch(0.54_0.16_58)]"
              style={{ width: `${starFillPct}%` }}
            >
              ★★★★★
            </span>
          </span>
          <span className="font-mono text-lg leading-none tabular-nums text-[oklch(0.16_0.018_45)]">
            {value.toFixed(precision)}
          </span>
        </span>
      </button>

      {breakdown.length > 0 && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-56 translate-y-1 rounded-md border border-[oklch(0.76_0.04_62)] bg-[oklch(0.985_0.005_62)] p-3 text-left opacity-0 shadow-[0_4px_16px_rgba(14,9,7,0.08),0_1px_4px_rgba(14,9,7,0.04)] transition duration-150 group-hover/cohesion-score:translate-y-0 group-hover/cohesion-score:opacity-100 group-focus-within/cohesion-score:translate-y-0 group-focus-within/cohesion-score:opacity-100"
        >
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[oklch(0.49_0.02_45)]">{tooltipTitle}</p>
          <dl className="mt-2 grid gap-1.5">
            {breakdown.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3">
                <dt className="text-xs text-[oklch(0.36_0.02_45)]">{item.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-[oklch(0.16_0.018_45)]">{item.value.toFixed(1)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
