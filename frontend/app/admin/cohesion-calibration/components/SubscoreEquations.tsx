/**
 * SubscoreEquations — Lineup-level subscore explanation components and their
 * supporting calculation functions.
 *
 * CohesionSubscoreEquation: Collapsible breakdown for one subscore (bar + equation).
 * PnrPairingEquation: Detailed PnR handler/screener equation with tier-colored pills.
 * synergyCalculationLines: Synergy-specific calculation line generator (used by LineupTester).
 */

import { cn } from "@/lib/utils";
import {
  SUBSCORE_LABELS,
  SYNERGY_DESCRIPTIONS,
} from "@/lib/cohesion-constants";
import { subscoreColor, subscoreBarFill } from "@/lib/cohesion-colors";
import { formatSkillName } from "@/lib/skills";
import {
  pnrScreenerSecondaryScale,
  pnrPairingQualityGate,
} from "@/lib/cohesion-weights";
import type { CohesionExplanationWeights } from "@/lib/cohesion-weights";
import { SkillTierPill, skillTier, skillValue, FORMULA_LABELS } from "./PlayerInspection";
import type { LineupSlot } from "../types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Display name for a lineup slot, falling back to "Player N". */
export function lineupName(slot: LineupSlot, index: number): string {
  return slot.player?.name ?? `Player ${index + 1}`;
}

/** Simple arithmetic mean, returns 0 for empty arrays. */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function synergyDescription(synergyId: string): string {
  return SYNERGY_DESCRIPTIONS[synergyId] ?? "No description available for this synergy.";
}

// ---------------------------------------------------------------------------
// Synergy calculation helpers
// ---------------------------------------------------------------------------

function skillLineupValue(lineupSlots: LineupSlot[], index: number, skill: string): number {
  return skillValue(lineupSlots[index]?.skills ?? {}, skill);
}

function indexesWithSkill(lineupSlots: LineupSlot[], skill: string): number[] {
  return lineupSlots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => skillValue(slot.skills, skill) > 0)
    .map(({ index }) => index);
}

function playerSkillTotal(lineupSlots: LineupSlot[], index: number, skills: string[]): number {
  return skills.reduce((sum, skill) => sum + skillLineupValue(lineupSlots, index, skill), 0);
}

function bestProvider(
  providerIndexes: number[],
  targetIndex: number,
  valueForProvider: (providerIndex: number) => number,
): { index: number; value: number } | null {
  const candidates = providerIndexes.filter((index) => index !== targetIndex);
  if (candidates.length === 0) return null;
  return candidates
    .map((index) => ({ index, value: valueForProvider(index) }))
    .sort((a, b) => b.value - a.value)[0] ?? null;
}

function boostLine(
  lineupSlots: LineupSlot[],
  targetIndex: number,
  skill: string,
  scale: number,
  provider: { index: number; value: number },
  providerLabel: string,
): string {
  const base = skillLineupValue(lineupSlots, targetIndex, skill);
  const boostMultiplier = 1 + scale * provider.value;
  const result = base * boostMultiplier;
  const providerName = lineupName(lineupSlots[provider.index], provider.index);
  return `${lineupName(lineupSlots[targetIndex], targetIndex)} ${formatSkillName(skill)}: ${base.toFixed(1)} x (1 + ${scale.toFixed(2)} x ${providerName} ${providerLabel} ${provider.value.toFixed(1)}) = ${result.toFixed(2)} (${boostMultiplier.toFixed(2)}x boost)`;
}

function penaltyLineWithWeights(lineupSlots: LineupSlot[], targetIndex: number, skill: string, scale: number, weights: CohesionExplanationWeights): string {
  const base = skillLineupValue(lineupSlots, targetIndex, skill);
  const result = base / (1 + scale * weights.SYNERGY_PENALTY_SEVERITY);
  return `${lineupName(lineupSlots[targetIndex], targetIndex)} ${formatSkillName(skill)}: ${base.toFixed(1)} / (1 + ${scale.toFixed(2)} x ${weights.SYNERGY_PENALTY_SEVERITY}) = ${result.toFixed(2)}`;
}

