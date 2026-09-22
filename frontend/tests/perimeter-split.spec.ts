/**
 * #152 — the split of Perimeter Disruptor into Point of Attack Defender
 * (on-ball) and Off-Ball Disruptor (off-ball).
 *
 * M3.1 (this file today) captures the BEFORE-split baseline from the dev
 * Surface, before any M3 code ships. For OG Anunoby, Jrue Holiday and Rudy
 * Gobert it writes, into `.tasks/119-3d-archetypes/m3-before/`:
 *   <slug>-profile.json     the released GET /api/players/<id>/profile,
 *                           which carries the released perimeter_disruptor tier
 *   <slug>-composites.json  POST /api/builder/player-composites,
 *                           which carries the perimeter_defense value
 *   <slug>.png              the public profile page
 * Those two numbers per player are the parity target for the whole milestone:
 * after the split, a player with no off-ball rating must score identically.
 *
 * M3.18 (the rest of this file) is the AFTER-split proof, read against those
 * same files: both Skills show on the Profile, in the Build picker and in the
 * legend editor, the retired key shows nowhere, each on-ball tier still equals
 * the captured `perimeter_disruptor` tier, and each `perimeter_defense` value
 * still equals the captured number. The last one is the parity bar for the
 * whole milestone, so it compares the numbers, not the shape of the answer.
 *
 * Read-only by construction: GETs, a POST to a pure-computation route that
 * writes nothing, and page opens. No write control is ever clicked, and the
 * admin page aborts any non-GET call outright. Headless (Playwright's default).
 *
 * Run:
 *   cd frontend && PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *     npx playwright test tests/perimeter-split.spec.ts --reporter=line
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { E2E_ADMIN_STATE, E2E_BASE_URL, E2E_LOGIN_MISSING, hasE2eLogin, loginAsE2eAdmin } from "./e2e-login";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://cornerstone-dev.hestia.chrooks.com";
/** Dev serves the Flask API on the same host through Caddy. */
const API_BASE_URL = process.env.PLAYWRIGHT_API_URL ?? BASE_URL;
const SEASON = "2025-26";

/** `.tasks/` is gitignored local working state, two levels above `frontend/`. */
export const BASELINE_DIR = path.join(__dirname, "..", "..", ".tasks", "119-3d-archetypes", "m3-before");

/** OG rates the on-ball Skill mid, Holiday Elite, Gobert None — three shapes. */
export const BASELINE_PLAYER_NAMES = ["OG Anunoby", "Jrue Holiday", "Rudy Gobert"] as const;

export function baselineSlug(playerName: string): string {
  return playerName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

interface SkillResult {
  final_tier: string | null;
}

/** Mirrors PlayerProfileShape.toSkillMap — the body the profile page posts. */
function toSkillMap(skills: Record<string, SkillResult>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(skills).map(([skill, result]) => [skill, result.final_tier ?? "None"]),
  );
}

async function okJson<T>(request: APIRequestContext, url: string, body?: unknown): Promise<T> {
  const response = body === undefined
    ? await request.get(url)
    : await request.post(url, { data: body });
  expect(response.ok(), `${url} returned ${response.status()}`).toBe(true);
  const payload = await response.json() as { success: boolean; data: T | null; error: string | null };
  expect(payload.success, payload.error ?? `${url} returned success: false`).toBe(true);
  expect(payload.data, `${url} returned no data`).toBeTruthy();
  return payload.data as T;
}

/** Player ids are dev-database ids, so resolve them by name instead of pinning them. */
async function resolvePlayerIds(request: APIRequestContext): Promise<Map<string, string>> {
  const players = await okJson<{ id: string; name: string }[]>(
    request,
    `${API_BASE_URL}/api/players/bulk`,
  );
  const byName = new Map(players.map((player) => [player.name, player.id]));
  const ids = new Map<string, string>();
  for (const name of BASELINE_PLAYER_NAMES) {
    const id = byName.get(name);
    expect(id, `${name} is not in /api/players/bulk on ${API_BASE_URL}`).toBeTruthy();
    ids.set(name, id as string);
  }
  return ids;
}

