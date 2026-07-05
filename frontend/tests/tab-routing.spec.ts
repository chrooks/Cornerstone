/**
 * Unit tests for the tab routing Seam (resolveActiveTab + isTabDisabled).
 * Runs via Playwright test runner (no browser required — pure TS logic).
 *
 * RED → GREEN cycle per TDD workflow.
 */

import { test, expect } from "@playwright/test";
import {
  type TabGateContext,
  isTabDisabled,
  resolveActiveTab,
} from "../app/admin/snapshots/draft/_lib/tabRouting";

// ── Tests ─────────────────────────────────────────────────────────────────────

const NO_DRAFT: TabGateContext = { hasDraft: false, draftStatus: null };
const DRAFT_STATUS: TabGateContext = { hasDraft: true, draftStatus: "draft" };
const REVIEW_STATUS: TabGateContext = { hasDraft: true, draftStatus: "review" };

// isTabDisabled

test("overview is never disabled — no draft", () => {
  expect(isTabDisabled("overview", NO_DRAFT)).toBe(false);
});

test("overview is never disabled — draft status", () => {
  expect(isTabDisabled("overview", DRAFT_STATUS)).toBe(false);
});

test("overview is never disabled — review status", () => {
  expect(isTabDisabled("overview", REVIEW_STATUS)).toBe(false);
});

test("pipeline disabled when no draft", () => {
  const result = isTabDisabled("pipeline", NO_DRAFT);
  expect(result).not.toBe(false);
  expect((result as { reason: string }).reason).toBeTruthy();
});

test("thresholds disabled when no draft", () => {
  const result = isTabDisabled("thresholds", NO_DRAFT);
  expect(result).not.toBe(false);
});

test("review disabled when no draft", () => {
  const result = isTabDisabled("review", NO_DRAFT);
  expect(result).not.toBe(false);
});

test("publish disabled when no draft", () => {
  const result = isTabDisabled("publish", NO_DRAFT);
  expect(result).not.toBe(false);
});

test("pipeline enabled when draft exists", () => {
  expect(isTabDisabled("pipeline", DRAFT_STATUS)).toBe(false);
});

test("thresholds enabled when draft exists", () => {
  expect(isTabDisabled("thresholds", DRAFT_STATUS)).toBe(false);
});

test("review enabled when draft exists", () => {
  expect(isTabDisabled("review", DRAFT_STATUS)).toBe(false);
});

test("publish disabled when draft status is 'draft'", () => {
  const result = isTabDisabled("publish", DRAFT_STATUS);
  expect(result).not.toBe(false);
  expect((result as { reason: string }).reason).toContain("review");
});

test("publish enabled when draft status is 'review'", () => {
  expect(isTabDisabled("publish", REVIEW_STATUS)).toBe(false);
});

test("thresholds disabled when draft status is 'review'", () => {
  const result = isTabDisabled("thresholds", REVIEW_STATUS);
  expect(result).not.toBe(false);
  expect((result as { reason: string }).reason).toContain("review");
});

test("review disabled when draft status is 'review'", () => {
  const result = isTabDisabled("review", REVIEW_STATUS);
  expect(result).not.toBe(false);
  expect((result as { reason: string }).reason).toContain("review");
});

test("pipeline still enabled when draft status is 'review'", () => {
  expect(isTabDisabled("pipeline", REVIEW_STATUS)).toBe(false);
});

test("legends disabled when no draft", () => {
  const result = isTabDisabled("legends", NO_DRAFT);
  expect(result).not.toBe(false);
});

test("legends enabled when draft exists", () => {
  expect(isTabDisabled("legends", DRAFT_STATUS)).toBe(false);
});

test("legends still enabled when draft status is 'review'", () => {
  // Legend writes are gated on an open draft (draft OR review), not frozen
  // by the review-freeze invariant that locks thresholds/review.
  expect(isTabDisabled("legends", REVIEW_STATUS)).toBe(false);
});

// resolveActiveTab

test("resolveActiveTab: null param → default overview", () => {
  expect(resolveActiveTab(null, NO_DRAFT)).toBe("overview");
});

test("resolveActiveTab: unknown param → default overview", () => {
  expect(resolveActiveTab("bogus", NO_DRAFT)).toBe("overview");
});

test("resolveActiveTab: overview param → overview (always)", () => {
  expect(resolveActiveTab("overview", NO_DRAFT)).toBe("overview");
});

test("resolveActiveTab: valid tab, no draft → falls back to overview", () => {
  expect(resolveActiveTab("thresholds", NO_DRAFT)).toBe("overview");
});

test("resolveActiveTab: pipeline, draft present → pipeline", () => {
  expect(resolveActiveTab("pipeline", DRAFT_STATUS)).toBe("pipeline");
});

test("resolveActiveTab: thresholds, draft present → thresholds", () => {
  expect(resolveActiveTab("thresholds", DRAFT_STATUS)).toBe("thresholds");
});

test("resolveActiveTab: review, draft present → review", () => {
  expect(resolveActiveTab("review", DRAFT_STATUS)).toBe("review");
});

test("resolveActiveTab: publish, status=draft → falls back to overview", () => {
  expect(resolveActiveTab("publish", DRAFT_STATUS)).toBe("overview");
});

test("resolveActiveTab: publish, status=review → publish", () => {
  expect(resolveActiveTab("publish", REVIEW_STATUS)).toBe("publish");
});

test("resolveActiveTab: review status — thresholds + review fall back to overview", () => {
  expect(resolveActiveTab("thresholds", REVIEW_STATUS)).toBe("overview");
  expect(resolveActiveTab("review", REVIEW_STATUS)).toBe("overview");
});

test("resolveActiveTab: review status — overview/pipeline/publish stay open", () => {
  expect(resolveActiveTab("overview", REVIEW_STATUS)).toBe("overview");
  expect(resolveActiveTab("pipeline", REVIEW_STATUS)).toBe("pipeline");
  expect(resolveActiveTab("publish", REVIEW_STATUS)).toBe("publish");
});
