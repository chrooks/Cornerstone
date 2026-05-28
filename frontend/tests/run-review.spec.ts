/**
 * Unit tests for the runReview.ts pure helper Seam.
 * RED -> GREEN: write tests first, implement after.
 *
 * Tests cover isStagedRun, isReviewableRun, isTerminalRun predicates
 * which are the single source of truth for review affordances in PipelineTab.
 */

import { test, expect } from "@playwright/test";
import {
  isStagedRun,
  isReviewableRun,
  isTerminalRun,
} from "../app/admin/snapshots/draft/_lib/runReview";
import type { PipelineRun } from "../lib/types";

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeRun(overrides: Partial<PipelineRun>): PipelineRun {
  return {
    id: "run-abc",
    pipeline_name: "skill_evaluation",
    scope: "bulk",
    player_id: null,
    snapshot_release_id: "snap-1",
    status: "success",
    rows_processed: 10,
    error_tail: null,
    started_at: "2024-01-01T00:00:00Z",
    finished_at: "2024-01-01T01:00:00Z",
    committed_at: null,
    ...overrides,
  };
}

// ── isStagedRun ───────────────────────────────────────────────────────────────

test("isStagedRun: skill_evaluation is staged", () => {
  expect(isStagedRun(makeRun({ pipeline_name: "skill_evaluation" }))).toBe(true);
});

test("isStagedRun: threshold_edit is staged", () => {
  expect(isStagedRun(makeRun({ pipeline_name: "threshold_edit" }))).toBe(true);
});

test("isStagedRun: stat_fetch is NOT staged", () => {
  expect(isStagedRun(makeRun({ pipeline_name: "stat_fetch" }))).toBe(false);
});

test("isStagedRun: salary_scrape is NOT staged", () => {
  expect(isStagedRun(makeRun({ pipeline_name: "salary_scrape" }))).toBe(false);
});

test("isStagedRun: bio_team_sync is NOT staged", () => {
  expect(isStagedRun(makeRun({ pipeline_name: "bio_team_sync" }))).toBe(false);
});

// ── isReviewableRun ───────────────────────────────────────────────────────────

test("isReviewableRun: staged + success + no committed_at = reviewable", () => {
  expect(
    isReviewableRun(
      makeRun({ pipeline_name: "skill_evaluation", status: "success", committed_at: null })
    )
  ).toBe(true);
});

test("isReviewableRun: threshold_edit + success + no committed_at = reviewable", () => {
  expect(
    isReviewableRun(
      makeRun({ pipeline_name: "threshold_edit", status: "success", committed_at: null })
    )
  ).toBe(true);
});

test("isReviewableRun: ingestion run is NOT reviewable even if success", () => {
  expect(
    isReviewableRun(makeRun({ pipeline_name: "stat_fetch", status: "success", committed_at: null }))
  ).toBe(false);
});

test("isReviewableRun: staged run with error status is NOT reviewable", () => {
  expect(
    isReviewableRun(makeRun({ pipeline_name: "skill_evaluation", status: "error", committed_at: null }))
  ).toBe(false);
});

test("isReviewableRun: staged run with running status is NOT reviewable", () => {
  expect(
    isReviewableRun(
      makeRun({ pipeline_name: "skill_evaluation", status: "running", committed_at: null })
    )
  ).toBe(false);
});

test("isReviewableRun: staged + success + committed_at set = NOT reviewable (already committed)", () => {
  expect(
    isReviewableRun(
      makeRun({
        pipeline_name: "skill_evaluation",
        status: "success",
        committed_at: "2024-01-01T02:00:00Z",
      })
    )
  ).toBe(false);
});

test("isReviewableRun: staged + discarded status = NOT reviewable", () => {
  expect(
    isReviewableRun(makeRun({ pipeline_name: "threshold_edit", status: "discarded", committed_at: null }))
  ).toBe(false);
});

// ── isTerminalRun ─────────────────────────────────────────────────────────────

test("isTerminalRun: committed_at set = terminal", () => {
  expect(
    isTerminalRun(makeRun({ committed_at: "2024-01-01T02:00:00Z", status: "success" }))
  ).toBe(true);
});

test("isTerminalRun: discarded status = terminal", () => {
  expect(isTerminalRun(makeRun({ status: "discarded", committed_at: null }))).toBe(true);
});

test("isTerminalRun: success + no committed_at = NOT terminal", () => {
  expect(isTerminalRun(makeRun({ status: "success", committed_at: null }))).toBe(false);
});

test("isTerminalRun: running = NOT terminal", () => {
  expect(isTerminalRun(makeRun({ status: "running", committed_at: null }))).toBe(false);
});

test("isTerminalRun: error = NOT terminal", () => {
  expect(isTerminalRun(makeRun({ status: "error", committed_at: null }))).toBe(false);
});