test("M3.1 capture the before-split baseline on dev", async ({ page, request }) => {
  test.setTimeout(180_000);

  // These files are the parity target for all of M3, and `.tasks/` is
  // gitignored, so they are the only copy. Once the split deploys, dev serves
  // post-split numbers — re-running the command in this file's header would
  // overwrite the bar with the very thing it is meant to check.
  // ponytail: skip when a capture exists; BASELINE_RECAPTURE=1 to overwrite.
  const captured = path.join(BASELINE_DIR, `${baselineSlug(BASELINE_PLAYER_NAMES[0])}-composites.json`);
  test.skip(
    fs.existsSync(captured) && process.env.BASELINE_RECAPTURE !== "1",
    `M3.1 baseline already captured in ${BASELINE_DIR} — set BASELINE_RECAPTURE=1 to overwrite it`,
  );

  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  const ids = await resolvePlayerIds(request);
  const rows: { name: string; perimeter_disruptor: string; perimeter_defense: number }[] = [];

  for (const name of BASELINE_PLAYER_NAMES) {
    const id = ids.get(name) as string;
    const slug = baselineSlug(name);

    const profile = await okJson<{ skills: Record<string, SkillResult> }>(
      request,
      `${API_BASE_URL}/api/players/${id}/profile?season=${SEASON}`,
    );
    fs.writeFileSync(
      path.join(BASELINE_DIR, `${slug}-profile.json`),
      `${JSON.stringify(profile, null, 2)}\n`,
    );

    const composites = await okJson<{ composites: Record<string, number>; normalization: string }>(
      request,
      `${API_BASE_URL}/api/builder/player-composites`,
      { skills: toSkillMap(profile.skills) },
    );
    // A theoretical_max answer would not be comparable after the split.
    expect(composites.normalization, `${name} composites are not percentile-normalized`)
      .toBe("percentile");
    fs.writeFileSync(
      path.join(BASELINE_DIR, `${slug}-composites.json`),
      `${JSON.stringify(composites, null, 2)}\n`,
    );

    await page.goto(`${BASE_URL}/players/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#player-profile-view-name")).toHaveText(name);
    // The Shape renders only once the composites answer lands.
    await expect(page.locator("#player-profile-shape")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(BASELINE_DIR, `${slug}.png`), fullPage: true });

    rows.push({
      name,
      perimeter_disruptor: profile.skills.perimeter_disruptor?.final_tier ?? "None",
      perimeter_defense: composites.composites.perimeter_defense,
    });
  }

  for (const name of BASELINE_PLAYER_NAMES) {
    const slug = baselineSlug(name);
    for (const file of [`${slug}-profile.json`, `${slug}-composites.json`, `${slug}.png`]) {
      expect(fs.existsSync(path.join(BASELINE_DIR, file)), `${file} was not written`).toBe(true);
    }
  }

  // The parity target for every later M3 step.
  console.log(`\nM3.1 baseline — ${BASE_URL}`);
  console.log("player        | perimeter_disruptor | perimeter_defense");
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(13)} | ${row.perimeter_disruptor.padEnd(19)} | ${row.perimeter_defense}`,
    );
  }
});

// ---------------------------------------------------------------------------
// M3.18 — the after-split proof
// ---------------------------------------------------------------------------

/** What the frontend shows for each key, from `lib/skills.ts`. */
const ON_BALL_LABEL = "Point of Attack Defender";
const OFF_BALL_LABEL = "Off-Ball Disruptor";
/** The retired Skill's label and table abbreviation — neither may appear anywhere. */
const RETIRED_LABEL = "Perimeter Disruptor";
const RETIRED_ABBREV = "Perim Disr";

/** The M3.1 capture is the bar; without it there is nothing to prove against. */
const BASELINE_EXISTS = fs.existsSync(
  path.join(BASELINE_DIR, `${baselineSlug(BASELINE_PLAYER_NAMES[0])}-composites.json`),
);
const NO_BASELINE = `no M3.1 baseline in ${BASELINE_DIR} — capture it before the split ships`;

interface Baseline {
  /** The released `perimeter_disruptor` tier the on-ball Skill must carry. */
  tier: string;
  /** The `perimeter_defense` composite the split must not move. */
  perimeterDefense: number;
}

function readBaseline(playerName: string): Baseline {
  const slug = baselineSlug(playerName);
  const read = <T>(file: string): T =>
    JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, file), "utf8")) as T;
  const profile = read<{ skills: Record<string, SkillResult> }>(`${slug}-profile.json`);
  const composites = read<{ composites: Record<string, number> }>(`${slug}-composites.json`);
  return {
    tier: profile.skills.perimeter_disruptor?.final_tier ?? "None",
    perimeterDefense: composites.composites.perimeter_defense,
  };
}

