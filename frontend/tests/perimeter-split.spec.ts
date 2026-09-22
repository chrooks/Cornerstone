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
 * M3.18 later extends this file with the AFTER-split proof, and compares
 * against these same files.
 *
 * Read-only by construction: one GET, one POST to a pure-computation route
 * that writes nothing, and one public page open per player. No write control
 * is ever clicked. Headless (Playwright's default).
 *
 * Run:
 *   cd frontend && npx playwright test tests/perimeter-split.spec.ts --reporter=line
 */

import fs from "node:fs";
import path from "node:path";
import { test, expect, type APIRequestContext } from "@playwright/test";

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
