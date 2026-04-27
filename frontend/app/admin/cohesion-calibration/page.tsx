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

import { useState, useCallback, useEffect } from "react";
import { Toaster, toast } from "sonner";
import { cn } from "@/lib/utils";
import { PlayerSearchCombobox } from "@/components/PlayerSearchCombobox";
import { CohesionCompositesTable } from "@/components/cohesion/CohesionResultDetails";
import {
  fetchPlayerComposites,
  fetchBellCurve,
  evaluateLineup,
  fetchCohesionWeights,
  updateCohesionWeights,
} from "@/lib/api";
import { ALL_SKILL_NAMES, formatSkillName } from "@/lib/skills";
import { TIER_BADGE_CLASSES, tierToNum } from "@/lib/tiers";
import type { CohesionPlayerComposites, Player, SkillTier } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Composite data for one player, fetched from GET /api/cohesion/player/<id>/composites. */
interface PlayerCompositeData {
  player_id: string;
  name: string;
  height: string | null;
  skills: Record<string, string>;
  composites_raw: Record<string, number>;
  composites_normalized: Record<string, number>;
  bell_curve: {
    amplitude: number;
    peak: number;
    range_down: number;
    range_up: number;
    flat_down: number;
    flat_up: number;
  };
}

/** Bell curve data for one player, fetched from GET /api/cohesion/bell-curve/<id>. */
interface BellCurveData {
  player_id: string;
  name: string;
  curve: { height: number; height_display: string; value: number }[];
}

/** Lineup test result from POST /api/cohesion/lineup/evaluate. */
interface LineupTestResult {
  id: string;
  timestamp: number;
  playerIds: string[];
  playerNames: string[];
  cohesion_score: number;
  subscores: Record<string, number>;
  synergies_applied: string[];
  accentuation: { strength_amplification: number; weakness_coverage: number };
  accentuation_details?: {
    strength?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
    weakness?: { score: number; credit: number; checks: number; terms: Record<string, unknown>[] };
  };
  /** RP-PD boosted bell curves — reflects the actual defensive picture the engine scores. */
  boosted_bell_curves?: (PlayerCompositeData["bell_curve"] | null)[];
  /** Teammate perimeter-disruptor boosts created by the lineup's best rim protector. */
  rp_pd_boosts?: RpPdBoostInfo[];
}

interface RpPdBoostInfo {
  player_index: number;
  player_name: string;
  provider_index: number;
  provider_name: string;
  provider_rim_protector_tier: string;
  boost: number;
  original_pd_tier: string;
  effective_pd_tier: string;
  original_pd_value: number;
  effective_pd_value: number;
}

/** A player slot in the lineup tester. */
interface LineupSlot {
  player: Player | null;
  skills: Record<string, string>;
  rawComposites: Record<string, number>;
  normalizedComposites: Record<string, number>;
  bellCurve: PlayerCompositeData["bell_curve"] | null;
  height: string | null;
  replacing: boolean;
}

type CenterTab = "bell_curves" | "lineup" | "weights";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPOSITE_LABELS: { key: string; label: string }[] = [
  { key: "spacing", label: "Spacing" },
  { key: "finishing", label: "Finishing" },
  { key: "paint_touch", label: "Paint Touch" },
  { key: "anchor", label: "Anchor" },
  { key: "post_game", label: "Post Game" },
  { key: "pnr_screener", label: "PnR Screener" },
  { key: "off_ball_impact", label: "Off-Ball Impact" },
  { key: "shot_creation", label: "Shot Creation" },
  { key: "rebounding", label: "Rebounding" },
  { key: "transition", label: "Transition" },
];

/** Distinct colors for overlaying bell curves (same as CohesionDebugPanel). */
const PLAYER_COLORS = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
];

// Bell curve chart range: 6'0" (72in) to 7'4" (88in)
const BELL_MIN_IN = 72;
const BELL_MAX_IN = 88;

const CENTER_TABS: { key: CenterTab; label: string }[] = [
  { key: "lineup", label: "Lineup Tester" },
  { key: "bell_curves", label: "Bell Curves" },
  { key: "weights", label: "Weights" },
];

const LINEUP_STORAGE_KEY = "cohesion-calibration-lineup-player-ids";
const TEST_HISTORY_STORAGE_KEY = "cohesion-calibration-test-history";

const SUBSCORE_LABELS: Record<string, string> = {
  spacing_creation_ratio: "Spacing / Creation",
  creation_offball_ratio: "Creation / Off-Ball",
  spacing_paint_touch_ratio: "Spacing / Paint Touch",
  rebound_transition_ratio: "Rebound / Transition",
  rebounding_spacing_deficit: "Spacing Support",
  pnr_pairing: "PnR Pairing",
  paint_touch_total: "Paint Touch",
  post_game_total: "Post Game",
  pnr_screener_total: "PnR Screener",
  anchor_total: "Anchor",
  collective_passing: "Passing",
  rebounding: "Rebounding",
  transition: "Transition",
  defensive_coverage: "Def Coverage",
  defensive_gaps: "Def Gaps",
};

const TIER_VALUES: Record<string, number> = {
  None: 0,
  Capable: 1.5,
  Proficient: 3,
  Elite: 6,
  "All-Time Great": 10,
};

const FORMULA_LABELS: Record<string, string> = {
  spacing: "Spacing",
  finishing: "Finishing",
  paint_touch: "Paint Touch",
  anchor: "Anchor",
  post_game: "Post Game",
  pnr_screener: "PnR Screener",
  off_ball_impact: "Off-Ball Impact",
  shot_creation: "Shot Creation",
  rebounding: "Rebounding",
  transition: "Transition",
};

const EQUATION_ORDER = [
  "spacing",
  "finishing",
  "paint_touch",
  "anchor",
  "post_game",
  "pnr_screener",
  "off_ball_impact",
  "shot_creation",
  "rebounding",
  "transition",
];

const SYNERGY_DESCRIPTIONS: Record<string, string> = {
  "OFF-02": "Screeners boost movement shooters by freeing them off the ball.",
  "OFF-03": "Movement shooters are penalized when no screener is available.",
  "OFF-04": "Screeners boost cutters by opening off-ball lanes.",
  "OFF-12": "Cutters are penalized when the lineup has no passer to find them.",
  "OFF-13": "Cutters are penalized when lineup spacing is too cramped.",
  "OFF-14": "Creators boost cutters by bending the defense.",
  "OFF-15": "Vertical spacers are penalized without passers or drivers to activate them.",
  "OFF-16": "Passers or drivers boost vertical spacers as lob and rim-pressure targets.",
  "OFF-31": "Passers boost transition threats in the open court.",
  "OFF-32": "Transition threats and passers boost high flyers.",
  "OFF-37": "Only one passer is present, making playmaking fragile.",
};

