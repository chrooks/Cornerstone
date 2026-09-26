"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { formatSalaryM } from "./SalaryGauge";

interface NarrowScoreStripProps {
  score: number | null;
  /** Starters (01–05) filled — the score only means something at five. */
  filledStarters: number;
  filledCount: number;
  maxRosterSlots: number;
  remainingSalary: number | null;
}

const SCORE_MIN_DELTA = 0.005;

/**
 * #141: the one-line score strip for the phone tab bar — "★ 3.44 +0.07 · 7/9 ·
 * $12.4M left". It stays in the sticky tab bar, so a touch user who stays on
 * the Players tab after an add still sees the score move.
 */
export function NarrowScoreStrip({ score, filledStarters, filledCount, maxRosterSlots, remainingSalary }: NarrowScoreStripProps) {
  const prevScore = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  useEffect(() => {
    if (score == null) return;
    const prev = prevScore.current;
    prevScore.current = score;
    if (prev != null && Math.abs(score - prev) >= SCORE_MIN_DELTA) setDelta(score - prev);
  }, [score]);

  const overCap = remainingSalary != null && remainingSalary < 0;
  return (
    <div
      id="builder-narrow-score-strip"
      role="status"
      className="flex items-center justify-between gap-3 border-t border-[#d9d0c9] px-3 py-1.5 font-mono text-[0.8125rem] tabular-nums text-[#0e0907]"
    >
      <span className="flex items-center gap-1.5">
        {score != null && filledStarters >= 5 ? (
          <>
            <span aria-hidden="true" className="text-[oklch(0.54_0.16_58)]">★</span>
            <span id="builder-narrow-score-strip-score" className="font-semibold">{score.toFixed(2)}</span>
            {delta != null && (
              <span
                id="builder-narrow-score-strip-delta"
                className={cn("text-[0.75rem] font-semibold", delta > 0 ? "text-[#047857]" : "text-[#b91c1c]")}
              >
                {delta > 0 ? "+" : ""}{delta.toFixed(2)}
              </span>
            )}
          </>
        ) : (
          <span id="builder-narrow-score-strip-starters" className="text-[#0e0907]/70">{filledStarters} of 5 starters</span>
        )}
      </span>
      <span id="builder-narrow-score-strip-slots" className="text-[#0e0907]/70">{filledCount}/{maxRosterSlots}</span>
      {remainingSalary != null && (
        <span id="builder-narrow-score-strip-cap" className={cn(overCap ? "font-semibold text-[#b91c1c]" : "text-[#0e0907]/70")}>
          {overCap ? `${formatSalaryM(Math.abs(remainingSalary))} over` : `${formatSalaryM(remainingSalary)} left`}
        </span>
      )}
    </div>
  );
}
