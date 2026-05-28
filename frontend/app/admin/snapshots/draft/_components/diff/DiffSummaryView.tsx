"use client";

/**
 * DiffSummaryView — dense skill-level ledger.
 *
 * One row per changed skill, sorted by per-skill changed-total descending.
 * Lead band: total_changed large + one-line prose + inline color legend.
 */

import { DIFF_CHANGE_COLORS, DIFF_CHANGE_LABEL } from "./diffColors";
import { DiffSummaryRow } from "./DiffSummaryRow";
import type { RunDiffSummary } from "@/lib/types";

interface DiffSummaryViewProps {
  summary: RunDiffSummary;
  onJumpToSkill: (skillName: string) => void;
}

function ColorLegendItem({ changeType }: { changeType: keyof typeof DIFF_CHANGE_COLORS }) {
  const { glyph, label } = DIFF_CHANGE_LABEL[changeType];
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: DIFF_CHANGE_COLORS[changeType] }}>
      <span className="font-mono font-bold">{glyph}</span>
      <span className="text-neutral-500">{label}</span>
    </span>
  );
}

export function DiffSummaryView({ summary, onJumpToSkill }: DiffSummaryViewProps) {
  const skillEntries = Object.entries(summary.per_skill)
    .filter(([, ps]) => ps.promotions + ps.demotions + ps.new > 0)
    .sort(([, a], [, b]) => {
      const totalA = a.promotions + a.demotions + a.new;
      const totalB = b.promotions + b.demotions + b.new;
      return totalB - totalA;
    });

  // Aggregate totals for prose summary
  const totalPromotions = skillEntries.reduce((s, [, ps]) => s + ps.promotions, 0);
  const totalDemotions = skillEntries.reduce((s, [, ps]) => s + ps.demotions, 0);
  const totalNew = skillEntries.reduce((s, [, ps]) => s + ps.new, 0);

  const parts: string[] = [];
  if (totalPromotions > 0) parts.push(`${totalPromotions} promotion${totalPromotions !== 1 ? "s" : ""}`);
  if (totalDemotions > 0) parts.push(`${totalDemotions} demotion${totalDemotions !== 1 ? "s" : ""}`);
  if (totalNew > 0) parts.push(`${totalNew} new`);

  const proseSummary =
    parts.length > 0
      ? `${parts.join(", ")} across ${skillEntries.length} skill${skillEntries.length !== 1 ? "s" : ""}`
      : "No changes";

  return (
    <div id="diff-summary-view">
      {/* Lead band */}
      <div
        id="diff-summary-band"
        className="mb-4 px-4 py-3 rounded-[6px] border border-[#d9d0c9]"
        style={{ backgroundColor: "#fef9f5" }}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <span
            className="text-2xl font-bold text-[#0e0907]"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {summary.total_changed}
          </span>
          <span className="text-sm text-neutral-500">{proseSummary}</span>
        </div>
        {/* Inline color legend */}
        <div className="flex items-center gap-3 mt-1.5">
          <ColorLegendItem changeType="promotion" />
          <ColorLegendItem changeType="demotion" />
          <ColorLegendItem changeType="new" />
        </div>
      </div>

      {/* Skill rows */}
      <div id="diff-summary-rows" className="space-y-1.5">
        {skillEntries.map(([skillName, perSkill]) => (
          <DiffSummaryRow
            key={skillName}
            skillName={skillName}
            perSkill={perSkill}
            onJumpToSkill={onJumpToSkill}
          />
        ))}
      </div>
    </div>
  );
}
