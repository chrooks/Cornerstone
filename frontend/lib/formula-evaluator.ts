/**
 * formula-evaluator.ts — Client-side composite formula evaluator.
 *
 * Lightweight TypeScript port of formula_engine.py for instant preview
 * in the formula editor. No API round-trip needed per coefficient change.
 */

import type { CompositeFormula, FormulaAmplifier } from "@/app/admin/cohesion-calibration/types";

function topologicalSort(formulas: Record<string, CompositeFormula>): string[] {
  const visited = new Set<string>();
  const temp = new Set<string>();
  const order: string[] = [];

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (temp.has(key)) {
      console.warn(`[formula-evaluator] Circular dependency at '${key}' — skipping`);
      return;
    }
    temp.add(key);
    for (const dep of formulas[key]?.depends_on ?? []) {
      if (dep in formulas) visit(dep);
    }
    temp.delete(key);
    visited.add(key);
    order.push(key);
  }

  for (const key of Object.keys(formulas)) {
    visit(key);
  }
  return order;
}

function resolveAmplifierSource(
  amp: FormulaAmplifier,
  skills: Record<string, string>,
  tierValues: Record<string, number>,
  rawResults: Record<string, number>,
): number {
  const source = amp.source;
  if (typeof source === "string") {
    return rawResults[source] ?? 0;
  }
  if (typeof source === "object" && "skills" in source) {
    return source.skills.reduce((sum, key) => sum + (tierValues[skills[key] ?? "None"] ?? 0), 0);
  }
  return 0;
}

export function computeRawFromFormulas(
  skills: Record<string, string>,
  formulas: Record<string, CompositeFormula>,
  tierValues: Record<string, number>,
): Record<string, number> {
  const order = topologicalSort(formulas);
  const rawResults: Record<string, number> = {};

  for (const compositeKey of order) {
    const formula = formulas[compositeKey];
    if (!formula) continue;

    const factorValues = formula.factors.map((factor) => {
      const val =
        factor.type === "skill"
          ? (tierValues[skills[factor.key] ?? "None"] ?? 0)
          : (rawResults[factor.key] ?? 0);
      return factor.coefficient * val;
    });

    for (const amp of formula.amplifiers) {
      const sourceVal = resolveAmplifierSource(amp, skills, tierValues, rawResults);
      const mult = Math.max(amp.floor, amp.floor + amp.scale * sourceVal);
      const appliesTo = amp.applies_to;

      if (appliesTo == null) {
        for (let i = 0; i < factorValues.length; i++) {
          factorValues[i] *= mult;
        }
      } else {
        for (const idx of appliesTo) {
          if (idx >= 0 && idx < factorValues.length) {
            factorValues[idx] *= mult;
          }
        }
      }
    }

    rawResults[compositeKey] = factorValues.reduce((a, b) => a + b, 0);
  }

  return rawResults;
}
