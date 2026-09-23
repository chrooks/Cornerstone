/**
 * #166 — the swipe deck for the review queue, proved at 390×844.
 *
 * Real login to the dev-only admin test account (e2e-login.ts) so the admin
 * gate runs for real. Every /api call is mocked in the "mocked" tests, so no
 * real flag is ever written. The one real-data test (ac14) aborts every
 * non-GET request, so it can only read.
 *
 * Run against the dev Surface (after the deploy that carries the deck):
 *   PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *   npx playwright test tests/review-deck.spec.ts --reporter=line
 *
 * Against a local dev server pointed at the SAME dev Supabase (the login only
 * exists there); ac14 skips itself off the dev Surface:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3166 npx playwright test tests/review-deck.spec.ts --reporter=line
 */

import { rm } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import { E2E_ADMIN_STATE, E2E_BASE_URL, E2E_LOGIN_MISSING, hasE2eLogin, loginAsE2eAdmin } from "./e2e-login";

const SKILL = "point_of_attack_defender";
const DECK_URL = `${E2E_BASE_URL}/admin/review/deck?skill=${SKILL}`;
/** The undo window is 5 s; allow the timer and the request to land. */
const AFTER_UNDO_WINDOW_MS = 7_000;

interface CardOverrides {
  flag_reason?: string;
  stat_rating?: string | null;
  claude_tier?: string | null;
}

/** Deck Player 01, 02, … — zero-padded so name order is index order. */
function makeCard(i: number, o: CardOverrides = {}) {
  const n = String(i).padStart(2, "0");
  const reason = o.flag_reason ?? "two_tier_disagreement";
  return {
    player_id: `00000000-0000-4000-8000-0000000001${n}`,
    player_name: `Deck Player ${n}`,
    team: "BOS",
    position: "G",
    unresolved_flag_count: 1,
    flag_reasons: [reason],
    agreement_count: 0,
    games_played: 70,
    minutes_per_game: 31.4,
    nba_api_id: null,
    flag: {
      id: `flag-${n}`,
      skill_name: SKILL,
      flag_reason: reason,
      stat_rating: o.stat_rating === undefined ? "Proficient" : o.stat_rating,
      claude_tier: o.claude_tier === undefined ? "None" : o.claude_tier,
      claude_justification: `Claude's full reason for player ${n}: rarely guards the point of attack and is hidden off-ball most nights.`,
      tier_now: "None",
    },
  };
}

const deckOf = (count: number) => Array.from({ length: count }, (_, i) => makeCard(i + 1));

/** Five rows: one passed volume gate (dropped from the front) and four tier rows. */
const BREAKDOWN = {
  skill_name: SKILL,
  stat_tier: "Proficient",
  volume_gate_passed: true,
  condition_results: [
    { section: "volume_gate", stat: "gp", operator: ">=", threshold: 20, actual_value: 70, passed: true, per: null, stabilized: false, group_id: 1, group_logic: "AND", depth: 0 },
    { section: "elite", stat: "defense.matchup_pts_per_poss", operator: "<=", threshold: 0.9, actual_value: 1.02, passed: false, per: null, stabilized: false, group_id: 2, group_logic: "AND", depth: 0 },
    { section: "elite", stat: "defense.pct_guarding_pg", operator: ">=", threshold: 0.3, actual_value: 0.41, passed: true, per: null, stabilized: false, group_id: 2, group_logic: "AND", depth: 0 },
    { section: "capable", stat: "defense.deflections", operator: ">=", threshold: 1.5, actual_value: 1.2, passed: false, per: null, stabilized: false, group_id: 3, group_logic: "AND", depth: 0 },
    { section: "capable", stat: "defense.stl", operator: ">=", threshold: 0.8, actual_value: 1.1, passed: true, per: null, stabilized: false, group_id: 3, group_logic: "AND", depth: 0 },
  ],
};

function ok(route: Route, data: unknown) {
  return route.fulfill({ json: { success: true, data, error: null } });
}

function fail(route: Route, status: number, error: string) {
  return route.fulfill({ status, json: { success: false, data: null, error } });
}

interface DeckMocks {
  /** Every resolve POST, in order, with the player it named. */
  resolves: { player_id: string; body: Record<string, unknown> }[];
  /** Set to make the NEXT resolve fail with this status and error string. */
  failNext: { status: number; error: string } | null;
}