/** Generate human-readable calculation lines for a given synergy. */
export function synergyCalculationLines(synergyId: string, lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): string[] {
  const scale = weights.SYNERGY_SCALE_FACTORS[synergyId] ?? 0;
  const screeners = indexesWithSkill(lineupSlots, "screen_setter");
  const movementShooters = indexesWithSkill(lineupSlots, "movement_shooter");
  const cutters = indexesWithSkill(lineupSlots, "cutter");
  const passers = indexesWithSkill(lineupSlots, "passer");
  const drivers = indexesWithSkill(lineupSlots, "driver");
  const verticalSpacers = indexesWithSkill(lineupSlots, "vertical_spacer");
  const transitionThreats = indexesWithSkill(lineupSlots, "transition_threat");
  const highFlyers = indexesWithSkill(lineupSlots, "high_flyer");
  const creators = lineupSlots
    .map((_slot, index) => index)
    .filter((index) => playerSkillTotal(lineupSlots, index, ["pnr_ball_handler", "driver", "isolation_scorer", "passer"]) >= 6);

  if (synergyId === "OFF-02") {
    return movementShooters.flatMap((targetIndex) => {
      const provider = bestProvider(screeners, targetIndex, (index) => skillLineupValue(lineupSlots, index, "screen_setter"));
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "movement_shooter", scale, provider, "Screen Setter")];
    });
  }
  if (synergyId === "OFF-03") {
    return movementShooters.map((targetIndex) => penaltyLineWithWeights(lineupSlots, targetIndex, "movement_shooter", scale, weights));
  }
  if (synergyId === "OFF-04") {
    return cutters.flatMap((targetIndex) => {
      const provider = bestProvider(screeners, targetIndex, (index) => skillLineupValue(lineupSlots, index, "screen_setter"));
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "cutter", scale, provider, "Screen Setter")];
    });
  }
  if (synergyId === "OFF-12") {
    return cutters.map((targetIndex) => penaltyLineWithWeights(lineupSlots, targetIndex, "cutter", scale, weights));
  }
  if (synergyId === "OFF-13") {
    const rawSpacing = lineupSlots.reduce(
      (sum, _slot, index) => sum + skillLineupValue(lineupSlots, index, "movement_shooter") + skillLineupValue(lineupSlots, index, "spot_up_shooter"),
      0,
    );
    return [
      `Raw spacing check: ${rawSpacing.toFixed(1)} < 15.0`,
      ...cutters.map((targetIndex) => penaltyLineWithWeights(lineupSlots, targetIndex, "cutter", scale, weights)),
    ];
  }
  if (synergyId === "OFF-14") {
    return cutters.flatMap((targetIndex) => {
      const provider = bestProvider(creators, targetIndex, (index) =>
        playerSkillTotal(lineupSlots, index, ["pnr_ball_handler", "driver", "isolation_scorer", "passer"]),
      );
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "cutter", scale, provider, "Creator score")];
    });
  }
  if (synergyId === "OFF-15") {
    return verticalSpacers.map((targetIndex) => penaltyLineWithWeights(lineupSlots, targetIndex, "vertical_spacer", scale, weights));
  }
  if (synergyId === "OFF-16") {
    const providerPool = Array.from(new Set([...passers, ...drivers]));
    return verticalSpacers.flatMap((targetIndex) => {
      const provider = bestProvider(providerPool, targetIndex, (index) => playerSkillTotal(lineupSlots, index, ["passer", "driver"]));
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "vertical_spacer", scale, provider, "Passer + Driver")];
    });
  }
  if (synergyId === "OFF-31") {
    return transitionThreats.flatMap((targetIndex) => {
      const provider = bestProvider(passers, targetIndex, (index) => skillLineupValue(lineupSlots, index, "passer"));
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "transition_threat", scale, provider, "Passer")];
    });
  }
  if (synergyId === "OFF-32") {
    const providerPool = Array.from(new Set([...transitionThreats, ...passers]));
    return highFlyers.flatMap((targetIndex) => {
      const provider = bestProvider(providerPool, targetIndex, (index) => playerSkillTotal(lineupSlots, index, ["transition_threat", "passer"]));
      return provider == null ? [] : [boostLine(lineupSlots, targetIndex, "high_flyer", scale, provider, "Transition + Passer")];
    });
  }
  if (synergyId === "OFF-37") {
    const passerNames = passers.map((index) => lineupName(lineupSlots[index], index)).join(", ");
    return [`Passer count: ${passers.length}. Active passer: ${passerNames || "none"}. No numeric boost is applied; this flags fragile playmaking.`];
  }
  return ["No calculation is available for this synergy yet."];
}

// ---------------------------------------------------------------------------
// Subscore calculation functions
// ---------------------------------------------------------------------------

interface NumericTerm {
  label: string;
  value: number;
}

function compositeTerms(lineupSlots: LineupSlot[], composite: string): NumericTerm[] {
  return lineupSlots.map((slot, index) => ({
    label: lineupName(slot, index),
    value: slot.normalizedComposites[composite] ?? 0,
  }));
}

function topTwoPlusDepthValue(
  lineupSlots: LineupSlot[],
  composite: string,
  primaryWeight: number,
  secondaryWeight: number,
  depthWeight: number,
): number {
  const sorted = [...compositeTerms(lineupSlots, composite)].sort((a, b) => b.value - a.value);
  const primary = sorted[0]?.value ?? 0;
  const secondary = sorted[1]?.value ?? 0;
  const depth = average(sorted.map((term) => term.value));
  return (
    primary * primaryWeight
    + secondary * secondaryWeight
    + depth * depthWeight
  );
}

