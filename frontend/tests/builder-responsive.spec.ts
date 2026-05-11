import { expect, test, type APIRequestContext } from "@playwright/test";

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

async function buildUrlWithFilledRotation(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${API_BASE_URL}/api/players/bulk?include_legends=true`);
  expect(response.ok()).toBe(true);

  const body = await response.json() as {
    success: boolean;
    data: PlayerWithSkills[] | null;
    error: string | null;
  };
  expect(body.success, body.error ?? "player bulk request failed").toBe(true);

  const players = body.data ?? [];
  const cornerstone =
    players.find((player) => player.is_legend && player.name === "LeBron James") ??
    players.find((player) => player.is_legend);
  expect(cornerstone, "expected at least one Legend for the Build URL").toBeTruthy();

  let remaining = SALARY_CAP - LEGEND_SALARY;
  const supportingPlayers = players
    .filter((player) => !player.is_legend && player.salary != null && player.salary > 0)
    .sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0))
    .filter((player) => {
      const salary = player.salary ?? 0;
      if (salary > remaining) return false;
      remaining -= salary;
      return true;
    })
    .slice(0, 8);
  expect(supportingPlayers.length, "expected enough active Players to fill a Rotation").toBe(8);

  const params = new URLSearchParams({ cornerstone: cornerstone!.id, s1: cornerstone!.id });
  supportingPlayers.forEach((player, index) => {
    params.set(`s${index + 2}`, player.id);
  });

  return `${FRONTEND_BASE_URL}/lab/standard/build?${params.toString()}`;
}

test("Lab Build adapts to mobile without preserving the desktop split", async ({ page, request }) => {
  const buildUrl = await buildUrlWithFilledRotation(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(buildUrl, { waitUntil: "networkidle" });

  await expect(page.locator("#builder-page")).toBeVisible();
  await expect(page.locator("#builder-workspace-resize-handle")).toBeHidden();
  await expect(page.locator("#builder-narrow-workspace-tabs")).toBeVisible();
  await expect(page.locator("#builder-playerpool-panel")).toBeVisible();
  await expect(page.locator("#builder-notes-panel")).toBeHidden();

  await expect.poll(async () => (
    page.locator("#builder-workspace").evaluate((element) => getComputedStyle(element).flexDirection)
  )).toBe("column");

  await page.locator("#player-picker-view-toggle-card-btn").click();
  const firstCard = page.locator("#player-picker-browser-cards > *").first();
  const secondCard = page.locator("#player-picker-browser-cards > *").nth(1);
  await expect(firstCard).toBeVisible();
  await expect(secondCard).toBeVisible();

  const [firstBox, secondBox] = await Promise.all([
    firstCard.boundingBox(),
    secondCard.boundingBox(),
  ]);
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs(firstBox!.x - secondBox!.x)).toBeLessThanOrEqual(4);
  expect(secondBox!.y).toBeGreaterThan(firstBox!.y + 24);

  const pageOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(2);

  await page.locator("#builder-narrow-workspace-tab-feedback").click();
  await expect(page.locator("#builder-playerpool-panel")).toBeHidden();
  await expect(page.locator("#builder-notes-panel")).toBeVisible();
  const feedbackBox = await page.locator("#builder-notes-panel").boundingBox();
  expect(feedbackBox).not.toBeNull();
  expect(feedbackBox!.y).toBeLessThan(500);
});

test("Lab Build preserves desktop split and avoids page overflow across the responsive matrix", async ({ page, request }) => {
  const buildUrl = await buildUrlWithFilledRotation(request);
  const matrix = [
    { name: "desktop", width: 1440, height: 900, split: true },
    { name: "short laptop", width: 1280, height: 720, split: true },
    { name: "tablet landscape", width: 1024, height: 768, split: true },
    { name: "tablet portrait", width: 768, height: 1024, split: false },
    { name: "mobile", width: 390, height: 844, split: false },
  ];

  for (const viewport of matrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(buildUrl, { waitUntil: "networkidle" });
    await expect(page.locator("#builder-page")).toBeVisible();

    const flexDirection = await page
      .locator("#builder-workspace")
      .evaluate((element) => getComputedStyle(element).flexDirection);
    expect(flexDirection, `${viewport.name} workspace direction`).toBe(viewport.split ? "row" : "column");

    if (viewport.split) {
      await expect(page.locator("#builder-workspace-resize-handle")).toBeVisible();
      await expect(page.locator("#builder-narrow-workspace-tabs")).toBeHidden();
    } else {
      await expect(page.locator("#builder-workspace-resize-handle")).toBeHidden();
      await expect(page.locator("#builder-narrow-workspace-tabs")).toBeVisible();
    }

    const pageOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageOverflow, `${viewport.name} page overflow`).toBeLessThanOrEqual(2);

    const courtOverflow = await page.locator("#builder-court-strip-scroll").evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    if (courtOverflow.scrollWidth > courtOverflow.clientWidth + 2) {
      expect(courtOverflow.overflowX, `${viewport.name} CourtStrip overflow mode`).toBe("auto");
    }
  }
});