async function mockDeck(page: Page, cards: ReturnType<typeof makeCard>[]): Promise<DeckMocks> {
  const mocks: DeckMocks = { resolves: [], failNext: null };
  // Registered first, so it matches last: nothing unmocked reaches a backend.
  await page.route("**/api/**", (route) => fail(route, 404, "not mocked"));
  await page.route("**/api/review/queue**", (route) => {
    const skill = new URL(route.request().url()).searchParams.get("skill_name");
    return ok(route, skill === SKILL ? cards : []);
  });
  await page.route("**/api/review/*/skill-breakdown**", (route) => ok(route, BREAKDOWN));
  await page.route("**/api/review/*/resolve", (route) => {
    const player_id = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    mocks.resolves.push({ player_id, body: route.request().postDataJSON() });
    const f = mocks.failNext;
    mocks.failNext = null;
    if (f) return fail(route, f.status, f.error);
    return ok(route, { flag_id: "x", resolved_tier: "x", all_flags_resolved: true });
  });
  return mocks;
}

/** Past the dock's 250 ms settle window, which drops a second tap on purpose. */
const SETTLE_WAIT_MS = 300;

/** Drag the top card by (dx, dy) in small steps, as a finger would. */
async function drag(page: Page, dx: number, dy: number) {
  const box = await page.locator("#flag-card").boundingBox();
  if (!box) throw new Error("no #flag-card on screen");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_WAIT_MS); // an answer settles the dock, whichever way it came
}

const topName = (page: Page) => page.locator("#card-player p").first();


/** Tap one answer, then wait as a thumb would before the next. */
async function answer(page: Page, selector: string) {
  await page.click(selector);
  await page.waitForTimeout(SETTLE_WAIT_MS);
}

async function openDeck(page: Page) {
  await page.goto(DECK_URL, { waitUntil: "networkidle" });
  expect(new URL(page.url()).pathname).not.toMatch(/^\/(login|unauthorized)/);
  await expect(page.locator("#flag-card")).toBeVisible();
}

