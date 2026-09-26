/**
 * #143: one check for Evaluate and Save — complete, and at or under the cap.
 * Run: npx playwright test tests/build-legality-logic.spec.ts --reporter=line
 */
import { test, expect } from "@playwright/test";
import { checkBuildLegality, describeBuildBlock } from "../components/builder/buildLegality";
import type { PlayerWithSkills } from "../lib/types";

const p = (value_price: number | null) => ({ id: String(value_price), name: "x", salary: null, value_price } as unknown as PlayerWithSkills);
const CAP = 195_000_000;

test("a full Rotation under the cap is legal", () => {
  const slots = Array.from({ length: 9 }, () => p(20_000_000));
  const l = checkBuildLegality(slots, { salaryCap: CAP, currency: "value" });
  expect(l.ok).toBe(true);
  expect(describeBuildBlock(l, "Rotation")).toBeNull();
});

test("open slots block with the count", () => {
  const slots = [p(60_000_000), null, null, null, null, null, null, null, null];
  const l = checkBuildLegality(slots, { salaryCap: CAP, currency: "value" });
  expect(l.ok).toBe(false);
  expect(describeBuildBlock(l, "Rotation")).toBe("8 open slots — fill the Rotation to evaluate");
});

test("over the cap blocks with the overage, and outranks open slots", () => {
  const slots = [p(100_000_000), p(100_000_000), p(45_900_000), null, null, null, null, null, null];
  const l = checkBuildLegality(slots, { salaryCap: CAP, currency: "value" });
  expect(l.overCapBy).toBe(50_900_000);
  expect(describeBuildBlock(l, "Rotation")).toBe("$50.9M over the $195M cap");
});

test("no cap in the RuleSet means only completeness counts, and an unpriced player costs nothing", () => {
  const slots = Array.from({ length: 5 }, () => p(null));
  const l = checkBuildLegality(slots, { salaryCap: null, currency: "value" });
  expect(l.ok).toBe(true);
});
