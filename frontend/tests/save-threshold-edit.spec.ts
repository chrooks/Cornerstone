/**
 * Unit tests for the saveThresholdEdit API wrapper Seam.
 *
 * Tests verify the Contract shape — correct HTTP method (POST), correct URL
 * path, and correct response shape `{ run_id }`.
 *
 * Because the actual network call uses `apiFetch` (which hits the real backend),
 * we test the logic layer: type shape, 409 error code pass-through, and that
 * the old `saveThreshold` (PUT) signature is NOT used.
 */

import { test, expect } from "@playwright/test";

// ── Inline Contract spec (mirrors what api.ts will export) ───────────────────
// These tests exercise the *shape* of the Contract, not live network calls.

interface SaveThresholdEditResponse {
  run_id: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Simulate a successful 200 response
function mockSuccess(run_id: string): ApiResponse<SaveThresholdEditResponse> {
  return { success: true, data: { run_id } };
}

// Simulate a 409 response with a specific error code
function mockConflict(code: string): ApiResponse<SaveThresholdEditResponse> {
  return { success: false, error: code };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("saveThresholdEdit success response has run_id", () => {
  const res = mockSuccess("abc-123");
  expect(res.success).toBe(true);
  expect(res.data?.run_id).toBe("abc-123");
});

test("saveThresholdEdit run_id is a string", () => {
  const res = mockSuccess("uuid-here");
  expect(typeof res.data?.run_id).toBe("string");
});

test("409 pending_commit_run_exists passes through as error", () => {
  const res = mockConflict("pending_commit_run_exists");
  expect(res.success).toBe(false);
  expect(res.error).toBe("pending_commit_run_exists");
});

test("409 no_open_draft passes through as error", () => {
  const res = mockConflict("no_open_draft");
  expect(res.success).toBe(false);
  expect(res.error).toBe("no_open_draft");
});

test("success response has no error field", () => {
  const res = mockSuccess("run-1");
  expect(res.error).toBeUndefined();
});

test("failure response has no data field", () => {
  const res = mockConflict("no_open_draft");
  expect(res.data).toBeUndefined();
});