test.describe("#166 swipe deck (mocked data)", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  // Instant card exits keep the flow deterministic; the clip test keeps the motion.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("ac1 — the deck fits one phone screen and shows where you are", async ({ page }) => {
    await mockDeck(page, deckOf(21));
    await openDeck(page);

    await expect(topName(page)).toHaveText("Deck Player 01");
    await expect(page.locator("#deck-picker")).toHaveValue(SKILL);
    await expect(page.locator("#deck-picker option:checked")).toHaveText("Point of Attack Defender");
    await expect(page.locator("#deck-done-count")).toHaveText("0 / 21 done");
    await expect(page.locator("#deck-round")).toHaveText("Round 1 · card 1 of 20");

    const [scrollW, scrollH, viewW, viewH] = await page.evaluate(() => [
      document.documentElement.scrollWidth, document.documentElement.scrollHeight, window.innerWidth, window.innerHeight,
    ]);
    expect(scrollW).toBeLessThanOrEqual(viewW);
    expect(scrollH).toBeLessThanOrEqual(viewH);

    for (const id of ["trust-stats-btn", "trust-claude-btn", "undo-btn", "skip-btn", "tier-strip-all-time-great", "tier-strip-none"]) {
      const btn = page.locator(`#${id}`);
      await expect(btn).toBeInViewport({ ratio: 1 });
      expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: "test-results/review-deck-ac1.png" });
  });

  test("ac2 — left swipe trusts Stats, right swipe trusts Claude, a short drag does nothing", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(21));
    await openDeck(page);

    await drag(page, -200, 0);
    await expect(topName(page)).toHaveText("Deck Player 02");
    await expect(page.locator("#deck-done-count")).toHaveText("1 / 21 done");
    expect(mocks.resolves).toHaveLength(0); // held for the undo window
    await expect.poll(() => mocks.resolves.length, { timeout: AFTER_UNDO_WINDOW_MS }).toBe(1);
    expect(mocks.resolves[0]).toMatchObject({
      player_id: "00000000-0000-4000-8000-000000000101",
      body: { skill_name: SKILL, resolution: "trust_stats", resolved_value: null, flag_id: "flag-01" },
    });

    await drag(page, 30, 0); // under 30% of the width
    await expect(topName(page)).toHaveText("Deck Player 02");
    await expect(page.locator("#undo-bar")).toHaveCount(0);

    await drag(page, 200, 0);
    await expect(topName(page)).toHaveText("Deck Player 03");
    await expect.poll(() => mocks.resolves.length, { timeout: AFTER_UNDO_WINDOW_MS }).toBe(2);
    expect(mocks.resolves[1].body).toMatchObject({ resolution: "trust_claude" });
  });

  test("ac3 — buttons mirror the swipes; up and Skip send nothing", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(21));
    await openDeck(page);

    await answer(page, "#trust-stats-btn");
    await expect(topName(page)).toHaveText("Deck Player 02");
    await answer(page, "#trust-claude-btn"); // the next call sends the held one at once
    await expect.poll(() => mocks.resolves.length).toBe(1);
    expect(mocks.resolves[0].body).toMatchObject({ resolution: "trust_stats" });
    await expect(topName(page)).toHaveText("Deck Player 03");

    await drag(page, 0, -300);
    await expect(topName(page)).toHaveText("Deck Player 04");
    await answer(page, "#skip-btn");
    await expect(topName(page)).toHaveText("Deck Player 05");
    await expect(page.locator("#deck-done-count")).toHaveText("2 / 21 done");
    await expect.poll(() => mocks.resolves.length, { timeout: AFTER_UNDO_WINDOW_MS }).toBe(2);
    expect(mocks.resolves[1].body).toMatchObject({ resolution: "trust_claude" });
  });

  test("ac4 — no Claude tier: the Claude button is off and a right swipe springs back", async ({ page }) => {
    const mocks = await mockDeck(page, [makeCard(1, { claude_tier: null }), makeCard(2)]);
    await openDeck(page);

    const claude = page.locator("#trust-claude-btn");
    await expect(claude).toBeDisabled();
    await expect(claude).toHaveText("Claude · no tier");
    await expect(page.locator("#card-claude-tier")).toContainText("no tier");

    await drag(page, 220, 0);
    await expect(topName(page)).toHaveText("Deck Player 01");
    await expect(page.locator("#undo-bar")).toHaveCount(0);
    expect(mocks.resolves).toHaveLength(0);
  });

  test("ac5 — one tap on the tier strip sets my own tier", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(3));
    await openDeck(page);

    await expect(page.locator("#tier-strip-proficient")).toContainText("stats");
    await expect(page.locator("#tier-strip-none")).toContainText("claude");

    await answer(page, "#tier-strip-capable");
    await expect(page.locator("#undo-bar")).toContainText("Point of Attack Defender → Capable (your tier)");
    await answer(page, "#tier-strip-elite"); // sends the held Capable now
    await expect.poll(() => mocks.resolves.length).toBe(1);
    expect(mocks.resolves[0].body).toMatchObject({ resolution: "manual_override", resolved_value: "Capable" });
  });

  test("ac6 — the front shows the evidence; a tap flips to all of it", async ({ page }) => {
    await mockDeck(page, deckOf(3));
    await openDeck(page);

    await expect(page.locator("#card-stats-tier")).toContainText("Proficient");
    await expect(page.locator("#card-claude-tier")).toContainText("None");
    await expect(page.locator("#card-tier-now")).toContainText("None");
    await expect(page.locator("#card-reason")).toHaveText("2-tier disagree");
    await expect(page.locator("#card-claude-line")).toContainText("Claude's full reason for player 01");
    await expect(page.locator("#card-thresholds tbody tr")).toHaveCount(4);
    await expect(page.locator("#card-thresholds")).toContainText("+1 more on the back");

    await page.locator("#card-tiers").click();
    await expect(page.locator("#flag-card-back")).toBeVisible();
    await expect(page.locator("#card-back-claude")).toContainText("hidden off-ball most nights");
    await expect(page.locator("#card-player-link")).toHaveAttribute(
      "href", `/admin/review/00000000-0000-4000-8000-000000000101?skill=${SKILL}`
    );
    await expect(page.locator("#card-back-thresholds")).toContainText("Volume Gate");
    await page.screenshot({ path: "test-results/review-deck-ac6-back.png" });

    await page.locator("#flag-card-back p").first().click();
    await expect(page.locator("#flag-card-front")).toBeVisible();
  });

  test("ac7 — a disputed call needs one flip before it takes an answer", async ({ page }) => {
    const mocks = await mockDeck(page, [
      // The longest real reason text (seen on dev as "manual override Capable").
      makeCard(1, { flag_reason: "human_decision_contradicted:manual_override:Capable" }),
      makeCard(2),
    ]);
    await openDeck(page);

    await expect(page.locator("#card-lock-note")).toBeInViewport({ ratio: 1 }); // not clipped by the card
    await expect(page.locator("#tier-strip-capable")).toContainText("yours"); // the tier Chris set before
    await expect(page.locator("#trust-stats-btn")).toBeDisabled();
    await expect(page.locator("#trust-claude-btn")).toBeDisabled();
    await expect(page.locator("#tier-strip-capable")).toBeDisabled();
    await drag(page, -220, 0);
    await expect(topName(page)).toHaveText("Deck Player 01");

    await page.locator("#card-tiers").click();
    await expect(page.locator("#flag-card-back")).toBeVisible();
    await expect(page.locator("#trust-stats-btn")).toBeEnabled();
    await answer(page, "#trust-stats-btn");
    await expect(topName(page)).toHaveText("Deck Player 02");
    await answer(page, "#trust-stats-btn");
    await expect.poll(() => mocks.resolves.length).toBe(1);
    expect(mocks.resolves[0]).toMatchObject({ player_id: "00000000-0000-4000-8000-000000000101", body: { resolution: "trust_stats" } });
  });

  test("ac8 — undo inside 5 s writes nothing; after 5 s the write lands; leaving sends a held call", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(5));
    await openDeck(page);

    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#undo-bar")).toContainText("Deck Player 01");
    await expect(page.locator("#undo-bar")).toContainText("Point of Attack Defender → Proficient (Stats)");
    await page.click("#undo-bar-btn");
    await expect(topName(page)).toHaveText("Deck Player 01");
    await expect(page.locator("#deck-done-count")).toHaveText("0 / 5 done");
    await page.waitForTimeout(AFTER_UNDO_WINDOW_MS - 1_000);
    expect(mocks.resolves).toHaveLength(0);

    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#undo-btn")).toBeEnabled();
    await expect.poll(() => mocks.resolves.length, { timeout: AFTER_UNDO_WINDOW_MS }).toBe(1);
    await expect(page.locator("#undo-btn")).toBeDisabled();
    await expect(page.locator("#undo-bar")).toHaveCount(0);

    await answer(page, "#trust-claude-btn");
    await page.click("#deck-back-link");
    await expect.poll(() => mocks.resolves.length).toBe(2);
    expect(mocks.resolves[1]).toMatchObject({ player_id: "00000000-0000-4000-8000-000000000102", body: { resolution: "trust_claude" } });
    await expect(page).toHaveURL(/\/admin\/review\?skill=point_of_attack_defender$/);
  });

  test("a second answer while the card is leaving writes nothing twice", async ({ page }) => {
    // Motion on: the card takes 200 ms to leave, the window the race lives in.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const mocks = await mockDeck(page, deckOf(3));
    await openDeck(page);

    await page.click("#trust-stats-btn");
    await page.click("#tier-strip-capable", { force: true }); // inside the 200 ms exit
    await expect.poll(() => mocks.resolves.length, { timeout: AFTER_UNDO_WINDOW_MS }).toBe(1);
    await page.waitForTimeout(1_000);
    expect(mocks.resolves).toHaveLength(1);
    expect(mocks.resolves[0]).toMatchObject({
      player_id: "00000000-0000-4000-8000-000000000101",
      body: { resolution: "trust_stats" }, // the first answer wins
    });
    await expect(topName(page)).toHaveText("Deck Player 02");
  });

  test("ac8 — the hold is five seconds: nothing at 4.9 s, the write at 5.1 s", async ({ page }) => {
    await page.clock.install();
    const mocks = await mockDeck(page, deckOf(3));
    await openDeck(page);

    await page.click("#trust-stats-btn");
    await expect(topName(page)).toHaveText("Deck Player 02");
    await page.clock.runFor(4_900);
    expect(mocks.resolves).toHaveLength(0);
    await page.clock.runFor(200);
    await expect.poll(() => mocks.resolves.length).toBe(1);
  });

  test("ac8 — hiding the page or leaving it sends the held call at once", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(4));
    await openDeck(page);

    await answer(page, "#trust-stats-btn");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => mocks.resolves.length, { timeout: 1_000 }).toBe(1);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    });
    await answer(page, "#trust-claude-btn");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await expect.poll(() => mocks.resolves.length, { timeout: 1_000 }).toBe(2);
    expect(mocks.resolves[1]).toMatchObject({ body: { resolution: "trust_claude", flag_id: "flag-02" } });
  });

  test("ac9 — a flag replaced after the deck loaded writes nothing and offers a reload", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(3));
    await openDeck(page);

    mocks.failNext = { status: 409, error: "flag_changed" };
    await answer(page, "#trust-stats-btn");
    await answer(page, "#trust-stats-btn"); // sends Player 01's held call; the server refuses it
    await expect(page.locator("#deck-error")).toContainText("Deck Player 01: This flag was resolved or replaced after the deck loaded");
    await expect(page.locator("#deck-error-reload-btn")).toBeVisible();
    await expect(page.locator("#deck-done-count")).toHaveText("1 / 2 done");
  });

  test("ac9 — a save that fails after leaving the deck shows on the review queue", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(3));
    await openDeck(page);

    mocks.failNext = { status: 500, error: "Internal server error" };
    await answer(page, "#trust-stats-btn");
    await page.click("#deck-back-link"); // the held call goes out as the deck closes, and fails
    await expect(page).toHaveURL(/\/admin\/review\?skill=/);
    await expect(page.locator("#review-deck-unsaved")).toContainText("Deck Player 01");
    await expect(page.locator("#review-deck-unsaved")).toContainText("did not save");
  });

  test("ac9 — a failed save brings the card back and says why", async ({ page }) => {
    const mocks = await mockDeck(page, deckOf(4));
    await openDeck(page);

    mocks.failNext = { status: 409, error: "No Claude tier for 'point_of_attack_defender' — use Trust Stats or Override" };
    await answer(page, "#trust-claude-btn");
    await answer(page, "#trust-stats-btn"); // sends the Claude call now; it fails
    await expect(page.locator("#deck-error")).toContainText("Deck Player 01: Claude has no tier for this Skill.");
    await expect(topName(page)).toHaveText("Deck Player 01");

    await page.waitForTimeout(600); // a returned card holds taps for 500 ms
    mocks.failNext = { status: 404, error: "No unresolved flag found for skill 'point_of_attack_defender' on player x" };
    await answer(page, "#trust-stats-btn"); // sends Player 02's held call; it fails with 404
    await expect(page.locator("#deck-error")).toContainText("Deck Player 02: This flag was already resolved somewhere else");
    await expect(page.locator("#deck-done-count")).toHaveText("1 / 3 done");

    mocks.failNext = { status: 409, error: "no_open_draft" };
    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#deck-error")).toContainText("No draft is open, so nothing can be resolved right now.");

    mocks.failNext = { status: 400, error: "'resolution' must be one of: manual_override, trust_claude, trust_stats" };
    await page.waitForTimeout(600); // a returned card holds taps for 500 ms
    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#deck-error")).toContainText("It did not save: 'resolution' must be one of");
    await page.click("#deck-error-dismiss-btn");
    await expect(page.locator("#deck-error")).toHaveCount(0);
  });

  test("ac10 — rounds of 20, the deck end, and the no-Skill page", async ({ page }) => {
    await mockDeck(page, deckOf(22));
    await openDeck(page);

    await answer(page, "#skip-btn");
    for (let i = 0; i < 20; i++) await answer(page, "#trust-stats-btn");
    const roundEnd = page.locator("#round-end-card");
    await expect(roundEnd).toBeVisible();
    await expect(roundEnd).toContainText("Round 1 done");
    await expect(roundEnd).toContainText("20 flags settled · 2 left in this deck");
    await expect(page.locator("#round-end-split")).toContainText("Stats");
    await expect(page.locator("#review-skipped-btn")).toHaveText("Review 1 skipped");
    await page.screenshot({ path: "test-results/review-deck-ac10-round-end.png" });

    await page.click("#next-round-btn");
    await expect(page.locator("#deck-round")).toHaveText("Round 2 · card 1 of 20");
    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#deck-empty")).toContainText("1 skipped left");
    await page.click("#review-skipped-btn");
    await expect(topName(page)).toHaveText("Deck Player 01");
    await answer(page, "#trust-stats-btn");
    await expect(page.locator("#deck-empty")).toContainText("Point of Attack Defender is clear");

    await page.goto(`${E2E_BASE_URL}/admin/review/deck`, { waitUntil: "networkidle" });
    await expect(page.locator("#deck-no-skill")).toContainText("Pick a Skill to start a deck");
  });

  test("ac11 — the review queue links a Skill-filtered list to its deck", async ({ page }) => {
    await mockDeck(page, deckOf(3));
    await page.goto(`${E2E_BASE_URL}/admin/review`, { waitUntil: "networkidle" });
    await expect(page.locator("#review-open-deck-link")).toHaveCount(0);

    await page.selectOption("#review-skill-select", SKILL);
    await page.click("#review-filter-btn");
    const link = page.locator("#review-open-deck-link");
    await expect(link).toHaveText(/Swipe the Point of Attack Defender deck/);
    await expect(link).toHaveAttribute("href", `/admin/review/deck?skill=${SKILL}`);
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("#166 swipe deck — recorded clip (ac13)", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("ac13 — swipes, an undo, a flip and a round end, in motion", async ({ browser }) => {
    test.setTimeout(90_000); // deliberate pauses so a person can follow the clip
    const context = await browser.newContext({
      storageState: E2E_ADMIN_STATE,
      viewport: { width: 390, height: 844 },
      recordVideo: {
        dir: "test-results/review-deck-clip",
        size: { width: 390, height: 844 },
        // top-left: at 390px a top-right action label runs off the frame
        showActions: { duration: 500, position: "top-left", fontSize: 16 },
      },
    });
    const page = await context.newPage();
    await mockDeck(page, deckOf(22)); // one skip + 20 calls leaves a card, so the round ends, not the deck
    await openDeck(page);
    await page.waitForTimeout(600);

    const slowDrag = async (dx: number, dy: number) => {
      const box = (await page.locator("#flag-card").boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 24; i++) {
        await page.mouse.move(x + (dx * i) / 24, y + (dy * i) / 24);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      await page.waitForTimeout(700);
    };

    await slowDrag(-230, 0);
    await slowDrag(230, 0);
    await page.click("#undo-bar-btn");
    await page.waitForTimeout(900);
    await page.locator("#card-tiers").click();
    await page.waitForTimeout(1_200);
    await page.locator("#flag-card-back p").first().click();
    await page.waitForTimeout(500);
    await slowDrag(0, -320);
    // One tap per card: a card ignores taps while it leaves (200 ms), which is
    // what stops a double tap from answering two cards.
    for (let i = 0; i < 19; i++) {
      await page.click("#trust-stats-btn");
      await page.waitForTimeout(300);
    }
    await expect(page.locator("#round-end-card")).toBeVisible();
    await page.waitForTimeout(1_500);
    await context.close(); // finalizes the .webm
    const video = page.video();
    if (video) {
      const raw = await video.path();
      await video.saveAs("test-results/review-deck-clip/ac13-swipe-feel.webm");
      await rm(raw, { force: true }); // saveAs copies; drop the hash-named twin
    }
  });
});

test.describe("#166 swipe deck on real dev data (ac14, read only)", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.skip(!/cornerstone-dev\.hestia\.chrooks\.com/.test(E2E_BASE_URL), "real data lives on the dev Surface only");
  test.use({ storageState: E2E_ADMIN_STATE, viewport: { width: 390, height: 844 } });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("ac14 — real cards and real threshold rows load; every write is blocked", async ({ page }) => {
    const blocked: string[] = [];
    await page.route("**/api/**", (route) => {
      if (route.request().method() === "GET") return route.continue();
      blocked.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort();
    });

    await openDeck(page);
    await expect(topName(page)).not.toBeEmpty();
    await expect(page.locator("#deck-done-count")).toHaveText(/^0 \/ \d+ done$/);
    await expect(page.locator("#card-thresholds tbody tr, #card-thresholds p:has-text('No threshold rows')").first()).toBeVisible({ timeout: 15_000 });
    if (await page.locator("#card-lock-note").count()) {
      await expect(page.locator("#card-lock-note")).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: "test-results/review-deck-ac14-real.png" });
    expect(blocked).toEqual([]);
  });
});
