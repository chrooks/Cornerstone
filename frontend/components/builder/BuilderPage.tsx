"use client";

/**
 * BuilderPage.tsx — Orchestrator for the /lab/[ruleset]/build route.
 *
 * Layout (top to bottom):
 *   1. Header row: breadcrumb, title, SalaryCap gauge, Evaluate CTA
 *   2. Court strip: full-width compact row of 9 slots, starter/bench divider
 *   3. Workspace: PlayerPool (primary, ~65%) | Feedback (secondary, ~35%, collapsible)
 *
 * Requires ?cornerstone=<id>. Redirects to /lab/[ruleset]/legends if missing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { listPlayersWithSkills, getLegend } from "@/lib/api";
import { useAdminStatus } from "@/lib/hooks/useAdminStatus";
import { useRosterSlots } from "@/lib/hooks/useRosterSlots";
import { useBuilderSalary } from "@/lib/hooks/useBuilderSalary";
import { useBuilderEvaluation } from "@/lib/hooks/useBuilderEvaluation";
import { BuilderHeader } from "./BuilderHeader";
import { CourtStrip } from "./CourtStrip";
import { PlayerPickerPanel } from "./PlayerPickerPanel";
import { BuilderFeedbackPanel, type BuilderInspectionSource } from "./BuilderFeedbackPanel";
import { BuilderPlayerFit } from "./BuilderPlayerFit";
import { PlayerProfileModal, playerWithSkillsToProfile } from "@/components/players/PlayerView";
import type { SuggestionFilter } from "@/lib/noteFilters";
import type { LegendDetail, PlayerWithSkills } from "@/lib/types";

/** Default workspace split: PlayerPool gets 65%, Feedback gets 35% */
const DEFAULT_FEEDBACK_FRAC = 0.35;
const MIN_FEEDBACK_FRAC = 0.20;
const MAX_FEEDBACK_FRAC = 0.50;

