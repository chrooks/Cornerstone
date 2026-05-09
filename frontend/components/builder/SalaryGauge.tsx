"use client";

/**
 * SalaryGauge.tsx — Horizontal SalaryCap bar for the Build page.
 *
 * Shows used salary vs. cap total with Geist Mono data typography,
 * percentage fill bar, and per-slot hover highlighting. Dollar figures
 * follow the Mono Data Rule from DESIGN.md.
 */

import { cn } from "@/lib/utils";
import { SALARY_CAP } from "@/lib/builder-config";

interface SalaryGaugeProps {
  /** Total salary currently committed across all filled slots. */
  usedSalary: number;
  /** Optional override for the cap total (defaults to SALARY_CAP). */
  cap?: number;
  /** Called when the user clicks the remaining salary label — passes remaining as a filter value. */
  onRemainingClick?: (maxSalary: number) => void;
  /**
   * Highlight a player's slice within the filled portion of the bar.
   * startFrac and endFrac are fractions of the total cap (0–1).
   */
  highlightRange?: { startFrac: number; endFrac: number } | null;
  /**
   * Picker-hover preview: salary of a player being hovered in the picker panel (not yet on roster).
   * Shows "+$XM" under the used label (green if fits, red if over cap) and
   * the would-be remaining salary under the remaining button.
   */
  previewSalary?: number | null;
}

/** Format a dollar amount as "$XM" or "$X.XM" — always rendered in Geist Mono. */
export function formatSalaryM(amount: number): string {
  const m = amount / 1_000_000;
  return m % 1 === 0 ? `$${m}M` : `$${m.toFixed(1)}M`;
}

export function SalaryGauge({ usedSalary, cap = SALARY_CAP, onRemainingClick, highlightRange, previewSalary }: SalaryGaugeProps) {
  const pct = Math.min(100, (usedSalary / cap) * 100);
  const overCap = usedSalary > cap;
  const remaining = cap - usedSalary;

  /* Preview values — how the numbers change if hovered picker player were added */
  const wouldExceedCap = previewSalary != null && usedSalary + previewSalary > cap;
  const wouldBeRemaining = previewSalary != null ? remaining - previewSalary : null;

  return (
    /* Single-line: [used label] [bar] [cap label] */
    <div id="builder-salary-gauge" className="flex items-center gap-3">
      {/* Used salary — Geist Mono for all dollar figures */}
      <div id="builder-salary-used" className="shrink-0 flex flex-col items-start leading-tight">
        <span className={cn(
          "font-mono text-[0.8125rem] tabular-nums font-medium whitespace-nowrap",
          overCap ? "text-[#e53e3e]" : "text-[#0e0907]",
        )}>
          {formatSalaryM(usedSalary)} <span className="text-[#0e0907]/45 font-sans text-[0.6875rem]">used</span>
        </span>
        {/* "+$XM" preview — invisible placeholder when no hover, preserves layout */}
        <span className={cn(
          "font-mono text-[0.6875rem] tabular-nums font-medium whitespace-nowrap transition-opacity",
          previewSalary != null ? "opacity-100" : "invisible",
          wouldExceedCap ? "text-[#e53e3e]" : "text-emerald-600",
        )}>
          {previewSalary != null ? `+${formatSalaryM(previewSalary)}` : "+$0M"}
        </span>
      </div>

      {/* Bar track — warm muted background */}
      <div
        id="builder-salary-bar-track"
        className="relative flex-1 h-2 rounded-full bg-[#d9d0c9]/40 overflow-hidden"
      >
        {/* Filled portion — total committed salary */}
        <div
          id="builder-salary-bar-fill"
          className={cn(
            "h-full rounded-full transition-all duration-300",
            overCap ? "bg-[#e53e3e]" : pct >= 90 ? "bg-amber-500" : "bg-emerald-500",
          )}
          style={{ width: `${pct}%` }}
        />
        {/* Ghost extension — shows cap hit of hovered picker player beyond current fill */}
        {previewSalary != null && (
          <div
            id="builder-salary-bar-preview"
            className={cn(
              "absolute top-0 h-full transition-all duration-150",
              wouldExceedCap ? "bg-[#e53e3e]/40" : "bg-emerald-400/40",
            )}
            style={{
              left: `${pct}%`,
              width: `${Math.min(100 - pct, (previewSalary / cap) * 100)}%`,
            }}
          />
        )}
        {/* Highlight overlay — shows hovered rotation player's slice within the filled bar */}
        {highlightRange && (
          <div
            id="builder-salary-bar-highlight"
            className="absolute top-0 h-full bg-white/50 transition-all duration-150"
            style={{
              left: `${highlightRange.startFrac * 100}%`,
              width: `${(highlightRange.endFrac - highlightRange.startFrac) * 100}%`,
            }}
          />
        )}
      </div>

      {/* Remaining — clickable to filter PlayerPool by salary */}
      <div className="shrink-0 flex flex-col items-end leading-tight">
        <button
          id="builder-salary-remaining"
          type="button"
          onClick={() => !overCap && onRemainingClick?.(remaining)}
          disabled={overCap || !onRemainingClick}
          title={!overCap ? `Filter players by salary ≤ ${formatSalaryM(remaining)}` : undefined}
          className={cn(
            "font-mono text-[0.8125rem] tabular-nums whitespace-nowrap transition-colors",
            overCap
              ? "text-[#e53e3e]"
              : onRemainingClick
                ? "text-[#0e0907]/45 hover:text-[#0e0907] hover:underline cursor-pointer"
                : "text-[#0e0907]/45",
          )}
        >
          {overCap
            ? `${formatSalaryM(Math.abs(remaining))} over`
            : `${formatSalaryM(remaining)} left`}
        </button>
        {/* Would-be remaining after adding hovered picker player */}
        <span className={cn(
          "font-mono text-[0.6875rem] tabular-nums whitespace-nowrap transition-opacity",
          wouldBeRemaining != null ? "opacity-100" : "invisible",
          wouldExceedCap ? "text-[#e53e3e]" : "text-[#0e0907]/45",
        )}>
          {wouldBeRemaining != null
            ? wouldExceedCap
              ? `${formatSalaryM(Math.abs(wouldBeRemaining))} over`
              : `${formatSalaryM(wouldBeRemaining)} left`
            : "—"}
        </span>
      </div>

      {/* SalaryCap label */}
      <span id="builder-salary-cap" className="font-mono text-[0.8125rem] tabular-nums text-[#0e0907]/35 whitespace-nowrap shrink-0">
        {formatSalaryM(cap)} cap
      </span>
    </div>
  );
}
