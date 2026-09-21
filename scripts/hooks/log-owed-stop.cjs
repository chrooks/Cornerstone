#!/usr/bin/env node
/* Stop hook: block a session from ending with an uncommitted record.
 *
 * The chat leak: work done in a session that never reaches the ledgers.
 * Mirrors chrooked-pokedex/scripts/hooks/deploy-owed-stop.js.
 *
 * - Truth is `git status --porcelain`: modified, staged, and untracked files
 *   that are not ignored. Hand edits synced in by LiveSync count too; they are
 *   part of the record and get committed with an honest message.
 * - Yields after one block (stop_hook_active) so it cannot trap the session.
 * - Escape: Claude names the pending log in its report and says why.
 */
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

const MAX_NAMED_FILES = 12;

let input = "";
try {
  input = fs.readFileSync(0, "utf8");
} catch {
  /* no stdin — plain stop check */
}
try {
  if (JSON.parse(input).stop_hook_active === true) process.exit(0);
} catch {
  /* unparseable stdin — proceed with the check */
}

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
// Optional args: paths that count as the Canon. Default is the whole tree (a docs repo).
// A code repo passes its Canon paths so half-done code never trips the hook.
const scope = process.argv.slice(2);
let lines;
try {
  lines = execFileSync("git", ["status", "--porcelain", "--", ...scope], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
} catch {
  process.exit(0); // not a repo state we can judge — stay silent
}
if (lines.length === 0) process.exit(0);

const named = lines.slice(0, MAX_NAMED_FILES).map((l) => l.slice(3));
const more = lines.length > MAX_NAMED_FILES ? `, +${lines.length - MAX_NAMED_FILES} more` : "";
process.stdout.write(
  JSON.stringify({
    decision: "block",
    reason:
      `Log owed: ${lines.length} uncommitted file(s) in the Canon — ${named.join(", ")}${more}. ` +
      `Commit them now with a scoped add and an honest message, or — if committing is genuinely ` +
      `wrong at this moment — tell the user why and name the pending log in your report.`,
  }) + "\n",
);
process.exit(0);
