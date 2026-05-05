/**
 * cohesion-weights.ts — Cohesion engine weights interface, defaults, and normalization.
 *
 * The calibration page uses these to display equation explanations and
 * allow admins to tune the engine via the Weights editor.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CohesionExplanationWeights {
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_COHESION_WEIGHTS: CohesionExplanationWeights = {
  COMPOSITE_COEFFICIENTS: {
    pnr_screener_secondary_scale: 0.15,
    perimeter_defense_versatile_defender: 0.7,
    interior_defense_versatile_defender: 0.5,
    interior_defense_rebounder: 0.3,
    paint_touch_finishing_scale: 0.08,
    off_ball_finishing_scale: 0.08,
    off_ball_passer: 0.3,
    shot_creation_spacing: 0.3,
    shot_creation_paint_touch: 0.5,
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
// Normalization helpers
// ---------------------------------------------------------------------------

export function numberFromWeights(weights: Record<string, unknown>, key: string, fallback: number): number {
  const value = weights[key];
  return typeof value === "number" ? value : fallback;
}

export function numberArrayFromWeights(weights: Record<string, unknown>, key: string, fallback: number[]): number[] {
  const value = weights[key];
  if (!Array.isArray(value)) return fallback;
  const numbers = value.filter((item): item is number => typeof item === "number");
  return numbers.length > 0 ? numbers : fallback;
}

export function numberRecordFromWeights(weights: Record<string, unknown>, key: string, fallback: Record<string, number>): Record<string, number> {
  const value = weights[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

/** Normalizes raw API weights data into a fully-populated CohesionExplanationWeights object. */
export function normalizeCohesionExplanationWeights(data: Record<string, unknown> | null | undefined): CohesionExplanationWeights {
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

// ---------------------------------------------------------------------------
// Weight-dependent utility functions
// ---------------------------------------------------------------------------

export function pnrScreenerSecondaryScale(weights: CohesionExplanationWeights): number {
  return weights.COMPOSITE_COEFFICIENTS.pnr_screener_secondary_scale ?? DEFAULT_COHESION_WEIGHTS.COMPOSITE_COEFFICIENTS.pnr_screener_secondary_scale;
}

export function pnrPairingQualityGate(handlerQuality: number, screenerQuality: number, weights: CohesionExplanationWeights): number {
  if (handlerQuality <= 0 || screenerQuality <= 0) return 0;
  const rawGate = Math.sqrt(handlerQuality * screenerQuality) / 10;
  return Math.min(1, weights.PNR_PAIRING_QUALITY_GATE_FLOOR + weights.PNR_PAIRING_QUALITY_GATE_SCALE * rawGate);
}

export function defensiveCoverageSubscoreFromRaw(rawCoverage: number, weights: CohesionExplanationWeights): number {
  if (rawCoverage <= 0) return 0;
  return 10 * (1 - Math.exp(-rawCoverage / weights.DEFENSIVE_COVERAGE_SATURATION_RAW));
}
