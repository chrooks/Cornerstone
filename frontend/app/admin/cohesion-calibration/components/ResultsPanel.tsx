"use client";

/**
 * ResultsPanel — Test history timeline for cohesion calibration.
 *
 * Displays LIFO list of past evaluations with collapsible detail (subscores,
 * synergies, load-lineup button). Shows delta from previous result.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SUBSCORE_LABELS, SYNERGY_DESCRIPTIONS } from "@/lib/cohesion-constants";
import { subscoreColor, synergyChipClass } from "@/lib/cohesion-colors";
import type { LineupTestResult } from "../types";

interface ResultsPanelProps {
  testHistory: LineupTestResult[];
  onLoadLineup: (result: LineupTestResult) => void;
}

function synergyDescription(synergyId: string): string {
  return SYNERGY_DESCRIPTIONS[synergyId] ?? "No description available for this synergy.";
}

/** Session history of lineup evaluations (LIFO, collapsible). */
export function ResultsPanel({ testHistory, onLoadLineup }: ResultsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (testHistory.length === 0) {
    return (
      <div id="cohesion-cal-results-empty" className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
        No test results yet
      </div>
    );
  }

  return (
    <div id="cohesion-cal-results" className="space-y-1.5 overflow-y-auto">
      {testHistory.map((result, idx) => {
        const isExpanded = expandedId === result.id;
        const prevResult = testHistory[idx + 1]; // older result (LIFO)
        const delta = prevResult ? result.cohesion_score - prevResult.cohesion_score : null;

        return (
          <button
            key={result.id}
            type="button"
            onClick={() => setExpandedId(isExpanded ? null : result.id)}
            className="w-full text-left rounded-md border border-border bg-card hover:bg-muted/50 transition-colors p-2.5 cursor-pointer"
          >
            {/* Summary row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] text-muted-foreground tabular-nums">
                  {new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-[10px] text-foreground truncate">
                  {result.playerNames.slice(0, 3).join(", ")}
                  {result.playerNames.length > 3 && ` +${result.playerNames.length - 3}`}
                </span>
                <span className="text-[8px] uppercase tracking-wider text-muted-foreground/60">
                  {result.mode === "rotation" ? "rotation" : "lineup"}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={cn("text-xs font-mono font-bold tabular-nums", subscoreColor(result.cohesion_score * 2))}>
                  {result.cohesion_score.toFixed(2)}
                </span>
                {delta !== null && (
                  <span className={cn("text-[9px] font-mono tabular-nums", delta >= 0 ? "text-green-400" : "text-red-400")}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-2" onClick={(e) => e.stopPropagation()}>
                {/* Full player names */}
                <p className="text-[9px] text-muted-foreground">{result.playerNames.join(" / ")}</p>
                <button
                  id={`cohesion-cal-history-load-${result.id}`}
                  type="button"
                  onClick={() => onLoadLineup(result)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-[9px] font-medium text-foreground hover:bg-muted cursor-pointer"
                >
                  Load {result.mode === "rotation" ? "Rotation" : "Lineup"}
                </button>
                {/* Subscores */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {Object.entries(result.subscores).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-[8px] text-muted-foreground">{SUBSCORE_LABELS[key] ?? key}</span>
                      <span className={cn("text-[8px] font-mono tabular-nums", subscoreColor(val))}>{val.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                {/* Synergies */}
                {result.synergies_applied.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.synergies_applied.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        id={`cohesion-cal-history-synergy-${result.id}-${s}-${i}`}
                        className={cn("text-[7px] font-mono px-1 rounded border", synergyChipClass(s))}
                        title={synergyDescription(s)}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
