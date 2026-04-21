"use client";

/**
 * ScoreDisplay.tsx — Renders the 9 numeric dimension scores from the evaluation pipeline.
 *
 * Layout:
 *   - Overall score: large prominent number at the top
 *   - Primary row: Offense, Defense, Optionality, Robustness (horizontal bars)
 *   - Under Offense (indented): Spacing, Creation, Paint, Transition (sub-scores)
 *
 * Color coding:
 *   - green (70+): meets threshold
 *   - amber (40–69): needs attention
 *   - red (<40): significant weakness
 */

import { cn } from "@/lib/utils";
import type { Scores } from "@/lib/types";

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function scoreColorClass(score: number): string {
  if (score >= 70) return "text-green-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}

function barColorClass(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ScoreBarProps {
  id: string;
  label: string;
  score: number;
  size?: "normal" | "sub";
}

/** A single labeled score with a horizontal bar indicator. */
function ScoreBar({ id, label, score, size = "normal" }: ScoreBarProps) {
  const rounded = Math.round(score);
  const barWidth = `${Math.max(0, Math.min(100, rounded))}%`;

  return (
    <div id={id} className={cn("flex flex-col gap-1", size === "sub" && "pl-4 border-l border-border")}>
      <div className="flex items-center justify-between">
        <span className={cn("font-medium", size === "normal" ? "text-sm text-foreground" : "text-xs text-muted-foreground")}>
          {label}
        </span>
        <span className={cn("font-mono font-bold tabular-nums", scoreColorClass(rounded), size === "normal" ? "text-sm" : "text-xs")}>
          {rounded}
        </span>
      </div>
      {/* Horizontal bar */}
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", barColorClass(rounded))}
          style={{ width: barWidth }}
          role="progressbar"
          aria-valuenow={rounded}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScoreDisplay
// ---------------------------------------------------------------------------

interface ScoreDisplayProps {
  scores: Scores;
}

export function ScoreDisplay({ scores }: ScoreDisplayProps) {
  const overall = Math.round(scores.overall);

  return (
    <div id="score-display" className="space-y-4 rounded-xl border border-border bg-card p-4">
      {/* Overall score — large and prominent */}
      <div id="score-display-overall" className="flex flex-col items-center gap-1 py-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Overall Cohesion
        </p>
        <span className={cn("text-5xl font-extrabold tabular-nums leading-none", scoreColorClass(overall))}>
          {overall}
        </span>
        <p className="text-[10px] text-muted-foreground">/ 100</p>
      </div>

      <div className="w-full h-px bg-border" />

      {/* Primary dimension scores */}
      <div id="score-display-primary" className="space-y-3">
        {/* Offense — primary score */}
        <ScoreBar id="score-display-offense" label="Offense" score={scores.offense} />

        {/* Offense sub-scores (indented under Offense) */}
        <div id="score-display-offense-sub" className="space-y-2 ml-2">
          <ScoreBar id="score-display-spacing" label="Spacing" score={scores.spacing} size="sub" />
          <ScoreBar id="score-display-creation" label="Creation" score={scores.creation} size="sub" />
          <ScoreBar id="score-display-paint" label="Paint" score={scores.paint} size="sub" />
          <ScoreBar id="score-display-transition" label="Transition" score={scores.transition} size="sub" />
        </div>

        {/* Defense */}
        <ScoreBar id="score-display-defense" label="Defense" score={scores.defense} />

        {/* Optionality + Robustness */}
        <ScoreBar id="score-display-optionality" label="Optionality" score={scores.optionality} />
        <ScoreBar id="score-display-robustness" label="Robustness" score={scores.robustness} />
      </div>
    </div>
  );
}
