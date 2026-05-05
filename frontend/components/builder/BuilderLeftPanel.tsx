/**
 * BuilderLeftPanel — Left side of the builder split layout.
 *
 * Contains the roster card (salary gauge + court lineup) on top,
 * and a tabbed area (GM Notes / Skills / Debug) below.
 * Owns tab state and scroll position preservation internally.
 */

"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SALARY_CAP } from "@/lib/builder-config";
import { SalaryGauge } from "./SalaryGauge";
import { CourtLineup } from "./CourtLineup";
import { SkillGrid } from "./SkillGrid";
import { AssistantGmNotes } from "./AssistantGmNotes";
import { CohesionDebugPanel } from "./CohesionDebugPanel";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { LegendDetail, PlayerWithSkills, RosterEvaluation } from "@/lib/types";

interface BuilderLeftPanelProps {
  // Roster card props
  allSlots: (PlayerWithSkills | null)[];
  cornerstoneId: string;
  legendDetail: LegendDetail | null;
  selectedSlot: number | null;
  usedSalary: number;
  highlightRange: { startFrac: number; endFrac: number } | null;
  pickerHoveredSalary: number | null;
  onSalaryCapFilterClick: (max: number) => void;
  isAdmin: boolean;

  // Court lineup handlers
  onSlotClick: (slotIndex: number) => void;
  onRemoveSlot: (slotIndex: number) => void;
  onDropPlayer: (slotIndex: number, player: PlayerWithSkills) => void;
  onSwapSlots: (fromSlot: number, toSlot: number) => void;
  onSlotHover: (slotIndex: number) => void;
  onSlotHoverEnd: () => void;

  // GM Notes suggestion filter callback
  onSuggestionFilter: (filter: SuggestionFilter) => void;

  // Layout
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

  // Restore scroll position synchronously after DOM mutation (before paint)
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
      {/* Roster card — salary bar + court lineup */}
      <div
        id="builder-roster-card"
        className={cn(
          "bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col min-h-0",
          isWideLayout ? "flex-[0_1_auto]" : "flex-shrink-0 mb-3",
        )}
        style={isWideLayout ? { flex: `${topPanelFrac} 1 0%` } : undefined}
      >
        {/* Salary gauge */}
        <div className="px-5 pt-3 pb-2">
          <SalaryGauge
            usedSalary={usedSalary}
            cap={SALARY_CAP}
            highlightRange={highlightRange}
            previewSalary={pickerHoveredSalary}
            onRemainingClick={(max) => onSalaryCapFilterClick(max)}
          />
        </div>

        {/* Court lineup — arc starters + bench row */}
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

      {/* Vertical resize handle */}
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
        <div className="h-px w-16 rounded-full bg-border group-hover:bg-foreground/30 transition-colors" />
      </div>

      {/* Tabbed content area — Skills / GM Notes / Debug */}
      <div
        id="builder-grid-area"
        className={cn(
          "flex flex-col min-h-0 overflow-hidden border border-border rounded-lg",
          !isWideLayout && "flex-1",
        )}
        style={isWideLayout ? { flex: `${1 - topPanelFrac} 1 0%` } : undefined}
      >
        {/* Tab bar */}
        <div id="builder-left-tabs" className="flex border-b border-border flex-shrink-0">
          <button
            id="builder-tab-notes"
            type="button"
            onClick={() => setLeftTab("notes")}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors",
              leftTab === "notes"
                ? "border-b-2 border-amber-500 text-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            GM Notes
          </button>
          <button
            id="builder-tab-skills"
            type="button"
            onClick={() => setLeftTab("skills")}
            className={cn(
              "px-4 py-2 text-xs font-medium transition-colors",
              leftTab === "skills"
                ? "border-b-2 border-primary text-foreground -mb-px"
                : "text-muted-foreground hover:text-foreground",
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
                "px-4 py-2 text-xs font-medium transition-colors",
                leftTab === "debug"
                  ? "border-b-2 border-violet-500 text-violet-400 -mb-px"
                  : "text-muted-foreground hover:text-foreground",
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
                <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Raw Notes JSON
                </summary>
                <pre id="builder-debug-notes-json-content" className="mt-2 max-h-[400px] overflow-auto rounded border border-border/60 bg-muted/30 p-2 text-[9px] font-mono text-muted-foreground whitespace-pre-wrap">
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
