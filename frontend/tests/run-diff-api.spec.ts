/**
 * Unit tests for the RunDiff API Contract shapes and 409 substring matching.
 * Tests the Contract without live network calls.
 */

import { test, expect } from "@playwright/test";
import type {
  RunDiff,
  CommitRunResult,
  DiscardRunResult,
  ApiResponse,
} from "../lib/types";

// ── Contract shape assertions ─────────────────────────────────────────────────

test("RunDiff has run_id, summary, and changes fields", () => {
  const diff: RunDiff = {
    run_id: "run-abc",
    summary: {
      per_skill: {
        spot_up_shooter: { promotions: 2, demotions: 0, new: 1, unchanged: 5 },
      },
      total_changed: 3,
    },
    changes: [
      {
        player_id: "player-1",
        player_name: "Test Player",
        season: "2024-25",
        source: "stats",
        skill_name: "spot_up_shooter",
        old_tier: "Capable",
        new_tier: "Elite",
        change_type: "promotion",
      },
    ],
  };
  expect(diff.run_id).toBe("run-abc");
  expect(diff.summary.total_changed).toBe(3);
  expect(diff.changes).toHaveLength(1);
  expect(diff.changes[0].change_type).toBe("promotion");
});

test("RunDiff change with old_tier null is a new skill (change_type=new)", () => {
  const change = {
    player_id: "p1",
    season: "2024-25",
    source: "stats",
    skill_name: "passer",
    old_tier: null as string | null,
    new_tier: "Capable",
    change_type: "new" as const,
  };
  expect(change.old_tier).toBeNull();
  expect(change.change_type).toBe("new");
});

test("CommitRunResult has committed_at string", () => {
  const result: CommitRunResult = { committed_at: "2024-01-01T12:00:00Z" };
  expect(typeof result.committed_at).toBe("string");
});

test("DiscardRunResult has discarded string", () => {
  const result: DiscardRunResult = { discarded: "run-abc" };
  expect(typeof result.discarded).toBe("string");
});

// ── 409 substring matching patterns ──────────────────────────────────────────

// Backend emits these as prose: "already_committed — ..."
// Consumers must substring-match, not equality-check.

const ALREADY_COMMITTED_ERROR = "already_committed — this run has already been committed";
const RUN_NOT_SUCCESS_ERROR = "run_not_in_success_state — cannot commit a run that is not successful";
const RUN_ALREADY_DISCARDED_ERROR = "run_already_discarded — this run has already been discarded";

function mockConflict(error: string): ApiResponse<CommitRunResult> {
  return { success: false, data: null, error };
}

test("commit 409 already_committed detected via substring", () => {
  const res = mockConflict(ALREADY_COMMITTED_ERROR);
  expect(res.error?.includes("already_committed")).toBe(true);
  expect(res.error === "already_committed").toBe(false);
});

test("commit 409 run_not_in_success_state detected via substring", () => {
  const res = mockConflict(RUN_NOT_SUCCESS_ERROR);
  expect(res.error?.includes("run_not_in_success_state")).toBe(true);
});

test("discard 409 run_already_discarded detected via substring", () => {
  const res = mockConflict(RUN_ALREADY_DISCARDED_ERROR);
  expect(res.error?.includes("run_already_discarded")).toBe(true);
});

test("discard 409 already_committed detected via substring", () => {
  const res = mockConflict(ALREADY_COMMITTED_ERROR);
  expect(res.error?.includes("already_committed")).toBe(true);
});