function topTwoPlusDepthTerms(
  lineupSlots: LineupSlot[],
  composite: string,
  primaryWeight: number,
  secondaryWeight: number,
  depthWeight: number,
): NumericTerm[] {
  const sorted = [...compositeTerms(lineupSlots, composite)].sort((a, b) => b.value - a.value);
  const primary = sorted[0];
  const secondary = sorted[1];
  const depth = average(sorted.map((term) => term.value));

  return [
    {
      label: `${primary?.label ?? "Top player"} primary ${primary?.value.toFixed(1) ?? "0.0"} x ${primaryWeight}`,
      value: (primary?.value ?? 0) * primaryWeight,
    },
    {
      label: `${secondary?.label ?? "Second player"} secondary ${secondary?.value.toFixed(1) ?? "0.0"} x ${secondaryWeight}`,
      value: (secondary?.value ?? 0) * secondaryWeight,
    },
    {
      label: `team avg ${depth.toFixed(1)} x ${depthWeight}`,
      value: depth * depthWeight,
    },
  ];
}

function topTwoPlusDepthTermsFromTerms(
  terms: NumericTerm[],
  primaryWeight: number,
  secondaryWeight: number,
  depthWeight: number,
): NumericTerm[] {
  const sorted = [...terms].sort((a, b) => b.value - a.value);
  const primary = sorted[0];
  const secondary = sorted[1];
  const depth = average(sorted.map((term) => term.value));

  return [
    {
      label: `${primary?.label ?? "Top player"} primary ${primary?.value.toFixed(1) ?? "0.0"} x ${primaryWeight}`,
      value: (primary?.value ?? 0) * primaryWeight,
    },
    {
      label: `${secondary?.label ?? "Second player"} secondary ${secondary?.value.toFixed(1) ?? "0.0"} x ${secondaryWeight}`,
      value: (secondary?.value ?? 0) * secondaryWeight,
    },
    {
      label: `team avg ${depth.toFixed(1)} x ${depthWeight}`,
      value: depth * depthWeight,
    },
  ];
}

function collectiveDefensiveReboundingValue(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  return topTwoPlusDepthValue(
    lineupSlots,
    "defensive_rebounding",
    weights.DEFENSIVE_REBOUNDING_PRIMARY_WEIGHT,
    weights.DEFENSIVE_REBOUNDING_SECONDARY_WEIGHT,
    weights.DEFENSIVE_REBOUNDING_DEPTH_WEIGHT,
  );
}

function collectiveDefensiveReboundingTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "defensive_rebounding",
    weights.DEFENSIVE_REBOUNDING_PRIMARY_WEIGHT,
    weights.DEFENSIVE_REBOUNDING_SECONDARY_WEIGHT,
    weights.DEFENSIVE_REBOUNDING_DEPTH_WEIGHT,
  );
}

function collectiveOffensiveReboundingTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "offensive_rebounding",
    weights.OFFENSIVE_REBOUNDING_PRIMARY_WEIGHT,
    weights.OFFENSIVE_REBOUNDING_SECONDARY_WEIGHT,
    weights.OFFENSIVE_REBOUNDING_DEPTH_WEIGHT,
  );
}

function collectivePerimeterDefenseValue(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  return topTwoPlusDepthValue(
    lineupSlots,
    "perimeter_defense",
    weights.PERIMETER_DEFENSE_PRIMARY_WEIGHT,
    weights.PERIMETER_DEFENSE_SECONDARY_WEIGHT,
    weights.PERIMETER_DEFENSE_DEPTH_WEIGHT,
  );
}

function collectivePerimeterDefenseTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "perimeter_defense",
    weights.PERIMETER_DEFENSE_PRIMARY_WEIGHT,
    weights.PERIMETER_DEFENSE_SECONDARY_WEIGHT,
    weights.PERIMETER_DEFENSE_DEPTH_WEIGHT,
  );
}

function collectiveInteriorDefenseTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "interior_defense",
    weights.INTERIOR_DEFENSE_PRIMARY_WEIGHT,
    weights.INTERIOR_DEFENSE_SECONDARY_WEIGHT,
    weights.INTERIOR_DEFENSE_DEPTH_WEIGHT,
  );
}

function collectivePostGameTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "post_game",
    weights.POST_GAME_PRIMARY_WEIGHT,
    weights.POST_GAME_SECONDARY_WEIGHT,
    weights.POST_GAME_DEPTH_WEIGHT,
  );
}

function passingTerms(lineupSlots: LineupSlot[]): NumericTerm[] {
  return lineupSlots.map((slot, index) => ({
    label: lineupName(slot, index),
    value: skillValue(slot.skills, "passer"),
  }));
}

function collectivePassingTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  const passers = passingTerms(lineupSlots);
  const topPasser = [...passers].sort((a, b) => b.value - a.value)[0];
  const depth = average(passers.map((term) => term.value));

  return [
    {
      label: `${topPasser?.label ?? "Top passer"} primary ${topPasser?.value.toFixed(1) ?? "0.0"} x ${weights.PASSING_PRIMARY_CREATOR_WEIGHT}`,
      value: (topPasser?.value ?? 0) * weights.PASSING_PRIMARY_CREATOR_WEIGHT,
    },
    {
      label: `team avg ${depth.toFixed(1)} x ${weights.PASSING_DEPTH_WEIGHT}`,
      value: depth * weights.PASSING_DEPTH_WEIGHT,
    },
  ];
}

