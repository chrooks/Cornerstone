/**
 * Lab V1 fixes on the dev Surface: #138 (picker and /players sort by Value,
 * unpriced players disabled), #149 (starter progress instead of 0.00 stars)
 * and #142 (the score strip pinned above the Team Shape).
 *
 * Run: PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *      npx playwright test tests/lab-build-fixes.spec.ts --reporter=line
 */
import { expect, test, type Page } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "https://cornerstone-dev.hestia.chrooks.com";
const API = process.env.NEXT_PUBLIC_API_URL ?? BASE;

interface Row { id: string; name: string; is_legend?: boolean; value_price?: number | null }

async function pool(page: Page): Promise<Row[]> {
  const res = await page.request.get(`${API}/api/players/bulk?include_legends=true`);
  expect(res.ok()).toBe(true);
  return ((await res.json()).data ?? []) as Row[];
}

/** An 8-of-9 standard Rotation under the value cap: the Legend plus the 7 cheapest priced actives.
 *  One slot stays open so the picker still has addable rows to hover. */
function fullRotationUrl(players: Row[]): string {
  const legend = players.find((p) => p.is_legend)!;
  const cheapest = players
    .filter((p) => !p.is_legend && p.value_price != null && p.value_price > 0)
    .sort((a, b) => a.value_price! - b.value_price!)
    .slice(0, 7);
  const params = new URLSearchParams({ cornerstone: legend.id, s1: legend.id });
  cheapest.forEach((p, i) => params.set(`s${i + 2}`, p.id));
  return `${BASE}/lab/standard/build?${params}`;
}

function toMillions(text: string): number {
  const m = /\$([\d.]+)m/i.exec(text);
  expect(m, `price cell "${text}"`).toBeTruthy();
  return parseFloat(m![1]);
}

for (const [width, height, label] of [[1440, 900, "desktop"], [390, 844, "phone"]] as const) {
  test(`#138 + #149 on the Build page at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const players = await pool(page);
    const legend = players.find((p) => p.is_legend)!;
    const unpriced = players.find((p) => !p.is_legend && p.value_price == null)!;
    await page.goto(`${BASE}/lab/standard/build?cornerstone=${legend.id}&s1=${legend.id}`, { waitUntil: "networkidle" });

    // #149: one starter picked → progress, not a 0.00 star badge.
    const progress = page.locator("#builder-new-feedback-starter-progress");
    if (label === "phone") await page.locator("#builder-narrow-workspace-tab-feedback").click();
    await expect(progress).toContainText("1 of 5 starters");
    await expect(page.locator("#builder-new-feedback-score")).toHaveCount(0);
    await expect(page.locator("#team-shape-progress")).toContainText("Fill 4 more starting slots (01–05)");

    // #138: the picker opens on Value, highest first.
    if (label === "phone") await page.locator("#builder-narrow-workspace-tab-players").click();
    const picker = page.locator("#player-picker-panel");
    await expect(picker).toContainText(/Value\s*▼/);
    const prices = await picker.locator("tbody tr").locator("td:nth-child(4)").allInnerTexts();
    const top = prices.slice(0, 3).map(toMillions);
    expect(top[0]).toBeGreaterThanOrEqual(top[1]);
    expect(top[1]).toBeGreaterThanOrEqual(top[2]);

    // #138: an unpriced player is labelled and not addable.
    await picker.locator("input[placeholder='Value…']").fill(unpriced.name);
    await picker.getByRole("button", { name: "Add Filter" }).click();
    const row = picker.locator("tbody tr", { hasText: unpriced.name }).first();
    await expect(row).toContainText("No Value price");
    await expect(row).toHaveAttribute("aria-disabled", "true");
  });

  test(`#142 the score strip is pinned above the Team Shape at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(fullRotationUrl(await pool(page)), { waitUntil: "networkidle" });
    if (label === "phone") await page.locator("#builder-narrow-workspace-tab-feedback").click();
    const strip = page.locator("#builder-feedback-score-strip");
    await expect(strip.locator("#builder-new-feedback-score")).toContainText(/\d\.\d\d/, { timeout: 30_000 });
    await expect(strip).toBeInViewport({ ratio: 1 });
    // The star no longer sits below the glyph, where desktop-09 cut it off.
    await expect(page.locator("#builder-feedback-content #builder-new-feedback-score")).toHaveCount(0);
    const glyph = page.locator("#builder-new-feedback-shape");
    const [stripBox, glyphBox] = await Promise.all([strip.boundingBox(), glyph.boundingBox()]);
    expect(stripBox!.y).toBeLessThan(glyphBox!.y);

    if (label === "desktop") {
      // Hover feedforward reads in the strip, not below the fold.
      const row = page.locator("#player-picker-panel tbody tr:not([aria-disabled])").first();
      await row.hover();
      await expect(strip.locator("#builder-eval-preview-delta")).toContainText(/★ \d\.\d\d → \d\.\d\d/, { timeout: 5_000 });
      await expect(strip).toBeInViewport({ ratio: 1 });
    }
  });

  test(`#138 /players carries a Value column, sorted first, at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/players`, { waitUntil: "networkidle" });
    const browser = page.locator("#players-pool-browser");
    await expect(browser).toContainText(/Value\s*▼/);
    const headers = (await browser.locator("thead th").allInnerTexts()).map((h) => h.replace(/[▲▼]/g, "").trim());
    expect(headers).toEqual(expect.arrayContaining(["Salary", "Value"]));
    const valueCol = headers.indexOf("Value") + 1;
    expect(valueCol).toBeLessThan(headers.indexOf("Salary") + 1);
    const values = await browser.locator("tbody tr").locator(`td:nth-child(${valueCol})`).allInnerTexts();
    const top = values.slice(0, 3).map(toMillions);
    expect(top[0]).toBeGreaterThanOrEqual(top[1]);
    expect(top[1]).toBeGreaterThanOrEqual(top[2]);
  });
}
