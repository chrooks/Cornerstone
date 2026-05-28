/**
 * builder-config.ts — Default constants for the Team Builder feature.
 *
 * These serve as fallbacks when rules_json has not yet loaded from the RuleSet.
 * Live values should come from the published RuleSet Version's rules_json.
 */

/** Default salary cap budget in dollars (fallback when RuleSet not loaded). */
export const DEFAULT_SALARY_CAP = 195_000_000;

/** Default salary assigned to a cornerstone legend (fallback). */
export const DEFAULT_LEGEND_SALARY = 54_000_000;

/** Default maximum number of players in a rotation (fallback). */
export const DEFAULT_MAX_ROSTER_SLOTS = 9;

/** Valid team sizes and their derived labels. */
export const TEAM_SIZE_LABELS: Record<number, string> = {
  5: "Lineup",
  9: "Rotation",
  12: "Roster",
};

export const VALID_TEAM_SIZES = [5, 9, 12] as const;
export type ValidTeamSize = (typeof VALID_TEAM_SIZES)[number];

/** Derive the team label from team_size. */
export function teamLabelForSize(size: number): string {
  return TEAM_SIZE_LABELS[size] ?? `${size}-player`;
}

// Re-export under old names for consumers that haven't migrated yet
// (admin evaluator-calibration, tests)
export const SALARY_CAP = DEFAULT_SALARY_CAP;
export const LEGEND_SALARY = DEFAULT_LEGEND_SALARY;
export const MAX_ROSTER_SLOTS = DEFAULT_MAX_ROSTER_SLOTS;