function bellTerms(lineupSlots: LineupSlot[]): NumericTerm[] {
  return lineupSlots.map((slot, index) => ({
    label: `${lineupName(slot, index)} amp`,
    value: slot.bellCurve?.amplitude ?? 0,
  }));
}

function ratioTerms(lineupSlots: LineupSlot[], a: string, b: string): NumericTerm[] {
  return [
    { label: `avg ${FORMULA_LABELS[a] ?? a}`, value: average(compositeTerms(lineupSlots, a).map((term) => term.value)) },
    { label: `avg ${FORMULA_LABELS[b] ?? b}`, value: average(compositeTerms(lineupSlots, b).map((term) => term.value)) },
  ];
}

function ratioScore(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  const harmonic = (2 * a * b) / (a + b);
  const baseScore = (harmonic / Math.max(a, b)) * 10;
  const gap = Math.abs(a - b);
  const threshold = 0.2 * Math.max(a, b);
  if (gap <= threshold) return Math.min(10, baseScore);
  const excess = gap - threshold;
  const penalty = 0.5 * excess / Math.max(a, 0.1);
  return Math.max(0, Math.min(10, baseScore - penalty * 10));
}

function topTwoPlusDepthValueFromTerms(
  terms: NumericTerm[],
  primaryWeight: number,
  secondaryWeight: number,
  depthWeight: number,
): number {
  const sorted = [...terms].sort((a, b) => b.value - a.value);
  const primary = sorted[0]?.value ?? 0;
  const secondary = sorted[1]?.value ?? 0;
  const depth = average(sorted.map((term) => term.value));
  return primary * primaryWeight + secondary * secondaryWeight + depth * depthWeight;
}

function pnrHandlerTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return lineupSlots.map((slot, index) => {
    const base = skillValue(slot.skills, "pnr_ball_handler");
    const support = average([
      skillValue(slot.skills, "passer"),
      skillValue(slot.skills, "driver"),
      skillValue(slot.skills, "off_dribble_shooter"),
    ]);
    const value = base <= 0 ? 0 : Math.min(10, base * (1 + weights.PNR_HANDLER_SUPPORT_SCALE * support / 10));
    return {
      label: `${lineupName(slot, index)} handler`,
      value,
    };
  });
}

function pnrScreenerTerms(lineupSlots: LineupSlot[]): NumericTerm[] {
  return lineupSlots.map((slot, index) => ({
    label: `${lineupName(slot, index)} screener`,
    value: slot.normalizedComposites.pnr_screener ?? 0,
  }));
}

function pnrHandlerQuality(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  return topTwoPlusDepthValueFromTerms(
    pnrHandlerTerms(lineupSlots, weights),
    weights.PNR_HANDLER_PRIMARY_WEIGHT,
    weights.PNR_HANDLER_SECONDARY_WEIGHT,
    weights.PNR_HANDLER_DEPTH_WEIGHT,
  );
}

function pnrScreenerQuality(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  return topTwoPlusDepthValueFromTerms(
    pnrScreenerTerms(lineupSlots),
    weights.PNR_SCREENER_PRIMARY_WEIGHT,
    weights.PNR_SCREENER_SECONDARY_WEIGHT,
    weights.PNR_SCREENER_DEPTH_WEIGHT,
  );
}

function pnrHandlerSupportValue(slot: LineupSlot): number {
  return average([
    skillValue(slot.skills, "passer"),
    skillValue(slot.skills, "driver"),
    skillValue(slot.skills, "off_dribble_shooter"),
  ]);
}

function pnrPairingValue(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  const handlerQuality = pnrHandlerQuality(lineupSlots, weights);
  const screenerQuality = pnrScreenerQuality(lineupSlots, weights);
  if (handlerQuality <= 0 || screenerQuality <= 0) return 0;
  return Math.min(10, ratioScore(handlerQuality, screenerQuality) * pnrPairingQualityGate(handlerQuality, screenerQuality, weights));
}

