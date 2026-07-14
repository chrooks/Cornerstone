import { DEFAULT_CURRENCY, DEFAULT_MAX_ROSTER_SLOTS, teamLabelForSize, VALID_TEAM_SIZES } from "@/lib/builder-config";
import type { RuleSetCurrency } from "@/lib/builder-config";

export type CornerstoneSource = "legend" | "all";

export interface ResolvedRuleSetRules {
  teamSize: number;
  teamLabel: string;
  allowedTeamSizes: number[];
  requiresTeamSizeChoice: boolean;
  cornerstoneSource: CornerstoneSource;
  /** Pricing currency for this RuleSet (#110). Defaults to "market". */
  currency: RuleSetCurrency;
  isValidTeamSizeParam: boolean;
}

function isValidTeamSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && (VALID_TEAM_SIZES as readonly number[]).includes(value);
}

function parseTeamSizeParam(params?: URLSearchParams): number | null {
  const value = params?.get("team_size");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

export function resolveRuleSetRules(
  rules: Record<string, unknown> | null | undefined,
  params?: URLSearchParams,
): ResolvedRuleSetRules {
  const defaultTeamSize = isValidTeamSize(rules?.team_size) ? rules.team_size : DEFAULT_MAX_ROSTER_SLOTS;
  const rawAllowedTeamSizes = Array.isArray(rules?.allowed_team_sizes)
    ? rules.allowed_team_sizes.filter(isValidTeamSize)
    : [];
  const allowedTeamSizes = rawAllowedTeamSizes.length > 0
    ? Array.from(new Set(rawAllowedTeamSizes)).sort((a, b) => a - b)
    : [defaultTeamSize];
  const requestedTeamSize = parseTeamSizeParam(params);
  const isValidTeamSizeParam = requestedTeamSize == null || allowedTeamSizes.includes(requestedTeamSize);
  const teamSize = requestedTeamSize != null && allowedTeamSizes.includes(requestedTeamSize)
    ? requestedTeamSize
    : allowedTeamSizes.includes(defaultTeamSize) ? defaultTeamSize : allowedTeamSizes[0] ?? DEFAULT_MAX_ROSTER_SLOTS;

  return {
    teamSize,
    teamLabel: teamLabelForSize(teamSize),
    allowedTeamSizes,
    requiresTeamSizeChoice: allowedTeamSizes.length > 1,
    cornerstoneSource: rules?.cornerstone_source === "all" ? "all" : "legend",
    currency: rules?.currency === "value" ? "value" : DEFAULT_CURRENCY,
    isValidTeamSizeParam,
  };
}
