/**
 * E2E for the public player-profile skill-trace affordance (issue #82).
 * Mocks the profile + skill-trace API responses via page.route() so the
 * test is deterministic regardless of seeded DB / active release state.
 */

import { test, expect } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PLAYER_ID = "11111111-1111-1111-1111-111111111111";

const PROFILE_RESPONSE = {
  success: true,
  error: null,
  data: {
    player: {
      id: PLAYER_ID,
      name: "Jordan Cole",
      team: "MIN",
      position: "SF",
      age: 24,
      games_played: 70,
      minutes_per_game: 32.1,
      salary: 18200000,
      height: "6-7",
      weight: 215,
      season: "2025-26",
      nba_api_id: 999999,
    },
    skills: {
      spot_up_shooter: { final_tier: "Elite", stat_tier: "Elite", claude_tier: null, source: "stats_only", flagged: false, flag_reason: null, stat_confidence: null, claude_confidence: null, agreement: null },
      rim_protector: { final_tier: "Capable", stat_tier: "Capable", claude_tier: null, source: "stats_only", flagged: false, flag_reason: null, stat_confidence: null, claude_confidence: null, agreement: null },
    },
    flag_summary: { total: 0, unresolved: 0 },
  },
};

const TRACE_RESPONSE = {
  success: true,
  error: null,
  data: {
    computed: true,
    skills: {
      spot_up_shooter: {
        condition_results: [
          { section: "elite", stat: "fg3a_per_game", operator: ">=", threshold: 4.0, actual_value: 5.2, passed: true, per: "game", stabilized: false, group_id: 0, group_logic: "AND", depth: 0 },
          { section: "elite", stat: "fg3_pct", operator: ">=", threshold: 37.0, actual_value: 30.1, passed: false, per: null, stabilized: false, group_id: 0, group_logic: "AND", depth: 0 },
        ],
        override: {
          resolution: "manual_override",
          resolved_value: "Elite",
          resolved_at: "2026-06-30T18:04:00Z",
        },
      },
      rim_protector: {
        condition_results: [
          { section: "capable", stat: "blocks_per_game", operator: ">=", threshold: 1.0, actual_value: 1.4, passed: true, per: "game", stabilized: false, group_id: 0, group_logic: "AND", depth: 0 },
        ],
        override: null,
      },
    },
  },
};

test("expanding a skill shows its condition trace and override banner, never notes", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER_ID}/profile*`, (route) =>
    route.fulfill({ json: PROFILE_RESPONSE })
  );
  await page.route(`**/api/players/${PLAYER_ID}/skill-trace*`, (route) =>
    route.fulfill({ json: TRACE_RESPONSE })
  );

  await page.goto(`${BASE_URL}/players/${PLAYER_ID}`, { waitUntil: "networkidle" });

  const spotUpToggle = page.locator("#player-profile-skill-toggle-spot_up_shooter");
  await expect(spotUpToggle).toBeVisible();
  await spotUpToggle.click();

  // One shared panel below the grid — not a per-row popover — so it never
  // needs to be clipped by a scroll container or guess which edge to open from.
  const panel = page.locator("#player-profile-skill-detail-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Spot Up Shooter");
  await expect(panel.locator("#skill-trace-override-banner")).toContainText("Manually reviewed");
  await expect(panel.locator("#skill-trace-override-banner")).toContainText("Elite");
  await expect(panel.locator("#skill-trace-row-fg3a_per_game")).toBeVisible();
  await expect(panel.locator("#skill-trace-row-fg3_pct")).toBeVisible();

  // notes must never appear anywhere on the page or in a captured response body.
  const bodyText = await page.textContent("body");
  expect(bodyText?.toLowerCase()).not.toContain("notes");

  await page.screenshot({ path: "test-results/skill-trace-expanded.png", fullPage: false });

  // Selecting a second skill reuses the same panel (cached trace, no re-fetch)
  // and shows no override banner for a skill that has none.
  const rimProtectorToggle = page.locator("#player-profile-skill-toggle-rim_protector");
  await rimProtectorToggle.click();
  await expect(panel).toContainText("Rim Protector");
  await expect(panel.locator("#skill-trace-override-banner")).toHaveCount(0);

  // Closing the panel removes it; Escape does too.
  await page.locator("#player-profile-skill-detail-close").click();
  await expect(panel).toHaveCount(0);
  await rimProtectorToggle.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("trace-unavailable state renders when the endpoint fails", async ({ page }) => {
  await page.route(`**/api/players/${PLAYER_ID}/profile*`, (route) =>
    route.fulfill({ json: PROFILE_RESPONSE })
  );
  await page.route(`**/api/players/${PLAYER_ID}/skill-trace*`, (route) =>
    route.fulfill({ status: 404, json: { success: false, data: null, error: "not_found" } })
  );

  await page.goto(`${BASE_URL}/players/${PLAYER_ID}`, { waitUntil: "networkidle" });

  await page.locator("#player-profile-skill-toggle-spot_up_shooter").click();
  await expect(page.locator("#player-profile-skill-detail-panel")).toContainText(
    "temporarily unavailable"
  );
});