function explanationForSubscore(
  subscoreKey: string,
  lineupSlots: LineupSlot[],
  weights: CohesionExplanationWeights,
): { mode: "average" | "ratio" | "model"; terms: NumericTerm[]; suffix?: string; detailLines?: string[] } {
  switch (subscoreKey) {
    case "spacing_creation_ratio":
      return { mode: "ratio", terms: ratioTerms(lineupSlots, "spacing", "shot_creation") };
    case "creation_offball_ratio":
      return { mode: "ratio", terms: ratioTerms(lineupSlots, "shot_creation", "off_ball_impact") };
    case "spacing_paint_touch_ratio":
      return { mode: "ratio", terms: ratioTerms(lineupSlots, "spacing", "paint_touch") };
    case "spacing":
      return { mode: "average", terms: compositeTerms(lineupSlots, "spacing"), suffix: "/ 5 players" };
    case "shot_creation":
      return { mode: "average", terms: compositeTerms(lineupSlots, "shot_creation"), suffix: "/ 5 players" };
    case "paint_touch":
      return { mode: "average", terms: compositeTerms(lineupSlots, "paint_touch"), suffix: "/ 5 players" };
    case "off_ball_impact":
      return { mode: "average", terms: compositeTerms(lineupSlots, "off_ball_impact"), suffix: "/ 5 players" };
    case "ball_security":
      return { mode: "average", terms: compositeTerms(lineupSlots, "ball_security"), suffix: "/ 5 players" };
    case "post_game":
      return {
        mode: "model",
        terms: collectivePostGameTerms(lineupSlots, weights),
        suffix: "primary post player plus secondary option and depth",
        detailLines: [
          `It weights the best post player at ${Math.round(weights.POST_GAME_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.POST_GAME_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.POST_GAME_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "pnr_pairing": {
      const handlerQuality = pnrHandlerQuality(lineupSlots, weights);
      const screenerQuality = pnrScreenerQuality(lineupSlots, weights);
      const balance = ratioScore(handlerQuality, screenerQuality);
      const rawQualityGate = handlerQuality > 0 && screenerQuality > 0 ? Math.sqrt(handlerQuality * screenerQuality) / 10 : 0;
      const qualityGate = pnrPairingQualityGate(handlerQuality, screenerQuality, weights);
      return {
        mode: "model",
        terms: [{ label: "balance x quality gate", value: pnrPairingValue(lineupSlots, weights) }],
        suffix: `handler ${handlerQuality.toFixed(1)} vs screener ${screenerQuality.toFixed(1)}`,
        detailLines: [
          `Handler quality blends PnR Ball Handler with a ${weights.PNR_HANDLER_SUPPORT_SCALE.toFixed(2)}x support multiplier from Passing, Driving, and Off-Dribble Shooting.`,
          `Handler depth uses ${Math.round(weights.PNR_HANDLER_PRIMARY_WEIGHT * 100)}% top handler, ${Math.round(weights.PNR_HANDLER_SECONDARY_WEIGHT * 100)}% second handler, and ${Math.round(weights.PNR_HANDLER_DEPTH_WEIGHT * 100)}% team average.`,
          `Screener depth uses ${Math.round(weights.PNR_SCREENER_PRIMARY_WEIGHT * 100)}% top screener, ${Math.round(weights.PNR_SCREENER_SECONDARY_WEIGHT * 100)}% second screener, and ${Math.round(weights.PNR_SCREENER_DEPTH_WEIGHT * 100)}% team average.`,
          `Final score = balance ${balance.toFixed(1)} x quality gate ${qualityGate.toFixed(2)} (${weights.PNR_PAIRING_QUALITY_GATE_FLOOR.toFixed(2)} + ${weights.PNR_PAIRING_QUALITY_GATE_SCALE.toFixed(2)} x raw ${rawQualityGate.toFixed(2)}). This rewards good handler/screener match quality instead of hidden OFF-28 skill boosts.`,
        ],
      };
    }
    case "perimeter_defense":
      return {
        mode: "model",
        terms: collectivePerimeterDefenseTerms(lineupSlots, weights),
        suffix: "primary perimeter defender plus secondary support and depth",
        detailLines: [
          `It weights the best perimeter defender at ${Math.round(weights.PERIMETER_DEFENSE_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.PERIMETER_DEFENSE_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.PERIMETER_DEFENSE_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "interior_defense":
      return {
        mode: "model",
        terms: collectiveInteriorDefenseTerms(lineupSlots, weights),
        suffix: "primary interior defender plus secondary support and depth",
        detailLines: [
          `It weights the best interior defender at ${Math.round(weights.INTERIOR_DEFENSE_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.INTERIOR_DEFENSE_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.INTERIOR_DEFENSE_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "switchability":
      return {
        mode: "model",
        terms: bellTerms(lineupSlots),
        suffix: "overlap density (60%) + floor compression (40%)",
        detailLines: [
          "Overlap density: how many defenders cover each height. More overlap means more switching options.",
          "Floor compression: evenness of coverage across heights. Tighter min/max ratio means fewer exploitable mismatches.",
        ],
      };
    case "collective_passing":
      return {
        mode: "model",
        terms: collectivePassingTerms(lineupSlots, weights),
        suffix: "primary creator plus passing depth",
        detailLines: [
          "Passing is no longer a flat five-player average.",
          `It weights the best passer at ${Math.round(weights.PASSING_PRIMARY_CREATOR_WEIGHT * 100)}% and the lineup average at ${Math.round(weights.PASSING_DEPTH_WEIGHT * 100)}%, so an elite hub still matters while secondary passers add depth.`,
        ],
      };
    case "defensive_rebounding":
      return {
        mode: "model",
        terms: collectiveDefensiveReboundingTerms(lineupSlots, weights),
        suffix: "top defensive rebounders plus team depth",
        detailLines: [
          `It weights the best defensive rebounder at ${Math.round(weights.DEFENSIVE_REBOUNDING_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.DEFENSIVE_REBOUNDING_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.DEFENSIVE_REBOUNDING_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "offensive_rebounding":
      return {
        mode: "model",
        terms: collectiveOffensiveReboundingTerms(lineupSlots, weights),
        suffix: "top offensive rebounders plus team depth",
        detailLines: [
          `It weights the best offensive rebounder at ${Math.round(weights.OFFENSIVE_REBOUNDING_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.OFFENSIVE_REBOUNDING_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.OFFENSIVE_REBOUNDING_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "transition": {
      const perimeterDefense = collectivePerimeterDefenseValue(lineupSlots, weights);
      const defensiveBoost = Math.min(2, perimeterDefense / 15);
      return {
        mode: "average",
        terms: compositeTerms(lineupSlots, "transition"),
        suffix: `/ 5 players + defensive boost (${defensiveBoost.toFixed(1)})`,
        detailLines: [
          "The engine adds the larger of guard-height defensive density or perimeter-defense pressure, capped at 2.0.",
          `Perimeter pressure check: ${perimeterDefense.toFixed(1)} / 15.0 = ${defensiveBoost.toFixed(1)} before the cap.`,
        ],
      };
    }
    case "rebound_transition_ratio":
      return {
        mode: "ratio",
        terms: [
          { label: "Def Rebounding", value: collectiveDefensiveReboundingValue(lineupSlots, weights) },
          { label: "avg Transition", value: average(compositeTerms(lineupSlots, "transition").map((term) => term.value)) },
        ],
      };
    case "defensive_coverage":
      return {
        mode: "model",
        terms: bellTerms(lineupSlots),
        suffix: "raw average stacked coverage through a saturating 0-10 curve",
        detailLines: [
          "Each player contributes a height-based defensive curve, not a flat value.",
          "At each height: best defender counts 100%, then 50%, 25%, and 10% for extra defenders.",
          `The curve is 10 x (1 - exp(-raw / ${weights.DEFENSIVE_COVERAGE_SATURATION_RAW})), so good coverage rises quickly but elite overlap still has room to separate.`,
        ],
      };
    case "defensive_gaps":
      return {
        mode: "model",
        terms: bellTerms(lineupSlots),
        suffix: "10 minus penalties for heights below the coverage threshold",
        detailLines: [
          "A 10.0 means no supported height band fell below the gap threshold.",
          "This can be high even when Def Coverage is low, because it measures holes rather than total coverage strength.",
        ],
      };
    default:
      return { mode: "model", terms: [], suffix: "engine output" };
  }
}

// ---------------------------------------------------------------------------
// CohesionSubscoreEquation — collapsible subscore bar + equation
// ---------------------------------------------------------------------------

interface CohesionSubscoreEquationProps {
  subscoreKey: string;
  value: number;
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
}

/** Collapsible explanation for one lineup-level cohesion subscore. */
export function CohesionSubscoreEquation({ subscoreKey, value, lineupSlots, weights }: CohesionSubscoreEquationProps) {
  const widthPct = Math.max(0, Math.min(100, (value / 10) * 100));
  const label = SUBSCORE_LABELS[subscoreKey] ?? subscoreKey;
  const explanation = explanationForSubscore(subscoreKey, lineupSlots, weights);

  return (
    <details id={`cohesion-cal-subscore-${subscoreKey}`} className="group rounded-sm">
      <summary id={`cohesion-cal-subscore-${subscoreKey}-summary`} className="list-none cursor-pointer">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between">
            <span id={`cohesion-cal-subscore-${subscoreKey}-label`} className="text-[8px] text-muted-foreground group-hover:text-foreground">
              {label}
            </span>
            <span id={`cohesion-cal-subscore-${subscoreKey}-value`} className={cn("text-[8px] font-mono tabular-nums font-bold", subscoreColor(value))}>
              {value.toFixed(1)}
            </span>
          </div>
          <div id={`cohesion-cal-subscore-${subscoreKey}-bar`} className="h-0.5 w-full bg-muted rounded-full overflow-hidden">
            <div className={cn("h-full rounded-full", subscoreBarFill(value))} style={{ width: `${widthPct}%` }} />
          </div>
        </div>
      </summary>
      {subscoreKey === "pnr_pairing" ? (
        <PnrPairingEquation value={value} lineupSlots={lineupSlots} weights={weights} />
      ) : (
      <div id={`cohesion-cal-subscore-${subscoreKey}-equation`} className="mt-1.5 text-[8px] leading-relaxed text-muted-foreground">
        <span id={`cohesion-cal-subscore-${subscoreKey}-equation-label`} className="font-semibold text-foreground">
          {label}
        </span>
        <span className="mx-1">=</span>
        <span id={`cohesion-cal-subscore-${subscoreKey}-equation-total`} className={cn("font-mono font-semibold tabular-nums", subscoreColor(value))}>
          {value.toFixed(2)}
        </span>
        <span className="mx-1">=</span>
        {explanation.mode === "average" && <span id={`cohesion-cal-subscore-${subscoreKey}-equation-open`}>(</span>}
        <span id={`cohesion-cal-subscore-${subscoreKey}-equation-terms`} className="inline-flex flex-wrap items-center gap-1">
          {explanation.terms.map((term, index) => (
            <span key={`${term.label}-${index}`} id={`cohesion-cal-subscore-${subscoreKey}-term-${index}`} className="inline-flex items-center gap-0.5">
              {index > 0 && <span className="text-muted-foreground/70">+</span>}
              <span className="text-muted-foreground">{term.label}</span>
              <span className="font-mono tabular-nums text-foreground">{term.value.toFixed(1)}</span>
            </span>
          ))}
        </span>
        {explanation.mode === "average" && <span id={`cohesion-cal-subscore-${subscoreKey}-equation-close`}>)</span>}
        {explanation.suffix && (
          <span id={`cohesion-cal-subscore-${subscoreKey}-equation-suffix`} className="ml-1">
            {explanation.suffix}
          </span>
        )}
        {explanation.detailLines && (
          <div id={`cohesion-cal-subscore-${subscoreKey}-details`} className="mt-1 space-y-0.5">
            {explanation.detailLines.map((line, index) => (
              <p key={`${subscoreKey}-detail-${index}`} id={`cohesion-cal-subscore-${subscoreKey}-detail-${index}`}>
                {line}
              </p>
            ))}
          </div>
        )}
      </div>
      )}
    </details>
  );
}

// ---------------------------------------------------------------------------
// PnrPairingEquation — detailed handler/screener breakdown
// ---------------------------------------------------------------------------

interface PnrPairingEquationProps {
  value: number;
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
}

/** Detailed PnR pairing equation with tier-colored source skills. */
function PnrPairingEquation({ value, lineupSlots, weights }: PnrPairingEquationProps) {
  const handlerTerms = pnrHandlerTerms(lineupSlots, weights);
  const screenerTerms = pnrScreenerTerms(lineupSlots);
  const handlerQuality = pnrHandlerQuality(lineupSlots, weights);
  const screenerQuality = pnrScreenerQuality(lineupSlots, weights);
  const balance = ratioScore(handlerQuality, screenerQuality);
  const rawQualityGate = handlerQuality > 0 && screenerQuality > 0 ? Math.sqrt(handlerQuality * screenerQuality) / 10 : 0;
  const qualityGate = pnrPairingQualityGate(handlerQuality, screenerQuality, weights);
  const handlerRollupTerms = topTwoPlusDepthTermsFromTerms(
    handlerTerms,
    weights.PNR_HANDLER_PRIMARY_WEIGHT,
    weights.PNR_HANDLER_SECONDARY_WEIGHT,
    weights.PNR_HANDLER_DEPTH_WEIGHT,
  );
  const screenerRollupTerms = topTwoPlusDepthTermsFromTerms(
    screenerTerms,
    weights.PNR_SCREENER_PRIMARY_WEIGHT,
    weights.PNR_SCREENER_SECONDARY_WEIGHT,
    weights.PNR_SCREENER_DEPTH_WEIGHT,
  );
  const handlerSources = lineupSlots
    .map((slot, index) => ({ slot, index, value: handlerTerms[index]?.value ?? 0 }))
    .filter(({ value: handlerValue }) => handlerValue > 0)
    .sort((a, b) => b.value - a.value);
  const screenerSources = lineupSlots
    .map((slot, index) => ({ slot, index, value: screenerTerms[index]?.value ?? 0 }))
    .filter(({ value: screenerValue }) => screenerValue > 0)
    .sort((a, b) => b.value - a.value);
  const screenerScale = pnrScreenerSecondaryScale(weights);

  return (
    <div id="cohesion-cal-subscore-pnr_pairing-equation" className="mt-1.5 space-y-2 text-[8px] leading-relaxed text-muted-foreground">
      <div id="cohesion-cal-subscore-pnr_pairing-final">
        <span id="cohesion-cal-subscore-pnr_pairing-equation-label" className="font-semibold text-foreground">
          PnR Pairing
        </span>
        <span className="mx-1">=</span>
        <span id="cohesion-cal-subscore-pnr_pairing-equation-total" className={cn("font-mono font-semibold tabular-nums", subscoreColor(value))}>
          {value.toFixed(2)}
        </span>
        <span className="mx-1">=</span>
        <span id="cohesion-cal-subscore-pnr_pairing-equation-balance" className="font-mono text-foreground">
          balance {balance.toFixed(2)}
        </span>
        <span className="mx-1">x</span>
        <span id="cohesion-cal-subscore-pnr_pairing-equation-gate" className="font-mono text-foreground">
          quality gate {qualityGate.toFixed(2)}
        </span>
        <span id="cohesion-cal-subscore-pnr_pairing-equation-raw-gate" className="font-mono text-muted-foreground">
          ({weights.PNR_PAIRING_QUALITY_GATE_FLOOR.toFixed(2)} + {weights.PNR_PAIRING_QUALITY_GATE_SCALE.toFixed(2)} x raw {rawQualityGate.toFixed(2)})
        </span>
      </div>

      <div id="cohesion-cal-subscore-pnr_pairing-handler-sources" className="space-y-1">
        <p id="cohesion-cal-subscore-pnr_pairing-handler-title" className="font-semibold text-foreground">
          Handler quality = {handlerQuality.toFixed(2)}
        </p>
        {handlerSources.map(({ slot, index, value: handlerValue }) => {
          const support = pnrHandlerSupportValue(slot);
          return (
            <div key={`handler-${index}`} id={`cohesion-cal-subscore-pnr_pairing-handler-${index}`} className="flex flex-wrap items-center gap-1">
              <span id={`cohesion-cal-subscore-pnr_pairing-handler-${index}-name`} className="text-muted-foreground">
                {lineupName(slot, index)}
              </span>
              <span className="font-mono text-muted-foreground">=</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-handler-${index}-base`} skill="pnr_ball_handler" tier={skillTier(slot.skills, "pnr_ball_handler")} compact />
              <span className="font-mono text-muted-foreground">x (1 + {weights.PNR_HANDLER_SUPPORT_SCALE.toFixed(2)} x avg(</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-handler-${index}-passer`} skill="passer" tier={skillTier(slot.skills, "passer")} compact />
              <span className="text-muted-foreground">+</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-handler-${index}-driver`} skill="driver" tier={skillTier(slot.skills, "driver")} compact />
              <span className="text-muted-foreground">+</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-handler-${index}-off-dribble`} skill="off_dribble_shooter" tier={skillTier(slot.skills, "off_dribble_shooter")} compact />
              <span className="font-mono text-muted-foreground">) {support.toFixed(1)} / 10)</span>
              <span className="font-mono text-foreground">= {handlerValue.toFixed(2)}</span>
            </div>
          );
        })}
        <div id="cohesion-cal-subscore-pnr_pairing-handler-rollup" className="flex flex-wrap items-center gap-1">
          <span className="font-semibold text-foreground">Rollup</span>
          {handlerRollupTerms.map((term, index) => (
            <span key={`handler-rollup-${index}`} id={`cohesion-cal-subscore-pnr_pairing-handler-rollup-${index}`} className="inline-flex items-center gap-0.5">
              {index > 0 && <span className="text-muted-foreground/70">+</span>}
              <span className="text-muted-foreground">{term.label}</span>
              <span className="font-mono text-foreground">{term.value.toFixed(2)}</span>
            </span>
          ))}
        </div>
      </div>

      <div id="cohesion-cal-subscore-pnr_pairing-screener-sources" className="space-y-1">
        <p id="cohesion-cal-subscore-pnr_pairing-screener-title" className="font-semibold text-foreground">
          Screener quality = {screenerQuality.toFixed(2)}
        </p>
        {screenerSources.map(({ slot, index, value: screenerValue }) => {
          const verticalValue = skillValue(slot.skills, "vertical_spacer");
          const spotUpValue = skillValue(slot.skills, "spot_up_shooter");
          const modifier = Math.max(1, 1 + screenerScale * (verticalValue + spotUpValue));
          const rawScreener = slot.rawComposites.pnr_screener ?? 0;

          return (
            <div key={`screener-${index}`} id={`cohesion-cal-subscore-pnr_pairing-screener-${index}`} className="flex flex-wrap items-center gap-1">
              <span id={`cohesion-cal-subscore-pnr_pairing-screener-${index}-name`} className="text-muted-foreground">
                {lineupName(slot, index)}
              </span>
              <span className="font-mono text-muted-foreground">raw</span>
              <span className="font-mono text-foreground">{rawScreener.toFixed(2)}</span>
              <span className="font-mono text-muted-foreground">=</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-screener-${index}-finisher`} skill="pnr_finisher" tier={skillTier(slot.skills, "pnr_finisher")} compact />
              <span className="font-mono text-muted-foreground">x max(1, 1 + {screenerScale.toFixed(2)} x (</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-screener-${index}-vertical`} skill="vertical_spacer" tier={skillTier(slot.skills, "vertical_spacer")} compact />
              <span className="text-muted-foreground">+</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-screener-${index}-spot-up`} skill="spot_up_shooter" tier={skillTier(slot.skills, "spot_up_shooter")} compact />
              <span className="font-mono text-muted-foreground">)) {modifier.toFixed(2)}</span>
              <span className="text-muted-foreground">+</span>
              <SkillTierPill id={`cohesion-cal-subscore-pnr_pairing-screener-${index}-screen`} skill="screen_setter" tier={skillTier(slot.skills, "screen_setter")} compact />
              <span className="font-mono text-muted-foreground">→ normalized</span>
              <span className="font-mono text-foreground">{screenerValue.toFixed(1)}</span>
            </div>
          );
        })}
        <div id="cohesion-cal-subscore-pnr_pairing-screener-rollup" className="flex flex-wrap items-center gap-1">
          <span className="font-semibold text-foreground">Rollup</span>
          {screenerRollupTerms.map((term, index) => (
            <span key={`screener-rollup-${index}`} id={`cohesion-cal-subscore-pnr_pairing-screener-rollup-${index}`} className="inline-flex items-center gap-0.5">
              {index > 0 && <span className="text-muted-foreground/70">+</span>}
              <span className="text-muted-foreground">{term.label}</span>
              <span className="font-mono text-foreground">{term.value.toFixed(2)}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Re-export synergyDescription for use in LineupTester synergy chip tooltips. */
export { synergyDescription };
