import { COMPOSITE_COLUMNS, SUBSCORE_LABELS } from "./cohesion-constants";
import { formatSkillName } from "./skills";
import type {
  CohesionCompositeScores,
  CohesionLineupCombination,
  PlayerSkillMap,
  PlayerWithSkills,
  RosterEvaluation,
} from "./types";

export type ImpactTraitKey = keyof CohesionCompositeScores & string;
export type LineupReadContextId = "starting" | "best" | "median";

export interface SkillTraceEntry {
  skill: string;
  label: string;
  tier: string;
  value: number;
}

export interface ImpactTraitReadEntry {
  key: string;
  label: string;
  value: number;
  rawValue?: number;
  normalizedValue?: number | null;
  affected: boolean;
  valueLabel: string;
}

export interface LineupSubscoreReadEntry {
  key: string;
  label: string;
  value: number;
}

export interface LineupReadContext {
  id: LineupReadContextId;
  label: string;
  eyebrow: string;
  helper?: string;
  worksLabel?: string;
  addsLabel?: string;
  lineup: CohesionLineupCombination;
}

export interface PlayerLineupRead {
  total: number;
  viableTotal: number;
  count: number;
  allCount: number;
  starting: CohesionLineupCombination | null;
  best: CohesionLineupCombination;
  median: CohesionLineupCombination;
  showingViableContexts: boolean;
  contexts: LineupReadContext[];
}

export interface RotationLineupRead {
  total: number;
  viable: number;
  medianScore: number;
  starting: CohesionLineupCombination;
  best: CohesionLineupCombination;
  median: CohesionLineupCombination;
  contexts: LineupReadContext[];
}

export interface LineupReachRead {
  filledCount: number;
  isInSelection: boolean;
  playerLineups: number;
  totalLineups: number;
}

const TIER_VALUES: Record<string, number> = {
  None: 0,
  Capable: 1.5,
  Proficient: 3,
  Elite: 6,
  "All-Time Great": 10,
};

const VIABLE_LINEUP_THRESHOLD = 2.75;

export const SKILL_TO_IMPACT_TRAITS: Record<string, ImpactTraitKey[]> = {
  movement_shooter: ["spacing", "off_ball_impact", "shot_creation"],
  spot_up_shooter: ["spacing", "pnr_screener", "off_ball_impact", "shot_creation", "transition"],
  off_dribble_shooter: ["spacing", "shot_creation"],
  high_flyer: ["finishing", "paint_touch", "off_ball_impact", "transition"],
  crafty_finisher: ["finishing", "paint_touch", "off_ball_impact"],
  driver: ["paint_touch", "shot_creation", "transition"],
  vertical_spacer: ["paint_touch", "pnr_screener"],
  low_post_player: ["paint_touch", "post_game"],
  mid_post_player: ["paint_touch", "post_game"],
  rebounder: ["defensive_rebounding", "interior_defense"],
  offensive_rebounder: ["offensive_rebounding"],
  perimeter_disruptor: ["perimeter_defense"],
  versatile_defender: ["perimeter_defense", "interior_defense"],
  rim_protector: ["interior_defense"],
  screen_setter: ["pnr_screener"],
  pnr_finisher: ["pnr_screener"],
  transition_threat: ["transition"],
  cutter: ["off_ball_impact"],
  passer: ["off_ball_impact", "shot_creation", "transition", "ball_security"],
  pnr_ball_handler: ["shot_creation"],
  isolation_scorer: ["shot_creation"],
};

export function formatScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0.0";
  return value.toFixed(1);
}