interface CohesionExplanationWeights {
  COMPOSITE_COEFFICIENTS: Record<string, number>;
  SYNERGY_SCALE_FACTORS: Record<string, number>;
  SYNERGY_PENALTY_SEVERITY: number;
  STACKING_RETURNS: number[];
  DEFENSIVE_COVERAGE_SATURATION_RAW: number;
  PASSING_PRIMARY_CREATOR_WEIGHT: number;
  PASSING_DEPTH_WEIGHT: number;
  REBOUNDING_PRIMARY_WEIGHT: number;
  REBOUNDING_SECONDARY_WEIGHT: number;
  REBOUNDING_DEPTH_WEIGHT: number;
  ANCHOR_PRIMARY_WEIGHT: number;
  ANCHOR_SECONDARY_WEIGHT: number;
  ANCHOR_DEPTH_WEIGHT: number;
  POST_GAME_PRIMARY_WEIGHT: number;
  POST_GAME_SECONDARY_WEIGHT: number;
  POST_GAME_DEPTH_WEIGHT: number;
  PNR_HANDLER_SUPPORT_SCALE: number;
  PNR_HANDLER_PRIMARY_WEIGHT: number;
  PNR_HANDLER_SECONDARY_WEIGHT: number;
  PNR_HANDLER_DEPTH_WEIGHT: number;
  PNR_SCREENER_PRIMARY_WEIGHT: number;
  PNR_SCREENER_SECONDARY_WEIGHT: number;
  PNR_SCREENER_DEPTH_WEIGHT: number;
  PNR_PAIRING_QUALITY_GATE_FLOOR: number;
  PNR_PAIRING_QUALITY_GATE_SCALE: number;
}

const DEFAULT_COHESION_WEIGHTS: CohesionExplanationWeights = {
  COMPOSITE_COEFFICIENTS: {
    pnr_screener_secondary_scale: 0.15,
  },
  SYNERGY_SCALE_FACTORS: {
    "OFF-02": 0.05,
    "OFF-03": 0.03,
    "OFF-04": 0.04,
    "OFF-12": 0.05,
    "OFF-13": 0.03,
    "OFF-14": 0.04,
    "OFF-15": 0.05,
    "OFF-16": 0.05,
    "OFF-31": 0.04,
    "OFF-32": 0.03,
  },
  SYNERGY_PENALTY_SEVERITY: 5,
  STACKING_RETURNS: [1, 0.5, 0.25, 0.1],
  DEFENSIVE_COVERAGE_SATURATION_RAW: 1.4,
  PASSING_PRIMARY_CREATOR_WEIGHT: 0.6,
  PASSING_DEPTH_WEIGHT: 0.4,
  REBOUNDING_PRIMARY_WEIGHT: 0.45,
  REBOUNDING_SECONDARY_WEIGHT: 0.35,
  REBOUNDING_DEPTH_WEIGHT: 0.2,
  ANCHOR_PRIMARY_WEIGHT: 0.6,
  ANCHOR_SECONDARY_WEIGHT: 0.3,
  ANCHOR_DEPTH_WEIGHT: 0.1,
  POST_GAME_PRIMARY_WEIGHT: 0.5,
  POST_GAME_SECONDARY_WEIGHT: 0.35,
  POST_GAME_DEPTH_WEIGHT: 0.15,
  PNR_HANDLER_SUPPORT_SCALE: 0.35,
  PNR_HANDLER_PRIMARY_WEIGHT: 0.65,
  PNR_HANDLER_SECONDARY_WEIGHT: 0.25,
  PNR_HANDLER_DEPTH_WEIGHT: 0.1,
  PNR_SCREENER_PRIMARY_WEIGHT: 0.55,
  PNR_SCREENER_SECONDARY_WEIGHT: 0.3,
  PNR_SCREENER_DEPTH_WEIGHT: 0.15,
  PNR_PAIRING_QUALITY_GATE_FLOOR: 0.7,
  PNR_PAIRING_QUALITY_GATE_SCALE: 0.3,
};

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

function compositeBarColor(score: number): string {
  if (score >= 8) return "bg-green-500";
  if (score >= 6) return "bg-green-600/60";
  if (score >= 4) return "bg-amber-500";
  if (score >= 2) return "bg-red-500/70";
  return "bg-red-600";
}

function subscoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function subscoreBarFill(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function skillTier(skills: Record<string, string>, skill: string): SkillTier {
  const tier = skills[skill];
  if (
    tier === "All-Time Great" ||
    tier === "Elite" ||
    tier === "Proficient" ||
    tier === "Capable" ||
    tier === "None"
  ) {
    return tier;
  }
  return "None";
}

function skillValue(skills: Record<string, string>, skill: string): number {
  return TIER_VALUES[skillTier(skills, skill)] ?? 0;
}

function ratedSkills(skills: Record<string, string>): { skill: string; tier: SkillTier }[] {
  return ALL_SKILL_NAMES
    .map((skill) => ({ skill, tier: skillTier(skills, skill) }))
    .filter(({ tier }) => tier !== "None")
    .sort((a, b) => {
      const tierDiff = tierToNum(b.tier) - tierToNum(a.tier);
      return tierDiff !== 0 ? tierDiff : formatSkillName(a.skill).localeCompare(formatSkillName(b.skill));
    });
}

function lineupName(slot: LineupSlot, index: number): string {
  return slot.player?.name ?? `Player ${index + 1}`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numberFromWeights(weights: Record<string, unknown>, key: string, fallback: number): number {
  const value = weights[key];
  return typeof value === "number" ? value : fallback;
}

function numberArrayFromWeights(weights: Record<string, unknown>, key: string, fallback: number[]): number[] {
  const value = weights[key];
  if (!Array.isArray(value)) return fallback;
  const numbers = value.filter((item): item is number => typeof item === "number");
  return numbers.length > 0 ? numbers : fallback;
}

function numberRecordFromWeights(weights: Record<string, unknown>, key: string, fallback: Record<string, number>): Record<string, number> {
  const value = weights[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function normalizeCohesionExplanationWeights(data: Record<string, unknown> | null | undefined): CohesionExplanationWeights {
  const weights = data ?? {};
  return {
    COMPOSITE_COEFFICIENTS: {
      ...DEFAULT_COHESION_WEIGHTS.COMPOSITE_COEFFICIENTS,
      ...numberRecordFromWeights(weights, "COMPOSITE_COEFFICIENTS", {}),
    },
    SYNERGY_SCALE_FACTORS: {
      ...DEFAULT_COHESION_WEIGHTS.SYNERGY_SCALE_FACTORS,
      ...numberRecordFromWeights(weights, "SYNERGY_SCALE_FACTORS", {}),
    },
    SYNERGY_PENALTY_SEVERITY: numberFromWeights(weights, "SYNERGY_PENALTY_SEVERITY", DEFAULT_COHESION_WEIGHTS.SYNERGY_PENALTY_SEVERITY),
    STACKING_RETURNS: numberArrayFromWeights(weights, "STACKING_RETURNS", DEFAULT_COHESION_WEIGHTS.STACKING_RETURNS),
    DEFENSIVE_COVERAGE_SATURATION_RAW: numberFromWeights(weights, "DEFENSIVE_COVERAGE_SATURATION_RAW", DEFAULT_COHESION_WEIGHTS.DEFENSIVE_COVERAGE_SATURATION_RAW),
    PASSING_PRIMARY_CREATOR_WEIGHT: numberFromWeights(weights, "PASSING_PRIMARY_CREATOR_WEIGHT", DEFAULT_COHESION_WEIGHTS.PASSING_PRIMARY_CREATOR_WEIGHT),
    PASSING_DEPTH_WEIGHT: numberFromWeights(weights, "PASSING_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.PASSING_DEPTH_WEIGHT),
    REBOUNDING_PRIMARY_WEIGHT: numberFromWeights(weights, "REBOUNDING_PRIMARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.REBOUNDING_PRIMARY_WEIGHT),
    REBOUNDING_SECONDARY_WEIGHT: numberFromWeights(weights, "REBOUNDING_SECONDARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.REBOUNDING_SECONDARY_WEIGHT),
    REBOUNDING_DEPTH_WEIGHT: numberFromWeights(weights, "REBOUNDING_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.REBOUNDING_DEPTH_WEIGHT),
    ANCHOR_PRIMARY_WEIGHT: numberFromWeights(weights, "ANCHOR_PRIMARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.ANCHOR_PRIMARY_WEIGHT),
    ANCHOR_SECONDARY_WEIGHT: numberFromWeights(weights, "ANCHOR_SECONDARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.ANCHOR_SECONDARY_WEIGHT),
    ANCHOR_DEPTH_WEIGHT: numberFromWeights(weights, "ANCHOR_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.ANCHOR_DEPTH_WEIGHT),
    POST_GAME_PRIMARY_WEIGHT: numberFromWeights(weights, "POST_GAME_PRIMARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.POST_GAME_PRIMARY_WEIGHT),
    POST_GAME_SECONDARY_WEIGHT: numberFromWeights(weights, "POST_GAME_SECONDARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.POST_GAME_SECONDARY_WEIGHT),
    POST_GAME_DEPTH_WEIGHT: numberFromWeights(weights, "POST_GAME_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.POST_GAME_DEPTH_WEIGHT),
    PNR_HANDLER_SUPPORT_SCALE: numberFromWeights(weights, "PNR_HANDLER_SUPPORT_SCALE", DEFAULT_COHESION_WEIGHTS.PNR_HANDLER_SUPPORT_SCALE),
    PNR_HANDLER_PRIMARY_WEIGHT: numberFromWeights(weights, "PNR_HANDLER_PRIMARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_HANDLER_PRIMARY_WEIGHT),
    PNR_HANDLER_SECONDARY_WEIGHT: numberFromWeights(weights, "PNR_HANDLER_SECONDARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_HANDLER_SECONDARY_WEIGHT),
    PNR_HANDLER_DEPTH_WEIGHT: numberFromWeights(weights, "PNR_HANDLER_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_HANDLER_DEPTH_WEIGHT),
    PNR_SCREENER_PRIMARY_WEIGHT: numberFromWeights(weights, "PNR_SCREENER_PRIMARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_SCREENER_PRIMARY_WEIGHT),
    PNR_SCREENER_SECONDARY_WEIGHT: numberFromWeights(weights, "PNR_SCREENER_SECONDARY_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_SCREENER_SECONDARY_WEIGHT),
    PNR_SCREENER_DEPTH_WEIGHT: numberFromWeights(weights, "PNR_SCREENER_DEPTH_WEIGHT", DEFAULT_COHESION_WEIGHTS.PNR_SCREENER_DEPTH_WEIGHT),
    PNR_PAIRING_QUALITY_GATE_FLOOR: numberFromWeights(weights, "PNR_PAIRING_QUALITY_GATE_FLOOR", DEFAULT_COHESION_WEIGHTS.PNR_PAIRING_QUALITY_GATE_FLOOR),
    PNR_PAIRING_QUALITY_GATE_SCALE: numberFromWeights(weights, "PNR_PAIRING_QUALITY_GATE_SCALE", DEFAULT_COHESION_WEIGHTS.PNR_PAIRING_QUALITY_GATE_SCALE),
  };
}

function pnrScreenerSecondaryScale(weights: CohesionExplanationWeights): number {
  return weights.COMPOSITE_COEFFICIENTS.pnr_screener_secondary_scale ?? DEFAULT_COHESION_WEIGHTS.COMPOSITE_COEFFICIENTS.pnr_screener_secondary_scale;
}

function pnrPairingQualityGate(handlerQuality: number, screenerQuality: number, weights: CohesionExplanationWeights): number {
  if (handlerQuality <= 0 || screenerQuality <= 0) return 0;
  const rawGate = Math.sqrt(handlerQuality * screenerQuality) / 10;
  return Math.min(1, weights.PNR_PAIRING_QUALITY_GATE_FLOOR + weights.PNR_PAIRING_QUALITY_GATE_SCALE * rawGate);
}

function defensiveCoverageSubscoreFromRaw(rawCoverage: number, weights: CohesionExplanationWeights): number {
  if (rawCoverage <= 0) return 0;
  return 10 * (1 - Math.exp(-rawCoverage / weights.DEFENSIVE_COVERAGE_SATURATION_RAW));
}

function synergyDescription(synergyId: string): string {
  return SYNERGY_DESCRIPTIONS[synergyId] ?? "No description available for this synergy.";
}

function synergyChipClass(synergyId: string): string {
  if (synergyId.startsWith("OFF")) return "bg-blue-200 text-black border-blue-400";
  if (synergyId.startsWith("DEF")) return "bg-violet-200 text-black border-violet-400";
  return "bg-amber-200 text-black border-amber-400";
}

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

function synergyCalculationLines(synergyId: string, lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): string[] {
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
// Sub-components: Left Panel
// ---------------------------------------------------------------------------

interface CompositeBarsProps {
  composites: Record<string, number>;
}

/** Horizontal bars for 10 composites (0-10 scale). */
function CompositeBars({ composites }: CompositeBarsProps) {
  return (
    <div id="cohesion-cal-composites" className="space-y-1.5">
      {COMPOSITE_LABELS.map(({ key, label }) => {
        const score = composites[key] ?? 0;
        const rounded = Math.round(score * 10) / 10;
        const widthPct = Math.max(0, Math.min(100, (score / 10) * 100));
        return (
          <div key={key} id={`cohesion-cal-composite-${key}`} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-20 truncate" title={label}>
              {label}
            </span>
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full transition-all duration-300", compositeBarColor(score))}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-[10px] font-mono tabular-nums text-foreground w-7 text-right">
              {rounded.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface SkillTierPillProps {
  id: string;
  skill: string;
  tier: SkillTier;
  compact?: boolean;
}

/** Small tier-colored chip used for player skill inspection and equations. */
function SkillTierPill({ id, skill, tier, compact = false }: SkillTierPillProps) {
  return (
    <span
      id={id}
      className={cn(
        "inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap",
        compact ? "px-1 py-0 text-[8px]" : "px-1.5 py-0.5 text-[9px]",
        TIER_BADGE_CLASSES[tier],
      )}
      title={`${formatSkillName(skill)}: ${tier} (${skillValue({ [skill]: tier }, skill)})`}
    >
      <span id={`${id}-name`}>{compact ? formatSkillName(skill).replaceAll(" ", "\u00a0") : formatSkillName(skill)}</span>
      <span id={`${id}-value`} className="font-mono tabular-nums opacity-80">
        {skillValue({ [skill]: tier }, skill).toFixed(tier === "None" ? 0 : 1)}
      </span>
    </span>
  );
}

interface PlayerSkillsPanelProps {
  idPrefix: string;
  skills: Record<string, string>;
}

/** Compact display of a player's non-None skills under the composite bars. */
function PlayerSkillsPanel({ idPrefix, skills }: PlayerSkillsPanelProps) {
  const visibleSkills = ratedSkills(skills);

  return (
    <div id={`${idPrefix}-skills-panel`} className="space-y-2">
      <p id={`${idPrefix}-skills-title`} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Skills
      </p>
      {visibleSkills.length === 0 ? (
        <p id={`${idPrefix}-skills-empty`} className="text-xs text-muted-foreground/50">
          No rated skills
        </p>
      ) : (
        <div id={`${idPrefix}-skills-list`} className="flex flex-wrap gap-1.5">
          {visibleSkills.map(({ skill, tier }) => (
            <SkillTierPill
              key={skill}
              id={`${idPrefix}-skill-${skill}`}
              skill={skill}
              tier={tier}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface EquationTerm {
  skill: string;
  multiplier?: number;
}

function equationTermsFor(composite: string): EquationTerm[] {
  switch (composite) {
    case "spacing":
      return [
        { skill: "movement_shooter" },
        { skill: "spot_up_shooter" },
        { skill: "off_dribble_shooter", multiplier: 0.5 },
      ];
    case "finishing":
      return [{ skill: "high_flyer" }, { skill: "crafty_finisher" }];
    case "paint_touch":
      return [
        { skill: "driver" },
        { skill: "vertical_spacer", multiplier: 0.6 },
        { skill: "low_post_player" },
        { skill: "mid_post_player", multiplier: 0.7 },
      ];
    case "anchor":
      return [
        { skill: "rebounder" },
        { skill: "rim_protector" },
        { skill: "vertical_spacer" },
        { skill: "screen_setter", multiplier: 0.3 },
      ];
    case "post_game":
      return [{ skill: "low_post_player" }, { skill: "mid_post_player", multiplier: 0.7 }];
    case "pnr_screener":
      return [{ skill: "pnr_finisher" }, { skill: "screen_setter" }];
    case "off_ball_impact":
      return [{ skill: "movement_shooter" }, { skill: "spot_up_shooter" }, { skill: "cutter" }, { skill: "passer", multiplier: 0.5 }];
    case "shot_creation":
      return [
        { skill: "pnr_ball_handler" },
        { skill: "passer" },
        { skill: "off_dribble_shooter" },
        { skill: "isolation_scorer" },
        { skill: "driver" },
      ];
    case "rebounding":
      return [{ skill: "rebounder" }, { skill: "offensive_rebounder" }];
    case "transition":
      return [
        { skill: "transition_threat" },
        { skill: "passer" },
        { skill: "high_flyer", multiplier: 0.7 },
        { skill: "driver", multiplier: 0.3 },
        { skill: "spot_up_shooter", multiplier: 0.2 },
      ];
    default:
      return [];
  }
}

interface PlayerEquationPanelProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawComposites: Record<string, number>;
  weights: CohesionExplanationWeights;
}

/** Collapsible player-level raw composite formulas for debugging cohesion inputs. */
function PlayerEquationPanel({ idPrefix, skills, rawComposites, weights }: PlayerEquationPanelProps) {
  return (
    <details id={`${idPrefix}-equations`} className="mt-2 rounded-md border border-border/70 bg-background/70 px-2 py-1.5">
      <summary id={`${idPrefix}-equations-summary`} className="cursor-pointer text-[10px] font-medium text-muted-foreground hover:text-foreground">
        Raw composite equations
      </summary>
      <div id={`${idPrefix}-equations-list`} className="mt-2 space-y-1.5">
        {EQUATION_ORDER.map((composite) => {
          const terms = equationTermsFor(composite);
          if (composite === "pnr_screener") {
            return (
              <PnrScreenerRawEquation
                key={composite}
                idPrefix={`${idPrefix}-equation-${composite}`}
                skills={skills}
                rawValue={rawComposites[composite] ?? 0}
                weights={weights}
              />
            );
          }

          return (
            <div key={composite} id={`${idPrefix}-equation-${composite}`} className="text-[9px] leading-relaxed">
              <span id={`${idPrefix}-equation-${composite}-label`} className="font-semibold text-foreground">
                {FORMULA_LABELS[composite]}
              </span>
              <span id={`${idPrefix}-equation-${composite}-equals`} className="mx-1 text-muted-foreground">
                =
              </span>
              <span id={`${idPrefix}-equation-${composite}-total`} className="font-mono font-semibold text-foreground tabular-nums">
                {(rawComposites[composite] ?? 0).toFixed(2)}
              </span>
              <span id={`${idPrefix}-equation-${composite}-terms-equals`} className="mx-1 text-muted-foreground">
                =
              </span>
              <span id={`${idPrefix}-equation-${composite}-terms`} className="inline-flex flex-wrap items-center gap-1">
                {terms.map((term, index) => {
                  const tier = skillTier(skills, term.skill);
                  return (
                    <span key={`${composite}-${term.skill}`} id={`${idPrefix}-equation-${composite}-term-${term.skill}`} className="inline-flex items-center gap-1">
                      {index > 0 && (
                        <span id={`${idPrefix}-equation-${composite}-plus-${index}`} className="text-muted-foreground">
                          +
                        </span>
                      )}
                      {term.multiplier != null && (
                        <span id={`${idPrefix}-equation-${composite}-mult-${term.skill}`} className="font-mono text-muted-foreground">
                          {term.multiplier}x
                        </span>
                      )}
                      <SkillTierPill
                        id={`${idPrefix}-equation-${composite}-pill-${term.skill}`}
                        skill={term.skill}
                        tier={tier}
                        compact
                      />
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

interface PnrScreenerRawEquationProps {
  idPrefix: string;
  skills: Record<string, string>;
  rawValue: number;
  weights: CohesionExplanationWeights;
}

/** Raw PnR Screener formula with pop and lob gravity shown as finisher modifiers. */
function PnrScreenerRawEquation({ idPrefix, skills, rawValue, weights }: PnrScreenerRawEquationProps) {
  const scale = pnrScreenerSecondaryScale(weights);
  const verticalValue = skillValue(skills, "vertical_spacer");
  const spotUpValue = skillValue(skills, "spot_up_shooter");
  const modifier = Math.max(1, 1 + scale * (verticalValue + spotUpValue));

  return (
    <div id={idPrefix} className="text-[9px] leading-relaxed">
      <span id={`${idPrefix}-label`} className="font-semibold text-foreground">
        PnR Screener
      </span>
      <span id={`${idPrefix}-equals`} className="mx-1 text-muted-foreground">
        =
      </span>
      <span id={`${idPrefix}-total`} className="font-mono font-semibold text-foreground tabular-nums">
        {rawValue.toFixed(2)}
      </span>
      <span id={`${idPrefix}-terms-equals`} className="mx-1 text-muted-foreground">
        =
      </span>
      <span id={`${idPrefix}-terms`} className="inline-flex flex-wrap items-center gap-1">
        <SkillTierPill id={`${idPrefix}-finisher`} skill="pnr_finisher" tier={skillTier(skills, "pnr_finisher")} compact />
        <span className="font-mono text-muted-foreground">
          x max(1, 1 + {scale.toFixed(2)} x (
        </span>
        <SkillTierPill id={`${idPrefix}-vertical`} skill="vertical_spacer" tier={skillTier(skills, "vertical_spacer")} compact />
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-spot-up`} skill="spot_up_shooter" tier={skillTier(skills, "spot_up_shooter")} compact />
        <span className="font-mono text-muted-foreground">
          )) {modifier.toFixed(2)}
        </span>
        <span className="text-muted-foreground">+</span>
        <SkillTierPill id={`${idPrefix}-screen`} skill="screen_setter" tier={skillTier(skills, "screen_setter")} compact />
      </span>
    </div>
  );
}

interface CohesionSubscoreEquationProps {
  subscoreKey: string;
  value: number;
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
}

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

function collectiveReboundingValue(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): number {
  return topTwoPlusDepthValue(
    lineupSlots,
    "rebounding",
    weights.REBOUNDING_PRIMARY_WEIGHT,
    weights.REBOUNDING_SECONDARY_WEIGHT,
    weights.REBOUNDING_DEPTH_WEIGHT,
  );
}

function collectiveReboundingTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "rebounding",
    weights.REBOUNDING_PRIMARY_WEIGHT,
    weights.REBOUNDING_SECONDARY_WEIGHT,
    weights.REBOUNDING_DEPTH_WEIGHT,
  );
}

function collectiveAnchorTerms(lineupSlots: LineupSlot[], weights: CohesionExplanationWeights): NumericTerm[] {
  return topTwoPlusDepthTerms(
    lineupSlots,
    "anchor",
    weights.ANCHOR_PRIMARY_WEIGHT,
    weights.ANCHOR_SECONDARY_WEIGHT,
    weights.ANCHOR_DEPTH_WEIGHT,
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
    case "paint_touch_total":
      return { mode: "average", terms: compositeTerms(lineupSlots, "paint_touch"), suffix: "/ 5 players" };
    case "post_game_total":
      return {
        mode: "model",
        terms: collectivePostGameTerms(lineupSlots, weights),
        suffix: "primary post player plus secondary option and depth",
        detailLines: [
          `It weights the best post player at ${Math.round(weights.POST_GAME_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.POST_GAME_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.POST_GAME_DEPTH_WEIGHT * 100)}%.`,
        ],
      };
    case "pnr_screener_total":
      return { mode: "average", terms: compositeTerms(lineupSlots, "pnr_screener"), suffix: "/ 5 players" };
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
    case "anchor_total":
      return {
        mode: "model",
        terms: collectiveAnchorTerms(lineupSlots, weights),
        suffix: "primary anchor plus secondary support and depth",
        detailLines: [
          "Anchor is no longer a flat five-player average.",
          `It weights the best anchor at ${Math.round(weights.ANCHOR_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.ANCHOR_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.ANCHOR_DEPTH_WEIGHT * 100)}%, so one elite rim presence can define the lineup's interior backbone.`,
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
    case "rebounding":
      return {
        mode: "model",
        terms: collectiveReboundingTerms(lineupSlots, weights),
        suffix: "top two rebounders plus team depth",
        detailLines: [
          "Rebounding is no longer a flat five-player average.",
          `It weights the best rebounder at ${Math.round(weights.REBOUNDING_PRIMARY_WEIGHT * 100)}%, second-best at ${Math.round(weights.REBOUNDING_SECONDARY_WEIGHT * 100)}%, and team average at ${Math.round(weights.REBOUNDING_DEPTH_WEIGHT * 100)}%, so elite possession finishers can carry the glass.`,
        ],
      };
    case "transition":
      return { mode: "average", terms: compositeTerms(lineupSlots, "transition"), suffix: "/ 5 players + defensive boost" };
    case "rebound_transition_ratio":
      return {
        mode: "ratio",
        terms: [
          { label: "adjusted Rebounding", value: collectiveReboundingValue(lineupSlots, weights) },
          { label: "avg Transition", value: average(compositeTerms(lineupSlots, "transition").map((term) => term.value)) },
        ],
      };
    case "rebounding_spacing_deficit": {
      const spacing = average(compositeTerms(lineupSlots, "spacing").map((term) => term.value));
      const rebounding = collectiveReboundingValue(lineupSlots, weights);
      const spacingDeficit = Math.max(0, 5 - spacing);
      return {
        mode: "ratio",
        terms: [
          { label: "adjusted Rebounding", value: rebounding },
          { label: spacingDeficit > 0 ? "spacing deficit" : "no spacing deficit", value: spacingDeficit },
        ],
        detailLines: spacingDeficit > 0
          ? ["Spacing is below 5.0, so rebounding is checked as an offset for the spacing deficit."]
          : ["This scores 10.0 because spacing is already at or above the deficit threshold."],
      };
    }
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

/** Collapsible explanation for one lineup-level cohesion subscore. */
function CohesionSubscoreEquation({ subscoreKey, value, lineupSlots, weights }: CohesionSubscoreEquationProps) {
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

// ---------------------------------------------------------------------------
// Sub-components: Bell Curve Visualizer
// ---------------------------------------------------------------------------

interface BellCurveChartProps {
  overlayPlayers: BellCurveData[];
  onRemovePlayer: (playerId: string) => void;
}

/** SVG bell curve overlay chart — one line per player. */
function BellCurveChart({ overlayPlayers, onRemovePlayer }: BellCurveChartProps) {
  // Chart dimensions
  const width = 600;
  const height = 300;
  const padX = 40;
  const padY = 30;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const yMax = 4.0;

  // Coordinate transforms
  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  // X-axis tick labels — every 2 inches
  const ticks = Array.from({ length: Math.floor((BELL_MAX_IN - BELL_MIN_IN) / 2) + 1 }, (_, i) => BELL_MIN_IN + i * 2);

  return (
    <div id="cohesion-cal-bellcurve-chart">
      <svg
        width={width}
        height={height}
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Defensive bell curve coverage overlay for selected players"
      >
        {/* Y-axis grid lines + labels at 1, 2, 3, 4 */}
        {[1, 2, 3, 4].map((v) => (
          <g key={v}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padX - 6} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
              {v}
            </text>
            {/* Tier labels on right side */}
            <text x={width - padX + 6} y={toY(v) + 3} textAnchor="start" className="fill-muted-foreground/40" fontSize={8}>
              {v === 1 ? "Cap" : v === 2 ? "Prof" : v === 3 ? "Elite" : "ATG"}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {ticks.map((h) => {
          const ft = Math.floor(h / 12);
          const inch = h % 12;
          return (
            <text key={h} x={toX(h)} y={height - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>
              {`${ft}'${inch}"`}
            </text>
          );
        })}

        {/* Player curve paths */}
        {overlayPlayers.map((player, idx) => {
          const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
          const d = player.curve
            .map((pt, i) => `${i === 0 ? "M" : "L"} ${toX(pt.height).toFixed(1)} ${toY(pt.value).toFixed(1)}`)
            .join(" ");
          return <path key={player.player_id} d={d} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.85} />;
        })}

        {/* Empty state message */}
        {overlayPlayers.length === 0 && (
          <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-muted-foreground/50" fontSize={12}>
            Search a player and click &quot;Add to Bell Curve&quot;
          </text>
        )}
      </svg>

      {/* Player legend with remove buttons */}
      {overlayPlayers.length > 0 && (
        <div id="cohesion-cal-bellcurve-legend" className="flex flex-wrap gap-2 mt-2">
          {overlayPlayers.map((player, idx) => (
            <button
              key={player.player_id}
              type="button"
              onClick={() => onRemovePlayer(player.player_id)}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer group"
              title={`Remove ${player.name}`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}
              />
              <span className="group-hover:line-through">{player.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function bellValueAtHeight(
  targetHeight: number,
  curve: PlayerCompositeData["bell_curve"],
): number {
  const abovePeak = targetHeight > curve.peak;
  const distance = abovePeak ? targetHeight - curve.peak : curve.peak - targetHeight;
  const flat = abovePeak ? curve.flat_up : curve.flat_down;
  const total = abovePeak ? curve.range_up : curve.range_down;

  if (distance <= flat) return curve.amplitude;

  const taper = total - flat;
  if (taper <= 0 || distance > total) return 0;

  const t = (distance - flat) / taper;
  return curve.amplitude * Math.max(0, 1 - t * t);
}

/** Compact defensive bell curve overlay for the current five-player lineup. */
function LineupBellCurveChart({ lineupSlots, weights, boostedBellCurves, rpPdBoosts = [] }: {
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
  /** RP-PD boosted bell curves from the evaluate response — matches the actual engine scoring. */
  boostedBellCurves?: (PlayerCompositeData["bell_curve"] | null)[];
  rpPdBoosts?: RpPdBoostInfo[];
}) {
  const width = 600;
  const height = 150;
  const padX = 34;
  const padY = 18;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const yMax = 6.0;
  // X-axis ticks every 2 inches
  const ticks = Array.from({ length: Math.floor((BELL_MAX_IN - BELL_MIN_IN) / 2) + 1 }, (_, i) => BELL_MIN_IN + i * 2);
  // Y-axis gridlines at every whole number 1–6
  const yTicks = [1, 2, 3, 4, 5, 6];
  // Use RP-PD boosted bell curves when available (from evaluate response),
  // falling back to raw per-player curves before evaluation has run.
  const effectiveCurves: (PlayerCompositeData["bell_curve"] | null)[] = lineupSlots.map((slot, idx) => {
    if (boostedBellCurves?.[idx]) return boostedBellCurves[idx];
    return slot.bellCurve;
  });

  // Track original slot index alongside filtered players for legend rendering
  const lineupPlayers = lineupSlots
    .map((slot, idx) => ({ slot, originalIdx: idx }))
    .filter(({ slot, originalIdx }) => slot.player && effectiveCurves[originalIdx]);
  const stackedValues = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_unused, i) => {
    const heightInches = BELL_MIN_IN + i;
    // Compute stacked coverage using effective (boosted) curves
    const values = effectiveCurves
      .map((curve) => (curve ? bellValueAtHeight(heightInches, curve) : 0))
      .sort((a, b) => b - a);
    const stacked = values.reduce((sum, value, index) => {
      const returnFactor = weights.STACKING_RETURNS[index] ?? weights.STACKING_RETURNS[weights.STACKING_RETURNS.length - 1] ?? 0;
      return sum + value * returnFactor;
    }, 0);
    return { height: heightInches, value: stacked };
  });
  const rawCoverageAverage = average(stackedValues.map((point) => point.value));
  const normalizedCoverage = Math.min(10, defensiveCoverageSubscoreFromRaw(rawCoverageAverage, weights));
  const boostProvider = rpPdBoosts[0];

  // Hovered player id — when a legend item is hovered, that player's line is brought to the front
  const [hoveredPlayerId, setHoveredPlayerId] = useState<string | null>(null);

  const toX = (inches: number) => padX + ((inches - BELL_MIN_IN) / (BELL_MAX_IN - BELL_MIN_IN)) * chartW;
  const toY = (value: number) => padY + chartH - (Math.min(value, yMax) / yMax) * chartH;

  // Build path data for each player so we can render hovered player last (on top)
  const playerPaths = lineupSlots
    .map((slot, idx) => {
      const curve = effectiveCurves[idx];
      if (!slot.player || !curve) return null;
      const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
      const d = Array.from({ length: BELL_MAX_IN - BELL_MIN_IN + 1 }, (_unused, i) => {
        const h = BELL_MIN_IN + i;
        const value = bellValueAtHeight(h, curve);
        return `${i === 0 ? "M" : "L"} ${toX(h).toFixed(1)} ${toY(value).toFixed(1)}`;
      }).join(" ");
      return { id: slot.player.id, d, color };
    })
    .filter(Boolean) as { id: string; d: string; color: string }[];

  // Sort paths so hovered player renders last (highest z-index in SVG)
  const sortedPaths = hoveredPlayerId
    ? [...playerPaths.filter((p) => p.id !== hoveredPlayerId), ...playerPaths.filter((p) => p.id === hoveredPlayerId)]
    : playerPaths;

  return (
    <div id="cohesion-cal-lineup-bellcurves" className="rounded-md border border-border/70 bg-background/60 p-2 space-y-2">
      <div id="cohesion-cal-lineup-bellcurves-header" className="flex items-center justify-between">
        <span id="cohesion-cal-lineup-bellcurves-title" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Defensive Bell Curves
        </span>
        <span id="cohesion-cal-lineup-bellcurves-scale" className="text-[9px] text-muted-foreground/70">
          raw avg {rawCoverageAverage.toFixed(2)} {"->"} {normalizedCoverage.toFixed(1)}/10
        </span>
      </div>

      <svg
        id="cohesion-cal-lineup-bellcurves-svg"
        width={width}
        height={height}
        className="w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Defensive bell curve overlay for the current lineup"
      >
        {/* Y-axis gridlines at whole numbers */}
        {yTicks.map((v) => (
          <g key={v} id={`cohesion-cal-lineup-bellcurves-grid-${v}`}>
            <line x1={padX} y1={toY(v)} x2={width - padX} y2={toY(v)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padX - 6} y={toY(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>
              {v}
            </text>
          </g>
        ))}

        {/* X-axis labels every 2 inches */}
        {ticks.map((h) => {
          const ft = Math.floor(h / 12);
          const inch = h % 12;
          return (
            <text key={h} x={toX(h)} y={height - 4} textAnchor="middle" className="fill-muted-foreground" fontSize={7}>
              {`${ft}'${inch}"`}
            </text>
          );
        })}

        {/* Player bell curves — hovered player rendered last for z-index */}
        {sortedPaths.map((p) => (
          <path
            key={p.id}
            id={`cohesion-cal-lineup-bellcurve-${p.id}`}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth={hoveredPlayerId === p.id ? 3 : 2}
            strokeOpacity={hoveredPlayerId && hoveredPlayerId !== p.id ? 0.3 : 0.9}
          />
        ))}

        {/* Stacked coverage line */}
        <path
          id="cohesion-cal-lineup-bellcurve-stacked"
          d={stackedValues
            .map((point, i) => `${i === 0 ? "M" : "L"} ${toX(point.height).toFixed(1)} ${toY(point.value).toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeOpacity={hoveredPlayerId ? 0.3 : 0.9}
        />
      </svg>

      {/* Legend with hover interaction */}
      <div id="cohesion-cal-lineup-bellcurves-legend" className="flex flex-wrap gap-2">
        <span id="cohesion-cal-lineup-bellcurves-legend-stacked" className="inline-flex items-center gap-1.5 text-[9px] font-semibold text-foreground">
          <span className="inline-block w-4 h-0.5 rounded-full bg-current" />
          <span>Stacked coverage</span>
        </span>
        {lineupPlayers.map(({ slot, originalIdx }) => {
          const curve = effectiveCurves[originalIdx];
          return (
            <span
              key={slot.player?.id}
              id={`cohesion-cal-lineup-bellcurves-legend-${slot.player?.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 text-[9px] cursor-pointer transition-opacity",
                hoveredPlayerId && hoveredPlayerId !== slot.player?.id ? "opacity-40" : "text-muted-foreground",
              )}
              onMouseEnter={() => setHoveredPlayerId(slot.player?.id ?? null)}
              onMouseLeave={() => setHoveredPlayerId(null)}
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: PLAYER_COLORS[originalIdx % PLAYER_COLORS.length] }}
              />
              <span>{slot.player?.name}</span>
              <span className="font-mono">amp {curve?.amplitude.toFixed(1)}</span>
            </span>
          );
        })}
      </div>

      {boostProvider && (
        <div id="cohesion-cal-lineup-rp-pd-boosts" className="rounded border border-blue-400/40 bg-blue-100/60 px-2 py-1.5 space-y-1">
          <p id="cohesion-cal-lineup-rp-pd-boosts-title" className="text-[9px] font-semibold text-black">
            {boostProvider.provider_name} {boostProvider.provider_rim_protector_tier} Rim Protector boosts teammate PD by +{boostProvider.boost.toFixed(1)}
          </p>
          <div id="cohesion-cal-lineup-rp-pd-boosts-list" className="flex flex-wrap gap-1.5">
            {rpPdBoosts.map((boost) => (
              <span
                key={`${boost.player_index}-${boost.player_name}`}
                id={`cohesion-cal-lineup-rp-pd-boost-${boost.player_index}`}
                className="rounded border border-blue-300 bg-white/70 px-1.5 py-0.5 text-[8px] text-black"
                title={`${boost.player_name}: Perimeter Disruptor ${boost.original_pd_tier} (${boost.original_pd_value.toFixed(1)}) -> ${boost.effective_pd_tier} (${boost.effective_pd_value.toFixed(1)})`}
              >
                {boost.player_name}: PD {boost.original_pd_tier} {"->"} {boost.effective_pd_tier}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Lineup Tester
// ---------------------------------------------------------------------------

interface LineupTesterProps {
  lineupSlots: LineupSlot[];
  weights: CohesionExplanationWeights;
  onSlotSelect: (index: number, player: Player) => void;
  onSlotRemove: (index: number) => void;
  onSlotReplace: (index: number) => void;
  onEvaluate: () => void;
  evaluating: boolean;
  latestResult: LineupTestResult | null;
}

/** 5-player slot picker + evaluate button + result display. */
function LineupTester({ lineupSlots, weights, onSlotSelect, onSlotRemove, onSlotReplace, onEvaluate, evaluating, latestResult }: LineupTesterProps) {
  const filledCount = lineupSlots.filter((s) => s.player !== null).length;
  const [selectedSynergy, setSelectedSynergy] = useState<string | null>(null);
  const selectedSynergyLines = selectedSynergy ? synergyCalculationLines(selectedSynergy, lineupSlots, weights) : [];

  return (
    <div id="cohesion-cal-lineup-tester" className="space-y-4">
      {/* 5 player slot pickers */}
      <div className="space-y-2">
        {lineupSlots.map((slot, i) => (
          <div key={i} id={`cohesion-cal-lineup-slot-${i}`} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-4">{i + 1}.</span>
            {slot.player && !slot.replacing ? (
              <div id={`cohesion-cal-lineup-player-${i}`} className="flex-1 min-w-0">
                <div id={`cohesion-cal-lineup-player-${i}-header`} className="flex items-center gap-2">
                  <span id={`cohesion-cal-lineup-player-${i}-name`} className="text-xs text-foreground font-medium truncate block flex-1">
                    {slot.player.is_legend && <span className="text-amber-500 mr-1" aria-label="Legend">★</span>}
                    {slot.player.name}
                  </span>
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
        {evaluating ? "Evaluating…" : `Evaluate Lineup (${filledCount}/5)`}
      </button>

      {/* Latest result inline */}
      {latestResult && (
        <div id="cohesion-cal-lineup-result" className="rounded-lg border border-border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cohesion Score
            </span>
            <span className={cn("text-lg font-bold font-mono tabular-nums", subscoreColor(latestResult.cohesion_score * 2))}>
              {latestResult.cohesion_score.toFixed(2)}
            </span>
          </div>

          <LineupBellCurveChart
            lineupSlots={lineupSlots}
            weights={weights}
            boostedBellCurves={latestResult.boosted_bell_curves}
            rpPdBoosts={latestResult.rp_pd_boosts}
          />

          {/* Subscores grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {Object.entries(latestResult.subscores).map(([key, val]) => (
              <CohesionSubscoreEquation
                key={key}
                subscoreKey={key}
                value={val}
                lineupSlots={lineupSlots}
                weights={weights}
              />
            ))}
          </div>

          {/* Synergies chips */}
          {latestResult.synergies_applied.length > 0 && (
            <div id="cohesion-cal-lineup-synergies" className="space-y-2">
              <div id="cohesion-cal-lineup-synergy-chips" className="flex flex-wrap gap-1">
                {latestResult.synergies_applied.map((s, idx) => (
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
            players={lineupSlotsToCompositeRows(lineupSlots)}
            idPrefix="cohesion-cal-lineup-result-composites"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Weights Editor
// ---------------------------------------------------------------------------

interface WeightsEditorProps {
  onWeightsUpdated: () => void;
}

/** Monaco JSON editor for weight overrides with test/save/reset. */
function WeightsEditor({ onWeightsUpdated }: WeightsEditorProps) {
  const [editorContent, setEditorContent] = useState<string>("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Lazy import Monaco to avoid SSR issues
  const [MonacoEditor, setMonacoEditor] = useState<typeof import("@monaco-editor/react").default | null>(null);

  // Load Monaco lazily on mount
  useEffect(() => {
    import("@monaco-editor/react").then((mod) => setMonacoEditor(() => mod.default));
  }, []);

  // Fetch current weights on mount
  useEffect(() => {
    fetchCohesionWeights().then((res) => {
      if (res.success && res.data) {
        setEditorContent(JSON.stringify(res.data, null, 2));
      }
      setLoading(false);
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const parsed = JSON.parse(editorContent);
      const res = await updateCohesionWeights(parsed);
      if (res.success) {
        toast.success("Weight overrides applied");
        onWeightsUpdated();
      } else {
        toast.error(res.error ?? "Failed to save weights");
      }
    } catch {
      toast.error("Invalid JSON");
    } finally {
      setSaving(false);
    }
  }, [editorContent, onWeightsUpdated]);

  const handleReset = useCallback(async () => {
    // Reset by sending empty overrides, then refetch
    const res = await updateCohesionWeights({});
    if (res.success && res.data) {
      setEditorContent(JSON.stringify(res.data, null, 2));
      toast.success("Weights reset to defaults");
      onWeightsUpdated();
    } else {
      toast.error(res.error ?? "Failed to reset weights");
    }
  }, [onWeightsUpdated]);

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Loading weights…</div>;
  }

  return (
    <div id="cohesion-cal-weights-editor" className="space-y-3 h-full flex flex-col">
      {/* Monaco editor */}
      <div className="flex-1 min-h-0 rounded-md border border-border overflow-hidden">
        {MonacoEditor ? (
          <MonacoEditor
            height="100%"
            language="json"
            theme="vs-dark"
            value={editorContent}
            onChange={(v) => setEditorContent(v ?? "{}")}
            options={{
              minimap: { enabled: false },
              fontSize: 11,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
            }}
          />
        ) : (
          <textarea
            id="cohesion-cal-weights-textarea"
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            className="w-full h-full bg-background text-foreground font-mono text-xs p-3 resize-none focus:outline-none"
            spellCheck={false}
          />
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          id="cohesion-cal-weights-save-btn"
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="flex-1 text-xs font-medium py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Overrides"}
        </button>
        <button
          id="cohesion-cal-weights-reset-btn"
          type="button"
          onClick={handleReset}
          className="text-xs font-medium py-1.5 px-3 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components: Results Panel
// ---------------------------------------------------------------------------

interface ResultsPanelProps {
  testHistory: LineupTestResult[];
  onLoadLineup: (result: LineupTestResult) => void;
}

/** Session history of lineup evaluations (LIFO, collapsible). */
function ResultsPanel({ testHistory, onLoadLineup }: ResultsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (testHistory.length === 0) {
    return (
      <div id="cohesion-cal-results-empty" className="flex items-center justify-center h-full text-xs text-muted-foreground/50">
        No test results yet
      </div>
    );
  }

  return (
    <div id="cohesion-cal-results" className="space-y-1.5 overflow-y-auto">
      {testHistory.map((result, idx) => {
        const isExpanded = expandedId === result.id;
        const prevResult = testHistory[idx + 1]; // older result (LIFO)
        const delta = prevResult ? result.cohesion_score - prevResult.cohesion_score : null;

        return (
          <button
            key={result.id}
            type="button"
            onClick={() => setExpandedId(isExpanded ? null : result.id)}
            className="w-full text-left rounded-md border border-border bg-card hover:bg-muted/50 transition-colors p-2.5 cursor-pointer"
          >
            {/* Summary row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[9px] text-muted-foreground tabular-nums">
                  {new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-[10px] text-foreground truncate">
                  {result.playerNames.slice(0, 3).join(", ")}
                  {result.playerNames.length > 3 && ` +${result.playerNames.length - 3}`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className={cn("text-xs font-mono font-bold tabular-nums", subscoreColor(result.cohesion_score * 2))}>
                  {result.cohesion_score.toFixed(2)}
                </span>
                {delta !== null && (
                  <span className={cn("text-[9px] font-mono tabular-nums", delta >= 0 ? "text-green-400" : "text-red-400")}>
                    {delta >= 0 ? "+" : ""}{delta.toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="mt-2 pt-2 border-t border-border/50 space-y-2" onClick={(e) => e.stopPropagation()}>
                {/* Full player names */}
                <p className="text-[9px] text-muted-foreground">{result.playerNames.join(" / ")}</p>
                <button
                  id={`cohesion-cal-history-load-${result.id}`}
                  type="button"
                  onClick={() => onLoadLineup(result)}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-[9px] font-medium text-foreground hover:bg-muted cursor-pointer"
                >
                  Load Lineup
                </button>
                {/* Subscores */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                  {Object.entries(result.subscores).map(([key, val]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-[8px] text-muted-foreground">{SUBSCORE_LABELS[key] ?? key}</span>
                      <span className={cn("text-[8px] font-mono tabular-nums", subscoreColor(val))}>{val.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
                {/* Synergies */}
                {result.synergies_applied.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {result.synergies_applied.map((s, i) => (
                      <span
                        key={`${s}-${i}`}
                        id={`cohesion-cal-history-synergy-${result.id}-${s}-${i}`}
                        className={cn("text-[7px] font-mono px-1 rounded border", synergyChipClass(s))}
                        title={synergyDescription(s)}
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const EMPTY_LINEUP: LineupSlot[] = Array.from({ length: 5 }, () => ({
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
    playerIds: candidate.playerIds.map((id) => String(id)).slice(0, 5),
    playerNames: candidate.playerNames.map((name) => String(name)).slice(0, 5),
    cohesion_score: candidate.cohesion_score,
    subscores: candidate.subscores as Record<string, number>,
    synergies_applied: candidate.synergies_applied.map((id) => String(id)),
    accentuation: candidate.accentuation as LineupTestResult["accentuation"],
    accentuation_details: candidate.accentuation_details,
    boosted_bell_curves: candidate.boosted_bell_curves,
    rp_pd_boosts: candidate.rp_pd_boosts,
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
        playerIds = parsed.slice(0, 5).map((id) => (id ? String(id) : null));
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
        ...Array.from({ length: Math.max(0, 5 - restored.length) }, () => emptyLineupSlot()),
      ].slice(0, 5));
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

  /** Set a player into a lineup slot and fetch their skills. */
  const handleLineupSlotSelect = useCallback(async (index: number, player: Player) => {
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
  }, [hydrateLineupSlot]);

  /** Put an existing slot back into search mode without clearing it yet. */
  const handleLineupSlotReplace = useCallback((index: number) => {
    setLineupSlots((prev) =>
      prev.map((slot, i) =>
        i === index ? { ...slot, replacing: true } : slot,
      ),
    );
    setActiveResultId(null);
  }, []);

  /** Remove one player from the lineup and clear the active result preview. */
  const handleLineupSlotRemove = useCallback((index: number) => {
    setLineupSlots((prev) =>
      prev.map((slot, i) => (i === index ? emptyLineupSlot() : slot)),
    );
    setActiveResultId(null);
  }, []);

  /** Rehydrate a saved history item into the lineup tester with fresh composite data. */
  const handleLoadTestHistoryLineup = useCallback(async (result: LineupTestResult) => {
    const restored = await Promise.all(result.playerIds.slice(0, 5).map(async (playerId, index) => {
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
      ...Array.from({ length: Math.max(0, 5 - restored.length) }, () => emptyLineupSlot()),
    ].slice(0, 5));
    setActiveResultId(null);
    setCenterTab("lineup");
    toast.success("Lineup loaded");
  }, [hydrateLineupSlot]);

  /** Evaluate the current 5-player lineup. */
  const handleEvaluateLineup = useCallback(async () => {
    // Guard against partial lineup even if button disabled state is bypassed
    if (lineupSlots.some((s) => !s.player)) return;

    setEvaluatingLineup(true);
    // Build the player array for the API — using name + height
    const players = lineupSlots.map((slot) => ({
      id: slot.player?.id,
      name: slot.player?.name ?? "",
      height: slot.height,
      skills: slot.skills,
    }));

    const res = await evaluateLineup(players);
    if (res.success && res.data) {
      const result: LineupTestResult = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        playerIds: lineupSlots.map((s) => s.player?.id ?? ""),
        playerNames: lineupSlots.map((s) => s.player?.name ?? "?"),
        cohesion_score: res.data.cohesion_score,
        subscores: res.data.subscores,
        synergies_applied: res.data.synergies_applied,
        accentuation: res.data.accentuation,
        accentuation_details: res.data.accentuation_details,
        boosted_bell_curves: res.data.boosted_bell_curves,
        rp_pd_boosts: res.data.rp_pd_boosts,
      };
      setTestHistory((prev) => [result, ...prev].slice(0, 20));
      setActiveResultId(result.id);
      toast.success(`Cohesion: ${res.data.cohesion_score.toFixed(2)}`);
    } else {
      toast.error(res.error ?? "Lineup evaluation failed");
    }
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
                        toast.error("All lineup slots filled");
                      }
                    }}
                    className="flex-1 text-[10px] font-medium py-1.5 rounded-md border border-border hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
                  >
                    Set in Lineup
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
                <BellCurveChart overlayPlayers={overlayPlayers} onRemovePlayer={handleRemoveBellCurvePlayer} />
              )}
              {centerTab === "lineup" && (
                <LineupTester
                  lineupSlots={lineupSlots}
                  weights={cohesionWeights}
                  onSlotSelect={handleLineupSlotSelect}
                  onSlotRemove={handleLineupSlotRemove}
                  onSlotReplace={handleLineupSlotReplace}
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
