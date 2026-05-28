/**
 * Unit tests for diff summary bar math and drill-down filter/cap logic.
 * RED -> GREEN: tests first.
 *
 * Tests the pure helpers that live in diffColors.ts and the proportional
 * bar width calculation logic that will be used by DiffSummaryRow.
 */

import { test, expect } from "@playwright/test";
import {
  calcBarSegments,
  applyDrilldownFilters,
  VISIBLE_CAP,
} from "../app/admin/snapshots/draft/_components/diff/diffLogic";
import type { RunDiffChange, RunDiffPerSkill } from "../lib/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeChange(overrides: Partial<RunDiffChange> = {}): RunDiffChange {
  return {
    player_id: "player-1",
    player_name: "Test Player",
    season: "2024-25",
    source: "stats",
    skill_name: "spot_up_shooter",
    old_tier: "Capable",
    new_tier: "Elite",
    change_type: "promotion",
    ...overrides,
  };
}

// ── calcBarSegments ───────────────────────────────────────────────────────────

test("calcBarSegments: proportions sum to 1 when all three types present", () => {
  const perSkill: RunDiffPerSkill = { promotions: 3, demotions: 1, new: 2, unchanged: 10 };
  const segments = calcBarSegments(perSkill);
  const total = segments.promotions + segments.demotions + segments.new;
  expect(Math.abs(total - 1)).toBeLessThan(0.001);
});

test("calcBarSegments: unchanged excluded from bar denominator", () => {
  // 5 changed, 100 unchanged — bar should be based on 5 not 105
  const perSkill: RunDiffPerSkill = { promotions: 5, demotions: 0, new: 0, unchanged: 100 };
  const segments = calcBarSegments(perSkill);
  expect(segments.promotions).toBe(1);
  expect(segments.demotions).toBe(0);
  expect(segments.new).toBe(0);
});

test("calcBarSegments: single promotion fills full bar", () => {
  const perSkill: RunDiffPerSkill = { promotions: 1, demotions: 0, new: 0, unchanged: 0 };
  const segments = calcBarSegments(perSkill);
  expect(segments.promotions).toBe(1);
});

test("calcBarSegments: zero total changed returns all zeros", () => {
  const perSkill: RunDiffPerSkill = { promotions: 0, demotions: 0, new: 0, unchanged: 5 };
  const segments = calcBarSegments(perSkill);
  expect(segments.promotions).toBe(0);
  expect(segments.demotions).toBe(0);
  expect(segments.new).toBe(0);
});

test("calcBarSegments: mixed returns correct ratios", () => {
  const perSkill: RunDiffPerSkill = { promotions: 2, demotions: 2, new: 0, unchanged: 0 };
  const segments = calcBarSegments(perSkill);
  expect(segments.promotions).toBeCloseTo(0.5);
  expect(segments.demotions).toBeCloseTo(0.5);
  expect(segments.new).toBe(0);
});

// ── VISIBLE_CAP ───────────────────────────────────────────────────────────────

test("VISIBLE_CAP is 250", () => {
  expect(VISIBLE_CAP).toBe(250);
});

// ── applyDrilldownFilters ─────────────────────────────────────────────────────

const changes: RunDiffChange[] = [
  makeChange({ skill_name: "spot_up_shooter", change_type: "promotion", player_id: "p1" }),
  makeChange({ skill_name: "spot_up_shooter", change_type: "demotion", player_id: "p2" }),
  makeChange({ skill_name: "rebounder", change_type: "new", player_id: "p3" }),
  makeChange({ skill_name: "passer", change_type: "promotion", player_id: "alice-uuid", player_name: "Alice Johnson" }),
];

test("applyDrilldownFilters: no filters returns all changes", () => {
  const result = applyDrilldownFilters(changes, {});
  expect(result).toHaveLength(4);
});

test("applyDrilldownFilters: skill filter narrows results", () => {
  const result = applyDrilldownFilters(changes, { skill: "rebounder" });
  expect(result).toHaveLength(1);
  expect(result[0].skill_name).toBe("rebounder");
});

test("applyDrilldownFilters: change_type filter narrows results", () => {
  const result = applyDrilldownFilters(changes, { changeType: "promotion" });
  expect(result).toHaveLength(2);
  result.forEach((c) => expect(c.change_type).toBe("promotion"));
});

test("applyDrilldownFilters: player query matches name case-insensitively", () => {
  const result = applyDrilldownFilters(changes, { playerQuery: "alice john" });
  expect(result).toHaveLength(1);
  expect(result[0].player_name).toBe("Alice Johnson");
});

test("applyDrilldownFilters: player query falls back to player_id", () => {
  const result = applyDrilldownFilters(changes, { playerQuery: "ALICE-UUID" });
  expect(result).toHaveLength(1);
  expect(result[0].player_id).toBe("alice-uuid");
});

test("applyDrilldownFilters: combined skill + change_type filters", () => {
  const result = applyDrilldownFilters(changes, {
    skill: "spot_up_shooter",
    changeType: "demotion",
  });
  expect(result).toHaveLength(1);
  expect(result[0].player_id).toBe("p2");
});

test("applyDrilldownFilters: empty player query returns all", () => {
  const result = applyDrilldownFilters(changes, { playerQuery: "" });
  expect(result).toHaveLength(4);
});

test("applyDrilldownFilters: no match returns empty array", () => {
  const result = applyDrilldownFilters(changes, { skill: "high_flyer" });
  expect(result).toHaveLength(0);
});
