/**
 * Headless proof of the #154 Signifiers (M1.26, ac24) and the #152 per-Skill
 * bulk review, scoped Claude runner and stuck-run Discard (M2.20, ac25/ac46).
 *
 * Real login to the dev-only admin test account (e2e-login.ts, plan decision f)
 * so the server-side admin gate runs for real; every /api call is mocked, so
 * nothing reaches a real backend and no write control ever touches real data.
 *
 * Run (after the deploy that carries the page changes):
 *   PLAYWRIGHT_BASE_URL=https://cornerstone-dev.hestia.chrooks.com \
 *   npx playwright test tests/review-bulk.spec.ts --reporter=line
 *
 * Against a local dev server before that deploy (the M2 build proof):
 *   PLAYWRIGHT_BASE_URL=http://localhost:3154 \
 *   npx playwright test tests/review-bulk.spec.ts --reporter=line
 * The local server must point at the SAME dev Supabase as the dev Surface, or
 * the admin login fails — the test account exists only there.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
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

/** Fulfil with the `{ success, data, error }` envelope every route returns. */
function ok(route: Route, data: unknown) {
  return route.fulfill({ json: { success: true, data, error: null } });
}

function fail(route: Route, status: number, error: string) {
  return route.fulfill({ status, json: { success: false, data: null, error } });
}

/** Block every unmocked /api call; register FIRST so it matches LAST. */
async function blockUnmockedApi(page: Page) {
  await page.route("**/api/**", (route) => fail(route, 404, "not mocked"));
}

