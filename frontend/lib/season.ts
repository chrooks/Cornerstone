/**
 * NBA season format helpers — mirrors backend/services/season.py.
 *
 * An NBA stat season is `YYYY-YY` where the two-digit tail is the first year
 * plus one, modulo 100 (e.g. `2025-26`, `1999-00`). The publish dialog validates
 * this client-side for fast Feedback; the backend re-validates at the API
 * Boundary and the publish RPC refuses a NULL/blank season as a backstop.
 */

export const SEASON_FORMAT_MESSAGE =
  "Season must be in YYYY-YY format where the tail is the first year plus one (e.g. 2025-26).";

const SEASON_RE = /^(\d{4})-(\d{2})$/;

/** Return true when `season` is a valid NBA `YYYY-YY` string. */
export function isValidNbaSeason(season: string): boolean {
  const match = SEASON_RE.exec(season);
  if (!match) return false;
  const head = Number(match[1]);
  const tail = Number(match[2]);
  return tail === (head + 1) % 100;
}
