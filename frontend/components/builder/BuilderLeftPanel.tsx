"use client";

/**
 * BuilderLeftPanel — Left side of the builder split layout.
 *
 * Contains the Rotation card (SalaryCap gauge + CourtLineup) on top,
 * and a tabbed area (GM Notes / Skills / Debug) below.
 * Owns tab state and scroll position preservation internally.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_SALARY_CAP } from "@/lib/builder-config";
import { SalaryGauge } from "./SalaryGauge";
import { CourtLineup } from "./CourtLineup";
import { SkillGrid } from "./SkillGrid";
import { AssistantGmNotes } from "./AssistantGmNotes";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

interface BuilderLeftPanelProps {
  /* Rotation card props */
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string;
  legendDetail: LegendDetail | null;
  selectedSlot: number | null;
  usedSalary: number;
  salaryCap?: number;
  highlightRange: { startFrac: number; endFrac: number } | null;
  pickerHoveredSalary: number | null;
  onSalaryCapFilterClick: (max: number) => void;
  isAdmin: boolean;

  /* CourtLineup handlers */
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  onSwapSlots: (fromSlot: number, toSlot: number) => void;
  onSlotHover: (slotIndex: number) => void;
  onSlotHoverEnd: () => void;

  /* GM Notes suggestion filter callback */
  onSuggestionFilter: (filter: SuggestionFilter) => void;

  /* Layout */
  isWideLayout: boolean;
  topPanelFrac: number;
  leftPanelRef: React.RefObject<HTMLDivElement>;
  onVerticalResizeStart: (e: React.MouseEvent) => void;
}

