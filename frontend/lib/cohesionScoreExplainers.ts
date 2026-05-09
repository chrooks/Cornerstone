export const SCORE_FACTOR_LABELS: Record<string, string> = {
  starting_5: "Starting Lineup",
  depth: "Depth",
  archetype_diversity: "Versatility",
  floor: "Floor",
};

export const SCORE_FACTOR_EXPLAINERS: Record<string, string> = {
  starting_5:
    "How much the first five slots hold together as the primary Lineup. This rises when the starters cover creation, spacing, defense, rebounding, and finishing without forcing one Player to solve every possession.",
  depth:
    "How many useful Lineup Combinations survive beyond the starters. This rises when bench Players keep the Rotation playable instead of creating fragile substitution paths.",
  archetype_diversity:
    "How many different lineup styles the Rotation can credibly play. This rises when the same nine Players can form multiple identities, like defensive, offensive, transition, or balanced groups.",
  floor:
    "How safe the Rotation is across its middle lineup outcomes. This rises when the median Lineup Combination stays solid, not just when the best Lineup is strong.",
};

export function scoreFactorLabel(key: string): string {
  return SCORE_FACTOR_LABELS[key] ?? key.replaceAll("_", " ");
}

export function scoreFactorExplainer(key: string): string {
  return SCORE_FACTOR_EXPLAINERS[key] ?? "How this score factor affects the current Eval.";
}
