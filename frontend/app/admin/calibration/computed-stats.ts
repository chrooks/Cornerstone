/**
 * computed-stats.ts — Shared client-side resolver for computed.* stat keys.
 *
 * Mirrors the backend's compute_derived_stats (skill_engine/transforms.py)
 * closely enough for calibration display: supports the "sum" and "ratio"
 * formulas, and lets components reference earlier computed stats
 * (e.g. tov_pct's denominator is computed.oliver_denominator).
 *
 * Used by StatLeadersTable (cell display) and StatLeadersPanel (sorting).
 */

/** A computed stat definition from the active skill's rule JSON. */
export interface ComputedStatDef {
  name: string;
  formula: "sum" | "ratio" | "weighted_average" | "expression";
  components?: Array<{ stat?: string; weight?: number; role?: string }>;
}

/** Reads a raw (or stabilized-with-raw-fallback) stat value by dot-path key. */
export type RawStatGetter = (key: string) => number | null;

const MAX_DEPTH = 5; // computed refs are shallow; guards against cycles

/**
 * Resolve any stat key — plain blob paths pass through the getter; computed.*
 * keys are derived from their definitions, recursively resolving components.
 * Returns null when a definition or any required component value is missing.
 */
export function resolveComputedValue(
  getRaw: RawStatGetter,
  key: string,
  computedDefs: ComputedStatDef[],
  depth: number = 0,
): number | null {
  if (!key.startsWith("computed.")) return getRaw(key);
  if (depth >= MAX_DEPTH) return null;

  const name = key.slice("computed.".length);
  const def = computedDefs.find((d) => d.name === name);
  if (!def || !Array.isArray(def.components)) return null;

  const resolve = (statKey: string | undefined): number | null =>
    statKey ? resolveComputedValue(getRaw, statKey, computedDefs, depth + 1) : null;

  if (def.formula === "sum") {
    let total = 0;
    for (const c of def.components) {
      const v = resolve(c.stat);
      if (v === null) return null;
      total += v * (c.weight ?? 1.0);
    }
    return total;
  }

  if (def.formula === "ratio") {
    const num = resolve(def.components.find((c) => c.role === "numerator")?.stat);
    const den = resolve(def.components.find((c) => c.role === "denominator")?.stat);
    if (num === null || den === null || den === 0) return null;
    return num / den;
  }

  // "weighted_average" and "expression" are not used by any calibration rule's
  // display columns today; render as missing rather than guessing.
  return null;
}
