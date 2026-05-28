"use client";

/**
 * DiffSummaryRow — one row in the skill-level summary ledger.
 *
 * Layout: LEFT skill label | CENTER proportional bar | RIGHT counts
 * Bar segments: promotions (green-700) / demotions (red-700) / new (heat-check)
 * Unchanged excluded from bar. Min-pixel floor 3px on any nonzero segment.
 */

import { cn } from "@/lib/utils";
import { SKILL_LABELS } from "@/lib/skills";
import { DIFF_CHANGE_COLORS } from "./diffColors";
import { calcBarSegments } from "./diffLogic";
import type { RunDiffPerSkill } from "@/lib/types";

interface DiffSummaryRowProps {
  skillName: string;
  perSkill: RunDiffPerSkill;
  onJumpToSkill: (skillName: string) => void;
}

const MIN_SEGMENT_PX = 3;
const TRACK_WIDTH_PX = 120;

function BarSegment({
  fraction,
  color,
}: {
  fraction: number;
  color: string;
}) {
  if (fraction === 0) return null;
  const widthPx = Math.max(MIN_SEGMENT_PX, Math.round(fraction * TRACK_WIDTH_PX));
  return (
    <span
      className="inline-block h-full rounded-sm"
      style={{ width: `${widthPx}px`, backgroundColor: color, flexShrink: 0 }}
    />
  );
}

export function DiffSummaryRow({ skillName, perSkill, onJumpToSkill }: DiffSummaryRowProps) {
  const label = SKILL_LABELS[skillName] ?? skillName;
  const rowTotal = perSkill.promotions + perSkill.demotions + perSkill.new;
  const segments = calcBarSegments(perSkill);

  return (
    <button
      id={`diff-summary-row-${skillName}`}
      type="button"
      onClick={() => onJumpToSkill(skillName)}
      className={cn(
        "w-full text-left rounded-[6px] border border-[#d9d0c9] px-3 py-2",
        "grid grid-cols-[180px_1fr_auto] items-center gap-3",
        "hover:border-[#ffa05c] hover:bg-[#fff8f4] transition-colors"
      )}
    >
      {/* LEFT: skill label */}
      <span className="text-xs font-medium text-[#0e0907] truncate">{label}</span>

      {/* CENTER: proportional bar */}
      <span
        className="inline-flex items-center h-[10px] rounded-sm overflow-hidden"
        style={{ backgroundColor: "#fef9f5", minWidth: `${TRACK_WIDTH_PX}px`, maxWidth: `${TRACK_WIDTH_PX}px` }}
        aria-hidden="true"
      >
        <BarSegment fraction={segments.promotions} color={DIFF_CHANGE_COLORS.promotion} />
        <BarSegment fraction={segments.demotions} color={DIFF_CHANGE_COLORS.demotion} />
        <BarSegment fraction={segments.new} color={DIFF_CHANGE_COLORS.new} />
      </span>

      {/* RIGHT: counts + total */}
      <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
        {perSkill.promotions > 0 && (
          <span className="text-green-700">+{perSkill.promotions}</span>
        )}
        {perSkill.demotions > 0 && (
          <span className="text-red-700">-{perSkill.demotions}</span>
        )}
        {perSkill.new > 0 && (
          <span className="text-[#fe6d34]">&bull;{perSkill.new}</span>
        )}
        <span className="font-bold text-[#0e0907]">{rowTotal}</span>
      </span>
    </button>
  );
}
