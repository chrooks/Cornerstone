#!/usr/bin/env bash
# One runnable check for inbox-nudge-session-start.sh: empty inbox is silent; a memo pair counts once. A crash fails.
set -euo pipefail
HOOK="$(cd "$(dirname "$0")" && pwd)/inbox-nudge-session-start.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir "$T/inbox"; echo "# Inbox" > "$T/inbox/README.md"
out="$(CLAUDE_PROJECT_DIR="$T" bash "$HOOK")"; [ -z "$out" ] || { echo "FAIL: empty inbox not silent"; exit 1; }; echo "empty inbox: silent"
touch "$T/inbox/Vermella Way 23.m4a" "$T/inbox/Vermella Way 23.txt" "$T/inbox/whiteboard-2026-09-16.jpg"
out="$(CLAUDE_PROJECT_DIR="$T" bash "$HOOK")"; grep -q "2 unprocessed capture(s)" <<<"$out" || { echo "FAIL: expected 2 captures"; exit 1; }; echo "memo pair + photo: counts 2"
