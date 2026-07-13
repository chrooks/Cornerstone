/**
 * E2E for the Save & Publish commit moment (#94).
 *
 * Requires the dev servers: frontend (PLAYWRIGHT_BASE_URL, default :3002)
 * and backend (:5001).
 *
 * The load-bearing assertions: the Save button opens the moment WITHOUT
 * committing, and the POST fires only from Publish Team, carrying the
 * visibility the moment named the consequence for. A logged-in session is
 * seeded into Supabase's own storage key and the save POST is stubbed, so the
 * ceremony is exercised end to end without a real account.
 */

import { expect, test, type Page } from "@playwright/test";

const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
const SUPABASE_STORAGE_KEY = "sb-ojtncdjioiafhiiyzcyd-auth-token";

// A complete, cap-legal Standard Rotation (Iverson cornerstone + 8 players):
// the commit moment only ever opens for a Team that could actually be saved.
const EVAL_URL =
  `${FRONTEND_BASE_URL}/lab/standard/eval` +
  "?cornerstone=e8e4ac9f-4710-42d8-bca0-9ad3c63cf1c7" +
  "&s1=e8e4ac9f-4710-42d8-bca0-9ad3c63cf1c7" +
  "&s2=11e50255-b7c0-453f-a09d-211411116423" +
  "&s3=ddf254ba-b90e-4fbe-b552-7ad540dec270" +
  "&s4=037cfe90-a282-4518-b2f0-1b6e04c12428" +
  "&s5=2a16662f-2b07-44a1-a494-9d728b212122" +
  "&s6=066636dc-a517-43ed-b268-8b46c4908e46" +
  "&s7=d6322d69-c960-48db-9945-1f8164a72336" +
  "&s8=5fad93b3-5211-43c3-af72-91e22bb50ed1" +
  "&s9=fd923ee0-bd6b-4287-ab7a-2917dda7c81a";

interface SaveRequest {
  visibility?: string;
}

const FAR_FUTURE = 4_102_444_800; // 2100-01-01 — never triggers a token refresh

/** A session shaped the way @supabase/ssr stores one: the access token has to
 *  be a well-formed JWT (auth-js decodes it); the signature is never checked
 *  client-side, and the save POST is stubbed so it never reaches the backend. */
function fakeSession(): string {
  const b64url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({
      sub: "00000000-0000-0000-0000-000000000001",
      email: "e2e@cornerstone.test",
      role: "authenticated",
      exp: FAR_FUTURE,
    }),
    "e2e-signature",
  ].join(".");

  return JSON.stringify({
    access_token: accessToken,
    refresh_token: "e2e-fake-refresh",
    token_type: "bearer",
    expires_at: FAR_FUTURE,
    expires_in: 3600,
    user: { id: "00000000-0000-0000-0000-000000000001", email: "e2e@cornerstone.test" },
  });
}

/** Seed a session so the page renders the logged-in save path, and capture
 *  every save POST instead of letting it reach the real backend. */
async function openEvalAsSignedInUser(page: Page): Promise<SaveRequest[]> {
  const saves: SaveRequest[] = [];

  await page.context().addCookies([
    {
      name: SUPABASE_STORAGE_KEY,
      value: `base64-${Buffer.from(fakeSession()).toString("base64")}`,
      url: FRONTEND_BASE_URL,
    },
  ]);

  await page.route("**/api/saved-teams", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    saves.push(JSON.parse(route.request().postData() ?? "{}") as SaveRequest);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { id: "saved-e2e", name: "E2E Rotation", ruleset_slug: "standard", visibility: "public" },
        error: null,
      }),
    });
  });

  // The user_roles lookup runs against a fake token — answer it so the admin
  // probe resolves instead of hanging the save button behind adminLoading.
  await page.route("**/rest/v1/user_roles**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );

  await page.goto(EVAL_URL, { waitUntil: "networkidle" });
  await page.waitForSelector("#eval-save-btn:not([disabled])", { timeout: 60_000 });
  return saves;
}

test("Save opens the commit moment without committing anything", async ({ page }) => {
  const saves = await openEvalAsSignedInUser(page);

  await expect(page.locator("#eval-save-btn")).toHaveText("Save Team");
  await page.click("#eval-save-btn");

  const modal = page.locator("#publish-team-modal");
  await expect(modal).toBeVisible();

  // The eval being committed is restated, and pinned to both versions.
  await expect(page.locator("#publish-team-stars")).toHaveText(/\d\.\d\d/);
  await expect(page.locator("#publish-ruleset-version")).not.toHaveText("—");
  await expect(page.locator("#publish-evaluation-version")).not.toHaveText("—");
  await expect(page.locator("#publish-sealed-note")).toContainText("sealed");
  await expect(page.locator("#publish-confirm-btn")).toHaveText("Publish Team");
  await expect(page.locator("#publish-cancel-btn")).toHaveText("Keep Tuning");

  // Nothing has been committed by merely opening the moment.
  expect(saves).toHaveLength(0);

  // Keep Tuning backs out, still without committing.
  await page.click("#publish-cancel-btn");
  await expect(modal).toBeHidden();
  expect(saves).toHaveLength(0);
});

test("The consequence line names what the chosen visibility actually does", async ({ page }) => {
  await openEvalAsSignedInUser(page);
  await page.click("#eval-save-btn");

  const consequence = page.locator("#publish-consequence");
  await expect(consequence).toContainText("Stays in your Lab");

  await page.click("#publish-visibility-public");
  await expect(consequence).toContainText("leaderboard");

  await page.click("#publish-visibility-private");
  await expect(consequence).toContainText("Stays in your Lab");
});

test("A backed-out choice does not survive into the next commit moment", async ({ page }) => {
  await openEvalAsSignedInUser(page);

  await page.click("#eval-save-btn");
  await page.click("#publish-visibility-public");
  await expect(page.locator("#publish-consequence")).toContainText("leaderboard");
  await page.click("#publish-cancel-btn");

  // Reopening starts from Private again — a stale Public would silently publish
  // a Team to the leaderboard the user never chose it for.
  await page.click("#eval-save-btn");
  await expect(page.locator("#publish-consequence")).toContainText("Stays in your Lab");
  await expect(page.locator("#publish-visibility-private")).toHaveAttribute("aria-checked", "true");
});

test("Publish commits exactly once, carrying the chosen visibility", async ({ page }) => {
  const saves = await openEvalAsSignedInUser(page);

  await page.click("#eval-save-btn");
  await page.click("#publish-visibility-public");
  await page.click("#publish-confirm-btn");

  await expect(page.locator("#publish-team-modal")).toBeHidden();
  await expect(page.locator("#eval-save-success")).toBeVisible();

  expect(saves).toHaveLength(1);
  expect(saves[0].visibility).toBe("public");
});
