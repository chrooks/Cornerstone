import type { RosterEvaluation } from "@/lib/types";

/**
 * Top movers for the eval-impact hover preview (#92) — the subscores the
 * hovered candidate would move most. Compares the starting five first (that
 * is what the Team Shape renders); a bench add cannot move the starting five,
 * so when nothing there clears the noise floor the comparison falls back to
 * the Rotation Medians and says so via source: "rotation" (honest labeling,
 * same reasoning as #103/#104).
 */

const NOISE_FLOOR = 0.05;
const MOVER_LIMIT = 2;

export interface PreviewMover {
  key: string;
  delta: number;
  source: "starting_lineup" | "rotation";
}

function deltas(
  current: Record<string, number> | undefined,
  preview: Record<string, number> | undefined,
): { key: string; delta: number }[] {
  if (!current || !preview) return [];
  return Array.from(new Set([...Object.keys(current), ...Object.keys(preview)]))
    .map((key) => ({ key, delta: (preview[key] ?? 0) - (current[key] ?? 0) }))
    .filter(({ delta }) => Math.abs(delta) > NOISE_FLOOR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MOVER_LIMIT);
}

export function topMovers(current: RosterEvaluation, preview: RosterEvaluation): PreviewMover[] {
  const startingMovers = deltas(current.starting_lineup.subscores, preview.starting_lineup.subscores);
  if (startingMovers.length > 0) {
    return startingMovers.map((mover) => ({ ...mover, source: "starting_lineup" as const }));
  }
  const rotationMovers = deltas(
    current.lineup_summary.rotation_median_subscores,
    preview.lineup_summary.rotation_median_subscores,
  );
  return rotationMovers.map((mover) => ({ ...mover, source: "rotation" as const }));
}
