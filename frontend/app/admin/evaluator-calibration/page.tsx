"use client";

/**
 * Evaluator Calibration Page: admin tool for inspecting and tuning the cohesion engine.
 *
 * Three-panel layout (mirrors existing /admin/calibration pattern):
 *   Left (~380px):  PlayerCompositePanel — search + composite bars + bell curve overlay
 *   Center (flex):  Tabbed — "Bell Curves" | "Lineup Tester" | "Weights"
 *   Right (~320px): ResultsPanel — test history with before/after comparison
 *
 * All state lifted to page level via custom hooks. No global stores.
 */

import { useState, useCallback, useRef } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { compositeCoefficientsFromEvaluationValues } from "@/lib/cohesion-constants";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import {
  fetchPlayerComposites,
  fetchBellCurve,
  evaluateLineup,
  evaluateRotation,
} from "@/lib/api";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { Player } from "@/lib/types";
import type { PlayerCompositeData, BellCurveData, LineupTestResult, CenterTab, ReferencePlayer } from "./types";
import { WeightsEditor } from "./components/WeightsEditor";
import { ResultsPanel } from "./components/ResultsPanel";
import { CompositeBars, PlayerSkillsPanel } from "./components/PlayerInspection";
import { LineupTester, emptyLineupSlot } from "./components/LineupTester";
import { BellCurveChart } from "./components/BellCurveCharts";
import { FormulaEditor } from "./components/FormulaEditor";
import { useLineupSlots } from "./hooks/useLineupSlots";
import { useTestHistory } from "./hooks/useTestHistory";
import { useTeamFill } from "./hooks/useTeamFill";
import { useCohesionWeights } from "./hooks/useCohesionWeights";
import { useEvaluationVersion } from "./hooks/useEvaluationVersion";
import { EvaluationVersionHeader } from "./components/EvaluationVersionHeader";
import { DraftBanner } from "./components/DraftBanner";
import { DiffDrawer } from "./components/DiffDrawer";
import { PublishDialog } from "./components/PublishDialog";
import { FormulaHandlerPicker } from "./components/FormulaHandlerPicker";
import { PanelResizeHandle } from "./components/PanelResizeHandle";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENTER_TABS: { key: CenterTab; label: string }[] = [
  { key: "lineup", label: "Lineup Tester" },
  { key: "bell_curves", label: "Bell Curves" },
  { key: "weights", label: "Weights" },
  { key: "handlers", label: "Handlers" },
  { key: "formulas", label: "Formulas" },
];

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CohesionCalibrationPage() {
  // --- Custom hooks ---
  const {
    lineupSlots,
    swapSourceIndex,
    setSwapSourceIndex,
    hydrateLineupSlot,
    handleSlotSelect,
    handleSlotReplace,
    handleSlotRemove,
    handleSwapTarget,
    fillSlots,
  } = useLineupSlots();

  const {
    testHistory,
    setActiveResultId,
    latestResult,
    addResult,
  } = useTestHistory();

  const {
    teamFillPlayers,
    teamFillLoading,
    setTeamFillLoading,
    selectedTeam,
    setSelectedTeam,
    teamOptions,
  } = useTeamFill();

  const { cohesionWeights, reloadWeights } = useCohesionWeights();

  const {
    active: activeVersion,
    draft: draftVersion,
    diff: versionDiff,
    loading: versionLoading,
    createDraft: handleCreateDraft,
    patch: handlePatchDraft,
    validate: handleValidateDraft,
    publish: handlePublishDraft,
    discardDraft: handleDiscardDraft,
    versions: allVersions,
    reactivate: handleReactivateVersion,
  } = useEvaluationVersion();

  // --- Diff drawer + publish dialog state ---
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  // --- Left panel state ---
  const [selectedComposites, setSelectedComposites] = useState<PlayerCompositeData | null>(null);
  const [loadingComposites, setLoadingComposites] = useState(false);

  // --- Bell curve overlay state ---
  const [overlayPlayers, setOverlayPlayers] = useState<BellCurveData[]>([]);
  const [refreshingCurves, setRefreshingCurves] = useState(false);

  // --- Center tab state ---
  const [centerTab, setCenterTab] = useState<CenterTab>("lineup");

  // --- Reference player state (for formula preview) ---
  const [referencePlayers, setReferencePlayers] = useState<ReferencePlayer[]>([]);

  // --- Panel layout state ---
  const [leftPanelWidth, setLeftPanelWidth] = useState(380);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftWidthBeforeCollapse = useRef(380);
  const rightWidthBeforeCollapse = useRef(320);

  const handleLeftResize = useCallback((deltaX: number) => {
    setLeftPanelWidth((prev) => Math.max(200, Math.min(600, prev + deltaX)));
  }, []);

  const handleRightResize = useCallback((deltaX: number) => {
    // Right panel grows when dragged left (negative delta).
    setRightPanelWidth((prev) => Math.max(200, Math.min(500, prev - deltaX)));
  }, []);

  const toggleLeftCollapsed = useCallback(() => {
    setLeftCollapsed((prev) => {
      if (!prev) {
        leftWidthBeforeCollapse.current = leftPanelWidth;
      } else {
        setLeftPanelWidth(leftWidthBeforeCollapse.current);
      }
      return !prev;
    });
  }, [leftPanelWidth]);

  const toggleRightCollapsed = useCallback(() => {
    setRightCollapsed((prev) => {
      if (!prev) {
        rightWidthBeforeCollapse.current = rightPanelWidth;
      } else {
        setRightPanelWidth(rightWidthBeforeCollapse.current);
      }
      return !prev;
    });
  }, [rightPanelWidth]);

  // --- Evaluation state ---
  const [evaluatingLineup, setEvaluatingLineup] = useState(false);

  // --- Handlers ---

  /** Fetch composites when a player is selected in the left panel search. */
  const handlePlayerSelect = useCallback(async (player: Player) => {
    setLoadingComposites(true);
    const res = await fetchPlayerComposites(player.id);
    if (res.success && res.data) {
      setSelectedComposites(res.data);
    } else {
      toast.error(res.error ?? "Failed to load composites");
      setSelectedComposites(null);
    }
    setLoadingComposites(false);
  }, []);

  /** Add a player's bell curve to the overlay chart. */
  const handleAddToBellCurve = useCallback(async () => {
    if (!selectedComposites) return;
    // Don't add duplicates
    if (overlayPlayers.some((p) => p.player_id === selectedComposites.player_id)) {
      toast.error("Player already on chart");
      return;
    }
    const res = await fetchBellCurve(selectedComposites.player_id);
    if (res.success && res.data) {
      const curveData = res.data;
      setOverlayPlayers((prev) => [...prev, curveData]);
      // Auto-switch to bell curves tab
      setCenterTab("bell_curves");
    } else {
      toast.error(res.error ?? "Failed to load bell curve");
    }
  }, [selectedComposites, overlayPlayers]);

  /** Remove a player from the bell curve overlay. */
  const handleRemoveBellCurvePlayer = useCallback((playerId: string) => {
    setOverlayPlayers((prev) => prev.filter((p) => p.player_id !== playerId));
  }, []);

  /** Re-fetch all overlay players' bell curves after weight/constant changes. */
  const handleRefreshBellCurves = useCallback(async () => {
    if (overlayPlayers.length === 0) return;
    setRefreshingCurves(true);
    try {
      // Fetch all curves in parallel
      const results = await Promise.all(
        overlayPlayers.map((p) => fetchBellCurve(p.player_id))
      );
      // Replace overlay with fresh data, keeping only successful fetches
      const refreshed: BellCurveData[] = [];
      for (const res of results) {
        if (res.success && res.data) refreshed.push(res.data);
      }
      setOverlayPlayers(refreshed);
    } finally {
      setRefreshingCurves(false);
    }
  }, [overlayPlayers]);

  /** Wrapper for slot select that also clears the active result. */
  const handleLineupSlotSelect = useCallback(async (index: number, player: Player) => {
    await handleSlotSelect(index, player);
    setActiveResultId(null);
  }, [handleSlotSelect, setActiveResultId]);

  /** Wrapper for slot replace that also clears the active result. */
  const handleLineupSlotReplace = useCallback((index: number) => {
    handleSlotReplace(index);
    setActiveResultId(null);
  }, [handleSlotReplace, setActiveResultId]);

  /** Wrapper for slot remove that also clears the active result. */
  const handleLineupSlotRemove = useCallback((index: number) => {
    handleSlotRemove(index);
    setActiveResultId(null);
  }, [handleSlotRemove, setActiveResultId]);

  /** Wrapper for swap that also clears the active result. */
  const handleLineupSlotSwapTarget = useCallback((targetIndex: number) => {
    handleSwapTarget(targetIndex);
    setActiveResultId(null);
  }, [handleSwapTarget, setActiveResultId]);

  /** Fill the rotation with the selected team's top active players by minutes per game. */
  const handleFillTeamRotation = useCallback(async () => {
    if (!selectedTeam) return;

    const topPlayers = teamFillPlayers
      .filter((player) => !player.is_legend && player.team === selectedTeam)
      .sort((a, b) => (b.minutes_per_game ?? 0) - (a.minutes_per_game ?? 0))
      .slice(0, MAX_ROSTER_SLOTS);

    if (topPlayers.length < 5) {
      toast.error(`${selectedTeam} has fewer than 5 active players available`);
      return;
    }

    setTeamFillLoading(true);
    const hydratedSlots = await Promise.all(
      topPlayers.map(async (player) => {
        const hydratedSlot = await hydrateLineupSlot({
          id: player.id,
          nba_api_id: player.nba_api_id ?? 0,
          name: player.name,
          team: player.team,
          position: player.position,
          age: player.age,
          games_played: player.games_played,
          minutes_per_game: player.minutes_per_game,
          season: player.season,
          is_legend: player.is_legend,
        });
        return hydratedSlot ?? emptyLineupSlot();
      }),
    );
    fillSlots(hydratedSlots);
    setActiveResultId(null);
    setTeamFillLoading(false);
    toast.success(`Filled ${selectedTeam} top ${hydratedSlots.filter((slot) => slot.player).length} by MPG`);
  }, [hydrateLineupSlot, selectedTeam, teamFillPlayers, fillSlots, setActiveResultId, setTeamFillLoading]);

  /** Rehydrate a saved history item into the lineup tester with fresh composite data. */
  const handleLoadTestHistoryLineup = useCallback(async (result: LineupTestResult) => {
    const restored = await Promise.all(result.playerIds.slice(0, MAX_ROSTER_SLOTS).map(async (playerId, index) => {
      const hydratedSlot = await hydrateLineupSlot({
        id: playerId,
        nba_api_id: 0,
        name: result.playerNames[index] ?? "",
        team: null,
        position: null,
        age: null,
        games_played: null,
        minutes_per_game: null,
        season: "",
      });
      return hydratedSlot ?? emptyLineupSlot();
    }));

    fillSlots(restored);
    setActiveResultId(null);
    setCenterTab("lineup");
    toast.success("Lineup loaded");
  }, [hydrateLineupSlot, fillSlots, setActiveResultId]);

  /** Evaluate the current selected players as a single lineup or full rotation. */
  const handleEvaluateLineup = useCallback(async () => {
    const selectedSlots = lineupSlots.filter((slot) => slot.player !== null);
    if (selectedSlots.length < 5) return;

    setEvaluatingLineup(true);
    const players = selectedSlots.map((slot, index) => ({
      id: slot.player?.id,
      name: slot.player?.name ?? "",
      slot: index + 1,
      height: slot.height,
      skills: slot.skills,
    }));

    if (selectedSlots.length === 5) {
      // Single lineup evaluation
      const res = await evaluateLineup(players);
      if (!res.success || !res.data) {
        toast.error(res.error ?? "Evaluation failed");
        setEvaluatingLineup(false);
        return;
      }
      addResult({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
        playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
        mode: "lineup",
        cohesion_score: res.data.cohesion_score,
        subscores: res.data.subscores,
        category_scores: (res.data as Record<string, unknown>).category_scores as Record<string, number> | undefined,
        synergies_applied: res.data.synergies_applied,
        archetype_labels: res.data.archetype_labels,
        archetype_details: res.data.archetype_details,
        accentuation: res.data.accentuation,
        accentuation_details: res.data.accentuation_details,
        boosted_bell_curves: res.data.boosted_bell_curves,
        rp_pd_boosts: res.data.rp_pd_boosts,
        selectedCombinationIndex: 0,
      });
      toast.success(`Cohesion: ${res.data.cohesion_score.toFixed(2)}`);
      setEvaluatingLineup(false);
      return;
    }

    // Rotation evaluation (6+ players)
    const res = await evaluateRotation(players);
    if (!res.success || !res.data) {
      toast.error(res.error ?? "Evaluation failed");
      setEvaluatingLineup(false);
      return;
    }

    const selectedCombinationIndex = Math.max(
      0,
      res.data.lineup_combinations.findIndex((lineup) => lineup.is_starting_lineup),
    );
    const selectedCombination = res.data.lineup_combinations[selectedCombinationIndex] ?? res.data.lineup_combinations[0];
    addResult({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
      playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
      mode: "rotation",
      cohesion_score: res.data.star_rating,
      subscores: selectedCombination.subscores,
      category_scores: selectedCombination.category_scores,
      synergies_applied: selectedCombination.synergies_applied,
      archetype_labels: selectedCombination.archetype_labels,
      archetype_details: selectedCombination.archetype_details,
      accentuation: selectedCombination.accentuation,
      accentuation_details: selectedCombination.accentuation_details,
      boosted_bell_curves: selectedCombination.boosted_bell_curves,
      rp_pd_boosts: selectedCombination.rp_pd_boosts,
      star_rating: res.data.star_rating,
      star_rating_breakdown: res.data.star_rating_breakdown,
      theoretical_best_starting_rating: res.data.theoretical_best_starting_rating,
      theoretical_best_starting_breakdown: res.data.theoretical_best_starting_breakdown,
      lineup_summary: res.data.lineup_summary,
      lineup_combinations: res.data.lineup_combinations,
      player_composites: res.data.player_composites,
      selectedCombinationIndex,
    });
    toast.success(`Rotation: ${res.data.star_rating.toFixed(2)}`);
    setEvaluatingLineup(false);
  }, [lineupSlots, addResult]);

  /** Notify results panel when weights change (for before/after comparison). */
  const handleWeightsUpdated = useCallback(() => {
    reloadWeights();
  }, [reloadWeights]);

  return (
    <>
      <Toaster position="bottom-right" richColors closeButton toastOptions={{ duration: 4000 }} />

      <div className="flex flex-col h-[calc(100vh-3rem)] overflow-hidden bg-background">
        {/* Header bar */}
        <header id="cohesion-cal-header" className="flex-shrink-0 flex items-center justify-between px-6 py-3 border-b border-border bg-background z-10">
          <div className="flex items-center gap-3">
            <a
              id="cohesion-cal-back-link"
              href="/admin"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              ← Cornerstone
            </a>
            <span className="text-muted-foreground/30">/</span>
            <h1 id="cohesion-cal-title" className="text-sm font-semibold text-foreground">
              Evaluator Calibration
            </h1>
          </div>
          <EvaluationVersionHeader
            active={activeVersion}
            draft={draftVersion}
            versions={allVersions}
            loading={versionLoading}
            onCreateDraft={handleCreateDraft}
            onDiscardDraft={handleDiscardDraft}
            onReactivate={handleReactivateVersion}
          />
        </header>

        {/* Draft banner */}
        {draftVersion && (
          <DraftBanner
            changeCount={versionDiff.length}
            onViewDiff={() => setDiffDrawerOpen(true)}
            onPublish={() => setPublishDialogOpen(true)}
          />
        )}

        {/* Three-panel layout — resizable and collapsible */}
        <div id="cohesion-cal-panels" className="flex-1 overflow-hidden flex">

          {/* ── Left panel: Player Composites ────────────────── */}
          <div
            id="cohesion-cal-left-panel"
            className={cn(
              "flex-shrink-0 border-r border-border overflow-hidden flex flex-col transition-[width] duration-150",
              leftCollapsed && "!w-0 !border-r-0",
            )}
            style={{ width: leftCollapsed ? 0 : leftPanelWidth }}
          >
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Player Inspector
              </p>
              <button
                id="cohesion-cal-collapse-left"
                type="button"
                onClick={toggleLeftCollapsed}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Collapse panel"
              >
                ◂
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
            {/* Player search */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Player Search
              </p>
              <PlayerSearchCombobox onSelect={handlePlayerSelect} placeholder="Search players…" includeLegends />
            </div>

            {/* Loading state */}
            {loadingComposites && (
              <div className="flex items-center justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
              </div>
            )}

            {/* Composite bars */}
            {selectedComposites && !loadingComposites && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">{selectedComposites.name}</p>
                  <span className="text-[10px] text-muted-foreground">{selectedComposites.height ?? "—"}</span>
                </div>

                <CompositeBars composites={selectedComposites.composites_normalized} />
                <PlayerSkillsPanel idPrefix="cohesion-cal-selected-player" skills={selectedComposites.skills} />

                {/* Action buttons */}
                <div className="flex gap-2">
                  <button
                    id="cohesion-cal-add-bellcurve-btn"
                    type="button"
                    onClick={handleAddToBellCurve}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Add to Bell Curve
                  </button>
                  <button
                    id="cohesion-cal-set-lineup-btn"
                    type="button"
                    onClick={() => {
                      // Fill next empty lineup slot
                      const emptyIdx = lineupSlots.findIndex((s) => s.player === null);
                      if (emptyIdx >= 0 && selectedComposites) {
                        const minimalPlayer: Player = {
                          id: selectedComposites.player_id,
                          nba_api_id: 0,
                          name: selectedComposites.name,
                          team: null,
                          position: null,
                          age: null,
                          games_played: null,
                          minutes_per_game: null,
                          season: "",
                        };
                        handleLineupSlotSelect(emptyIdx, minimalPlayer);
                        setCenterTab("lineup");
                      } else {
                        toast.error("All rotation slots filled");
                      }
                    }}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Set in Rotation
                  </button>
                </div>

                {/* Pin as reference for formula preview */}
                <button
                  id="cohesion-cal-pin-reference-btn"
                  type="button"
                  onClick={() => {
                    if (!selectedComposites) return;
                    if (referencePlayers.some((p) => p.player_id === selectedComposites.player_id)) {
                      // Remove if already pinned.
                      setReferencePlayers((prev) => prev.filter((p) => p.player_id !== selectedComposites.player_id));
                      return;
                    }
                    if (referencePlayers.length >= 5) {
                      toast.error("Max 5 reference players");
                      return;
                    }
                    setReferencePlayers((prev) => [
                      ...prev,
                      {
                        player_id: selectedComposites.player_id,
                        name: selectedComposites.name,
                        skills: selectedComposites.skills,
                        composites_raw: selectedComposites.composites_raw,
                      },
                    ]);
                  }}
                  className="w-full text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                >
                  {referencePlayers.some((p) => p.player_id === selectedComposites.player_id)
                    ? "Unpin Reference"
                    : "Pin as Reference"}
                </button>

                {/* Bell curve params summary */}
                <div className="text-[9px] text-muted-foreground/60 space-y-0.5">
                  <p>
                    Bell: amp={selectedComposites.bell_curve.amplitude.toFixed(1)},
                    peak={selectedComposites.bell_curve.peak}in,
                    range=[{selectedComposites.bell_curve.range_down},{selectedComposites.bell_curve.range_up}]
                  </p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!selectedComposites && !loadingComposites && (
              <div className="text-xs text-muted-foreground/40 text-center py-8">
                Search a player to view composites
              </div>
            )}
            </div>
          </div>

          {/* Left resize handle + collapse restore */}
          {leftCollapsed ? (
            <button
              id="cohesion-cal-restore-left"
              type="button"
              onClick={toggleLeftCollapsed}
              className="flex-shrink-0 w-6 flex items-center justify-center border-r border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-[10px] text-muted-foreground"
              title="Show player panel"
            >
              ▸
            </button>
          ) : (
            <PanelResizeHandle id="cohesion-cal-left-resize" onResize={handleLeftResize} />
          )}

          {/* ── Center panel: Tabbed ──────────────────────────────────── */}
          <div id="cohesion-cal-center-panel" className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Tab bar */}
            <div id="cohesion-cal-tab-bar" className="flex-shrink-0 flex border-b border-border bg-background">
              {CENTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  id={`cohesion-cal-tab-${tab.key}`}
                  type="button"
                  onClick={() => setCenterTab(tab.key)}
                  className={cn(
                    "px-4 py-2.5 text-xs font-medium transition-colors cursor-pointer border-b-2",
                    centerTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {centerTab === "bell_curves" && (
                <BellCurveChart overlayPlayers={overlayPlayers} onRemovePlayer={handleRemoveBellCurvePlayer} onRefresh={handleRefreshBellCurves} refreshing={refreshingCurves} />
              )}
              {centerTab === "lineup" && (
                <LineupTester
                  lineupSlots={lineupSlots}
                  weights={cohesionWeights}
                  teamOptions={teamOptions}
                  selectedTeam={selectedTeam}
                  teamFillLoading={teamFillLoading}
                  onSlotSelect={handleLineupSlotSelect}
                  onSlotRemove={handleLineupSlotRemove}
                  onSlotReplace={handleLineupSlotReplace}
                  swapSourceIndex={swapSourceIndex}
                  onSwapStart={setSwapSourceIndex}
                  onSwapTarget={handleLineupSlotSwapTarget}
                  onSwapCancel={() => setSwapSourceIndex(null)}
                  onTeamChange={setSelectedTeam}
                  onFillTeam={handleFillTeamRotation}
                  onEvaluate={handleEvaluateLineup}
                  evaluating={evaluatingLineup}
                  latestResult={latestResult}
                  subscoreTree={activeVersion?.payload.taxonomy.subscore_tree}
                  compositeCoefficients={compositeCoefficientsFromEvaluationValues(activeVersion?.payload.values)}
                />
              )}
              {centerTab === "weights" && (
                <WeightsEditor onWeightsUpdated={handleWeightsUpdated} draft={draftVersion} onPatchDraft={handlePatchDraft} />
              )}
              {centerTab === "handlers" && (
                <FormulaHandlerPicker draft={draftVersion} onPatchDraft={handlePatchDraft} />
              )}
              {centerTab === "formulas" && (
                <FormulaEditor
                  draft={draftVersion}
                  onPatchDraft={handlePatchDraft}
                  referencePlayersState={[referencePlayers, setReferencePlayers]}
                />
              )}
            </div>
          </div>

          {/* Right resize handle + collapse restore */}
          {rightCollapsed ? (
            <button
              id="cohesion-cal-restore-right"
              type="button"
              onClick={toggleRightCollapsed}
              className="flex-shrink-0 w-6 flex items-center justify-center border-l border-border bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-[10px] text-muted-foreground"
              title="Show test history"
            >
              ◂
            </button>
          ) : (
            <PanelResizeHandle id="cohesion-cal-right-resize" onResize={handleRightResize} />
          )}

          {/* ── Right panel: Results ─────────────────────────── */}
          <div
            id="cohesion-cal-right-panel"
            className={cn(
              "flex-shrink-0 border-l border-border overflow-hidden flex flex-col transition-[width] duration-150",
              rightCollapsed && "!w-0 !border-l-0",
            )}
            style={{ width: rightCollapsed ? 0 : rightPanelWidth }}
          >
            <div className="flex-shrink-0 px-4 py-2 border-b border-border flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Test History ({testHistory.length})
              </p>
              <button
                id="cohesion-cal-collapse-right"
                type="button"
                onClick={toggleRightCollapsed}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Collapse panel"
              >
                ▸
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ResultsPanel testHistory={testHistory} onLoadLineup={handleLoadTestHistoryLineup} />
            </div>
          </div>
        </div>
      </div>

      {/* Diff drawer */}
      <DiffDrawer
        open={diffDrawerOpen}
        entries={versionDiff}
        onRevert={handlePatchDraft}
        onClose={() => setDiffDrawerOpen(false)}
      />

      {/* Publish dialog */}
      <PublishDialog
        open={publishDialogOpen}
        suggestedSlug={
          activeVersion
            ? `cohesion-v${(activeVersion.slug.match(/\d+/) ?? ["1"])[0] ? Number((activeVersion.slug.match(/\d+/) ?? ["1"])[0]) + 1 : 2}`
            : "cohesion-v2"
        }
        onValidate={handleValidateDraft}
        onPublish={handlePublishDraft}
        onClose={() => setPublishDialogOpen(false)}
      />
    </>
  );
}
