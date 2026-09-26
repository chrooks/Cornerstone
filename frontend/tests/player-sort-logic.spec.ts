/**
 * #138: the picker and /players open sorted by Value, highest first, and a
 * player with no Value price sorts last in either direction.
 *
 * Run: npx playwright test tests/player-sort-logic.spec.ts --reporter=line
 */

import { test, expect } from "@playwright/test";
import { stableMultiSort } from "../components/players/playerPoolPipeline";
import type { PlayerWithSkills } from "../lib/types";

function player(name: string, salary: number | null, value_price: number | null): PlayerWithSkills {
  return { id: name, name, salary, value_price, skills: {} } as unknown as PlayerWithSkills;
}

const POOL = [
  player("Unpriced", null, null),
  player("Cheap", 2_000_000, 3_000_000),
  player("Star", 40_000_000, 55_000_000),
  player("Mid", 12_000_000, 20_000_000),
];

test("value_price desc opens on the highest Value and leaves the unpriced last", () => {
  const names = stableMultiSort(POOL, [{ field: "value_price", direction: "desc" }]).map((p) => p.name);
  expect(names).toEqual(["Star", "Mid", "Cheap", "Unpriced"]);
});

test("value_price asc still leaves the unpriced last", () => {
  const names = stableMultiSort(POOL, [{ field: "value_price", direction: "asc" }]).map((p) => p.name);
  expect(names).toEqual(["Cheap", "Mid", "Star", "Unpriced"]);
});

test("the picker's price sort follows the RuleSet currency", () => {
  const byValue = stableMultiSort(POOL, [{ field: "salary", direction: "desc" }], "value").map((p) => p.name);
  const byMarket = stableMultiSort(POOL, [{ field: "salary", direction: "desc" }], "market").map((p) => p.name);
  expect(byValue).toEqual(["Star", "Mid", "Cheap", "Unpriced"]);
  expect(byMarket).toEqual(["Star", "Mid", "Cheap", "Unpriced"]);
});
