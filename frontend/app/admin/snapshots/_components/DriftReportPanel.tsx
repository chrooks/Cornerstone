"use client";

/**
 * DriftReportPanel — post-publish tier-drift report (issue #131).
 *
 * Surfaces the #86 report-only drift check's result after a publish. Publish
 * has already succeeded by the time this renders — drift is data-health
 * feedback, never an Error State. Three states:
 *   - clean:        quiet one-line confirmation, no attention demanded.
 *   - drift:        banner with count; expandable (collapsed by default —
 *                   Progressive Disclosure) table of the drifted tiers.
 *   - check_failed: plain notice that the check itself errored; publish
 *                   still succeeded, so this stays informational too.
 */

import { useState } from "react";
import type { DriftSummary } from "@/lib/types";

interface DriftReportPanelProps {
  id: string;
  summary: DriftSummary;
}

export function DriftReportPanel({ id, summary }: DriftReportPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (summary.status === "clean") {
    return (
      <p id={id} className="text-xs text-neutral-500">
        Drift check clean — every stat-derived tier matches a fresh recompute.
      </p>
    );
  }

  if (summary.status === "check_failed") {
    return (
      <div
        id={id}
        className="rounded-[6px] border border-[#d9d0c9] px-4 py-3 text-xs text-neutral-600"
        style={{ backgroundColor: "#fef9f5" }}
      >
        The tier-drift check errored and did not run for this release. Publish
        still succeeded — nothing was blocked.
      </div>
    );
  }

  // status === "drift" — reuses the same deep-amber/warm-offwhite pairing as
  // StateChip's "review" variant (DESIGN.md: deep-amber #a34400), the
  // codebase's established non-error amber, rather than raw Tailwind amber.
  return (
    <div
      id="drift-report-banner"
      className="rounded-[6px] px-4 py-3 text-sm"
      style={{
        backgroundColor: "#fef3c7",
        border: "1px solid rgba(163, 68, 0, 0.25)",
        color: "#7e2c0c",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p>
          <strong>{summary.count}</strong> stat-derived skill tier
          {summary.count !== 1 ? "s" : ""} drifted from a fresh recompute.
          Publish succeeded — this is a data-health report, not an error.
        </p>
        <button
          id="drift-report-toggle"
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-semibold hover:text-[#0e0907] transition-colors whitespace-nowrap"
          style={{ color: "#a34400" }}
          aria-expanded={expanded}
          aria-controls="drift-report-table"
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {expanded && (
        <div id="drift-report-table" className="mt-3 overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr
                className="text-left"
                style={{ borderBottom: "1px solid rgba(163, 68, 0, 0.25)" }}
              >
                <th className="py-1.5 pr-4 font-semibold" style={{ color: "#a34400" }}>
                  Player
                </th>
                <th className="py-1.5 pr-4 font-semibold" style={{ color: "#a34400" }}>
                  Skill
                </th>
                <th className="py-1.5 font-semibold" style={{ color: "#a34400" }}>
                  Stored tier → Recomputed tier
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.entries.map((entry) => (
                <tr
                  key={`${entry.player_id}-${entry.skill_name}`}
                  className="last:border-0"
                  style={{ borderBottom: "1px solid rgba(163, 68, 0, 0.12)" }}
                >
                  <td className="py-1.5 pr-4">{entry.player_name}</td>
                  <td className="py-1.5 pr-4">{entry.skill_name}</td>
                  <td className="py-1.5">
                    {entry.stored_tier ?? "—"} → {entry.recomputed_tier}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