test("M3.18 the carried tier and perimeter_defense survive the split", async ({ request }) => {
  test.skip(!BASELINE_EXISTS, NO_BASELINE);
  test.setTimeout(180_000);

  const ids = await resolvePlayerIds(request);
  const rows: { name: string; before: Baseline; tier: string; perimeterDefense: number }[] = [];

  for (const name of BASELINE_PLAYER_NAMES) {
    const before = readBaseline(name);
    const profile = await okJson<{ skills: Record<string, SkillResult> }>(
      request,
      `${API_BASE_URL}/api/players/${ids.get(name)}/profile?season=${SEASON}`,
    );

    expect(profile.skills.perimeter_disruptor, `${name}'s profile still serves the retired key`)
      .toBeUndefined();
    // An absent entry is "never rated", which would silently drop the carried
    // tier — so check the key is there before checking what it says.
    const carried = profile.skills.point_of_attack_defender;
    expect(carried, `${name} has no point_of_attack_defender entry — the carried tier reads as unrated`)
      .toBeTruthy();
    expect(carried?.final_tier, `${name}'s on-ball tier moved`).toBe(before.tier);

    const composites = await okJson<{ composites: Record<string, number>; normalization: string }>(
      request,
      `${API_BASE_URL}/api/builder/player-composites`,
      { skills: toSkillMap(profile.skills) },
    );
    expect(composites.normalization, `${name} composites are not percentile-normalized`)
      .toBe("percentile");
    // The parity bar: the same number, not merely a number.
    expect(composites.composites.perimeter_defense, `${name}'s perimeter_defense moved`)
      .toBe(before.perimeterDefense);

    rows.push({
      name,
      before,
      tier: carried?.final_tier ?? "None",
      perimeterDefense: composites.composites.perimeter_defense,
    });
  }

  console.log(`\nM3.18 parity — ${API_BASE_URL}`);
  console.log("player        | captured tier | live tier  | captured pd | live pd");
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(13)} | ${row.before.tier.padEnd(13)} | ${row.tier.padEnd(10)} ` +
      `| ${String(row.before.perimeterDefense).padEnd(11)} | ${row.perimeterDefense}`,
    );
  }
});

test("M3.18 OG's Profile shows both new Skills and not the retired one", async ({ page, request }) => {
  test.setTimeout(120_000);

  const ids = await resolvePlayerIds(request);
  await page.goto(`${BASE_URL}/players/${ids.get("OG Anunoby")}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#player-profile-view-name")).toHaveText("OG Anunoby");

  await expect(page.locator("#player-profile-skill-toggle-point_of_attack_defender"))
    .toContainText(ON_BALL_LABEL, { timeout: 30_000 });
  await expect(page.locator("#player-profile-skill-toggle-off_ball_disruptor"))
    .toContainText(OFF_BALL_LABEL);
  await expect(page.locator("#player-profile-skill-toggle-perimeter_disruptor")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(RETIRED_LABEL);
});

test("M3.18 each Profile shows the carried on-ball tier, not an unrated dash", async ({ page, request }) => {
  test.skip(!BASELINE_EXISTS, NO_BASELINE);
  test.setTimeout(180_000);

  const ids = await resolvePlayerIds(request);
  for (const name of BASELINE_PLAYER_NAMES) {
    const { tier } = readBaseline(name);
    await page.goto(`${BASE_URL}/players/${ids.get(name)}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#player-profile-view-name")).toHaveText(name);

    const row = page.locator("#player-profile-skill-toggle-point_of_attack_defender");
    await expect(row).toContainText(ON_BALL_LABEL, { timeout: 30_000 });
    // "--" is the unrated mark; a carried tier must wear its badge instead.
    await expect(row, `${name}'s on-ball Skill reads unrated`).not.toContainText("--");
    await expect(row, `${name}'s on-ball tier is not the captured ${tier}`).toContainText(tier);
  }
});

test("M3.18 the Build picker's Skill columns show both new Skills", async ({ page, request }) => {
  test.setTimeout(120_000);

  // Dev's RuleSet and Legend ids are not pinned, so resolve both.
  const rulesets = await okJson<{ slug: string; status: string }[]>(request, `${API_BASE_URL}/api/rulesets`);
  const ruleset = rulesets.find((r) => r.status === "active");
  expect(ruleset, `no active RuleSet on ${API_BASE_URL}`).toBeTruthy();
  const legends = await okJson<{ id: string }[]>(request, `${API_BASE_URL}/api/legends`);
  expect(legends.length, "no Legends to open the Build picker with").toBeGreaterThan(0);

  await page.goto(
    `${BASE_URL}/lab/${ruleset?.slug}/build?cornerstone=${legends[0].id}`,
    { waitUntil: "domcontentloaded" },
  );

  // PlayerTable.columnLabel prefers SKILL_LABELS over SKILL_ABBREV, so the
  // header shows the full name; the abbreviation only ever appears as a
  // fallback for a key SKILL_LABELS has lost.
  const head = page.locator("#player-table thead");
  await expect(head).toContainText(ON_BALL_LABEL, { timeout: 60_000 });
  await expect(head).toContainText(OFF_BALL_LABEL);
  await expect(head).not.toContainText(RETIRED_LABEL);
  await expect(head).not.toContainText(RETIRED_ABBREV);
});

test.describe("M3.18 the legend editor", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("lists both new Skills in its Skill groups", async ({ page, request }) => {
    test.setTimeout(120_000);

    // This page edits real Legend data, so make a stray write impossible
    // rather than merely unlikely: only reads leave the browser.
    await page.route("**/api/**", (route) =>
      ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort(),
    );

    const legends = await okJson<{ id: string }[]>(request, `${API_BASE_URL}/api/legends`);
    expect(legends.length, "no Legends to open the editor with").toBeGreaterThan(0);
    await page.goto(`${E2E_BASE_URL}/admin/legends/${legends[0].id}`, { waitUntil: "domcontentloaded" });
    expect(new URL(page.url()).pathname, "the admin gate bounced the test login")
      .not.toMatch(/^\/(login|unauthorized)/);

    // Each Skill group row renders one TierSelector, labelled by Skill.
    await expect(page.locator(`[aria-label="Tier for ${ON_BALL_LABEL}"]`))
      .toBeVisible({ timeout: 60_000 });
    await expect(page.locator(`[aria-label="Tier for ${OFF_BALL_LABEL}"]`)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(RETIRED_LABEL);
  });
});
