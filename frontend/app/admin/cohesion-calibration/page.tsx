"use client";

/**
 * Cohesion Calibration Page — Admin tool for inspecting and tuning the cohesion engine.
 *
 * Three-panel layout (mirrors existing /admin/calibration pattern):
 *   Left (~380px):  PlayerCompositePanel — search + composite bars + bell curve overlay
 *   Center (flex):  Tabbed — "Bell Curves" | "Lineup Tester" | "Weights"
 *   Right (~320px): ResultsPanel — test history with before/after comparison
 *
 * All state lifted to page level. No global stores.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import { CohesionCompositesTable } from "@/components/cohesion/CohesionResultDetails";
import {
  SUBSCORE_LABELS,
} from "@/lib/cohesion-constants";
import { subscoreColor, synergyChipClass } from "@/lib/cohesion-colors";
import {
  DEFAULT_COHESION_WEIGHTS,
  normalizeCohesionExplanationWeights,
} from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import {
  fetchPlayerComposites,
  fetchBellCurve,
  listPlayersWithSkills,
  evaluateLineup,
  evaluateRotation,
  fetchCohesionWeights,
} from "@/lib/api";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { CohesionLineupCombination, CohesionPlayerComposites, Player, PlayerWithSkills } from "@/lib/types";
import type { PlayerCompositeData, BellCurveData, LineupTestResult, LineupSlot, CenterTab } from "./types";
import { WeightsEditor } from "./components/WeightsEditor";
import { ResultsPanel } from "./components/ResultsPanel";
import { CompositeBars, PlayerSkillsPanel, PlayerEquationPanel } from "./components/PlayerInspection";
import { BellCurveChart, LineupBellCurveChart } from "./components/BellCurveCharts";
import { CohesionSubscoreEquation, synergyCalculationLines, synergyDescription } from "./components/SubscoreEquations";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CENTER_TABS: { key: CenterTab; label: string }[] = [
  { key: "lineup", label: "Lineup Tester" },
  { key: "bell_curves", label: "Bell Curves" },
  { key: "weights", label: "Weights" },
];

const LINEUP_STORAGE_KEY = "cohesion-calibration-lineup-player-ids";
const TEST_HISTORY_STORAGE_KEY = "cohesion-calibration-test-history";

// ---------------------------------------------------------------------------
// Sub-components: Lineup Tester
// ---------------------------------------------------------------------------

interface LineupTesterProps {
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
  teamOptions: string[];
  selectedTeam: string;
  teamFillLoading: boolean;
  onSlotSelect: (index: number, player: Player) => void;
  onSlotRemove: (index: number) => void;
  onSlotReplace: (index: number) => void;
  swapSourceIndex: number | null;
  onSwapStart: (index: number) => void;
  onSwapTarget: (index: number) => void;
  onSwapCancel: () => void;
  onTeamChange: (team: string) => void;
  onFillTeam: () => void;
  onEvaluate: () => void;
  evaluating: boolean;
  latestResult: LineupTestResult | null;
}

/** 5-player slot picker + evaluate button + result display. */
function LineupTester({
  lineupSlots,
  weights,
  teamOptions,
  selectedTeam,
  teamFillLoading,
  onSlotSelect,
  onSlotRemove,
  onSlotReplace,
  swapSourceIndex,
  onSwapStart,
  onSwapTarget,
  onSwapCancel,
  onTeamChange,
  onFillTeam,
  onEvaluate,
  evaluating,
  latestResult,
}: LineupTesterProps) {
  const filledCount = lineupSlots.filter((s) => s.player !== null).length;
  const [selectedSynergy, setSelectedSynergy] = useState<string | null>(null);
  const [selectedCombinationIndex, setSelectedCombinationIndex] = useState(0);
  const combinations = latestResult?.lineup_combinations ?? [];
  const selectedCombination = combinations[selectedCombinationIndex] ?? combinations.find((lineup) => lineup.is_starting_lineup) ?? combinations[0];
  const displaySlots = latestResult?.mode === "rotation"
    ? lineupSlotsForCombination(lineupSlots, selectedCombination)
    : lineupSlots.filter((slot) => slot.player !== null).slice(0, 5);
  const displayResult = latestResult?.mode === "rotation" && selectedCombination
    ? selectedCombination
    : latestResult;
  const selectedSynergyLines = selectedSynergy ? synergyCalculationLines(selectedSynergy, displaySlots, weights) : [];

  useEffect(() => {
    setSelectedSynergy(null);
    if (!latestResult?.lineup_combinations?.length) {
      setSelectedCombinationIndex(0);
      return;
    }
    const startingIndex = latestResult.lineup_combinations.findIndex((lineup) => lineup.is_starting_lineup);
    setSelectedCombinationIndex(startingIndex >= 0 ? startingIndex : 0);
  }, [latestResult?.id, latestResult?.lineup_combinations]);

  const selectedPlayerIds = new Set(lineupSlots.map((slot) => slot.player?.id).filter((id): id is string => Boolean(id)));
  const isRotationResult = latestResult?.mode === "rotation" && combinations.length > 1;
  const swapActive = swapSourceIndex !== null;

  return (
    <div id="cohesion-cal-lineup-tester" className="space-y-4">
      <div id="cohesion-cal-team-fill-controls" className="rounded-md border border-border/70 bg-background/60 p-2">
        <div id="cohesion-cal-team-fill-row" className="flex items-center gap-2">
          <label id="cohesion-cal-team-fill-label" htmlFor="cohesion-cal-team-select" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Team Fill
          </label>
          <select
            id="cohesion-cal-team-select"
            value={selectedTeam}
            onChange={(event) => onTeamChange(event.target.value)}
            className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
          >
            <option id="cohesion-cal-team-select-empty" value="">Select team...</option>
            {teamOptions.map((team) => (
              <option key={team} id={`cohesion-cal-team-option-${team.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`} value={team}>
                {team}
              </option>
            ))}
          </select>
          <button
            id="cohesion-cal-team-fill-btn"
            type="button"
            disabled={!selectedTeam || teamFillLoading}
            onClick={onFillTeam}
            className={cn(
              "rounded border px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
              selectedTeam && !teamFillLoading
                ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : "border-border bg-muted text-muted-foreground cursor-not-allowed",
            )}
          >
            {teamFillLoading ? "Filling..." : `Fill Top ${MAX_ROSTER_SLOTS}`}
          </button>
        </div>
        <p id="cohesion-cal-team-fill-help" className="mt-1 text-[9px] text-muted-foreground">
          Uses active players only, sorted by minutes per game.
        </p>
      </div>

      {/* Rotation slot pickers */}
      <div className="space-y-2">
        {swapActive && (
          <div id="cohesion-cal-swap-banner" className="flex items-center justify-between rounded-md border border-amber-400/50 bg-amber-100/70 px-2 py-1 text-[10px] text-black">
            <span id="cohesion-cal-swap-banner-text">
              Swapping slot {(swapSourceIndex ?? 0) + 1}; click another slot number or name.
            </span>
            <button
              id="cohesion-cal-swap-cancel-btn"
              type="button"
              onClick={onSwapCancel}
              className="rounded border border-amber-500/50 bg-white/70 px-1.5 py-0.5 font-medium hover:bg-white cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
        {lineupSlots.map((slot, i) => (
          <div
            key={i}
            id={`cohesion-cal-lineup-slot-${i}`}
            className={cn(
              "flex items-center gap-2 rounded-sm p-2",
              swapSourceIndex === i && "bg-amber-100/70 ring-1 ring-amber-400/70",
            )}
          >
            <button
              id={`cohesion-cal-lineup-slot-${i}-number`}
              type="button"
              onClick={() => (swapActive ? onSwapTarget(i) : undefined)}
              disabled={!swapActive}
              className={cn(
                "text-[10px] text-muted-foreground w-4 text-left",
                swapActive && "cursor-pointer hover:text-foreground",
              )}
              title={swapActive ? `Swap with slot ${i + 1}` : undefined}
            >
              {i + 1}.
            </button>
            {slot.player && !slot.replacing ? (
              <div id={`cohesion-cal-lineup-player-${i}`} className="flex-1 min-w-0">
                <div id={`cohesion-cal-lineup-player-${i}-header`} className="flex items-center gap-2">
                  <button
                    id={`cohesion-cal-lineup-player-${i}-name`}
                    type="button"
                    onClick={() => (swapActive ? onSwapTarget(i) : undefined)}
                    disabled={!swapActive}
                    className={cn(
                      "text-xs text-foreground font-medium truncate block flex-1 text-left",
                      swapActive && "cursor-pointer hover:underline",
                    )}
                    title={swapActive ? `Swap with ${slot.player.name}` : undefined}
                  >
                    {slot.player.is_legend && <span className="text-amber-500 mr-1" aria-label="Legend">★</span>}
                    {slot.player.name}
                  </button>
                  <button
                    id={`cohesion-cal-lineup-player-${i}-swap-btn`}
                    type="button"
                    onClick={() => (swapSourceIndex === i ? onSwapCancel() : onSwapStart(i))}
                    className={cn(
                      "text-[9px] border rounded px-1.5 py-0.5 cursor-pointer",
                      swapSourceIndex === i
                        ? "text-black border-amber-500 bg-amber-100"
                        : "text-muted-foreground hover:text-foreground border-border",
                    )}
                  >
                    {swapSourceIndex === i ? "Cancel" : "Swap"}
                  </button>
                  <button
                    id={`cohesion-cal-lineup-player-${i}-replace-btn`}
                    type="button"
                    onClick={() => onSlotReplace(i)}
                    className="text-[9px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 cursor-pointer"
                  >
                    Replace
                  </button>
                  <button
                    id={`cohesion-cal-lineup-player-${i}-remove-btn`}
                    type="button"
                    onClick={() => onSlotRemove(i)}
                    className="text-[9px] text-red-400 hover:text-red-300 border border-red-500/30 rounded px-1.5 py-0.5 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
                <PlayerEquationPanel
                  idPrefix={`cohesion-cal-lineup-player-${i}`}
                  skills={slot.skills}
                  rawComposites={slot.rawComposites}
                  weights={weights}
                />
              </div>
            ) : (
              <div className="flex-1">
                <PlayerSearchCombobox
                  onSelect={(p) => onSlotSelect(i, p)}
                  placeholder={slot.player ? `Replace ${slot.player.name}…` : `Slot ${i + 1}…`}
                  className="text-xs"
                  includeLegends
                  excludedPlayerIds={selectedPlayerIds}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Evaluate button */}
      <button
        id="cohesion-cal-evaluate-lineup-btn"
        type="button"
        disabled={filledCount < 5 || evaluating}
        onClick={onEvaluate}
        className={cn(
          "w-full text-xs font-medium py-2 rounded-md border transition-colors cursor-pointer",
          filledCount >= 5 && !evaluating
            ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary"
            : "bg-muted text-muted-foreground border-border cursor-not-allowed",
        )}
      >
        {evaluating ? "Evaluating…" : `Evaluate ${filledCount > 5 ? "Rotation" : "Lineup"} (${filledCount}/${MAX_ROSTER_SLOTS})`}
      </button>

      {/* Latest result inline */}
      {latestResult && displayResult && (
        <div id="cohesion-cal-lineup-result" className="rounded-lg border border-border bg-card p-3 space-y-3">
          {latestResult.mode === "rotation" && latestResult.star_rating_breakdown && latestResult.lineup_summary ? (
            <div id="cohesion-cal-rotation-diagnostics" className="rounded-md border border-border/70 bg-background/60 p-2 space-y-2">
              <div id="cohesion-cal-rotation-diagnostics-header" className="flex items-center justify-between">
                <span id="cohesion-cal-rotation-diagnostics-title" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Rotation Diagnostics
                </span>
                <div id="cohesion-cal-rotation-score-comparison" className="flex items-center gap-2">
                  <span id="cohesion-cal-rotation-score-label" className="text-[9px] text-muted-foreground">actual</span>
                  <span id="cohesion-cal-rotation-score" className={cn("text-sm font-bold font-mono tabular-nums", subscoreColor((latestResult.star_rating ?? latestResult.cohesion_score) * 2))}>
                    {(latestResult.star_rating ?? latestResult.cohesion_score).toFixed(2)}
                  </span>
                  <span id="cohesion-cal-rotation-theoretical-score-label" className="text-[9px] text-muted-foreground">best-start</span>
                  <span
                    id="cohesion-cal-rotation-theoretical-score"
                    className={cn("text-sm font-bold font-mono tabular-nums", subscoreColor((latestResult.theoretical_best_starting_rating ?? latestResult.star_rating ?? latestResult.cohesion_score) * 2))}
                    title="Theoretical rotation score if the highest-scoring lineup were the starting lineup."
                  >
                    {(latestResult.theoretical_best_starting_rating ?? latestResult.star_rating ?? latestResult.cohesion_score).toFixed(2)}
                  </span>
                </div>
              </div>
              <div id="cohesion-cal-rotation-subscore-grid" className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ["Starting 5", latestResult.star_rating_breakdown.starting_5],
                  ["Depth", latestResult.star_rating_breakdown.depth],
                  ["Versatility", latestResult.star_rating_breakdown.archetype_diversity],
                  ["Floor", latestResult.star_rating_breakdown.floor],
                ].map(([label, value]) => (
                  <div key={label} id={`cohesion-cal-rotation-subscore-${String(label).toLowerCase().replace(/\s+/g, "-")}`} className="rounded border border-border/60 bg-card/70 px-2 py-1.5">
                    <p id={`cohesion-cal-rotation-subscore-${String(label).toLowerCase().replace(/\s+/g, "-")}-label`} className="text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p id={`cohesion-cal-rotation-subscore-${String(label).toLowerCase().replace(/\s+/g, "-")}-value`} className={cn("text-xs font-mono font-bold tabular-nums", subscoreColor(Number(value) * 10))}>
                      {(Number(value) * 100).toFixed(0)}%
                    </p>
                  </div>
                ))}
              </div>
              <div id="cohesion-cal-rotation-summary" className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
                <span id="cohesion-cal-rotation-total-lineups">Total lineups <b id="cohesion-cal-rotation-total-lineups-value" className="text-foreground">{latestResult.lineup_summary.total_lineups}</b></span>
                <span id="cohesion-cal-rotation-viable-lineups">Viable <b id="cohesion-cal-rotation-viable-lineups-value" className="text-foreground">{latestResult.lineup_summary.viable_lineups}</b></span>
                <span id="cohesion-cal-rotation-median">Median <b id="cohesion-cal-rotation-median-value" className="text-foreground">{latestResult.lineup_summary.median_score.toFixed(2)}</b></span>
                <span id="cohesion-cal-rotation-bench-median">Bench median <b id="cohesion-cal-rotation-bench-median-value" className="text-foreground">{(latestResult.lineup_summary.bench_median_score ?? 0).toFixed(2)}</b></span>
                <span id="cohesion-cal-rotation-best">Best <b id="cohesion-cal-rotation-best-value" className="text-foreground">{(combinations[0]?.cohesion_score ?? 0).toFixed(2)}</b></span>
                <span id="cohesion-cal-rotation-worst">Worst <b id="cohesion-cal-rotation-worst-value" className="text-foreground">{(combinations[combinations.length - 1]?.cohesion_score ?? 0).toFixed(2)}</b></span>
                <span id="cohesion-cal-rotation-theoretical-delta">Best-start delta <b id="cohesion-cal-rotation-theoretical-delta-value" className="text-foreground">{((latestResult.theoretical_best_starting_rating ?? latestResult.star_rating ?? latestResult.cohesion_score) - (latestResult.star_rating ?? latestResult.cohesion_score)).toFixed(2)}</b></span>
                <span id="cohesion-cal-rotation-depth-quality">Depth quality <b id="cohesion-cal-rotation-depth-quality-value" className="text-foreground">{((latestResult.lineup_summary.depth_quality ?? 0) * 100).toFixed(0)}%</b></span>
                <span id="cohesion-cal-rotation-archetypes">Archetypes <b id="cohesion-cal-rotation-archetypes-value" className="text-foreground">{latestResult.lineup_summary.archetype_labels.join(", ") || "none"}</b></span>
              </div>
            </div>
          ) : (
            <div id="cohesion-cal-lineup-mode-summary" className="flex items-center justify-between rounded-md border border-border/70 bg-background/60 px-2 py-1.5">
              <span id="cohesion-cal-lineup-mode-title" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Single Lineup</span>
              <span id="cohesion-cal-lineup-mode-count" className="text-[9px] text-muted-foreground">5 selected players</span>
            </div>
          )}

          {isRotationResult && (
            <div id="cohesion-cal-lineup-navigator" className="flex items-center gap-2">
              <button
                id="cohesion-cal-lineup-prev"
                type="button"
                disabled={selectedCombinationIndex <= 0}
                onClick={() => setSelectedCombinationIndex((index) => Math.max(0, index - 1))}
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                title="Previous ranked lineup"
              >
                ←
              </button>
              <select
                id="cohesion-cal-lineup-combination-select"
                value={selectedCombinationIndex}
                onChange={(event) => setSelectedCombinationIndex(Number(event.target.value))}
                className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-xs"
              >
                {combinations.map((lineup, index) => (
                  <option key={`${lineup.rank}-${lineup.player_ids.join("-")}`} value={index}>
                    {combinationLabel(lineup)}{lineup.is_starting_lineup ? " · Starting" : ""}
                  </option>
                ))}
              </select>
              <button
                id="cohesion-cal-lineup-next"
                type="button"
                disabled={selectedCombinationIndex >= combinations.length - 1}
                onClick={() => setSelectedCombinationIndex((index) => Math.min(combinations.length - 1, index + 1))}
                className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer"
                title="Next ranked lineup"
              >
                →
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span id="cohesion-cal-current-lineup-score-label" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cohesion Score
            </span>
            <span id="cohesion-cal-current-lineup-score-value" className={cn("text-lg font-bold font-mono tabular-nums", subscoreColor(displayResult.cohesion_score * 2))}>
              {displayResult.cohesion_score.toFixed(2)}
            </span>
          </div>

          {(displayResult.archetype_details?.length ?? 0) > 0 && (
            <div id="cohesion-cal-lineup-archetypes" className="rounded-md border border-border/70 bg-background/60 p-2 space-y-1.5">
              <div id="cohesion-cal-lineup-archetypes-header" className="flex items-center justify-between">
                <span id="cohesion-cal-lineup-archetypes-title" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Lineup Archetypes
                </span>
                <span id="cohesion-cal-lineup-archetypes-method" className="text-[9px] text-muted-foreground">
                  strongest mapped subscores
                </span>
              </div>
              <div id="cohesion-cal-lineup-archetype-chips" className="flex flex-wrap gap-1">
                {displayResult.archetype_details?.map((detail, index) => (
                  <span
                    key={`${detail.archetype}-${detail.subscore_key ?? index}`}
                    id={`cohesion-cal-lineup-archetype-${index}`}
                    className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[9px]"
                  >
                    <span id={`cohesion-cal-lineup-archetype-${index}-label`} className="font-semibold text-foreground">{formatArchetypeLabel(detail.archetype)}</span>
                    {detail.subscore_key && (
                      <>
                        <span id={`cohesion-cal-lineup-archetype-${index}-source-prefix`} className="text-muted-foreground">from</span>
                        <span id={`cohesion-cal-lineup-archetype-${index}-source`} className="text-muted-foreground">{SUBSCORE_LABELS[detail.subscore_key] ?? detail.subscore_key}</span>
                        <span id={`cohesion-cal-lineup-archetype-${index}-value`} className={cn("font-mono font-semibold tabular-nums", subscoreColor(detail.subscore_value))}>
                          {detail.subscore_value.toFixed(1)}
                        </span>
                      </>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          <LineupBellCurveChart
            lineupSlots={displaySlots}
            weights={weights}
            boostedBellCurves={displayResult.boosted_bell_curves}
            rpPdBoosts={displayResult.rp_pd_boosts}
          />

          {/* Subscores grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(displayResult.subscores).map(([key, val]) => (
              <CohesionSubscoreEquation
                key={key}
                subscoreKey={key}
                value={val}
                lineupSlots={displaySlots}
                weights={weights}
              />
            ))}
          </div>

          {/* Synergies chips */}
          {displayResult.synergies_applied.length > 0 && (
            <div id="cohesion-cal-lineup-synergies" className="space-y-2">
              <div id="cohesion-cal-lineup-synergy-chips" className="flex flex-wrap gap-1">
                {displayResult.synergies_applied.map((s, idx) => (
                  <span
                    key={`${s}-${idx}`}
                    id={`cohesion-cal-lineup-synergy-${s}-${idx}`}
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "text-[8px] font-mono px-1 py-0.5 rounded border cursor-pointer",
                      synergyChipClass(s),
                      selectedSynergy === s && "ring-2 ring-offset-1 ring-black",
                    )}
                    onClick={() => setSelectedSynergy((current) => (current === s ? null : s))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedSynergy((current) => (current === s ? null : s));
                      }
                    }}
                    title={synergyDescription(s)}
                  >
                    {s}
                  </span>
                ))}
              </div>
              {selectedSynergy && (
                <div id="cohesion-cal-lineup-synergy-calculation" className="rounded-md border border-border bg-background p-2">
                  <div id="cohesion-cal-lineup-synergy-calculation-header" className="flex items-center gap-2">
                    <span
                      id="cohesion-cal-lineup-synergy-calculation-code"
                      className={cn("text-[8px] font-mono px-1 py-0.5 rounded border", synergyChipClass(selectedSynergy))}
                    >
                      {selectedSynergy}
                    </span>
                    <span id="cohesion-cal-lineup-synergy-calculation-description" className="text-[9px] text-muted-foreground">
                      {synergyDescription(selectedSynergy)}
                    </span>
                  </div>
                  <div id="cohesion-cal-lineup-synergy-calculation-lines" className="mt-1.5 space-y-1">
                    {selectedSynergyLines.map((line, index) => (
                      <p key={`${selectedSynergy}-${index}`} id={`cohesion-cal-lineup-synergy-calculation-line-${index}`} className="text-[9px] font-mono text-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <CohesionCompositesTable
            players={latestResult.mode === "rotation" && latestResult.player_composites ? latestResult.player_composites : lineupSlotsToCompositeRows(displaySlots)}
            idPrefix="cohesion-cal-lineup-result-composites"
          />
        </div>
      )}
    </div>
  );
}

// WeightsEditor imported from ./components/WeightsEditor
// ResultsPanel imported from ./components/ResultsPanel

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const EMPTY_LINEUP: LineupSlot[] = Array.from({ length: MAX_ROSTER_SLOTS }, () => ({
  player: null,
  skills: {},
  rawComposites: {},
  normalizedComposites: {},
  bellCurve: null,
  height: null,
  replacing: false,
}));

function emptyLineupSlot(): LineupSlot {
  return {
    player: null,
    skills: {},
    rawComposites: {},
    normalizedComposites: {},
    bellCurve: null,
    height: null,
    replacing: false,
  };
}

function lineupSlotsToCompositeRows(lineupSlots: LineupSlot[]): CohesionPlayerComposites[] {
  return lineupSlots
    .filter((slot): slot is LineupSlot & { player: Player } => slot.player !== null)
    .map((slot) => ({
      player_id: slot.player.id,
      name: slot.player.name,
      base: {
        spacing: slot.normalizedComposites.spacing ?? 0,
        finishing: slot.normalizedComposites.finishing ?? 0,
        paint_touch: slot.normalizedComposites.paint_touch ?? 0,
        anchor: slot.normalizedComposites.anchor ?? 0,
        post_game: slot.normalizedComposites.post_game ?? 0,
        pnr_screener: slot.normalizedComposites.pnr_screener ?? 0,
        off_ball_impact: slot.normalizedComposites.off_ball_impact ?? 0,
        shot_creation: slot.normalizedComposites.shot_creation ?? 0,
        rebounding: slot.normalizedComposites.rebounding ?? 0,
        transition: slot.normalizedComposites.transition ?? 0,
        perimeter_defense: slot.normalizedComposites.perimeter_defense ?? 0,
        interior_defense: slot.normalizedComposites.interior_defense ?? 0,
      },
      bell_curve: slot.bellCurve ?? {
        amplitude: 0,
        peak: 78,
        range_down: 0,
        range_up: 0,
        flat_down: 0,
        flat_up: 0,
      },
    }));
}

function lineupSlotsForCombination(lineupSlots: LineupSlot[], combination?: CohesionLineupCombination): LineupSlot[] {
  if (!combination) {
    return lineupSlots.filter((slot) => slot.player !== null).slice(0, 5);
  }
  return combination.player_ids.map((playerId) => {
    const slot = lineupSlots.find((candidate) => candidate.player?.id === playerId);
    return slot ?? emptyLineupSlot();
  });
}

function combinationLabel(combination: CohesionLineupCombination): string {
  return `#${combination.rank} · ${combination.cohesion_score.toFixed(2)} · ${combination.player_names.join(" / ")}`;
}

function formatArchetypeLabel(archetype: string): string {
  return archetype
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resultFromStorage(value: unknown): LineupTestResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LineupTestResult>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.timestamp !== "number"
    || !Array.isArray(candidate.playerIds)
    || !Array.isArray(candidate.playerNames)
    || typeof candidate.cohesion_score !== "number"
    || !candidate.subscores
    || typeof candidate.subscores !== "object"
    || !Array.isArray(candidate.synergies_applied)
    || !candidate.accentuation
    || typeof candidate.accentuation !== "object"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    timestamp: candidate.timestamp,
    playerIds: candidate.playerIds.map((id) => String(id)).slice(0, MAX_ROSTER_SLOTS),
    playerNames: candidate.playerNames.map((name) => String(name)).slice(0, MAX_ROSTER_SLOTS),
    cohesion_score: candidate.cohesion_score,
    mode: candidate.mode === "rotation" ? "rotation" : "lineup",
    subscores: candidate.subscores as Record<string, number>,
    synergies_applied: candidate.synergies_applied.map((id) => String(id)),
    archetype_labels: candidate.archetype_labels,
    archetype_details: candidate.archetype_details,
    accentuation: candidate.accentuation as LineupTestResult["accentuation"],
    accentuation_details: candidate.accentuation_details,
    boosted_bell_curves: candidate.boosted_bell_curves,
    rp_pd_boosts: candidate.rp_pd_boosts,
    star_rating: candidate.star_rating,
    star_rating_breakdown: candidate.star_rating_breakdown,
    theoretical_best_starting_rating: candidate.theoretical_best_starting_rating,
    theoretical_best_starting_breakdown: candidate.theoretical_best_starting_breakdown,
    lineup_summary: candidate.lineup_summary,
    lineup_combinations: candidate.lineup_combinations,
    player_composites: candidate.player_composites,
    selectedCombinationIndex: candidate.selectedCombinationIndex,
  };
}

export default function CohesionCalibrationPage() {
  // --- Left panel state ---
  const [selectedComposites, setSelectedComposites] = useState<PlayerCompositeData | null>(null);
  const [loadingComposites, setLoadingComposites] = useState(false);

  // --- Bell curve overlay state ---
  const [overlayPlayers, setOverlayPlayers] = useState<BellCurveData[]>([]);

  // --- Center tab state ---
  const [centerTab, setCenterTab] = useState<CenterTab>("lineup");

  // --- Lineup tester state ---
  const [lineupSlots, setLineupSlots] = useState<LineupSlot[]>(EMPTY_LINEUP);
  const [evaluatingLineup, setEvaluatingLineup] = useState(false);
  const [teamFillPlayers, setTeamFillPlayers] = useState<PlayerWithSkills[]>([]);
  const [teamFillLoading, setTeamFillLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [swapSourceIndex, setSwapSourceIndex] = useState<number | null>(null);

  // --- Results state ---
  const [testHistory, setTestHistory] = useState<LineupTestResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [historyStorageLoaded, setHistoryStorageLoaded] = useState(false);

  // --- Cohesion weights state ---
  const [cohesionWeights, setCohesionWeights] = useState<CohesionExplanationWeights>(DEFAULT_COHESION_WEIGHTS);

  // --- Derived ---
  const latestResult = activeResultId
    ? testHistory.find((result) => result.id === activeResultId) ?? null
    : null;
  const teamOptions = useMemo(
    () => Array.from(new Set(
      teamFillPlayers
        .filter((player) => !player.is_legend && player.team)
        .map((player) => player.team as string),
    )).sort((a, b) => a.localeCompare(b)),
    [teamFillPlayers],
  );

  // --- Handlers ---

  /** Build a fresh lineup slot from persisted player id metadata. */
  const hydrateLineupSlot = useCallback(async (player: Player): Promise<LineupSlot | null> => {
    const res = await fetchPlayerComposites(player.id);
    if (!res.success || !res.data) return null;

    const compositeData = res.data;
    const hydratedPlayer = {
      ...player,
      id: compositeData.player_id,
      name: compositeData.name,
    };

    return {
      player: hydratedPlayer,
      skills: compositeData.skills,
      rawComposites: compositeData.composites_raw,
      normalizedComposites: compositeData.composites_normalized,
      bellCurve: compositeData.bell_curve,
      height: compositeData.height,
      replacing: false,
    };
  }, []);

  /** Load backend engine weights so explanation math mirrors weights.py and runtime overrides. */
  const loadCohesionWeights = useCallback(async () => {
    const res = await fetchCohesionWeights();
    if (res.success) {
      setCohesionWeights(normalizeCohesionExplanationWeights(res.data));
    } else {
      toast.error(res.error ?? "Failed to load cohesion weights");
    }
  }, []);

  useEffect(() => {
    loadCohesionWeights();
  }, [loadCohesionWeights]);

  /** Load active player rows for team-fill shortcuts. */
  useEffect(() => {
    let cancelled = false;

    listPlayersWithSkills()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setTeamFillPlayers(res.data.filter((player) => !player.is_legend));
        } else {
          toast.error(res.error ?? "Failed to load team list");
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("Failed to load team list");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /** Restore persisted evaluation history for the right sidebar. */
  useEffect(() => {
    if (typeof window === "undefined") {
      setHistoryStorageLoaded(true);
      return;
    }
    const saved = window.localStorage.getItem(TEST_HISTORY_STORAGE_KEY);
    if (!saved) {
      setHistoryStorageLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        setTestHistory(parsed.map(resultFromStorage).filter((result): result is LineupTestResult => result !== null).slice(0, 20));
      }
    } catch {
      window.localStorage.removeItem(TEST_HISTORY_STORAGE_KEY);
    } finally {
      setHistoryStorageLoaded(true);
    }
  }, []);

  /** Restore persisted lineup ids and refetch fresh composite data on load. */
  useEffect(() => {
    let cancelled = false;

    const restoreLineup = async () => {
      if (typeof window === "undefined") return;
      const saved = window.localStorage.getItem(LINEUP_STORAGE_KEY);
      if (!saved) return;

      let playerIds: Array<string | null>;
      try {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;
        playerIds = parsed.slice(0, MAX_ROSTER_SLOTS).map((id) => (id ? String(id) : null));
      } catch {
        return;
      }

      const restored = await Promise.all(playerIds.map(async (playerId) => {
        if (!playerId) return emptyLineupSlot();
        const hydratedSlot = await hydrateLineupSlot({
          id: playerId,
          nba_api_id: 0,
          name: "",
          team: null,
          position: null,
          age: null,
          games_played: null,
          minutes_per_game: null,
          season: "",
        });
        return hydratedSlot ?? emptyLineupSlot();
      }));

      if (cancelled) return;
      setLineupSlots([
        ...restored,
        ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - restored.length) }, () => emptyLineupSlot()),
      ].slice(0, MAX_ROSTER_SLOTS));
    };

    restoreLineup();

    return () => {
      cancelled = true;
    };
  }, [hydrateLineupSlot]);

  /** Persist selected player ids only; composites are refetched fresh on reload. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const playerIds = lineupSlots.map((slot) => slot.player?.id ?? null);

    if (playerIds.every((id) => id === null)) {
      window.localStorage.removeItem(LINEUP_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(LINEUP_STORAGE_KEY, JSON.stringify(playerIds));
  }, [lineupSlots]);

  /** Persist evaluated lineup history so the sidebar survives refreshes. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!historyStorageLoaded) return;

    if (testHistory.length === 0) {
      window.localStorage.removeItem(TEST_HISTORY_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(TEST_HISTORY_STORAGE_KEY, JSON.stringify(testHistory.slice(0, 20)));
  }, [historyStorageLoaded, testHistory]);

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
  const [refreshingCurves, setRefreshingCurves] = useState(false);
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

  /** Set a player into a lineup slot and fetch their skills. */
  const handleLineupSlotSelect = useCallback(async (index: number, player: Player) => {
    setSwapSourceIndex(null);
    if (lineupSlots.some((slot, slotIndex) => slotIndex !== index && slot.player?.id === player.id)) {
      toast.error("Player already in rotation");
      return;
    }
    const hydratedSlot = await hydrateLineupSlot(player);
    if (hydratedSlot) {
      setLineupSlots((prev) =>
        prev.map((slot, i) =>
          i === index
            ? hydratedSlot
            : slot,
        ),
      );
      setActiveResultId(null);
    } else {
      toast.error("Failed to load player data");
    }
  }, [hydrateLineupSlot, lineupSlots]);

  /** Put an existing slot back into search mode without clearing it yet. */
  const handleLineupSlotReplace = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) =>
        i === index ? { ...slot, replacing: true } : slot,
      ),
    );
    setActiveResultId(null);
  }, []);

  /** Remove one player from the lineup and clear the active result preview. */
  const handleLineupSlotRemove = useCallback((index: number) => {
    setSwapSourceIndex(null);
    setLineupSlots((prev) =>
      prev.map((slot, i) => (i === index ? emptyLineupSlot() : slot)),
    );
    setActiveResultId(null);
  }, []);

  /** Swap two rotation slots after the user enters swap mode. */
  const handleLineupSlotSwapTarget = useCallback((targetIndex: number) => {
    if (swapSourceIndex === null) return;
    if (swapSourceIndex === targetIndex) {
      setSwapSourceIndex(null);
      return;
    }
    setLineupSlots((prev) => {
      const next = [...prev];
      const source = next[swapSourceIndex];
      next[swapSourceIndex] = next[targetIndex];
      next[targetIndex] = source;
      return next;
    });
    setSwapSourceIndex(null);
    setActiveResultId(null);
  }, [swapSourceIndex]);

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
    setLineupSlots([
      ...hydratedSlots,
      ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - hydratedSlots.length) }, () => emptyLineupSlot()),
    ].slice(0, MAX_ROSTER_SLOTS));
    setSwapSourceIndex(null);
    setActiveResultId(null);
    setTeamFillLoading(false);
    toast.success(`Filled ${selectedTeam} top ${hydratedSlots.filter((slot) => slot.player).length} by MPG`);
  }, [hydrateLineupSlot, selectedTeam, teamFillPlayers]);

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

    setLineupSlots([
      ...restored,
      ...Array.from({ length: Math.max(0, MAX_ROSTER_SLOTS - restored.length) }, () => emptyLineupSlot()),
    ].slice(0, MAX_ROSTER_SLOTS));
    setActiveResultId(null);
    setCenterTab("lineup");
    toast.success("Lineup loaded");
  }, [hydrateLineupSlot]);

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
      const res = await evaluateLineup(players);
      if (!res.success || !res.data) {
        toast.error(res.error ?? "Evaluation failed");
        setEvaluatingLineup(false);
        return;
      }
      const result: LineupTestResult = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
        playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
        mode: "lineup",
        cohesion_score: res.data.cohesion_score,
        subscores: res.data.subscores,
        synergies_applied: res.data.synergies_applied,
        archetype_labels: res.data.archetype_labels,
        archetype_details: res.data.archetype_details,
        accentuation: res.data.accentuation,
        accentuation_details: res.data.accentuation_details,
        boosted_bell_curves: res.data.boosted_bell_curves,
        rp_pd_boosts: res.data.rp_pd_boosts,
        selectedCombinationIndex: 0,
      };
      setTestHistory((prev) => [result, ...prev].slice(0, 20));
      setActiveResultId(result.id);
      toast.success(`Cohesion: ${res.data.cohesion_score.toFixed(2)}`);
      setEvaluatingLineup(false);
      return;
    }

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
    const result: LineupTestResult = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      playerIds: selectedSlots.map((s) => s.player?.id ?? ""),
      playerNames: selectedSlots.map((s) => s.player?.name ?? "?"),
      mode: "rotation",
      cohesion_score: res.data.star_rating,
      subscores: selectedCombination.subscores,
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
    };
    setTestHistory((prev) => [result, ...prev].slice(0, 20));
    setActiveResultId(result.id);
    toast.success(`Rotation: ${res.data.star_rating.toFixed(2)}`);
    setEvaluatingLineup(false);
  }, [lineupSlots]);

  /** Notify results panel when weights change (for before/after comparison). */
  const handleWeightsUpdated = useCallback(() => {
    // Refresh explanation weights after runtime overrides are saved or reset.
    loadCohesionWeights();
  }, [loadCohesionWeights]);

  // --- Tab data (module-level constant, no memo needed) ---

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
              Cohesion Calibration
            </h1>
          </div>
        </header>

        {/* Three-panel layout */}
        <div id="cohesion-cal-panels" className="flex-1 overflow-hidden flex">

          {/* ── Left panel: Player Composites (~380px) ────────────────── */}
          <div
            id="cohesion-cal-left-panel"
            className="w-[380px] flex-shrink-0 border-r border-border overflow-y-auto p-4 space-y-4"
          >
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
                />
              )}
              {centerTab === "weights" && (
                <WeightsEditor onWeightsUpdated={handleWeightsUpdated} />
              )}
            </div>
          </div>

          {/* ── Right panel: Results (~320px) ─────────────────────────── */}
          <div
            id="cohesion-cal-right-panel"
            className="w-[320px] flex-shrink-0 border-l border-border overflow-hidden flex flex-col"
          >
            <div className="flex-shrink-0 px-4 py-3 border-b border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Test History ({testHistory.length})
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <ResultsPanel testHistory={testHistory} onLoadLineup={handleLoadTestHistoryLineup} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
