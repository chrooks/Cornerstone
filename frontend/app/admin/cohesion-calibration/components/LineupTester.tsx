/**
 * LineupTester — 5-to-8 player slot picker with evaluate button and inline result display.
 *
 * Includes team-fill controls, rotation slot management, synergy chip inspection,
 * and composites table for the evaluated lineup.
 */

"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import { CohesionCompositesTable } from "@/components/cohesion/CohesionResultDetails";
import {
  SUBSCORE_LABELS,
} from "@/lib/cohesion-constants";
import { subscoreColor, synergyChipClass } from "@/lib/cohesion-colors";
import { MAX_ROSTER_SLOTS } from "@/lib/builder-config";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import type { CohesionLineupCombination, CohesionPlayerComposites, Player } from "@/lib/types";
import type { LineupTestResult, LineupSlot } from "../types";
import { PlayerEquationPanel } from "./PlayerInspection";
import { LineupBellCurveChart } from "./BellCurveCharts";
import { CohesionSubscoreEquation, synergyCalculationLines, synergyDescription } from "./SubscoreEquations";
import { GroupedSubscoreLayout } from "./GroupedSubscoreLayout";

// ---------------------------------------------------------------------------
// Lineup slot helpers (exported for use by page orchestrator)
// ---------------------------------------------------------------------------

/** Create an empty lineup slot with no player data. */
export function emptyLineupSlot(): LineupSlot {
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

/** Convert filled lineup slots into composite rows for the CohesionCompositesTable. */
export function lineupSlotsToCompositeRows(lineupSlots: LineupSlot[]): CohesionPlayerComposites[] {
  return lineupSlots
    .filter((slot): slot is LineupSlot & { player: Player } => slot.player !== null)
    .map((slot) => ({
      player_id: slot.player.id,
      name: slot.player.name,
      base: {
        spacing: slot.normalizedComposites.spacing ?? 0,
        finishing: slot.normalizedComposites.finishing ?? 0,
        paint_touch: slot.normalizedComposites.paint_touch ?? 0,
        post_game: slot.normalizedComposites.post_game ?? 0,
        pnr_screener: slot.normalizedComposites.pnr_screener ?? 0,
        off_ball_impact: slot.normalizedComposites.off_ball_impact ?? 0,
        shot_creation: slot.normalizedComposites.shot_creation ?? 0,
        pnr_ball_handler: slot.normalizedComposites.pnr_ball_handler ?? 0,
        ball_security: slot.normalizedComposites.ball_security ?? 0,
        defensive_rebounding: slot.normalizedComposites.defensive_rebounding ?? 0,
        offensive_rebounding: slot.normalizedComposites.offensive_rebounding ?? 0,
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Select the lineup slots that match a specific combination's player ids. */
function lineupSlotsForCombination(lineupSlots: LineupSlot[], combination?: CohesionLineupCombination): LineupSlot[] {
  if (!combination) {
    return lineupSlots.filter((slot) => slot.player !== null).slice(0, 5);
  }
  return combination.player_ids.map((playerId) => {
    const slot = lineupSlots.find((candidate) => candidate.player?.id === playerId);
    return slot ?? emptyLineupSlot();
  });
}

/** Human-readable label for a combination dropdown option. */
function combinationLabel(combination: CohesionLineupCombination): string {
  return `#${combination.rank} · ${combination.cohesion_score.toFixed(2)} · ${combination.player_names.join(" / ")}`;
}

/** Format snake_case archetype id into Title Case. */
function formatArchetypeLabel(archetype: string): string {
  return archetype
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// LineupTester component
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
export function LineupTester({
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

          {/* Subscores grouped by category */}
          <GroupedSubscoreLayout
            id="cohesion-cal-lineup-subscores"
            subscores={displayResult.subscores}
            categoryScores={displayResult.category_scores}
            accentuation={displayResult.accentuation}
            groupGap="space-y-3"
            headerGap="mb-1"
            gridClassName="grid grid-cols-2 gap-x-3 gap-y-1"
            renderEntry={(key, val) => (
              <CohesionSubscoreEquation
                key={key}
                subscoreKey={key}
                value={val}
                lineupSlots={displaySlots}
                weights={weights}
              />
            )}
            renderAccentuation={(key, val) => (
              <CohesionSubscoreEquation
                key={key}
                subscoreKey={key}
                value={val}
                lineupSlots={displaySlots}
                weights={weights}
              />
            )}
          />

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
