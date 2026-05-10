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

import { cn } from "@/lib/utils";
import { CohesionScoreBadge } from "@/components/cohesion/CohesionScoreBadge";
import { SUBSCORE_GROUPS } from "@/lib/cohesion-constants";
import { subscoreColor } from "@/lib/cohesion-colors";
import { scoreFactorExplainer, scoreFactorLabel } from "@/lib/cohesionScoreExplainers";
import type { RosterEvaluation } from "@/lib/types";

// ---------------------------------------------------------------------------
// Color utilities (component-specific scales not shared elsewhere)
// ---------------------------------------------------------------------------

const subscoreColorClass = subscoreColor;

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
// Sub-components
// ---------------------------------------------------------------------------

const SUBSCORE_DESCRIPTIONS: Record<string, string> = {
  spacing_creation_ratio: "Whether or not you have enough spacing for your on-ball creators to operate.",
  creation_offball_ratio: "Whether or not you have a good balance of on & off-ball offensive players.",
  spacing_paint_touch_ratio: "Whether or not you have enough spacing to support your paint touches.",
  rebound_transition_ratio: "Whether rebounding and transition play support each other.",
  rebounding_spacing_deficit: "Whether spacing is adequate or rebounding can offset a spacing deficit.",
  paint_touch_total: "Lineup-wide ability to pressure the rim.",
  post_game_total: "Top post option, secondary post option, and post depth blended together.",
  pnr_pairing: "How well pick-and-roll handlers and screeners match in both quality and balance.",
  anchor_total: "How much the Lineup has a stabilizing big-man presence through interior defense, rebounding, vertical size, and screening.",
  perimeter_defense_total: "Primary perimeter defender quality with secondary support and depth.", //TODO change this t
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

function SummaryMetric({
  id,
  label,
  value,
  description,
}: {
  id: string;
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div
      id={id}
      className="border border-[#d9d0c9]/70 bg-[#f7f7f7] px-3 py-2"
      title={description}
    >
      <p id={`${id}-label`} className="text-[0.6875rem] font-semibold text-[#0e0907]/50">
        {label}
      </p>
      <p id={`${id}-value`} className="mt-1 font-mono text-[0.875rem] font-semibold tabular-nums text-[#0e0907]">
        {value}
      </p>
    </div>
  );
}

function gradeForScore(score: number): string {
  if (score >= 9.7) return "A+";
  if (score >= 9.3) return "A";
  if (score >= 9.0) return "A-";
  if (score >= 8.7) return "B+";
  if (score >= 8.3) return "B";
  if (score >= 8.0) return "B-";
  if (score >= 7.7) return "C+";
  if (score >= 7.3) return "C";
  if (score >= 7.0) return "C-";
  if (score >= 6.7) return "D+";
  if (score >= 6.3) return "D";
  if (score >= 6.0) return "D-";
  return "F";
}

function gradeToneClass(score: number): string {
  if (score >= 8) return "border-green-500/35 bg-green-500/10 text-green-700 dark:text-green-300";
  if (score >= 6) return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300";
}

function deltaLabel(score: number, rotationScore?: number): string {
  if (rotationScore == null) return "No Median";
  const delta = Math.round((rotationScore - score) * 10) / 10;
  if (Math.abs(delta) < 0.05) return "Even";
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`;
}

function deltaToneClass(score: number, rotationScore?: number): string {
  if (rotationScore == null) return "text-[#0e0907]/35";
  const delta = rotationScore - score;
  if (delta >= 0.25) return "text-green-600";
  if (delta <= -0.75) return "text-red-600";
  return "text-[#0e0907]/45";
}

/** A scouting-grade tile for 0-10 subscore values. */
function SubscoreGrade({
  id,
  label,
  score,
  rotationScore,
  description,
}: {
  id: string;
  label: string;
  score: number;
  rotationScore?: number;
  description: string;
}) {
  const rounded = Math.round(score * 10) / 10;
  const hasRotation = rotationScore != null;
  const rotRounded = hasRotation ? Math.round(rotationScore * 10) / 10 : 0;
  const grade = gradeForScore(score);
  return (
    <div
      id={id}
      className="grid min-h-[88px] grid-cols-[3.25rem_minmax(0,1fr)] border border-[#d9d0c9]/70 bg-[#f7f7f7] transition-colors hover:border-[#ffa05c]/55"
      title={description}
    >
      <div
        id={`${id}-grade`}
        className={cn(
          "flex items-center justify-center border-r px-2 font-mono text-lg font-bold tabular-nums",
          gradeToneClass(score),
        )}
      >
        {grade}
      </div>
      <div className="min-w-0 px-3 py-2">
        <p id={`${id}-label`} className="truncate text-xs font-semibold text-[#0e0907]">
          {label}
        </p>
        <div className="mt-2 grid gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.6875rem] text-[#0e0907]/48">Starting Lineup</span>
            <span className={cn("font-mono text-xs font-bold tabular-nums", subscoreColorClass(score))}>
              {rounded.toFixed(1)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[0.6875rem] text-[#0e0907]/48">Rotation Median</span>
            <span
              id={`${id}-rotation`}
              className={cn("font-mono text-xs tabular-nums", hasRotation ? subscoreColorClass(rotationScore) : "text-[#0e0907]/35")}
            >
              {hasRotation ? rotRounded.toFixed(1) : "--"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-[#d9d0c9]/60 pt-1">
            <span className="text-[0.625rem] text-[#0e0907]/38">Durability</span>
            <span id={`${id}-delta`} className={cn("font-mono text-[0.6875rem] tabular-nums", deltaToneClass(score, rotationScore))}>
              {deltaLabel(score, rotationScore)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// SUBSCORE_GROUPS imported from @/lib/cohesion-constants

// ---------------------------------------------------------------------------
// CohesionScoreDisplay
// ---------------------------------------------------------------------------

interface CohesionScoreDisplayProps {
  evaluation: RosterEvaluation;
}

export function CohesionScoreDisplay({ evaluation }: CohesionScoreDisplayProps) {
  const { star_rating, star_rating_breakdown, starting_lineup, lineup_summary } = evaluation;
  const rotationMedian = lineup_summary.rotation_median_subscores;
  const factorEntries = Object.entries(star_rating_breakdown).map(([key, value]) => ({
    key,
    label: scoreFactorLabel(key),
    value,
    description: scoreFactorExplainer(key),
  }));

  return (
    <div id="cohesion-score-display" className="space-y-5 border border-[#d9d0c9] bg-[#f7f7f7] p-4 sm:p-5">

      {/* Star Rating Hero */}
      <div
        id="cohesion-score-hero"
        role="group"
        aria-label={`Team cohesion: ${star_rating.toFixed(2)} out of 5 stars`}
        className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
      >
        <div id="cohesion-score-heading" className="min-w-0">
          <p className="text-xs font-semibold text-[#0e0907]/50">
            Final Team Read
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#0e0907]">
            Rotation Cohesion
          </h2>
          <p className="mt-1 max-w-[62ch] text-sm leading-6 text-[#0e0907]/62">
            The engine evaluates the Starting Lineup, then tests the full Rotation across its Lineup Combinations.
          </p>
        </div>
        <CohesionScoreBadge
          id="cohesion-score-rating"
          value={star_rating}
          precision={2}
          featured
          ariaLabel={`Team Cohesion score: ${star_rating.toFixed(2)} out of 5`}
        />
      </div>

      <div className="w-full h-px bg-border" />

      <div id="cohesion-rotation-summary" className="grid gap-2 sm:grid-cols-3">
        <SummaryMetric
          id="cohesion-summary-starting-lineup"
          label="Starting Lineup"
          value={starting_lineup.cohesion_score.toFixed(2)}
          description="Cohesion score for slots 1 through 5."
        />
        <SummaryMetric
          id="cohesion-summary-viable-combos"
          label="Viable Combos"
          value={`${lineup_summary.viable_lineups}/${lineup_summary.total_lineups}`}
          description="Lineup Combinations above the engine viability floor."
        />
        <SummaryMetric
          id="cohesion-summary-median-combo"
          label="Median Combo"
          value={lineup_summary.median_score.toFixed(2)}
          description="Middle Lineup Combination score across the Rotation."
        />
      </div>

      <div className="w-full h-px bg-border" />

      {/* 4-Factor Breakdown (0-1 bars shown as percentages) */}
      <div id="cohesion-breakdown" className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Score Factors
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Hover a factor for the engine read. A low factor can pull down an otherwise strong Team.
          </p>
        </div>
        {factorEntries.map((item) => (
          <BreakdownBar
            key={item.key}
            id={`cohesion-breakdown-${item.key}`}
            label={item.label}
            value={item.value}
            description={item.description}
          />
        ))}
      </div>

      <div className="w-full h-px bg-border" />

      {/* 13 Subscore Grid (0-10 scale, grouped) */}
      <div id="cohesion-subscores" className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">
            Subscores
          </p>
          {rotationMedian && Object.keys(rotationMedian).length > 0 && (
            <p id="cohesion-subscores-legend" className="text-[9px] text-muted-foreground/60">
              Starting Lineup / <span className="opacity-50">Rotation Median</span>
            </p>
          )}
        </div>
        {SUBSCORE_GROUPS.map((group) => (
          <div key={group.heading} className="space-y-2">
            <p className="text-[11px] font-medium text-muted-foreground/70">
              {group.heading}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {group.entries.map((entry) => (
                <SubscoreGrade
                  key={entry.key}
                  id={`cohesion-subscore-${entry.key}`}
                  label={entry.label}
                  score={starting_lineup.subscores[entry.key] ?? 0}
                  rotationScore={rotationMedian?.[entry.key]}
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
        <p className="text-xs font-semibold text-muted-foreground">
          Accentuation
        </p>
        <div className="grid grid-cols-2 gap-x-4">
          <SubscoreGrade
            id="cohesion-accentuation-strength"
            label="Strength Amp"
            score={starting_lineup.accentuation.strength_amplification}
            rotationScore={rotationMedian?.accentuation_strength}
            description={SUBSCORE_DESCRIPTIONS.accentuation_strength}
          />
          <SubscoreGrade
            id="cohesion-accentuation-weakness"
            label="Weakness Cover"
            score={starting_lineup.accentuation.weakness_coverage}
            rotationScore={rotationMedian?.accentuation_weakness}
            description={SUBSCORE_DESCRIPTIONS.accentuation_weakness}
          />
        </div>
      </div>
    </div>
  );
}
