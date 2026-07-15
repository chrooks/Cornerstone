/**
 * builder-config.ts — Default constants for the Team Builder feature.
 *
 * These serve as fallbacks when rules_json has not yet loaded from the RuleSet.
 * Live values should come from the published RuleSet Version's rules_json.
 */

/**
 * A RuleSet's pricing currency (#110). "market" prices players by their real NBA
 * salary; "value" prices them by the skill-derived value_price ladder (#109).
 * Both are dollars, so the cap, gauge, and picker filter math is unit-identical —
 * only which field is read changes.
 */
export type RuleSetCurrency = "market" | "value";

/** Default currency when a RuleSet's rules_json omits it — real-salary pricing. */
export const DEFAULT_CURRENCY: RuleSetCurrency = "market";

/**
 * Resolve the dollar figure a player is priced at under the active currency.
 * Returns null exactly when the underlying field is null (unranked value_price,
 * or an unknown salary) — callers keep their existing null handling, so null
 * degrades identically to a null salary does today: counted as $0 in cap math,
 * never filtered out.
 */
export function getPlayerPrice(
  player: { salary: number | null; value_price?: number | null },
  currency: RuleSetCurrency,
): number | null {
  return currency === "value" ? (player.value_price ?? null) : (player.salary ?? null);
}

/** Default salary cap budget in dollars (fallback when RuleSet not loaded). */
export const DEFAULT_SALARY_CAP = 195_000_000;

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
export const MAX_ROSTER_SLOTS = DEFAULT_MAX_ROSTER_SLOTS;