export function BuilderLeftPanel({
  allSlots,
  cornerstoneId,
  legendDetail,
  selectedSlot,
  usedSalary,
  salaryCap = DEFAULT_SALARY_CAP,
  highlightRange,
  pickerHoveredSalary,
  onSalaryCapFilterClick,
  isAdmin,
  onSlotClick,
  onRemoveSlot,
  onDropPlayer,
  onSwapSlots,
  onSlotHover,
  onSlotHoverEnd,
  onSuggestionFilter,
  isWideLayout,
  topPanelFrac,
  leftPanelRef,
  onVerticalResizeStart,
}: BuilderLeftPanelProps) {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [leftTab, setLeftTab] = useState<"skills" | "notes" | "debug">("notes");

  // ── Latest evaluation — lifted from AssistantGmNotes for the Debug tab ────
  const [latestEval, setLatestEval] = useState<RosterEvaluation | null>(null);

  // ── Scroll position preservation across tab switches ──────────────────────
  const notesScrollRef = useRef<HTMLDivElement>(null);
  const debugScrollRef = useRef<HTMLDivElement>(null);
  const savedScrollPos = useRef<Record<"notes" | "debug", number>>({ notes: 0, debug: 0 });

  /* Restore scroll position synchronously after DOM mutation (before paint) */
  useLayoutEffect(() => {
    if (leftTab === "notes" && notesScrollRef.current) {
      notesScrollRef.current.scrollTop = savedScrollPos.current.notes;
    } else if (leftTab === "debug" && debugScrollRef.current) {
      debugScrollRef.current.scrollTop = savedScrollPos.current.debug;
    }
  }, [leftTab]);

  return (
    <div
      id="builder-left-panel"
      ref={leftPanelRef}
      className="flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden pr-0 lg:pr-1"
    >
      {/* Rotation card — SalaryCap gauge + CourtLineup */}
      <div
        id="builder-roster-card"
        className={cn(
          "bg-[#f7f7f7] border border-[#d9d0c9] rounded-lg overflow-hidden flex flex-col min-h-0",
          isWideLayout ? "flex-[0_1_auto]" : "flex-shrink-0 mb-3",
        )}
        style={isWideLayout ? { flex: `${topPanelFrac} 1 0%` } : undefined}
      >
        {/* SalaryCap gauge */}
        <div className="px-5 pt-3 pb-2">
          <SalaryGauge
            usedSalary={usedSalary}
            cap={salaryCap}
            highlightRange={highlightRange}
            previewSalary={pickerHoveredSalary}
            onRemainingClick={(max) => onSalaryCapFilterClick(max)}
          />
        </div>

        {/* CourtLineup — arc starters + bench row */}
        <div id="builder-roster-lineup-wrapper" className="flex-1 min-h-0">
          <CourtLineup
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            selectedSlot={selectedSlot}
            onSlotClick={onSlotClick}
            onRemoveSlot={onRemoveSlot}
            onDropPlayer={onDropPlayer}
            onSwapSlots={onSwapSlots}
            onSlotHover={onSlotHover}
            onSlotHoverEnd={onSlotHoverEnd}
          />
        </div>
      </div>

      {/* Vertical resize handle — warm border accent */}
      <div
        id="builder-vertical-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize roster and notes panels"
        onMouseDown={onVerticalResizeStart}
        className={cn(
          "hidden lg:flex items-center justify-center flex-shrink-0 cursor-row-resize group",
          "h-3 hover:h-4 transition-[height]",
        )}
      >
        <div className="h-px w-16 rounded-full bg-[#d9d0c9] group-hover:bg-[#0e0907]/30 transition-colors" />
      </div>

      {/* Tabbed content area — Skills / GM Notes / Debug */}
      <div
        id="builder-grid-area"
        className={cn(
          "flex flex-col min-h-0 overflow-hidden border border-[#d9d0c9] rounded-lg",
          !isWideLayout && "flex-1",
        )}
        style={isWideLayout ? { flex: `${1 - topPanelFrac} 1 0%` } : undefined}
      >
        {/* Tab bar — Hardwood Amber active indicator */}
        <div id="builder-left-tabs" className="flex border-b border-[#d9d0c9] flex-shrink-0">
          <button
            id="builder-tab-notes"
            type="button"
            onClick={() => setLeftTab("notes")}
            className={cn(
              "px-4 py-2 text-[0.8125rem] font-medium transition-colors",
              leftTab === "notes"
                ? "border-b-2 border-[#ffa05c] text-[#0e0907] -mb-px"
                : "text-[#0e0907]/45 hover:text-[#0e0907]/70",
            )}
          >
            GM Notes
          </button>
          <button
            id="builder-tab-skills"
            type="button"
            onClick={() => setLeftTab("skills")}
            className={cn(
              "px-4 py-2 text-[0.8125rem] font-medium transition-colors",
              leftTab === "skills"
                ? "border-b-2 border-[#ffa05c] text-[#0e0907] -mb-px"
                : "text-[#0e0907]/45 hover:text-[#0e0907]/70",
            )}
          >
            Skills
          </button>
          {/* Debug tab — admin only */}
          {isAdmin && (
            <button
              id="builder-tab-debug"
              type="button"
              onClick={() => setLeftTab("debug")}
              className={cn(
                "px-4 py-2 text-[0.8125rem] font-medium transition-colors",
                leftTab === "debug"
                  ? "border-b-2 border-[#ffa05c] text-[#0e0907] -mb-px"
                  : "text-[#0e0907]/45 hover:text-[#0e0907]/70",
              )}
            >
              Debug
            </button>
          )}
        </div>

        {/* Tab panels — all mounted for scroll preservation, inactive get hidden */}

        {/* Skills panel */}
        <div
          id="builder-skill-grid-wrapper"
          className={cn("flex-1 min-h-0 overflow-hidden", leftTab !== "skills" && "hidden")}
        >
          <SkillGrid
            allSlots={allSlots}
            cornerstoneId={cornerstoneId}
            legendProfile={legendDetail?.profile ?? null}
            hideEmptyColumns
          />
        </div>

        {/* GM Notes panel */}
        <div
          id="builder-gm-notes-wrapper"
          ref={notesScrollRef}
          onScroll={() => {
            savedScrollPos.current.notes = notesScrollRef.current?.scrollTop ?? 0;
          }}
          className={cn(
            "flex-1 min-h-0 overflow-y-auto p-3 flex flex-col",
            leftTab !== "notes" && "hidden",
          )}
        >
          <AssistantGmNotes
            allSlots={allSlots}
            legendDetail={legendDetail}
            isAdmin={isAdmin}
            onEvaluation={setLatestEval}
            onSuggestionFilter={onSuggestionFilter}
          />
        </div>

        {/* Debug panel — admin only */}
        {isAdmin && (
          <div
            id="builder-debug-wrapper"
            ref={debugScrollRef}
            onScroll={() => {
              savedScrollPos.current.debug = debugScrollRef.current?.scrollTop ?? 0;
            }}
            className={cn(
              "flex-1 min-h-0 overflow-y-auto p-3",
              leftTab !== "debug" && "hidden",
            )}
          >
            {latestEval && (
              <CohesionDebugPanel evaluation={latestEval} />
            )}
            {latestEval && (
              <details id="builder-debug-notes-json" className="mt-4">
                <summary className="cursor-pointer text-[0.625rem] font-semibold uppercase tracking-wider text-[#0e0907]/35 hover:text-[#0e0907]/60">
                  Raw Notes JSON
                </summary>
                <pre id="builder-debug-notes-json-content" className="mt-2 max-h-[400px] overflow-auto rounded-md border border-[#d9d0c9]/60 bg-[#f0f0f0]/50 p-2 text-[0.5625rem] font-mono text-[#0e0907]/45 whitespace-pre-wrap">
                  {JSON.stringify(latestEval.notes, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
