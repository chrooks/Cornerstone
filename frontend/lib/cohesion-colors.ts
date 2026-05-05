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
