/**
 * cohesion-bell-curve.ts — Bell curve math and height formatting utilities.
 *
 * Used by both CohesionResultDetails (shared bell curve chart) and the
 * cohesion calibration page's bell curve visualizations.
 */

import type { CohesionBellCurve } from "@/lib/types";

/**
 * Evaluates a player's defensive bell curve at a given height (inches).
 *
 * Returns the amplitude value (0 to params.amplitude) based on the player's
 * peak height, flat zone, and quadratic taper in each direction.
 */
export function bellValueAtHeight(targetHeight: number, params: CohesionBellCurve): number {
  const { amplitude, peak, range_down, range_up, flat_down, flat_up } = params;
  const distance = Math.abs(targetHeight - peak);
  const flat = targetHeight > peak ? flat_up : flat_down;
  const total = targetHeight > peak ? range_up : range_down;
  if (distance <= flat) return amplitude;
  const taper = total - flat;
  if (taper <= 0 || distance > total) return 0;
  const t = (distance - flat) / taper;
  return amplitude * Math.max(0, 1 - t * t);
}

/** Converts height in inches to feet'inches" display format (e.g. 72 → "6'0\""). */
export function inToLabel(inches: number): string {
  const ft = Math.floor(inches / 12);
  const inch = inches % 12;
  return `${ft}'${inch}"`;
}
