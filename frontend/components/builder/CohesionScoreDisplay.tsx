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

const BREAKDOWN_DESCRIPTIONS: Record<string, string> = {
  starting_5: "How strong the selected starting five is on the 0-5 cohesion scale.",
  depth: "Bench rotation depth: viable non-starting lineup ratio blended with median non-starting lineup quality.",
  archetype_diversity: "How many different lineup identities the roster can support.",
  floor: "How stable the roster is across all evaluated five-man lineup combinations.",
};

const SUBSCORE_DESCRIPTIONS: Record<string, string> = {
  spacing_creation_ratio: "How well lineup spacing and shot creation balance each other.",
  creation_offball_ratio: "Whether on-ball creation has enough off-ball impact around it.",
  spacing_paint_touch_ratio: "Whether rim pressure has enough spacing support.",
  rebound_transition_ratio: "Whether rebounding and transition play support each other.",
  rebounding_spacing_deficit: "Whether spacing is adequate or rebounding can offset a spacing deficit.",
  paint_touch_total: "Lineup-wide ability to pressure the rim.",
  post_game_total: "Top post option, secondary post option, and post depth blended together.",
  pnr_pairing: "How well pick-and-roll handlers and screeners match in both quality and balance.",
  anchor_total: "Primary defensive anchor quality with secondary support and depth.",
  perimeter_defense_total: "Primary perimeter defender quality with secondary support and depth.",
  interior_defense_total: "Primary interior defender quality with secondary support and depth.",
  collective_passing: "Primary creator passing plus lineup-wide passing depth.",
  rebounding: "Top rebounders plus team rebounding depth.",
  transition: "Lineup-wide transition pressure and open-court value.",
  defensive_coverage: "Stacked height-based defensive bell-curve coverage after lineup effects.",
  defensive_gaps: "How many height bands avoid falling below the defensive gap threshold.",
  accentuation_strength: "How much the lineup amplifies its best traits.",
  accentuation_weakness: "How well the lineup covers its weakest traits.",
};

/** A labeled horizontal bar for 0-1 breakdown factors. */
function BreakdownBar({ id, label, value, description }: { id: string; label: string; value: number; description: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div id={id} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground cursor-help" title={description}>
          {label}
        </span>
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
function SubscoreBar({ id, label, score, description }: { id: string; label: string; score: number; description: string }) {
  const rounded = Math.round(score * 10) / 10;
  const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
  return (
    <div id={id} className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span id={`${id}-label`} className="text-xs font-medium text-muted-foreground cursor-help" title={description}>
          {label}
        </span>
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
    heading: "Fit Ratios",
    entries: [
      { key: "spacing_creation_ratio", label: "Spacing / Creation" },
      { key: "creation_offball_ratio", label: "Creation / Off-Ball" },
      { key: "spacing_paint_touch_ratio", label: "Spacing / Rim Pressure" },
      { key: "rebound_transition_ratio", label: "Rebound / Transition" },
      { key: "rebounding_spacing_deficit", label: "Spacing Support" },
    ],
  },
  {
    heading: "Lineup Qualities",
    entries: [
      { key: "paint_touch_total", label: "Rim Pressure" },
      { key: "post_game_total", label: "Post Game" },
      { key: "pnr_pairing", label: "PnR Pairing" },
      { key: "anchor_total", label: "Anchor" },
      { key: "collective_passing", label: "Passing" },
      { key: "rebounding", label: "Rebounding" },
      { key: "transition", label: "Transition" },
    ],
  },
  {
    heading: "Defense",
    entries: [
      { key: "perimeter_defense_total", label: "Perim Defense" },
      { key: "interior_defense_total", label: "Interior Defense" },
      { key: "defensive_coverage", label: "Def Coverage" },
      { key: "defensive_gaps", label: "Def Gaps" },
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
        <BreakdownBar id="cohesion-breakdown-starting5" label="Starting 5" value={star_rating_breakdown.starting_5} description={BREAKDOWN_DESCRIPTIONS.starting_5} />
        <BreakdownBar id="cohesion-breakdown-depth" label="Depth" value={star_rating_breakdown.depth} description={BREAKDOWN_DESCRIPTIONS.depth} />
        <BreakdownBar id="cohesion-breakdown-versatility" label="Versatility" value={star_rating_breakdown.archetype_diversity} description={BREAKDOWN_DESCRIPTIONS.archetype_diversity} />
        <BreakdownBar id="cohesion-breakdown-floor" label="Floor" value={star_rating_breakdown.floor} description={BREAKDOWN_DESCRIPTIONS.floor} />
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
                  description={SUBSCORE_DESCRIPTIONS[entry.key] ?? "Cohesion subscore used in the lineup rollup."}
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
            description={SUBSCORE_DESCRIPTIONS.accentuation_strength}
          />
          <SubscoreBar
            id="cohesion-accentuation-weakness"
            label="Weakness Cover"
            score={starting_lineup.accentuation.weakness_coverage}
            description={SUBSCORE_DESCRIPTIONS.accentuation_weakness}
          />
        </div>
      </div>
    </div>
  );
}
