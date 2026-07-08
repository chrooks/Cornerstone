/**
 * E2E for the eval-impact hover preview (#92, feedforward).
 *
 * Requires the dev servers: frontend (PLAYWRIGHT_BASE_URL, default :3002)
 * and backend (:5001). The Build roster below leaves one slot free so the
 * hovered candidate has somewhere to land.
 *
 * The load-bearing assertion is NO DRIFT (ADR 0005): the previewed "after"
 * star equals the committed star once the candidate is actually added.
 */

import { expect, test, type Page } from "@playwright/test";

const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";

const BUILD_URL =
  `${FRONTEND_BASE_URL}/lab/standard/build` +
  "?cornerstone=e8e4ac9f-4710-42d8-bca0-9ad3c63cf1c7" +
  "&s1=e8e4ac9f-4710-42d8-bca0-9ad3c63cf1c7" +
  "&s2=21d8663e-79fd-4346-b61a-eebe9c38c855" +
  "&s3=bff66cca-0c6e-42b5-a708-1ff6c34df143" +
  "&s4=7d3c872a-d144-433c-a2e4-a740160d609d" +
  "&s5=cc55897a-d729-4a9f-9e9e-c9797811d63b" +
  "&s6=a4f013d4-a60d-4e41-b138-bb4ecb688856" +
  "&s7=f29ccf9f-30b5-472b-9340-c9bf3d62d4ac" +
  "&s8=6539850b-1495-499d-8449-055fa0ec2cdf";

async function openBuild(page: Page): Promise<void> {
  await page.goto(BUILD_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#builder-new-feedback-shape", { timeout: 30_000 });
  // Let the roster's own live eval settle before measuring anything.
  await page.waitForSelector("#builder-new-feedback-score", { timeout: 30_000 });
  await page.waitForTimeout(1_200);
}

function pickerRows(page: Page) {
  return page.locator("[id^='player-row-view-']");
}

/** Hover rows until one previews — unavailable rows are gated out by design. */
async function hoverFirstAvailableRow(page: Page) {
  const rows = pickerRows(page);
  const rowCount = Math.min(await rows.count(), 10);
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);
    await row.hover();
    const appeared = await page
      .waitForSelector("#builder-eval-preview-delta", { timeout: 2_500 })
      .then(() => true)
      .catch(() => false);
    if (appeared) return row;
  }
  throw new Error("no available picker row produced a preview");
}

test("previewed star delta matches the committed eval exactly (no drift)", async ({ page }) => {
  await openBuild(page);

  const row = await hoverFirstAvailableRow(page);
  const caption = await page.locator("#builder-eval-preview-delta").innerText();
  const match = caption.match(/(\d\.\d{2}) → (\d\.\d{2})/);
  expect(match, `caption should carry a before → after read, got: ${caption}`).not.toBeNull();
  const previewedAfter = match![2];

  // The candidate ghost is on the glyph while the preview is live.
  await expect(page.locator("#team-shape-candidate-ghost")).toBeVisible();

  // Commit the same candidate; the reflowed list can put another row under
  // the pointer, so move off the picker before reading the committed score.
  await row.click();
  await page.locator("#player-picker-title").hover();
  await expect(page.locator("#builder-eval-preview-delta")).toHaveCount(0);
  await expect(page.locator("#builder-new-feedback-score")).toContainText(previewedAfter, {
    timeout: 15_000,
  });
});

test("skimming the picker fires zero preview requests; deliberate hover fires one", async ({ page }) => {
  const evalRequests: number[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/builder/evaluate")) evalRequests.push(Date.now());
  });
  await openBuild(page);
  const baseline = evalRequests.length;

  const rows = pickerRows(page);
  for (let i = 0; i < 5; i++) {
    await rows.nth(i).hover();
    await page.waitForTimeout(80);
  }
  await page.locator("#player-picker-title").hover();
  await page.waitForTimeout(500);
  expect(evalRequests.length - baseline).toBe(0);

  const row = await hoverFirstAvailableRow(page);
  const afterDeliberate = evalRequests.length - baseline;
  expect(afterDeliberate).toBe(1);

  // Re-hover reads from cache — no new request.
  await page.locator("#player-picker-title").hover();
  await page.waitForTimeout(200);
  await row.hover();
  await page.waitForSelector("#builder-eval-preview-delta", { timeout: 3_000 });
  expect(evalRequests.length - baseline).toBe(afterDeliberate);
});

test("degrades gracefully when the preview path is unavailable", async ({ page }) => {
  await openBuild(page);

  // Kill evaluate calls from here on — the roster's own eval already settled.
  await page.route("**/api/builder/evaluate", (route) => route.abort());

  await pickerRows(page).first().hover();
  await page.waitForTimeout(1_200);
  await expect(page.locator("#builder-eval-preview-delta")).toHaveCount(0);
  // No error surface appears; the Team Shape stays on the committed read.
  await expect(page.locator("#team-shape-candidate-ghost")).toHaveCount(0);
  await expect(page.locator("#builder-new-feedback-shape")).toBeVisible();
});
