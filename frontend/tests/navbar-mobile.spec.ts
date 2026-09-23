/**
 * NavBar on a phone: every link and "Log in" must be reachable without a
 * sideways scroll (Chris reviews flags from his phone — the old single row ran
 * "Log in" off the right edge of a 390px screen).
 *
 * Run: PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *      npx playwright test tests/navbar-mobile.spec.ts --reporter=line
 */
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_STATE, E2E_BASE_URL, E2E_LOGIN_MISSING, hasE2eLogin, loginAsE2eAdmin } from "./e2e-login";

async function noSideScroll(page: Page) {
  const [scrollW, viewW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW).toBeLessThanOrEqual(viewW);
}

for (const width of [320, 390]) {
  test(`logged out at ${width}px: Log in and every link are in reach`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${E2E_BASE_URL}/faq`, { waitUntil: "load" });
    await noSideScroll(page);

    const login = page.locator("#navbar-login-link");
    await expect(login).toBeInViewport({ ratio: 1 });
    await expect(page.locator("#navbar-links")).toBeHidden();

    const menuBtn = page.locator("#navbar-menu-btn");
    await expect(menuBtn).toHaveAttribute("aria-expanded", "false");
    await menuBtn.click();
    await expect(menuBtn).toHaveAttribute("aria-expanded", "true");
    for (const id of ["lab", "players", "legends", "community", "faq"]) {
      await expect(page.locator(`#navbar-mobile-link-${id}`)).toBeInViewport();
    }
    const box = await page.locator("#navbar-mobile-link-lab").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await noSideScroll(page);

    await page.keyboard.press("Escape");
    await expect(page.locator("#navbar-mobile-panel")).toHaveCount(0);
    await expect(menuBtn).toBeFocused();
  });
}

test("desktop keeps the single row and no menu button", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${E2E_BASE_URL}/faq`, { waitUntil: "load" });
  await expect(page.locator("#navbar-links")).toBeVisible();
  await expect(page.locator("#navbar-menu-btn")).toBeHidden();
});

test.describe("logged in as admin on a phone", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });
  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("the menu reaches the review queue and closes on navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/review/queue**", (r) => r.fulfill({ json: { success: true, data: [], error: null } }));
    await page.goto(`${E2E_BASE_URL}/faq`, { waitUntil: "load" });
    await noSideScroll(page);
    await page.locator("#navbar-menu-btn").click();
    await page.locator("#navbar-mobile-admin-link-review").click();
    await page.waitForURL(/\/admin\/review$/);
    await expect(page.locator("#navbar-mobile-panel")).toHaveCount(0);
    await noSideScroll(page);
  });
});