export function BuilderPage() {
  const searchParams = useSearchParams();
  const params = useParams();
  const router = useRouter();
  const { isAdmin } = useAdminStatus();

  /* RuleSet slug from the dynamic route segment */
  const ruleset = (params.ruleset as string) ?? "standard";

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

  // ── No cornerstone → redirect to Legends picker ──────────────────────────
  useEffect(() => {
    if (!dataLoading && !cornerstoneId) {
      router.replace(`/lab/${ruleset}/legends`);
    }
  }, [dataLoading, cornerstoneId, ruleset, router]);

  // ── Full Legend profile for Skill Profile and Feedback ────────────────────
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

  // ── Hover state — bridges court strip ↔ salary gauge ↔ picker ────────────
  const [hoveredSlotIndex, setHoveredSlotIndex] = useState<number | null>(null);
  const [hoveredCourtPlayerId, setHoveredCourtPlayerId] = useState<string | null>(null);

  const salary = useBuilderSalary(roster.allSlots, cornerstoneId, hoveredSlotIndex);

  // ── Feedback collapse state ───────────────────────────────────────────────
  const [feedbackCollapsed, setFeedbackCollapsed] = useState(false);
  const [hasUnreadFeedback, setHasUnreadFeedback] = useState(false);
  const { latestEval } = useBuilderEvaluation({ allSlots: roster.allSlots, legendDetail, isAdmin });

  useEffect(() => {
    if (latestEval && feedbackCollapsed) setHasUnreadFeedback(true);
  }, [feedbackCollapsed, latestEval]);

  /* Expanding Feedback clears the unread indicator */
  const handleExpandFeedback = useCallback(() => {
    setFeedbackCollapsed(false);
    setHasUnreadFeedback(false);
  }, []);

  // ── Player-scoped note filtering (slot click → filter Feedback) ──────────
  const [focusedPlayerName, setFocusedPlayerName] = useState<string | null>(null);

  const handleSlotClick = useCallback((slotIndex: number) => {
    const occupant = roster.allSlots[slotIndex - 1];
    roster.handleSlotClick(slotIndex);

    if (!occupant) {
      setFocusedPlayerName(null);
      return;
    }

    /* Toggle: click same player = deselect, click different = switch */
    setFocusedPlayerName((prev) =>
      prev === occupant.name ? null : occupant.name,
    );
  }, [roster]);

  const handleClearPlayerFocus = useCallback(() => {
    setFocusedPlayerName(null);
  }, []);

  const handleShowPlayerInFeedback = useCallback((player: PlayerWithSkills) => {
    setFocusedPlayerName(player.name);
    setFeedbackCollapsed(false);
    setHasUnreadFeedback(false);
  }, []);

  const handlePlayerPick = useCallback((player: PlayerWithSkills) => {
    const selectedSlot = roster.selectedSlot;
    const canFillSelectedSlot =
      selectedSlot !== null && roster.allSlots[selectedSlot - 1]?.id !== cornerstoneId;
    const hasOpenSlot = roster.allSlots.some((slotPlayer) => slotPlayer === null);

    roster.handlePlayerClick(player);
    if (canFillSelectedSlot || hasOpenSlot) {
      handleShowPlayerInFeedback(player);
    }
  }, [cornerstoneId, handleShowPlayerInFeedback, roster]);

  const handleDropPlayer = useCallback((slotIndex: number, player: PlayerWithSkills) => {
    const canDropIntoSlot = roster.allSlots[slotIndex - 1]?.id !== cornerstoneId;

    roster.handleDropPlayer(slotIndex, player);
    if (canDropIntoSlot) {
      handleShowPlayerInFeedback(player);
    }
  }, [cornerstoneId, handleShowPlayerInFeedback, roster]);

  const [buildProfilePlayer, setBuildProfilePlayer] = useState<PlayerWithSkills | null>(null);
  const hasAvailableBuildSlot = roster.rosterPlayerIds.size < roster.allSlots.length;
  const buildProfile = useMemo(
    () => (buildProfilePlayer ? playerWithSkillsToProfile(buildProfilePlayer) : null),
    [buildProfilePlayer],
  );

  const handleSlotContextMenu = useCallback((slotIndex: number) => {
    const occupant = roster.allSlots[slotIndex - 1];
    if (occupant) setBuildProfilePlayer(occupant);
  }, [roster.allSlots]);

  const handleCloseBuildProfile = useCallback(() => {
    setBuildProfilePlayer(null);
  }, []);

  // ── Suggestion-driven skill filter for PlayerPool ─────────────────────────
  const [suggestionFilterTrigger, setSuggestionFilterTrigger] = useState<SuggestionFilter | null>(null);
  const [pickerFlashKey, setPickerFlashKey] = useState(0);
  const [pickerFlashing, setPickerFlashing] = useState(false);

  useEffect(() => {
    if (pickerFlashKey === 0) return;
    setPickerFlashing(true);
    const t = setTimeout(() => setPickerFlashing(false), 900);
    return () => clearTimeout(t);
  }, [pickerFlashKey]);

  const handleSuggestionFilter = useCallback((filter: SuggestionFilter) => {
    setSuggestionFilterTrigger(filter);
    setPickerFlashKey((k) => k + 1);
  }, []);

  const handleSlotHover = useCallback((slotIndex: number) => {
    setHoveredSlotIndex(slotIndex);
    const occupant = roster.allSlots[slotIndex - 1];
    setHoveredCourtPlayerId(occupant?.id ?? null);
  }, [roster.allSlots]);

  const handleSlotHoverEnd = useCallback(() => {
    setHoveredSlotIndex(null);
    setHoveredCourtPlayerId(null);
  }, []);

  const inspection = useMemo<{ player: PlayerWithSkills | null; source: BuilderInspectionSource }>(() => {
    if (focusedPlayerName) {
      return {
        player: roster.allSlots.find((player) => player?.name === focusedPlayerName) ?? null,
        source: "build-player",
      };
    }
    return { player: null, source: "build" };
  }, [focusedPlayerName, roster.allSlots]);

  // ── Workspace horizontal resize (PlayerPool | Feedback) ───────────────────
  const [feedbackFrac, setFeedbackFrac] = useState(DEFAULT_FEEDBACK_FRAC);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startFrac = feedbackFrac;

    const onMove = (moveEvent: MouseEvent) => {
      if (!workspaceRef.current || !isDraggingRef.current) return;
      const containerWidth = workspaceRef.current.getBoundingClientRect().width;
      const dx = moveEvent.clientX - startX;
      const deltaFrac = dx / containerWidth;
      /* Feedback panel grows when handle moves left (subtract delta) */
      const newFrac = Math.max(MIN_FEEDBACK_FRAC, Math.min(MAX_FEEDBACK_FRAC, startFrac - deltaFrac));
      setFeedbackFrac(newFrac);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [feedbackFrac]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (dataLoading) {
    return (
      <div id="builder-loading" className="max-w-screen-2xl mx-auto px-6 py-8 space-y-4 animate-pulse">
        <div className="h-4 w-56 bg-[#0e0907]/[0.06] rounded-sm" />
        <div className="h-8 w-72 bg-[#0e0907]/[0.06] rounded-sm" />
        <div className="h-16 bg-[#0e0907]/[0.04] rounded-lg" />
        <div className="flex gap-4 flex-1">
          <div className="flex-1 bg-[#0e0907]/[0.04] rounded-lg h-[60vh]" />
          <div className="w-[35%] bg-[#0e0907]/[0.04] rounded-lg h-[60vh]" />
        </div>
      </div>
    );
  }

  if (dataError) {
    return (
      <div id="builder-error" className="max-w-screen-2xl mx-auto px-6 py-8">
        <p className="text-[#e53e3e] text-[0.9375rem]">{dataError}</p>
      </div>
    );
  }

  if (!cornerstoneId || !cornerstone) {
    return null;
  }

  // ── Builder workspace ─────────────────────────────────────────────────────
  return (
    <main id="builder-page" className="max-w-screen-2xl mx-auto px-6 pt-4 pb-2 h-[calc(100vh-3rem)] flex flex-col">
      {/* Row 1: Header — breadcrumb, title, SalaryCap gauge, Evaluate CTA */}
      <BuilderHeader
        cornerstone={cornerstone}
        ruleset={ruleset}
        allSlotsFilled={roster.allSlots.every((p) => p !== null)}
      />

      {/* Row 2: Court strip — salary gauge + centered slot row */}
      <CourtStrip
        allSlots={roster.allSlots}
        cornerstoneId={cornerstoneId}
        focusedPlayerName={focusedPlayerName}
        usedSalary={salary.usedSalary}
        highlightRange={salary.highlightRange}
        pickerHoveredSalary={salary.pickerHoveredSalary}
        onSalaryCapFilterClick={(max) => salary.setSalaryCapFilter(max)}
        onSlotClick={handleSlotClick}
        onRemoveSlot={roster.handleRemoveSlot}
        onDropPlayer={handleDropPlayer}
        onSwapSlots={roster.handleSwapSlots}
        onSlotHover={handleSlotHover}
        onSlotHoverEnd={handleSlotHoverEnd}
        onSlotContextMenu={handleSlotContextMenu}
      />

      {/* Row 3: Workspace — PlayerPool (primary) | Feedback (secondary, collapsible) */}
      <div
        id="builder-workspace"
        ref={workspaceRef}
        className="flex-1 flex min-h-0 mt-3 gap-0"
      >
        {/* PlayerPool — primary workspace */}
        <div
          id="builder-playerpool-panel"
          className={cn(
            "flex-1 min-w-0 border border-[#d9d0c9] rounded-lg p-3 overflow-hidden flex flex-col",
            pickerFlashing && "border-[#ffa05c] ring-1 ring-[#ffa05c]/40",
          )}
          style={!feedbackCollapsed ? { flex: `${1 - feedbackFrac} 1 0%` } : undefined}
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
            onPlayerClick={handlePlayerPick}
            onPlayerHover={(s) => salary.setPickerHoveredSalary(s)}
            onPlayerHoverEnd={() => salary.setPickerHoveredSalary(null)}
            renderPlayerFit={(player, context) => (
              <BuilderPlayerFit
                player={player}
                allSlots={roster.allSlots}
                latestEval={latestEval}
                surface={context.surface}
                canAddToBuild={context.canAddToBuild}
                onAddToBuild={context.addToBuild}
                onShowInFeedback={(focusedPlayer) => {
                  handleShowPlayerInFeedback(focusedPlayer);
                  context.dismissProfile?.();
                }}
              />
            )}
            highlightedPlayerId={hoveredCourtPlayerId}
            isAdmin={isAdmin}
          />
        </div>

        {/* Resize handle — between PlayerPool and Feedback */}
        {!feedbackCollapsed && (
          <div
            id="builder-workspace-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize notes panel"
            onMouseDown={handleResizeStart}
            className="flex items-center justify-center flex-shrink-0 cursor-col-resize group w-3 hover:w-4 transition-[width]"
          >
            <div className="w-px h-12 rounded-full bg-[#d9d0c9] group-hover:bg-[#0e0907]/30 transition-colors" />
          </div>
        )}

        {/* Feedback — secondary panel, collapsible */}
        <div
          id="builder-notes-panel"
          className="flex-shrink-0 min-w-0 overflow-hidden flex flex-col"
          style={feedbackCollapsed ? { flex: "0 0 2.5rem" } : { flex: `${feedbackFrac} 1 0%` }}
        >
          <BuilderFeedbackPanel
            allSlots={roster.allSlots}
            cornerstoneId={cornerstoneId}
            legendDetail={legendDetail}
            isAdmin={isAdmin}
            collapsed={feedbackCollapsed}
            hasUnreadFeedback={hasUnreadFeedback}
            latestEval={latestEval}
            inspectedPlayer={inspection.player}
            inspectionSource={inspection.source}
            focusedPlayerName={focusedPlayerName}
            onClearPlayerFocus={handleClearPlayerFocus}
            onCollapse={() => setFeedbackCollapsed(true)}
            onExpand={handleExpandFeedback}
            onSuggestionFilter={handleSuggestionFilter}
          />
        </div>
      </div>

      {buildProfile && buildProfilePlayer && (
        <PlayerProfileModal
          profile={buildProfile}
          boxStats={null}
          onDismiss={handleCloseBuildProfile}
          fitContent={
            <BuilderPlayerFit
              player={buildProfilePlayer}
              allSlots={roster.allSlots}
              latestEval={latestEval}
              surface="profile"
              canAddToBuild={hasAvailableBuildSlot && !roster.rosterPlayerIds.has(buildProfilePlayer.id)}
              onAddToBuild={handlePlayerPick}
              onShowInFeedback={(focusedPlayer) => {
                handleShowPlayerInFeedback(focusedPlayer);
                handleCloseBuildProfile();
              }}
            />
          }
        />
      )}
    </main>
  );
}
