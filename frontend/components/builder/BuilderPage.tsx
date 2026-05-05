"use client";

/**
 * BuilderPage.tsx — Thin orchestrator for the /builder route.
 *
 * Two modes driven by URL params:
 *   - Picker mode  (no ?cornerstone= param): shows LegendPickerGrid
 *   - Builder mode (?cornerstone=<id>):       shows split-panel layout
 *
 * All domain logic lives in extracted hooks:
 *   - useRosterSlots: slot state, selection, URL sync
 *   - useBuilderSalary: salary computation, cap filtering
 *   - useResizablePanel: drag-to-resize split panels
 *
 * Layout is delegated to BuilderHeader, BuilderLeftPanel, and PlayerPickerPanel.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, getLegend } from "@/lib/api";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { useRosterSlots } from "@/lib/hooks/useRosterSlots";
import { useBuilderSalary } from "@/lib/hooks/useBuilderSalary";
import { useResizablePanel } from "@/lib/hooks/useResizablePanel";
import { LegendPickerGrid } from "./LegendPickerGrid";
import { BuilderHeader } from "./BuilderHeader";
import { BuilderLeftPanel } from "./BuilderLeftPanel";
import { PlayerPickerPanel } from "./PlayerPickerPanel";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { LegendDetail, PlayerWithSkills } from "@/lib/types";

export function BuilderPage() {
  const searchParams = useSearchParams();
  const { isAdmin } = useAdminStatus();

  // ── Data fetching — single bulk load of all players + legends ─────────────
  const [legendRows, setLegendRows] = useState<PlayerWithSkills[]>([]);
  const [activeRows, setActiveRows] = useState<PlayerWithSkills[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    setDataLoading(true);
    listPlayersWithSkills()
      .then((res) => {
        if (res.success && res.data) {
          setLegendRows(res.data.filter((p) => p.is_legend === true));
          setActiveRows(res.data.filter((p) => !p.is_legend));
        } else {
          setDataError(res.error ?? "Failed to load data");
        }
      })
      .catch(() => setDataError("Failed to load data"))
      .finally(() => setDataLoading(false));
  }, []);

  // ── Cornerstone — derived from URL + legend rows ──────────────────────────
  const cornerstoneId = searchParams.get("cornerstone");
  const cornerstone = useMemo(
    () => legendRows.find((l) => l.id === cornerstoneId) ?? null,
    [legendRows, cornerstoneId],
  );

  // ── Full legend profile for skill grid and GM Notes ───────────────────────
  const [legendDetail, setLegendDetail] = useState<LegendDetail | null>(null);

  useEffect(() => {
    if (!cornerstoneId) {
      setLegendDetail(null);
      return;
    }
    getLegend(cornerstoneId)
      .then((res) => {
        if (res.success && res.data) setLegendDetail(res.data);
      })
      .catch(() => {/* grid handles missing profile gracefully */});
  }, [cornerstoneId]);

  // ── Domain hooks ──────────────────────────────────────────────────────────
  const roster = useRosterSlots(cornerstoneId, legendRows, activeRows);
  const { splitRef, leftPanelRef, rightPanelFrac, topPanelFrac, handleResizeStart, handleVerticalResizeStart } =
    useResizablePanel();

  // ── Hover state — bridges court lineup ↔ salary gauge ↔ picker ────────────
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [hoveredCourtPlayerId, setHoveredCourtPlayerId] = useState<string | null>(null);

  const salary = useBuilderSalary(roster.allSlots, cornerstoneId, hoveredSlotIndex);

  // ── Mobile player picker toggle ───────────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isWideBuilderLayout, setIsWideBuilderLayout] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const syncLayoutMode = () => setIsWideBuilderLayout(mediaQuery.matches);
    syncLayoutMode();
    mediaQuery.addEventListener("change", syncLayoutMode);
    return () => mediaQuery.removeEventListener("change", syncLayoutMode);
  }, []);

  // ── Suggestion-driven skill filter for player picker ──────────────────────
  const [suggestionFilterTrigger, setSuggestionFilterTrigger] = useState<SuggestionFilter | null>(null);
  const [pickerFlashKey, setPickerFlashKey] = useState(0);
  const [pickerFlashing, setPickerFlashing] = useState(false);

  // Brief orange ring flash on the picker when a suggestion filter is pushed
  useEffect(() => {
    if (pickerFlashKey === 0) return;
    setPickerFlashing(true);
    const t = setTimeout(() => setPickerFlashing(false), 900);
    return () => clearTimeout(t);
  }, [pickerFlashKey]);

  const handleSuggestionFilter = useCallback(
    (filter: SuggestionFilter) => {
      setSuggestionFilterTrigger(filter);
      setPickerFlashKey((k) => k + 1);
      setPickerOpen(true);
    },
    [],
  );

  // ── Slot hover handlers (bridge court lineup → salary gauge + picker) ─────
  const handleSlotHover = useCallback(
    (slotIndex: number) => {
      setHoveredSlotIndex(slotIndex);
      const occupant = roster.allSlots[slotIndex - 1];
      setHoveredCourtPlayerId(occupant?.id ?? null);
    },
    [roster.allSlots],
  );

  const handleSlotHoverEnd = useCallback(() => {
    setHoveredSlotIndex(null);
    setHoveredCourtPlayerId(null);
  }, []);

  // ── Back-to-picker handler ────────────────────────────────────────────────
  const handleBackToPicker = useCallback(() => {
    // Trigger legend removal which clears slots and navigates to picker mode
    if (roster.allSlots[0]) {
      roster.handleRemoveSlot(1);
    }
  }, [roster]);

  // ── Loading / error states ────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div id="builder-loading" className="max-w-screen-2xl mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-40 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div id="builder-error" className="max-w-screen-2xl mx-auto px-4 py-8">
        <p className="text-destructive text-sm">{dataError}</p>
      </div>
    );
  }

  // ── Picker mode ───────────────────────────────────────────────────────────
  if (!cornerstoneId || !cornerstone) {
    return (
      <main id="builder-picker-page" className="max-w-screen-2xl mx-auto px-4 py-6 space-y-4">
        <div id="builder-picker-header">
          <h1 id="builder-picker-title" className="text-xl font-bold text-foreground">
            Pick Your Cornerstone
          </h1>
          <p id="builder-picker-subtitle" className="text-sm text-muted-foreground mt-1">
            Select an all-time great to anchor your 8-man rotation.
          </p>
        </div>
        <LegendPickerGrid legends={legendRows} onSelectLegend={roster.handleSelectLegend} />
      </main>
    );
  }

  // ── Builder mode ──────────────────────────────────────────────────────────
  return (
    <main id="builder-page" className="max-w-screen-2xl mx-auto px-4 py-4 h-[calc(100vh-3rem)] flex flex-col">
      <BuilderHeader
        cornerstone={cornerstone}
        allSlotsFilled={roster.allSlots.every((p) => p !== null)}
        pickerOpen={pickerOpen}
        onPickerToggle={() => setPickerOpen((v) => !v)}
        onBackToPicker={handleBackToPicker}
      />

      {/* Resizable split — left (builder) + drag handle + right (player picker) */}
      <div id="builder-split" ref={splitRef} className="flex-1 flex flex-col lg:flex-row min-h-0">
        <BuilderLeftPanel
          allSlots={roster.allSlots}
          cornerstoneId={cornerstoneId}
          legendDetail={legendDetail}
          selectedSlot={roster.selectedSlot}
          usedSalary={salary.usedSalary}
          highlightRange={salary.highlightRange}
          pickerHoveredSalary={salary.pickerHoveredSalary}
          onSalaryCapFilterClick={(max) => salary.setSalaryCapFilter(max)}
          isAdmin={isAdmin}
          onSlotClick={roster.handleSlotClick}
          onRemoveSlot={roster.handleRemoveSlot}
          onDropPlayer={roster.handleDropPlayer}
          onSwapSlots={roster.handleSwapSlots}
          onSlotHover={handleSlotHover}
          onSlotHoverEnd={handleSlotHoverEnd}
          onSuggestionFilter={handleSuggestionFilter}
          isWideLayout={isWideBuilderLayout}
          topPanelFrac={topPanelFrac}
          leftPanelRef={leftPanelRef}
          onVerticalResizeStart={handleVerticalResizeStart}
        />

        {/* Drag handle — resizes right panel */}
        <div
          id="builder-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize player panel"
          onMouseDown={handleResizeStart}
          className={cn(
            "hidden lg:flex items-center justify-center flex-shrink-0 cursor-col-resize group",
            "w-3 hover:w-4 transition-[width]",
          )}
        >
          <div className="w-px h-12 rounded-full bg-border group-hover:bg-foreground/30 transition-colors" />
        </div>

        {/* Right panel: player picker */}
        <div
          id="builder-right-panel"
          className={cn(
            "flex-col min-w-0 border rounded-lg p-3 overflow-hidden lg:flex-shrink-0 transition-[box-shadow,border-color] duration-300",
            "lg:flex",
            pickerOpen ? "flex" : "hidden",
            pickerFlashing
              ? "border-orange-400 ring-2 ring-orange-400/60 shadow-[0_0_16px_rgba(251,146,60,0.35)]"
              : "border-border",
          )}
          style={{ width: `${Math.round(rightPanelFrac * 100)}%` }}
        >
          <PlayerPickerPanel
            players={activeRows}
            loading={false}
            error={null}
            remainingSalary={salary.remainingSalary}
            salaryFilterTrigger={salary.salaryCapFilter}
            onSalaryFilterInjected={() => salary.setSalaryCapFilter(null)}
            skillFilterTrigger={suggestionFilterTrigger}
            onSkillFilterInjected={() => setSuggestionFilterTrigger(null)}
            rosterPlayerIds={roster.rosterPlayerIds}
            selectedSlot={roster.selectedSlot}
            onPlayerClick={roster.handlePlayerClick}
            onPlayerHover={(s) => salary.setPickerHoveredSalary(s)}
            onPlayerHoverEnd={() => salary.setPickerHoveredSalary(null)}
            highlightedPlayerId={hoveredCourtPlayerId}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </main>
  );
}
