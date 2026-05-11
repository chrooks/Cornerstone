/**
 * cohesion-colors.ts — Unified color utility functions for cohesion engine UI.
 *
 * Provides consistent color mapping across all cohesion-related components:
 * calibration page, builder debug panel, evaluation results.
 */

// ---------------------------------------------------------------------------
// Subscore colors (0-10 scale)
// ---------------------------------------------------------------------------

/** Text color class for a 0-10 subscore value. Green ≥7, amber ≥4, red <4. */
export function subscoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

/** Bar fill class for a 0-10 subscore value. */
export function subscoreBarFill(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

// ---------------------------------------------------------------------------
// Builder read value colors
// ---------------------------------------------------------------------------

export type QualityValueScale = "ten" | "ratio";

export interface QualityValueThresholds {
  scale: QualityValueScale;
  strongMin: number;
  subparMin: number;
}

/** Edit these thresholds to tune builder read green / amber / red value mapping. */
export const BUILDER_READ_VALUE_THRESHOLDS = {
  impactTrait: { scale: "ten", strongMin: 7, subparMin: 4 },
  lineupSubscore: { scale: "ten", strongMin: 7, subparMin: 4 },
  scoreFactor: { scale: "ratio", strongMin: 0.7, subparMin: 0.4 },
  lineupViability: { scale: "ratio", strongMin: 0.7, subparMin: 0.4 },
  tenPoint: { scale: "ten", strongMin: 7, subparMin: 4 },
  ratio: { scale: "ratio", strongMin: 0.7, subparMin: 0.4 },
} as const satisfies Record<string, QualityValueThresholds>;

export type QualityValueKind = keyof typeof BUILDER_READ_VALUE_THRESHOLDS;

function normalizeQualityValue(value: number, scale: QualityValueScale): number {
  return scale === "ratio" ? value * 10 : value;
}

function thresholdValue(threshold: number, scale: QualityValueScale): number {
  return scale === "ratio" ? threshold * 10 : threshold;
}

/** Semantic text color for builder read values using `BUILDER_READ_VALUE_THRESHOLDS`. */
export function qualityTextColor(value: number, kind: QualityValueKind = "tenPoint"): string {
  const thresholds = BUILDER_READ_VALUE_THRESHOLDS[kind];
  const normalized = normalizeQualityValue(value, thresholds.scale);
  if (normalized >= thresholdValue(thresholds.strongMin, thresholds.scale)) return "text-[oklch(42%_0.13_145)]";
  if (normalized >= thresholdValue(thresholds.subparMin, thresholds.scale)) return "text-[#a34400]";
  return "text-[oklch(45%_0.17_25)]";
}

/** Semantic bar fill color for builder read values using `BUILDER_READ_VALUE_THRESHOLDS`. */
export function qualityBarFill(value: number, kind: QualityValueKind = "tenPoint"): string {
  const thresholds = BUILDER_READ_VALUE_THRESHOLDS[kind];
  const normalized = normalizeQualityValue(value, thresholds.scale);
  if (normalized >= thresholdValue(thresholds.strongMin, thresholds.scale)) return "bg-[oklch(55%_0.14_145)]";
  if (normalized >= thresholdValue(thresholds.subparMin, thresholds.scale)) return "bg-[#ffa05c]";
  return "bg-[oklch(58%_0.18_25)]";
}

// ---------------------------------------------------------------------------
// Composite heat map colors (0-10 scale, finer gradations)
// ---------------------------------------------------------------------------

/** Background + text color class for composite table cells. */
export function compositeHeatColor(score: number): string {
  if (score >= 8) return "bg-green-400 text-black font-semibold";
  if (score >= 6) return "bg-green-300 text-black";
  if (score >= 4) return "bg-amber-300 text-black";
  if (score >= 2) return "bg-red-300 text-black";
  return "bg-red-400 text-black";
}

// ---------------------------------------------------------------------------
// Synergy chip colors
// ---------------------------------------------------------------------------

/** CSS class for synergy chip badges (offensive, defensive, other). */
export function synergyChipClass(synergyId: string): string {
  if (synergyId.startsWith("OFF")) return "bg-blue-200 text-black border-blue-400";
  if (synergyId.startsWith("DEF")) return "bg-violet-200 text-black border-violet-400";
  return "bg-amber-200 text-black border-amber-400";
}
