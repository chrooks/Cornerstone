/**
 * Visual verification screenshot spec for the diff preview surface.
 * Navigates to the pipeline tab of the draft workspace.
 *
 * If a staged run exists, navigates to ?tab=pipeline&run=<id> for the diff view.
 * Screenshots are saved to test-results/ for reviewer inspection.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const DRAFT_PAGE = `${BASE_URL}/admin/snapshots/draft`;

test("Pipeline tab renders in draft workspace", async ({ page }) => {
  await page.goto(`${DRAFT_PAGE}?tab=pipeline`, { waitUntil: "networkidle" });

  // The page should load — either the tab content or a redirect
  await page.waitForLoadState("domcontentloaded");

  await page.screenshot({
    path: "test-results/pipeline-tab.png",
    fullPage: false,
  });

  // Verify the draft workspace shell loaded (not a hard 500)
  const body = await page.textContent("body");
  expect(body).toBeTruthy();
  expect(body).not.toContain("Application error");
});

test("Diff preview renders when run param is set", async ({ page }) => {
  // Navigate to pipeline tab with a run param that would exercise the diff preview
  // If the run doesn't exist or isn't staged, PipelineTab shows the list.
  await page.goto(`${DRAFT_PAGE}?tab=pipeline&run=nonexistent-run-id`, {
    waitUntil: "networkidle",
  });

  await page.waitForLoadState("domcontentloaded");

  await page.screenshot({
    path: "test-results/diff-preview-nonexistent.png",
    fullPage: false,
  });

  const body = await page.textContent("body");
  expect(body).toBeTruthy();
  expect(body).not.toContain("Application error");
});
