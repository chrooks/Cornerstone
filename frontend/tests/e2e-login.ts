/**
 * Dev-only admin login for headless admin specs (plan decision f, M1.26).
 *
 * The admin gate runs on the server (middleware.ts asks the Supabase auth
 * server; admin/layout.tsx reads user_roles), so a faked browser session
 * cannot open /admin. This logs in once through /login with the dev-only test
 * account from the gitignored frontend/.env.e2e.local and saves the session to
 * test-results/e2e-admin-state.json for `test.use({ storageState })`.
 *
 * The account exists only in the self-hosted dev Supabase, so the base URL
 * defaults to the dev Surface. Specs mock data routes; never click a write
 * control on real data with this login.
 */

import fs from "node:fs";
import path from "node:path";
import type { Browser } from "@playwright/test";

export const E2E_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://cornerstone-dev.hestia.chrooks.com";
export const E2E_ADMIN_STATE = path.join(__dirname, "..", "test-results", "e2e-admin-state.json");
const ENV_FILE = path.join(__dirname, "..", ".env.e2e.local");

export const E2E_LOGIN_MISSING =
  "frontend/.env.e2e.local is missing (E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD) — create it per plan M1.0";

/** KEY=value lines of .env.e2e.local, or null when the file is absent. */
function readLogin(): { email: string; password: string } | null {
  if (!fs.existsSync(ENV_FILE)) return null;
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !line.trimStart().startsWith("#")) {
      env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  const email = env.E2E_ADMIN_EMAIL;
  const password = env.E2E_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

export function hasE2eLogin(): boolean {
  return readLogin() !== null;
}

/** Log in through /login once and save the session file. Never logs the password. */
export async function loginAsE2eAdmin(browser: Browser): Promise<string> {
  // Decision (f): this login is dev-only. Never send it to another host.
  const host = new URL(E2E_BASE_URL).hostname;
  if (!/\.hestia\.chrooks\.com$/.test(host) && host !== "localhost" && host !== "100.69.82.20") {
    throw new Error(`e2e admin login is dev-only; refusing ${E2E_BASE_URL}`);
  }
  const login = readLogin();
  if (!login) throw new Error(E2E_LOGIN_MISSING);

  // A fresh, logged-out context: the spec's test.use({ storageState }) would
  // otherwise apply here too, before the state file exists.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto(`${E2E_BASE_URL}/login?redirectTo=%2Fadmin`, { waitUntil: "networkidle" });
    await page.fill("#login-email-input", login.email);
    await page.fill("#login-password-input", login.password);
    await page.click("#login-submit-btn");
    await Promise.race([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
      page.locator("#login-error").waitFor({ timeout: 15_000 }),
    ]);
    if (await page.locator("#login-error").count()) {
      throw new Error(`e2e admin login failed: ${await page.locator("#login-error").innerText()}`);
    }
    fs.mkdirSync(path.dirname(E2E_ADMIN_STATE), { recursive: true });
    await context.storageState({ path: E2E_ADMIN_STATE });
    fs.chmodSync(E2E_ADMIN_STATE, 0o600); // holds a live admin access and refresh token
    return E2E_ADMIN_STATE;
  } finally {
    await context.close();
  }
}