test.describe("review page #154 Signifiers", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  /** Mock every backend call the per-player review page makes. */
  async function mockPlayerPage(page: Page): Promise<Record<string, unknown>[]> {
    const bulkBodies: Record<string, unknown>[] = [];
    await blockUnmockedApi(page);
    await page.route(`**/api/review/${PLAYER_ID}/flags**`, (route) => ok(route, DETAIL));
    // The page also loads these on mount; a 404 would log a console error.
    await page.route("**/api/players/*/stats**", (route) => ok(route, null));
    await page.route("**/api/review/queue**", (route) => ok(route, []));
    await page.route("**/api/review/bulk-resolve", (route) => {
      bulkBodies.push(route.request().postDataJSON());
      return ok(route, {
        resolved_count: 1,
        all_flags_resolved: false,
        skipped: [{ player_id: PLAYER_ID, skill_name: "rim_protector", reason: "no_claude_tier" }],
      });
    });
    return bulkBodies;
  }

  test("Trust All Claude names the stats-only flag it leaves open", async ({ page }) => {
    const bulkBodies = await mockPlayerPage(page);
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
    // M2.8 moved every caller to the list form; `player_id` is gone.
    expect(bulkBodies[0]).toMatchObject({ player_ids: [PLAYER_ID], resolution: "trust_claude" });

    await page.screenshot({ path: "test-results/review-bulk-trust-claude.png" });
    expect(consoleErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M2.20 — per-Skill bulk bar on the review queue (#152, ac25)
// ---------------------------------------------------------------------------

const FLYER_QUEUE = [
  { player_id: "00000000-0000-4000-8000-0000000000a1", player_name: "Queue Player A", team: "BOS", position: "F", unresolved_flag_count: 4, flag_reasons: ["one_tier_low_confidence"], agreement_count: 3 },
  { player_id: "00000000-0000-4000-8000-0000000000a2", player_name: "Queue Player B", team: "DEN", position: "G", unresolved_flag_count: 3, flag_reasons: ["two_tier_disagreement"], agreement_count: 2 },
];

const VERSATILE_QUEUE = [
  { player_id: "00000000-0000-4000-8000-0000000000b1", player_name: "Queue Player C", team: "OKC", position: "F", unresolved_flag_count: 2, flag_reasons: ["two_tier_disagreement"], agreement_count: 1 },
];

/** The unfiltered queue the page loads on mount — no `agreement_count` key. */
const FULL_QUEUE = [...FLYER_QUEUE, ...VERSATILE_QUEUE].map(({ agreement_count, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars

interface QueueMocks {
  /** Every body POSTed to /api/review/bulk-resolve, in order. */
  bulkBodies: Record<string, unknown>[];
  /** Set to a `[status, error]` pair to make the next bulk-resolve fail. */
  failBulkWith: { status: number; error: string } | null;
}

/**
 * Mock the review queue. `skill_name` decides which rows come back, exactly as
 * M2.3 specifies: only players with an open flag on that Skill, each carrying
 * its `agreement_count`.
 */
async function mockReviewQueue(page: Page): Promise<QueueMocks> {
  const mocks: QueueMocks = { bulkBodies: [], failBulkWith: null };
  await blockUnmockedApi(page);
  await page.route("**/api/review/queue**", (route) => {
    const skill = new URL(route.request().url()).searchParams.get("skill_name") ?? "";
    if (skill === "high_flyer") return ok(route, FLYER_QUEUE);
    if (skill === "versatile_defender") return ok(route, VERSATILE_QUEUE);
    // Any other Skill filter matches nothing — the Empty State case.
    if (skill) return ok(route, []);
    return ok(route, FULL_QUEUE);
  });
  await page.route("**/api/review/bulk-resolve", (route) => {
    mocks.bulkBodies.push(route.request().postDataJSON());
    if (mocks.failBulkWith) return fail(route, mocks.failBulkWith.status, mocks.failBulkWith.error);
    return ok(route, {
      resolved_count: 5,
      all_flags_resolved: false,
      skipped: [
        { player_id: FLYER_QUEUE[0].player_id, skill_name: "high_flyer", reason: "disagreement" },
        { player_id: FLYER_QUEUE[1].player_id, skill_name: "high_flyer", reason: "human_decision" },
      ],
    });
  });
  return mocks;
}

/** Pick a Skill in #review-skill-select and apply it through the Filter button. */
async function applySkillFilter(page: Page, skill: string) {
  await page.selectOption("#review-skill-select", skill);
  await page.click("#review-filter-btn");
}

test.describe("M2.20 — per-Skill bulk bar on the review queue", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("the bulk bar names the agreement count and sends agreements_only", async ({ page }) => {
    const mocks = await mockReviewQueue(page);
    await page.goto(`${E2E_BASE_URL}/admin/review`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/(login|unauthorized)/);

    // No Skill applied yet: no bulk bar.
    await expect(page.locator("#review-skill-bulk-actions")).toHaveCount(0);

    await applySkillFilter(page, "high_flyer");

    const bar = page.locator("#review-skill-bulk-actions");
    await expect(bar).toBeVisible();
    // 3 + 2 agreements, 4 + 3 open flags, across 2 players.
    await expect(page.locator("#review-skill-bulk-counts")).toHaveText(
      "5 agreements · 7 open flags across 2 players"
    );

    const trustClaude = page.locator("#review-skill-bulk-trust-claude-btn");
    await expect(trustClaude).toHaveText("Trust Claude for 5 Above the Rim Finishing agreements");
    await expect(trustClaude).toBeEnabled();

    let dialogMessage = "";
    page.once("dialog", (d) => {
      dialogMessage = d.message();
      return d.accept();
    });
    await trustClaude.click();

    // The confirm names the count, the Skill and the players it covers...
    await expect.poll(() => dialogMessage).toContain("5");
    expect(dialogMessage).toContain("Above the Rim Finishing");
    expect(dialogMessage).toContain("2 players");
    // ...and the consequence, which is what makes it a real decision.
    expect(dialogMessage).toContain("published composite profile");
    expect(dialogMessage).toContain("cannot be undone");

    // M2.4 request shape: a player list, the Skill, and the strict agreements flag.
    await expect.poll(() => mocks.bulkBodies.length).toBe(1);
    expect(mocks.bulkBodies[0]).toMatchObject({
      player_ids: [FLYER_QUEUE[0].player_id, FLYER_QUEUE[1].player_id],
      skill_name: "high_flyer",
      agreements_only: true,
      resolution: "trust_claude",
    });

    // The result line names what was resolved, and counts each reason it left
    // open — "2 left open (disagreements / human decisions)" cannot tell 1 from 23.
    await expect(page.locator("#review-skill-bulk-result")).toHaveText(
      "Resolved 5 · 2 left open: 1 disagreement, 1 human decision. " +
        "Those need a person — open the players below."
    );
    await page.screenshot({ path: "test-results/review-skill-bulk-bar.png" });
  });

  test("Trust Stats is absent for a defensive key", async ({ page }) => {
    await mockReviewQueue(page);
    await page.goto(`${E2E_BASE_URL}/admin/review`, { waitUntil: "networkidle" });

    // The button exists for an ordinary Skill...
    await applySkillFilter(page, "high_flyer");
    await expect(page.locator("#review-skill-bulk-trust-stats-btn")).toBeVisible();

    // ...and is gone for a NO_BULK_TRUST_STATS_SKILLS Skill (D19).
    await applySkillFilter(page, "versatile_defender");
    await expect(page.locator("#review-skill-bulk-actions")).toBeVisible();
    await expect(page.locator("#review-skill-bulk-trust-stats-btn")).toHaveCount(0);
    // Trust Claude stays, so the bar is never a dead end.
    await expect(page.locator("#review-skill-bulk-trust-claude-btn")).toBeVisible();
    // And the reason is on screen rather than implied by an absence.
    await expect(page.locator("#review-skill-bulk-defensive-note")).toBeVisible();
  });

  test("a 400 shows its text in #review-skill-bulk-error and leaves the queue alone", async ({ page }) => {
    const mocks = await mockReviewQueue(page);
    await page.goto(`${E2E_BASE_URL}/admin/review`, { waitUntil: "networkidle" });
    await applySkillFilter(page, "high_flyer");

    mocks.failBulkWith = { status: 400, error: "defensive_key_trust_stats_blocked" };
    page.once("dialog", (d) => d.accept());
    await page.locator("#review-skill-bulk-trust-stats-btn").click();

    // Error State: the bare code names no cause and no way out, so the code is
    // mapped to a sentence that does both.
    const bulkError = page.locator("#review-skill-bulk-error");
    await expect(bulkError).toBeVisible();
    await expect(bulkError).toContainText("Trust Stats is blocked on this Skill");
    await expect(bulkError).toContainText("Use Trust Claude");

    // Error State: the queue on screen is exactly what it was.
    await expect(page.locator("#review-queue-count")).toHaveText("2 players in queue");
    await expect(page.locator("#review-skill-bulk-counts")).toHaveText(
      "5 agreements · 7 open flags across 2 players"
    );
    await expect(page.locator("#review-skill-bulk-result")).toHaveCount(0);
  });

  test("a Skill with no open flags shows the Empty State", async ({ page }) => {
    await mockReviewQueue(page);
    await page.goto(`${E2E_BASE_URL}/admin/review`, { waitUntil: "networkidle" });

    await applySkillFilter(page, "rim_protector"); // mocked as an empty queue

    const empty = page.locator("#review-skill-bulk-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText("No open Rim Protector flags");
    // No bar to click when there is nothing to resolve.
    await expect(page.locator("#review-skill-bulk-actions")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// M2.20 — draft Pipeline tab: scoped Claude runner and the stuck-run Discard
// ---------------------------------------------------------------------------

const DRAFT_ID = "00000000-0000-4000-8000-0000000000d1";
const RUNNING_RUN_ID = "00000000-0000-4000-8000-0000000000e1";

const DRAFT = {
  id: DRAFT_ID,
  label: "E2E Mock Draft",
  season: "2025-26",
  status: "draft",
  is_active: false,
  published_at: null,
  created_at: "2026-09-22T00:00:00Z",
  published_with_open_flags: null,
  drift_summary: null,
  has_running_jobs: false,
};

const SUMMARY = {
  players_total: 401,
  players_changed_since_active: 0,
  players_missing_composite: 0,
  thresholds_changed: 0,
  manual_overrides_since_active: 0,
};

const VALIDATION = {
  players_missing_canonical: 0,
  missing_canonical_players: [],
  legends_missing_canonical: 0,
  players_missing_composite: 0,
  missing_composite_players: [],
  open_flags: 0,
};

const RUNNING_RUN = {
  id: RUNNING_RUN_ID,
  pipeline_name: "skill_evaluation",
  scope: "bulk",
  player_id: null,
  snapshot_release_id: DRAFT_ID,
  status: "running",
  rows_processed: 0,
  error_tail: null,
  started_at: "2026-09-22T09:00:00Z",
  finished_at: null,
  committed_at: null,
  params: null,
};

interface DraftMocks {
  /** Every body POSTed to /api/pipeline/skill-evaluation, in order. */
  runBodies: Record<string, unknown>[];
  /** Set to make the next skill-evaluation trigger fail. */
  failRunWith: { status: number; error: string } | null;
  /** Runs the Pipeline tab lists. Empty by default. */
  runs: unknown[];
  /** Number of discard calls the spec saw. */
  discards: string[];
}

/** Mock every backend call the draft workspace's Pipeline tab makes. */
async function mockDraftWorkspace(page: Page): Promise<DraftMocks> {
  const mocks: DraftMocks = { runBodies: [], failRunWith: null, runs: [], discards: [] };
  await blockUnmockedApi(page);
  await page.route("**/api/snapshots/draft", (route) => ok(route, DRAFT));
  await page.route("**/api/snapshots/active", (route) => ok(route, null));
  await page.route(`**/api/snapshots/drafts/${DRAFT_ID}/summary`, (route) => ok(route, SUMMARY));
  await page.route(`**/api/snapshots/drafts/${DRAFT_ID}/validation`, (route) => ok(route, VALIDATION));
  await page.route(`**/api/snapshots/drafts/${DRAFT_ID}/pipeline-runs`, (route) => ok(route, mocks.runs));
  // `*` stops at a path separator, so this never swallows /diff or /discard.
  await page.route("**/api/pipeline-runs/*", (route) => ok(route, RUNNING_RUN));
  await page.route("**/api/pipeline-runs/*/discard", (route) => {
    mocks.discards.push(route.request().url());
    return ok(route, { run_id: RUNNING_RUN_ID, status: "discarded" });
  });
  await page.route("**/api/pipeline/skill-evaluation", (route) => {
    mocks.runBodies.push(route.request().postDataJSON());
    if (mocks.failRunWith) return fail(route, mocks.failRunWith.status, mocks.failRunWith.error);
    return ok(route, { run_id: RUNNING_RUN_ID, status: "running" });
  });
  return mocks;
}

test.describe("M2.20 — draft Pipeline tab", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("Ask Claude is disabled until Recompute composite is checked", async ({ page }) => {
    await mockDraftWorkspace(page);
    await page.goto(`${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/(login|unauthorized)/);

    const recompute = page.locator("#skill-eval-recompute-composite");
    const withClaude = page.locator("#skill-eval-with-claude");
    await expect(recompute).toBeVisible();

    // The backend refuses with_claude without recompute_composite; the
    // disabled state says so before the click (M2.16).
    await expect(withClaude).toBeDisabled();
    await expect(withClaude).not.toBeChecked();

    await recompute.check();
    await expect(withClaude).toBeEnabled();
    await withClaude.check();
    await expect(withClaude).toBeChecked();

    // Unchecking the dependency clears the dependent box, not just its enabled state.
    await recompute.uncheck();
    await expect(withClaude).toBeDisabled();
    await expect(withClaude).not.toBeChecked();

    // The note tells Chris what each mode changes.
    await expect(page.locator("#skill-eval-layer-note")).toContainText(
      "Both modes need at least one Skill selected."
    );
  });

  test("a 400 skill_filter_required shows its text in #skill-eval-error", async ({ page }) => {
    const mocks = await mockDraftWorkspace(page);
    await page.goto(`${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline`, { waitUntil: "networkidle" });

    // Recompute with no Skill chosen — the shape M2.16 rejects.
    await page.locator("#skill-eval-recompute-composite").check();
    mocks.failRunWith = {
      status: 400,
      error: "skill_filter_required — a composite recompute or Claude run must name its Skills",
    };
    await page.locator("#pipeline-skill-eval-run-btn").click();

    const runError = page.locator("#skill-eval-error");
    await expect(runError).toBeVisible();
    await expect(runError).toHaveText(
      "skill_filter_required — a composite recompute or Claude run must name its Skills"
    );

    // The mode really did reach the request, so the 400 is about the missing Skills.
    expect(mocks.runBodies).toHaveLength(1);
    expect(mocks.runBodies[0]).toMatchObject({ recompute_composite: true });
    expect(mocks.runBodies[0]).not.toHaveProperty("skill_filter");
  });

  test("the scope summary stops promising every Skill once a mode is on", async ({ page }) => {
    await mockDraftWorkspace(page);
    await page.goto(`${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline`, { waitUntil: "networkidle" });

    const summary = page.locator("#skill-eval-scope-summary");
    // Taxonomy size is not the point and #152 changes it — assert the wording.
    await expect(summary).toContainText(/against all \d+ Skills/);
    await expect(summary).toContainText("stops at the stats layer");

    // Both modes need a Skill filter, so an empty picker is not "all Skills"
    // there — it is a run that cannot go. The layer note says so; the summary
    // must not say the opposite.
    await page.locator("#skill-eval-recompute-composite").check();
    await expect(summary).toContainText("no Skills selected");
    await expect(summary).toContainText("published composite");
  });

  test("Ask Claude confirms the spend before it runs", async ({ page }) => {
    const mocks = await mockDraftWorkspace(page);
    await page.goto(`${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline`, { waitUntil: "networkidle" });

    await page.locator("#skill-eval-recompute-composite").check();
    await page.locator("#skill-eval-with-claude").check();
    await page.locator("#skill-eval-skill-chip-versatile_defender").click();

    let dialogMessage = "";
    page.once("dialog", (d) => {
      dialogMessage = d.message();
      return d.dismiss(); // a cancel must spend nothing
    });
    await page.locator("#pipeline-skill-eval-run-btn").click();

    await expect.poll(() => dialogMessage).toContain("every qualifying Player");
    expect(dialogMessage).toContain("one Anthropic API call per Player");
    expect(mocks.runBodies).toHaveLength(0);
  });

  test("a running run offers Discard stuck run and its confirm names the risk", async ({ page }) => {
    const mocks = await mockDraftWorkspace(page);
    mocks.runs = [RUNNING_RUN];

    await page.goto(
      `${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline&run=${RUNNING_RUN_ID}`,
      { waitUntil: "networkidle" }
    );

    await expect(page.locator("#run-diff-preview-running")).toBeVisible();
    const discard = page.locator("#run-diff-preview-discard-stuck-btn");
    await expect(discard).toBeVisible();
    await expect(discard).toHaveText("Discard stuck run");

    let dialogMessage = "";
    page.once("dialog", (d) => {
      dialogMessage = d.message();
      return d.dismiss(); // Transparent Friction: a cancel must change nothing.
    });
    await discard.click();

    await expect.poll(() => dialogMessage).toContain("develop push restarted the server");
    expect(dialogMessage).toContain("throws its work away");
    // Dismissed, so nothing was discarded.
    expect(mocks.discards).toHaveLength(0);
    await expect(discard).toBeVisible();

    await page.screenshot({ path: "test-results/run-diff-discard-stuck.png" });
  });

  test("a failed discard shows the API error text", async ({ page }) => {
    const mocks = await mockDraftWorkspace(page);
    mocks.runs = [RUNNING_RUN];
    await page.route("**/api/pipeline-runs/*/discard", (route) =>
      fail(route, 409, "run_already_committed")
    );

    await page.goto(
      `${E2E_BASE_URL}/admin/snapshots/draft?tab=pipeline&run=${RUNNING_RUN_ID}`,
      { waitUntil: "networkidle" }
    );

    page.once("dialog", (d) => d.accept());
    await page.locator("#run-diff-preview-discard-stuck-btn").click();

    const stuckError = page.locator("#run-diff-preview-discard-stuck-error");
    await expect(stuckError).toBeVisible();
    await expect(stuckError).toHaveText("run_already_committed");
    // The run stays on screen so the Discard can be retried.
    await expect(page.locator("#run-diff-preview-running")).toBeVisible();
  });
});

// #165: a flag whose stored tiers differ from today's profiles — the case where
// the old card labels named one tier and the click wrote another.
const STALE_ID = "00000000-0000-4000-8000-000000000165";
const STALE_DETAIL = {
  player: { ...DETAIL.player, id: STALE_ID },
  flags: [
    { ...FLAG, id: "flag-poa", skill_name: "point_of_attack_defender", stat_rating: "Capable", claude_rating: "Capable", flag_reason: "human_decision_contradicted:resolved:Elite", has_claude_tier: true },
    { ...FLAG, id: "flag-rim2", skill_name: "rim_protector", stat_rating: "Proficient", claude_rating: "None", flag_reason: "human_decision_contradicted:resolved:Elite", has_claude_tier: false },
  ],
  profiles: {
    // Today's profiles disagree with the flag row on purpose.
    stats: { point_of_attack_defender: "Elite", rim_protector: "Elite" },
    claude: { point_of_attack_defender: "Elite", rim_protector: "Elite" },
    composite: {
      point_of_attack_defender: { final_tier: "Elite", stat_tier: "Elite", claude_tier: "Elite", source: "resolved", flagged: false },
      rim_protector: { final_tier: "Elite", stat_tier: "Elite", claude_tier: null, source: "resolved", flagged: false },
    },
  },
};

test.describe("review page #165 Trust labels name what the click writes", () => {
  test.skip(!hasE2eLogin(), E2E_LOGIN_MISSING);
  test.use({ storageState: E2E_ADMIN_STATE });

  test.beforeAll(async ({ browser }) => {
    await loginAsE2eAdmin(browser);
  });

  test("labels read the flag row, not today's profiles", async ({ page }) => {
    const resolveBodies: Record<string, unknown>[] = [];
    await blockUnmockedApi(page);
    await page.route(`**/api/review/${STALE_ID}/flags**`, (route) => ok(route, STALE_DETAIL));
    await page.route("**/api/players/*/stats**", (route) => ok(route, null));
    await page.route("**/api/review/queue**", (route) => ok(route, []));
    await page.route(`**/api/review/${STALE_ID}/resolve`, (route) => {
      resolveBodies.push(route.request().postDataJSON());
      return ok(route, { flag_id: "flag-poa", resolved_tier: "Capable", all_flags_resolved: false });
    });

    await page.goto(`${E2E_BASE_URL}/admin/review/${STALE_ID}`, { waitUntil: "networkidle" });
    expect(new URL(page.url()).pathname).not.toMatch(/^\/(login|unauthorized)/);

    // The server writes flag.stat_rating / flag.claude_rating — the labels must say so.
    await expect(page.locator("#review-flag-point_of_attack_defender-trust-stats-btn")).toHaveText("Trust Stats (Capable)");
    await expect(page.locator("#review-flag-point_of_attack_defender-trust-claude-btn")).toHaveText("Trust Claude (Capable)");
    await expect(page.locator("#review-flag-rim_protector-trust-stats-btn")).toHaveText("Trust Stats (Proficient)");
    // No Claude tier the server would accept (#154) → no Trust Claude button.
    await expect(page.locator("#review-flag-rim_protector-trust-claude-btn")).toHaveCount(0);

    await page.locator("#review-flag-point_of_attack_defender-trust-stats-btn").click();
    await expect.poll(() => resolveBodies.length).toBe(1);
    expect(resolveBodies[0]).toMatchObject({ skill_name: "point_of_attack_defender", resolution: "trust_stats" });
  });
});
