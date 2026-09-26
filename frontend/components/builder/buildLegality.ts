import { getPlayerPrice, type RuleSetCurrency } from "@/lib/builder-config";
import type { PlayerWithSkills } from "@/lib/types";
import { formatSalaryM } from "./SalaryGauge";

/**
 * #143: the one check a Build must pass before Evaluate and Save — complete,
 * and at or under the cap. The Build page, the Final Eval and the save path
 * all read this so they cannot disagree.
 */
export interface BuildLegality {
  filled: number;
  teamSize: number;
  complete: boolean;
  /** Dollars over the cap; 0 when under or when the RuleSet has no cap. */
  overCapBy: number;
  salaryCap: number | null;
  ok: boolean;
}

export function checkBuildLegality(
  slots: (PlayerWithSkills | null)[],
  options: { salaryCap: number | null | undefined; currency: RuleSetCurrency },
): BuildLegality {
  const teamSize = slots.length;
  const filled = slots.filter(Boolean).length;
  const used = slots.reduce((sum, p) => sum + (p ? getPlayerPrice(p, options.currency) ?? 0 : 0), 0);
  const salaryCap = options.salaryCap ?? null;
  const overCapBy = salaryCap != null ? Math.max(0, used - salaryCap) : 0;
  const complete = filled === teamSize;
  return { filled, teamSize, complete, overCapBy, salaryCap, ok: complete && overCapBy === 0 };
}

/** The one-line reason a Build is blocked, or null when it is not. Cap first: it is the rule, not the progress. */
export function describeBuildBlock(legality: BuildLegality, teamLabel: string): string | null {
  if (legality.overCapBy > 0 && legality.salaryCap != null) {
    return `${formatSalaryM(legality.overCapBy)} over the ${formatSalaryM(legality.salaryCap)} cap`;
  }
  if (!legality.complete) {
    const open = legality.teamSize - legality.filled;
    return `${open} open slot${open === 1 ? "" : "s"} — fill the ${teamLabel} to evaluate`;
  }
  return null;
}
