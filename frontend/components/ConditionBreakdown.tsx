"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ConditionResult } from "@/lib/types";

const SECTION_LABELS: Record<string, string> = {
  volume_gate: "Volume Gate",
  elite:       "Elite",
  capable:     "Capable",
  tier_bump:   "Tier Bump",
};

/**
 * Format a condition value for display.
 * Percentage stats (ending in _pct) are shown as XX.X%, others as X.XX.
 */
function fmtValue(c: ConditionResult, v: number | null): string {
  if (v === null) return "—";
  // Percentage stats
  if (c.stat.endsWith("_pct") || c.stat.endsWith("_fg3_pct") || c.stat.endsWith("_fg_pct")) {
    return (v * 100).toFixed(1) + "%";
  }
  // Round to 2 decimal places for most stats, whole number for large integers
  if (Math.abs(v) >= 100 && Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

/**
 * Expandable condition breakdown component showing every leaf condition
 * for a skill evaluation — actual value vs threshold, pass/fail per condition.
 *
 * Used in: review panel (per-skill breakdown), calibration (anchor test results).
 *
 * @param conditions - flat list of ConditionResult from collect_condition_results
 * @param defaultOpen - whether the breakdown starts expanded (default false)
 * @param forceOpen - override local toggle when set (used by "expand all" in calibration)
 */
export function ConditionBreakdown({
  conditions,
  defaultOpen = false,
  forceOpen,
}: {
  conditions: ConditionResult[];
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  // forceOpen from parent overrides local toggle when defined
  const open = forceOpen !== undefined ? forceOpen : localOpen;

  // Group conditions by section in display order
  const sectionOrder = ["volume_gate", "elite", "capable", "tier_bump"] as const;
  const grouped = sectionOrder
    .map((s) => ({ section: s, items: conditions.filter((c) => c.section === s) }))
    .filter((g) => g.items.length > 0);

  if (grouped.length === 0) return null;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setLocalOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors select-none"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Stats vs Thresholds</span>
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-md border border-border bg-muted/20 p-2">
          {grouped.map(({ section, items }) => {
            // Build render nodes — insert logic label whenever group_id changes
            const nodes: React.ReactNode[] = [];
            let lastGroupId: number | null = null;

            items.forEach((c, i) => {
              // Emit a group label when entering a new AND/OR block
              if (c.group_id !== lastGroupId) {
                lastGroupId = c.group_id;
                if (c.group_logic && (c.depth > 0 || c.group_logic === "OR")) {
                  nodes.push(
                    <div
                      key={`label-${c.group_id}`}
                      className="flex items-center gap-1 mt-1"
                      style={{ paddingLeft: `${c.depth * 12}px` }}
                    >
                      <span
                        className={cn(
                          "text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wide",
                          c.group_logic === "OR"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-blue-100 text-blue-700"
                        )}
                      >
                        {c.group_logic}
                      </span>
                      <span className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    </div>
                  );
                }
              }

              // Stat label — use just the leaf key name for readability
              const statLabel = c.stat.split(".").pop() ?? c.stat;

              const passIcon =
                c.passed === null ? (
                  <span className="text-muted-foreground" title="Data missing">?</span>
                ) : c.passed ? (
                  <span className="text-emerald-600" title="Passes">✓</span>
                ) : (
                  <span className="text-red-600" title="Fails">✗</span>
                );

              nodes.push(
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded",
                    c.passed === true  && "bg-emerald-50",
                    c.passed === false && "bg-red-50",
                    c.passed === null  && "bg-muted/30"
                  )}
                  style={{ marginLeft: `${c.depth * 12}px` }}
                >
                  {passIcon}
                  {/* Stat name with badges for stabilized / per-season */}
                  <span
                    className="flex-1 text-muted-foreground truncate"
                    title={c.stat}
                  >
                    {statLabel}
                    {c.stabilized && (
                      <span className="ml-0.5 text-[9px] bg-blue-100 text-blue-600 px-0.5 rounded" title="Bayesian-stabilized">~</span>
                    )}
                    {c.per === "season" && (
                      <span className="ml-0.5 text-[9px] text-blue-400" title="Season total">/s</span>
                    )}
                  </span>
                  {/* Actual value — highlighted red when failing */}
                  <span
                    className={cn(
                      "font-semibold tabular-nums",
                      c.passed === false ? "text-red-700" : "text-foreground"
                    )}
                  >
                    {fmtValue(c, c.actual_value)}
                  </span>
                  <span className="text-muted-foreground w-4 text-center">{c.operator}</span>
                  {/* Threshold value */}
                  <span className="text-muted-foreground tabular-nums">
                    {fmtValue(c, c.threshold)}
                  </span>
                </div>
              );
            });

            return (
              <div key={section}>
                <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
                  {SECTION_LABELS[section] ?? section}
                </div>
                <div className="space-y-0.5">{nodes}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
