/**
 * #152 — the admin calibration panel's printed equation must agree with the
 * number the engine actually produced.
 *
 * `PlayerEquationPanel` renders `Perimeter Defense = <engine raw> = <terms>`.
 * The backend runs a two-term fallback (`1.0*POA + 0.7*VD`) for any profile
 * with no `off_ball_disruptor` key — which is every player between the split
 * and the M5 publish — so a flat three-term equation makes the two sides of
 * that second `=` disagree on every player.
 *
 * These are pure-logic tests: no browser, no network.
 *
 * Run:
 *   cd frontend && npx playwright test tests/perimeter-equation-logic.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";
import { equationTermsFor } from "../app/admin/evaluator-calibration/components/PlayerInspection";
import { computeRawCompositeBreakdowns, TIER_VALUES } from "../lib/player-composites";
import { DEFAULT_COHESION_WEIGHTS } from "../lib/cohesion-weights";

/** The dict PlayerEquationPanel falls back to when no Evaluation Version is loaded. */
const COEFFICIENTS: Record<string, number> = { ...DEFAULT_COHESION_WEIGHTS.COMPOSITE_COEFFICIENTS };

function sumEquation(
  composite: string,
  skills: Record<string, string>,
  coefficients: Record<string, number> = COEFFICIENTS,
): number {
  return equationTermsFor(composite, coefficients, skills).reduce((total, term) => {
    const base = term.skill ? TIER_VALUES[skills[term.skill] ?? "None"] ?? 0 : 0;
    return total + base * (term.multiplier ?? 1);
  }, 0);
}

function engineRaw(skills: Record<string, string>): number {
  return computeRawCompositeBreakdowns(skills).perimeter_defense?.raw ?? 0;
}

// ── The window the split creates: no player has an off-ball rating yet ──────

test("OG-shaped profile: the printed equation equals the engine raw", () => {
  // Proficient on-ball (4.0), Elite versatile (8.0), no off-ball key.
  const skills = { point_of_attack_defender: "Proficient", versatile_defender: "Elite" };

  expect(engineRaw(skills)).toBeCloseTo(9.6, 6);
  expect(sumEquation("perimeter_defense", skills)).toBeCloseTo(9.6, 6);
});

test("an absent off-ball key prints two terms, not three", () => {
  const skills = { point_of_attack_defender: "Proficient", versatile_defender: "Elite" };

  const terms = equationTermsFor("perimeter_defense", COEFFICIENTS, skills);

  expect(terms.map((t) => t.skill)).toEqual(["point_of_attack_defender", "versatile_defender"]);
  expect(terms[0].multiplier).toBe(1);
});

test("a rated-None off-ball key is present, so the three-term split prints", () => {
  const skills = {
    point_of_attack_defender: "Proficient",
    off_ball_disruptor: "None",
    versatile_defender: "Elite",
  };

  const terms = equationTermsFor("perimeter_defense", COEFFICIENTS, skills);

  expect(terms.map((t) => t.skill)).toEqual([
    "point_of_attack_defender",
    "off_ball_disruptor",
    "versatile_defender",
  ]);
  expect(sumEquation("perimeter_defense", skills)).toBeCloseTo(engineRaw(skills), 6);
});

test("a post-split profile still agrees with the engine", () => {
  const skills = {
    point_of_attack_defender: "Elite",
    off_ball_disruptor: "Capable",
    versatile_defender: "Proficient",
  };

  expect(sumEquation("perimeter_defense", skills)).toBeCloseTo(engineRaw(skills), 6);
});

// ── Pre-v10 Evaluation Version: the coefficients dict holds neither new key ──

test("with a pre-v10 coefficient dict the off-ball term falls back to 0, like the backend", () => {
  const preV10 = { ...COEFFICIENTS };
  delete preV10.perimeter_defense_poa;
  delete preV10.perimeter_defense_off_ball;

  const skills = {
    point_of_attack_defender: "Elite",
    off_ball_disruptor: "Elite",
    versatile_defender: "Capable",
  };
  const terms = equationTermsFor("perimeter_defense", preV10, skills);
  const byKey = Object.fromEntries(terms.map((t) => [t.skill, t.multiplier]));

  // Backend: c.get("perimeter_defense_poa", 1.0), c.get("perimeter_defense_off_ball", 0.0).
  expect(byKey.point_of_attack_defender).toBe(1);
  expect(byKey.off_ball_disruptor).toBe(0);
  expect(sumEquation("perimeter_defense", skills, preV10)).toBeCloseTo(8 + 0 + 0.7 * 1, 6);
});

// ── Every other composite keeps its existing shape ───────────────────────────

test("passing skills does not change any other composite's terms", () => {
  const skills = { point_of_attack_defender: "Elite" };

  for (const composite of ["spacing", "interior_defense", "transition", "shot_creation"]) {
    expect(equationTermsFor(composite, COEFFICIENTS, skills)).toEqual(
      equationTermsFor(composite, COEFFICIENTS),
    );
  }
});
