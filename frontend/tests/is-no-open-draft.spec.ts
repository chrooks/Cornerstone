/**
 * Unit tests for isNoOpenDraft — mirrors isNoActiveRelease's shape.
 * Runs via Playwright test runner (no browser required — pure TS logic).
 */

import { test, expect } from "@playwright/test";
import { isNoOpenDraft, NO_OPEN_DRAFT_ERROR } from "../lib/api";

test("isNoOpenDraft: true when success=false and error is 'no_open_draft'", () => {
  expect(isNoOpenDraft({ success: false, data: null, error: NO_OPEN_DRAFT_ERROR })).toBe(true);
});

test("isNoOpenDraft: false when success=true", () => {
  expect(isNoOpenDraft({ success: true, data: { id: "1" }, error: null })).toBe(false);
});

test("isNoOpenDraft: false when success=false but a different error code", () => {
  expect(isNoOpenDraft({ success: false, data: null, error: "some_other_error" })).toBe(false);
});
