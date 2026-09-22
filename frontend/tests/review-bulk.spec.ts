/**
 * Headless proof of the #154 Signifiers on the admin review page (M1.26, ac24).
 *
 * Real login to the dev-only admin test account (e2e-login.ts, plan decision f)
 * so the server-side admin gate runs for real; every /api call is mocked, so
 * nothing reaches the dev backend. One HIGH flag (rim_protector, no Claude
 * tier) and one Claude-rated flag (high_flyer): "Trust All Claude" must name
 * the stats-only flag it leaves open, and the toast must report it.
 *
 * Run (after the deploy that carries the page change):
 *   PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *   npx playwright test tests/review-bulk.spec.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_STATE, E2E_BASE_URL, E2E_LOGIN_MISSING, hasE2eLogin, loginAsE2eAdmin } from "./e2e-login";

const PLAYER_ID = "00000000-0000-4000-8000-000000000154";

const FLAG = {
  stat_values: null,
  claude_justification: null,
  resolution: null,
  resolved_value: null,
  resolved_at: null,
  notes: null,
};

const DETAIL = {
  player: {
    id: PLAYER_ID,
    name: "E2E Mock Player",
    team: null,
    position: "F",
    age: null,
    games_played: null,
    minutes_per_game: null,
    height: null,
    weight: null,
    nba_api_id: null,
  },
  flags: [
    // HIGH Skill: the commit RPC stores the string 'None' when Claude has no tier.
    { ...FLAG, id: "flag-rim", skill_name: "rim_protector", stat_rating: "Elite", claude_rating: "None", flag_reason: "always_flag_for_review", has_claude_tier: false },
    { ...FLAG, id: "flag-flyer", skill_name: "high_flyer", stat_rating: "None", claude_rating: "Capable", flag_reason: "one_tier_low_confidence", has_claude_tier: true },
  ],
  profiles: {
    stats: { rim_protector: "Elite", high_flyer: "None" },
    claude: { rim_protector: null, high_flyer: "Capable" },
    composite: {
      rim_protector: { final_tier: "Elite", stat_tier: "Elite", claude_tier: null, source: "flagged", flagged: true, flag_reason: "always_flag_for_review", stat_confidence: "high" },
      high_flyer: { final_tier: "None", stat_tier: "None", claude_tier: "Capable", source: "flagged", flagged: true, flag_reason: "one_tier_low_confidence", stat_confidence: "low" },
    },
  },
};

/** Mock every backend call; return the bulk-resolve request bodies. */
async function mockApi(page: Page): Promise<Record<string, unknown>[]> {
  const bulkBodies: Record<string, unknown>[] = [];
  // Registered first, so it matches last: anything not mocked below never reaches dev.
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, json: { success: false, data: null, error: "not mocked" } })
  );
  await page.route(`**/api/review/${PLAYER_ID}/flags**`, (route) =>
    route.fulfill({ json: { success: true, data: DETAIL, error: null } })
  );
  // The page also loads these on mount; a 404 would log a console error.
  await page.route("**/api/players/*/stats**", (route) =>
    route.fulfill({ json: { success: true, data: null, error: null } })
  );
  await page.route("**/api/review/queue**", (route) =>
    route.fulfill({ json: { success: true, data: [], error: null } })
  );
  await page.route("**/api/review/bulk-resolve", (route) => {
    bulkBodies.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        success: true,
        data: {
          resolved_count: 1,
          all_flags_resolved: false,
          skipped: [{ player_id: PLAYER_ID, skill_name: "rim_protector", reason: "no_claude_tier" }],
        },
        error: null,
      },
    });
  });
  return bulkBodies;
}

test.describe("review page #154 Signifiers", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("Trust All Claude names the stats-only flag it leaves open", async ({ page }) => {
    const bulkBodies = await mockApi(page);
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.once("dialog", (d) => d.accept());

    await page.goto(`${E2E_BASE_URL}/admin/review/${PLAYER_ID}`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/(login|unauthorized)/);

    const trustClaude = page.locator("#review-bulk-trust-claude-btn");
    await expect(trustClaude).toHaveText("Trust All Claude (1 stats-only left open)");
    await expect(trustClaude).toBeEnabled();

    await trustClaude.click();
    await expect(page.getByText(/Resolved 1 flags · 1 left open/)).toBeVisible();
    expect(bulkBodies).toHaveLength(1);
    expect(bulkBodies[0]).toMatchObject({ player_id: PLAYER_ID, resolution: "trust_claude" });

    await page.screenshot({ path: "test-results/review-bulk-trust-claude.png" });
    expect(consoleErrors).toEqual([]);
  });
});
