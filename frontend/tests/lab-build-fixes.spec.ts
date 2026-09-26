/**
 * Lab V1 fixes on the dev Surface: #138 (picker and /players sort by Value,
 * unpriced players disabled) and #149 (starter progress instead of 0.00 stars).
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
    if (label === "phone") await page.getByRole("tab", { name: "Feedback" }).or(page.getByText("Feedback", { exact: true })).first().click();
    await expect(progress).toContainText("1 of 5 starters");
    await expect(page.locator("#builder-new-feedback-score")).toHaveCount(0);
    await expect(page.locator("#team-shape-progress")).toContainText("Fill 4 more starting slots (01–05)");

    // #138: the picker opens on Value, highest first.
    if (label === "phone") await page.getByText("Players", { exact: true }).first().click();
    const picker = page.locator("#player-picker-panel");
    await expect(picker).toContainText("Value ▼");
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

  test(`#138 /players carries a Value column, sorted first, at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/players`, { waitUntil: "networkidle" });
    const browser = page.locator("#players-pool-browser");
    await expect(browser).toContainText("Value ▼");
    const headers = await browser.locator("thead th").allInnerTexts();
    expect(headers.map((h) => h.trim())).toEqual(expect.arrayContaining(["Salary", "Value"]));
    const valueCol = headers.findIndex((h) => h.trim() === "Value") + 1;
    const values = await browser.locator("tbody tr").locator(`td:nth-child(${valueCol})`).allInnerTexts();
    const top = values.slice(0, 3).map(toMillions);
    expect(top[0]).toBeGreaterThanOrEqual(top[1]);
    expect(top[1]).toBeGreaterThanOrEqual(top[2]);
  });
}