export function buildSkillTraceEntries(skills: PlayerSkillMap | null | undefined): SkillTraceEntry[] {
  return Object.entries(skills ?? {})
    .map(([skill, tier]) => ({
      skill,
      label: formatSkillName(skill),
      tier: tier ?? "None",
      value: TIER_VALUES[tier ?? "None"] ?? 0,
    }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function getImpactTraitKeysForSkill(skill: string | null | undefined): ImpactTraitKey[] {
  if (!skill) return [];
  return SKILL_TO_IMPACT_TRAITS[skill] ?? [];
}

export function getImpactTraitLabel(key: string): string {
  return COMPOSITE_COLUMNS.find((column) => column.key === key)?.label ?? key.replaceAll("_", " ");
}

export function getImpactTraitLabels(keys: Iterable<string>): string[] {
  return Array.from(keys).map(getImpactTraitLabel);
}

export function isPlayerInBuild(allSlots: (PlayerWithSkills | null)[], player: PlayerWithSkills | null): boolean {
  if (!player) return false;
  return allSlots.some((slotPlayer) => slotPlayer?.id === player.id);
}

function compositeValue(player: { base: CohesionCompositeScores }, key: string): number {
  return (player.base as unknown as Record<string, number>)[key] ?? 0;
}

export function getEvaluatedImpactTraitValues(
  evaluation: RosterEvaluation | null,
  player: PlayerWithSkills | null,
): Record<string, number> | null {
  if (!player) return null;
  const playerName = player.name.toLowerCase();
  const evaluatedPlayer = evaluation?.player_composites.find(
    (item) => item.player_id === player.id || item.name.toLowerCase() === playerName,
  );
  if (!evaluatedPlayer) return null;

  return Object.fromEntries(COMPOSITE_COLUMNS.map((column) => [column.key, compositeValue(evaluatedPlayer, column.key)]));
}

export function getPotentialImpactTraitValues(skills: PlayerSkillMap | null | undefined): Record<string, number> {
  const values = Object.fromEntries(COMPOSITE_COLUMNS.map((column) => [column.key, 0])) as Record<string, number>;
  Object.entries(skills ?? {}).forEach(([skill, tier]) => {
    const value = TIER_VALUES[tier ?? "None"] ?? 0;
    (SKILL_TO_IMPACT_TRAITS[skill] ?? []).forEach((traitKey) => {
      values[traitKey] = Math.min(10, (values[traitKey] ?? 0) + value);
    });
  });
  return values;
}

export function impactTraitEntriesFromValues(
  values: Record<string, number>,
  affectedTraitKeys: Set<string>,
  valueLabel: (value: number, key: string) => string = (value) => formatScore(value),
): ImpactTraitReadEntry[] {
  return COMPOSITE_COLUMNS.map((column) => {
    const value = values[column.key] ?? 0;
    return {
      key: column.key,
      label: column.label,
      value,
      affected: affectedTraitKeys.has(column.key),
      valueLabel: valueLabel(value, column.key),
    };
  });
}

export function rankImpactTraitEntries(
  entries: ImpactTraitReadEntry[],
  options: { onlyAffected?: boolean; limit?: number; affectedFirst?: boolean; includeZero?: boolean } = {},
): ImpactTraitReadEntry[] {
  const { onlyAffected = false, limit, affectedFirst = true, includeZero = false } = options;
  const ranked = entries
    .filter((entry) => includeZero || entry.value > 0)
    .filter((entry) => !onlyAffected || entry.affected)
    .sort((a, b) => {
      if (affectedFirst && a.affected !== b.affected) return a.affected ? -1 : 1;
      return b.value - a.value || a.label.localeCompare(b.label);
    });
  return typeof limit === "number" ? ranked.slice(0, limit) : ranked;
}

export function combinationCount(total: number, pick: number): number {
  if (total < pick || pick < 0) return 0;
  if (pick === 0 || total === pick) return 1;
  let numerator = 1;
  let denominator = 1;
  for (let index = 1; index <= pick; index += 1) {
    numerator *= total - (pick - index);
    denominator *= index;
  }
  return Math.round(numerator / denominator);
}

export function getLineupReach(
  allSlots: (PlayerWithSkills | null)[],
  player: PlayerWithSkills | null,
): LineupReachRead {
  const filledPlayers = allSlots.filter((slotPlayer): slotPlayer is PlayerWithSkills => slotPlayer !== null);
  const totalLineups = combinationCount(filledPlayers.length, 5);
  const isInSelection = isPlayerInBuild(allSlots, player);
  const playerLineups = isInSelection ? combinationCount(filledPlayers.length - 1, 4) : 0;
  return {
    filledCount: filledPlayers.length,
    isInSelection,
    playerLineups,
    totalLineups,
  };
}

export function playerIdentityKeys(player: PlayerWithSkills | null): Set<string> {
  if (!player) return new Set();
  return new Set([player.id, player.name, player.name.toLowerCase()].filter(Boolean));
}

export function lineupHasPlayer(lineup: CohesionLineupCombination, player: PlayerWithSkills | null): boolean {
  const keys = playerIdentityKeys(player);
  if (keys.size === 0) return false;
  return lineup.player_ids.some((id) => keys.has(id) || keys.has(id.toLowerCase()))
    || lineup.player_names.some((name) => keys.has(name) || keys.has(name.toLowerCase()));
}

export function getPlayerLineups(
  evaluation: RosterEvaluation | null,
  player: PlayerWithSkills | null,
): CohesionLineupCombination[] {
  const combinations = evaluation?.lineup_combinations ?? [];
  if (!player || combinations.length === 0) return [];
  return combinations
    .filter((lineup) => lineupHasPlayer(lineup, player))
    .sort((a, b) => a.rank - b.rank || b.cohesion_score - a.cohesion_score);
}

export function isViableLineup(lineup: CohesionLineupCombination): boolean {
  return lineup.is_viable ?? lineup.cohesion_score >= VIABLE_LINEUP_THRESHOLD;
}

export function getPlayerLineupRead(
  evaluation: RosterEvaluation | null,
  player: PlayerWithSkills | null,
  options: {
    startingHelper?: string;
    bestHelper?: string;
    medianHelper?: string;
    startingWorksLabel?: string;
    bestWorksLabel?: string;
    medianWorksLabel?: string;
    addsLabel?: string;
    medianAddsLabel?: string;
  } = {},
): PlayerLineupRead | null {
  const combinations = evaluation?.lineup_combinations ?? [];
  const withPlayer = getPlayerLineups(evaluation, player);
  if (withPlayer.length === 0) return null;

  const viableCombinations = combinations.filter(isViableLineup);
  const viableWithPlayer = withPlayer.filter(isViableLineup);
  const showingViableContexts = viableWithPlayer.length > 0;
  const displayedLineups = showingViableContexts ? viableWithPlayer : withPlayer;
  const viableStarting = viableWithPlayer.find((lineup) => lineup.is_starting_lineup) ?? null;
  const starting = showingViableContexts ? viableStarting : withPlayer.find((lineup) => lineup.is_starting_lineup) ?? null;
  const best = displayedLineups[0];
  const median = displayedLineups[Math.floor((displayedLineups.length - 1) / 2)];
  const contextQualifier = showingViableContexts ? "viable " : "";
  const fallbackPrefix = showingViableContexts
    ? ""
    : "No viable Lineup Combination includes this Player. Showing overall fit instead. ";
  const contextCandidates: Array<LineupReadContext | null> = [
    starting
      ? {
          id: "starting" as const,
          label: "Starting",
          eyebrow: showingViableContexts ? "Starting Fit" : "Starting Overall",
          lineup: starting,
          helper: options.startingHelper ?? `${fallbackPrefix}The Starting Lineup includes this Player.`,
          worksLabel: options.startingWorksLabel ?? "Starting Fit",
          addsLabel: options.addsLabel,
        }
      : null,
    {
      id: "best" as const,
      label: "Best",
      eyebrow: showingViableContexts ? "Best Viable Fit" : "Best Overall Fit",
      lineup: best,
      helper: options.bestHelper ?? `${fallbackPrefix}Highest-ranked ${contextQualifier}evaluated Lineup Combination that includes this Player.`,
      worksLabel: options.bestWorksLabel ?? "Lineup Works Through",
      addsLabel: options.addsLabel,
    },
    {
      id: "median" as const,
      label: "Median",
      eyebrow: showingViableContexts ? "Typical Viable Fit" : "Typical Overall Fit",
      lineup: median,
      helper: options.medianHelper ?? `${fallbackPrefix}Middle ${contextQualifier}evaluated Lineup Combination that includes this Player. This shows typical fit, not ceiling.`,
      worksLabel: options.medianWorksLabel ?? "Typical Fit",
      addsLabel: options.medianAddsLabel ?? options.addsLabel,
    },
  ];
  const contexts = contextCandidates.filter((context): context is LineupReadContext => context !== null);

  return {
    total: combinations.length,
    viableTotal: evaluation?.lineup_summary.viable_lineups ?? viableCombinations.length,
    count: viableWithPlayer.length,
    allCount: withPlayer.length,
    starting,
    best,
    median,
    showingViableContexts,
    contexts,
  };
}

export function getRotationLineupRead(evaluation: RosterEvaluation | null): RotationLineupRead | null {
  const combinations = evaluation?.lineup_combinations ?? [];
  if (combinations.length === 0) return null;

  const starting = combinations.find((lineup) => lineup.is_starting_lineup) ?? combinations[0];
  const best = combinations[0];
  const median = combinations[Math.floor((combinations.length - 1) / 2)];

  return {
    total: evaluation?.lineup_summary.total_lineups ?? combinations.length,
    viable: evaluation?.lineup_summary.viable_lineups ?? 0,
    medianScore: evaluation?.lineup_summary.median_score ?? 0,
    starting,
    best,
    median,
    contexts: [
      {
        id: "starting",
        label: "Starting",
        eyebrow: "Starting Fit",
        lineup: starting,
        helper: "The Starting Lineup uses the first five selected slots in the current Build.",
        worksLabel: "Starting Fit",
      },
      {
        id: "best",
        label: "Best",
        eyebrow: "Best Fit",
        lineup: best,
        helper: "Highest-ranked Lineup Combination in the current Build.",
        worksLabel: "Lineup Works Through",
      },
      {
        id: "median",
        label: "Median",
        eyebrow: "Typical Fit",
        lineup: median,
        helper: "Middle-ranked Lineup Combination in the current Build.",
        worksLabel: "Typical Fit",
      },
    ],
  };
}

export function compactPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name;

  const suffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
  const last = parts[parts.length - 1];
  if (suffixes.has(last.toLowerCase()) && parts.length > 2) {
    return parts[parts.length - 2];
  }
  return last;
}

export function lineupNames(lineup: CohesionLineupCombination, compact = true): string {
  return (compact ? lineup.player_names.map(compactPlayerName) : lineup.player_names).join(" / ");
}

export function topLineupSubscores(
  lineup: CohesionLineupCombination | null | undefined,
  limit = 3,
): LineupSubscoreReadEntry[] {
  if (!lineup) return [];
  return Object.entries(lineup.subscores)
    .map(([key, value]) => ({ key, label: SUBSCORE_LABELS[key] ?? key.replaceAll("_", " "), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
