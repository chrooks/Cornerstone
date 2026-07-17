import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * #100 acceptance proof (ac3, ac5): the 12th spoke "Passing".
 *
 * ac3 — Lab build page renders 12-spoke glyphs: Team Shape aria-label reports
 *       12 axes; offense arc order Spacing, Creation, Rim, Post, Off-Ball,
 *       Passing, Ball Sec; Player Shape shows a Passing value or an honest gap.
 * ac5 — Lab eval view: the Passing (collective_passing) spoke's Attribution
 *       Ledger surfaces per-player passer lines (primary creator + depth).
 *
 * Runs against the deployed dev stack:
 *   PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com
 *   NEXT_PUBLIC_API_URL=https://cornerstone-dev.hestia.chrooks.com
 */

interface PlayerWithSkills {
  id: string;
  name: string;
  is_legend?: boolean;
  salary?: number | null;
}

const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";
const LEGEND_SALARY = 54_000_000;
const SALARY_CAP = 195_000_000;

const OFFENSE_ARC_ORDER = ["Spacing", "Creation", "Rim", "Post", "Off-Ball", "Passing", "Ball Sec"];

async function buildRosterParams(request: APIRequestContext): Promise<URLSearchParams> {
  const response = await request.get(`${API_BASE_URL}/api/players/bulk?include_legends=true`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { success: boolean; data: PlayerWithSkills[] | null; error: string | null };
  expect(body.success, body.error ?? "player bulk request failed").toBe(true);

  const players = body.data ?? [];
  const cornerstone =
    players.find((p) => p.is_legend && p.name === "LeBron James") ?? players.find((p) => p.is_legend);
  expect(cornerstone, "expected at least one Legend").toBeTruthy();

  let remaining = SALARY_CAP - LEGEND_SALARY;
  const support = players
    .filter((p) => !p.is_legend && p.salary != null && p.salary > 0)
    .sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0))
    .filter((p) => {
      const s = p.salary ?? 0;
      if (s > remaining) return false;
      remaining -= s;
      return true;
    })
    .slice(0, 8);
  expect(support.length, "expected 8 affordable support Players").toBe(8);

  const params = new URLSearchParams({ cornerstone: cornerstone!.id, s1: cornerstone!.id });
  support.forEach((p, i) => params.set(`s${i + 2}`, p.id));
  return params;
}

/** Axis labels off a rendered glyph SVG, filtered to the offense-arc set, in draw order. */
async function offenseArcLabels(page: Page, glyphSelector: string): Promise<string[]> {
  const labels = (await page.locator(`${glyphSelector} svg text`).allTextContents()).map((t) => t.trim());
  return labels.filter((t) => OFFENSE_ARC_ORDER.includes(t));
}

test.describe("#100 Passing spoke", () => {
  test("ac3 — Lab build renders 12-spoke Team + Player Shapes with Passing in the offense arc", async ({
    page,
    request,
  }) => {
    const params = await buildRosterParams(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${FRONTEND_BASE_URL}/lab/standard/build?${params.toString()}`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("#builder-page")).toBeVisible();

    // Team Shape forms once 5 slots are filled + the live eval returns.
    const teamGlyph = page.locator("#team-shape-glyph");
    await expect(teamGlyph).toBeVisible();
    const teamSvg = teamGlyph.locator('svg[role="group"]');
    await expect
      .poll(async () => teamSvg.getAttribute("aria-label"), { timeout: 30_000 })
      .toBe("Team Shape: Starting Lineup subscores across 12 axes");

    // Offense arc label order: Spacing, Creation, Rim, Post, Off-Ball, Passing, Ball Sec.
    const teamOffense = await offenseArcLabels(page, "#team-shape-glyph");
    expect(teamOffense.slice(0, OFFENSE_ARC_ORDER.length)).toEqual(OFFENSE_ARC_ORDER);

    // Passing vertex exists on the Team Shape (team key collective_passing).
    await expect(page.locator("#team-shape-vertex-collective_passing")).toHaveCount(1);

    await page.screenshot({ path: "test-results/ac3-team-shape.png", fullPage: false });

    // Reveal the Player Shape by focusing a filled court slot.
    await page.locator("[data-builder-slot-index]").first().click();
    const contribution = page.locator("#builder-new-feedback-player-contribution");
    await expect(contribution).toBeVisible({ timeout: 15_000 });

    // Player Shape renders on the same 12 axes, OR the honest empty/gap state.
    const playerGlyph = page.locator("#player-shape-glyph");
    const playerEmpty = page.locator("#player-shape-empty");
    const hasGlyph = (await playerGlyph.count()) > 0;
    if (hasGlyph) {
      await expect(playerGlyph.locator("svg")).toHaveAttribute("aria-label", /across 12 axes$/);
      // Passing axis: either a real value (title starts "Passing:") or a gap (no dot). Never 0.
      const passingTitle = playerGlyph.locator("title", { hasText: /^Passing:/ });
      const passingCount = await passingTitle.count();
      if (passingCount > 0) {
        const txt = (await passingTitle.first().textContent()) ?? "";
        console.log(`[ac3] Player Shape Passing value present: ${txt.trim()}`);
        expect(txt).not.toMatch(/Passing:\s*0\.0/); // honest: null renders as gap, never a fake 0
      } else {
        console.log("[ac3] Player Shape Passing axis is an honest gap (no dot).");
      }
    } else {
      await expect(playerEmpty).toBeVisible();
      console.log("[ac3] Player Shape honest empty state (no Impact Trait data).");
    }
    await page.locator("#builder-new-feedback-player-contribution").screenshot({
      path: "test-results/ac3-player-shape.png",
    });
  });

  test("ac5 — Eval view Passing spoke opens per-player passer attribution", async ({ page, request }) => {
    const params = await buildRosterParams(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${FRONTEND_BASE_URL}/lab/standard/eval?${params.toString()}`, {
      waitUntil: "networkidle",
    });

    await expect(page.locator("#eval-results")).toBeVisible({ timeout: 45_000 });

    const vertex = page.locator("#team-shape-vertex-collective_passing");
    await expect(vertex).toHaveCount(1);
    // Vertices are real buttons only when the response carries subscore_breakdowns.
    await expect(vertex).toHaveAttribute("role", "button");

    await vertex.click();

    const ledger = page.locator("#cohesion-ledger-collective_passing");
    await expect(ledger).toBeVisible({ timeout: 15_000 });
    await expect(ledger).toContainText("Passing — Starting Lineup");

    const players = page.locator("#cohesion-ledger-collective_passing-players");
    await expect(players).toContainText("Player inputs");

    const playerRows = players.locator('button[id^="cohesion-ledger-collective_passing-player-"]');
    const rowCount = await playerRows.count();
    expect(rowCount, "expected at least one per-player passer line").toBeGreaterThan(0);

    // Record the passer roles/values surfaced (primary creator + depth).
    const rowTexts: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      rowTexts.push(((await playerRows.nth(i).textContent()) ?? "").replace(/\s+/g, " ").trim());
    }
    console.log(`[ac5] collective_passing attribution rows (${rowCount}):\n  ${rowTexts.join("\n  ")}`);

    await ledger.screenshot({ path: "test-results/ac5-passing-attribution.png" });
  });
});
