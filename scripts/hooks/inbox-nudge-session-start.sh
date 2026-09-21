#!/usr/bin/env bash
# SessionStart hook: the trigger for instant capture. If inbox/ holds unprocessed
# captures, say so, so the session processes them first. Silent when empty.
# A memo's audio and its transcript share a stem and count as one capture.
set -euo pipefail
INBOX="${CLAUDE_PROJECT_DIR:-$PWD}/inbox"
[ -d "$INBOX" ] || exit 0
stems="$(ls -1 "$INBOX" | grep -v '^README\.md$' | sed 's/\.[^.]*$//' | sort -u || true)"
[ -n "$stems" ] || exit 0
n="$(printf '%s\n' "$stems" | wc -l | tr -d ' ')"
names="$(printf '%s\n' "$stems" | paste -sd ',' - | sed 's/,/, /g')"
echo "Inbox nudge: $n unprocessed capture(s) in inbox/ — $names. Chronicle them before anything else: transcript (whisper) or image read → Beats into the Canon (decisions.md / learning-log.md lines, checklist ticks, follow-ups) → one commit → move the capture to archive/. No read-back, no approval; git is the undo. Then report one Feedback line: 'Logged N ticks, M lines, committed <sha>.' Client data in a capture goes to that client's repo, never here; an idea goes to the user's knowledge base only with approval."
