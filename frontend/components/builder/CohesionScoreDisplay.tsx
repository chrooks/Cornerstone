"use client";

/**
 * CohesionScoreDisplay.tsx — Renders cohesion engine evaluation results.
 *
 * Layout (top to bottom):
 *   1. Star Rating Hero — large 5-star display with exact numeric
 *   2. 4-Factor Breakdown — starting_5, depth, archetype_diversity, floor (0-1 bars)
 *   3. 13 Subscore Grid — grouped by category, 0-10 scale bars
 *   4. Accentuation — strength amplification + weakness coverage
 *
 * Color coding:
 *   Stars: green (≥3.5), amber (2.0–3.49), red (<2.0)
 *   Subscores (0-10): green (≥7), amber (4–6.99), red (<4)
 *   Breakdown (0-1): green (≥0.7), amber (0.4–0.69), red (<0.4)
 */

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { CohesionRosterEvaluation } from "@/lib/types";

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/** Color class for star rating (1-5 scale). */
function starColorClass(rating: number): string {
  if (rating >= 3.5) return "text-green-400";
  if (rating >= 2.0) return "text-amber-400";
  return "text-red-400";
}

/** Color class for 0-10 subscore bars. */
function subscoreColorClass(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

/** Bar fill color for 0-10 subscore bars. */
function subscoreBarColor(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

/** Color class for 0-1 breakdown bars. */
function breakdownColorClass(value: number): string {
  if (value >= 0.7) return "text-green-400";
  if (value >= 0.4) return "text-amber-400";
  return "text-red-400";
}

/** Bar fill color for 0-1 breakdown bars. */
function breakdownBarColor(value: number): string {
  if (value >= 0.7) return "bg-green-500";
  if (value >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Star icons
// ---------------------------------------------------------------------------

/** Filled star SVG icon. */
function StarFilled({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none" width="24" height="24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/** Half-filled star SVG icon — uses inline clipPath to avoid global id collision. */
function StarHalf({ className }: { className?: string }) {
  // Use useId()-style unique id to prevent SVG clipPath collision when multiple
  // CohesionScoreDisplay instances render in the same document.
  const clipId = useId();
  return (
    <svg className={className} viewBox="0 0 24 24" width="24" height="24">
      {/* Filled left half */}
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="currentColor"
        clipPath={`url(#${clipId})`}
      />
      {/* Empty outline for right half */}
      <path
        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.3"
      />
    </svg>
  );
}

/** Empty star SVG icon. */
function StarEmpty({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24" opacity="0.3">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/**
 * Render 5 star icons based on a rating rounded to nearest 0.5.
 * E.g. 4.23 → 4.0 → 4 filled, 0 half, 1 empty
 *      3.76 → 4.0 → 4 filled, 0 half, 1 empty
 *      3.25 → 3.5 → 3 filled, 1 half, 1 empty
 */
function StarRating({ rating, colorClass }: { rating: number; colorClass: string }) {
  // Clamp to [0, 5] then round to nearest half star for display
  const clamped = Math.max(0, Math.min(5, rating));
  const rounded = Math.round(clamped * 2) / 2;
  const fullStars = Math.floor(rounded);
  const hasHalf = rounded % 1 !== 0;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  return (
    <div className={cn("flex items-center gap-0.5", colorClass)} aria-hidden="true">
      {Array.from({ length: fullStars }, (_, i) => (
        <StarFilled key={`full-${i}`} className="w-8 h-8" />
      ))}
      {hasHalf && <StarHalf className="w-8 h-8" />}
      {Array.from({ length: emptyStars }, (_, i) => (
        <StarEmpty key={`empty-${i}`} className="w-8 h-8" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A labeled horizontal bar for 0-1 breakdown factors. */
function BreakdownBar({ id, label, value }: { id: string; label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div id={id} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("text-xs font-mono font-bold tabular-nums", breakdownColorClass(value))}>
          {pct}%
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", breakdownBarColor(value))}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

/** A labeled horizontal bar for 0-10 subscore values. */
function SubscoreBar({ id, label, score }: { id: string; label: string; score: number }) {
  const rounded = Math.round(score * 10) / 10;
  const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <div id={id} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("text-xs font-mono font-bold tabular-nums", subscoreColorClass(score))}>
          {rounded.toFixed(1)}
        </span>
      </div>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", subscoreBarColor(score))}
          style={{ width: `${widthPct}%` }}
          role="progressbar"
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={10}
          aria-label={label}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscore key → display label mapping, grouped by category
// ---------------------------------------------------------------------------

const SUBSCORE_GROUPS: { heading: string; entries: { key: string; label: string }[] }[] = [
  {
    heading: "Ratios",
    entries: [
      { key: "spacing_creation_ratio", label: "Spacing / Creation" },
      { key: "spacing_paint_touch_ratio", label: "Spacing / Paint Touch" },
      { key: "rebound_transition_ratio", label: "Rebound / Transition" },
      { key: "rebounding_spacing_deficit", label: "Rebounding–Spacing Gap" },
    ],
  },
  {
    heading: "Totals",
    entries: [
      { key: "paint_touch_total", label: "Paint Touch" },
      { key: "post_game_total", label: "Post Game" },
      { key: "pnr_screener_total", label: "PnR Screener" },
      { key: "anchor_total", label: "Anchor" },
      { key: "collective_passing", label: "Passing" },
      { key: "rebounding", label: "Rebounding" },
      { key: "transition", label: "Transition" },
    ],
  },
  {
    heading: "Defense",
    entries: [
      { key: "defensive_coverage", label: "Defensive Coverage" },
      { key: "defensive_gaps", label: "Defensive Gaps" },
    ],
  },
];

// ---------------------------------------------------------------------------
// CohesionScoreDisplay
// ---------------------------------------------------------------------------

interface CohesionScoreDisplayProps {
  evaluation: CohesionRosterEvaluation;
}

export function CohesionScoreDisplay({ evaluation }: CohesionScoreDisplayProps) {
  const { star_rating, star_rating_breakdown, starting_lineup } = evaluation;
  const colorClass = starColorClass(star_rating);

  return (
    <div id="cohesion-score-display" className="space-y-4 rounded-xl border border-border bg-card p-4">

      {/* Star Rating Hero */}
      <div
        id="cohesion-score-hero"
        role="group"
        aria-label={`Roster cohesion: ${star_rating.toFixed(2)} out of 5 stars`}
        className="flex flex-col items-center gap-2 py-2"
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Roster Cohesion
        </p>
        <StarRating rating={star_rating} colorClass={colorClass} />
        <span id="cohesion-score-exact" className={cn("text-lg font-mono font-bold tabular-nums", colorClass)}>
          {star_rating.toFixed(2)}
        </span>
      </div>

      <div className="w-full h-px bg-border" />

      {/* 4-Factor Breakdown (0-1 bars shown as percentages) */}
      <div id="cohesion-breakdown" className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Rating Breakdown
        </p>
        <BreakdownBar id="cohesion-breakdown-starting5" label="Starting 5" value={star_rating_breakdown.starting_5} />
        <BreakdownBar id="cohesion-breakdown-depth" label="Depth" value={star_rating_breakdown.depth} />
        <BreakdownBar id="cohesion-breakdown-versatility" label="Versatility" value={star_rating_breakdown.archetype_diversity} />
        <BreakdownBar id="cohesion-breakdown-floor" label="Floor" value={star_rating_breakdown.floor} />
      </div>

      <div className="w-full h-px bg-border" />

      {/* 13 Subscore Grid (0-10 scale, grouped) */}
      <div id="cohesion-subscores" className="space-y-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Subscores
        </p>
        {SUBSCORE_GROUPS.map((group) => (
          <div key={group.heading} className="space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {group.heading}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {group.entries.map((entry) => (
                <SubscoreBar
                  key={entry.key}
                  id={`cohesion-subscore-${entry.key}`}
                  label={entry.label}
                  score={starting_lineup.subscores[entry.key] ?? 0}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="w-full h-px bg-border" />

      {/* Accentuation — strength amplification + weakness coverage */}
      <div id="cohesion-accentuation" className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Accentuation
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          <SubscoreBar
            id="cohesion-accentuation-strength"
            label="Strength Amp"
            score={starting_lineup.accentuation.strength_amplification}
          />
          <SubscoreBar
            id="cohesion-accentuation-weakness"
            label="Weakness Cover"
            score={starting_lineup.accentuation.weakness_coverage}
          />
        </div>
      </div>
    </div>
  );
}
