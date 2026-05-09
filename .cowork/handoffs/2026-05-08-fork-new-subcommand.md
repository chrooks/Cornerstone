<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: Update `/fork` to Auto-Copy Handoff Prompt

## Context

Forked from a Cornerstone session where the need for a clean-session handoff flow surfaced. Can't auto-exit and reopen Claude Code from within a session, so the `/fork new` concept simplified to: write the handoff, generate a continuation prompt, and copy it to clipboard via `pbcopy`. User can then `/exit` and paste into new session.

## What to Build

Update the `/fork` skill to add a clipboard-copy step after writing the handoff.

### Updated behavior (all forks, not a subcommand)

After writing the handoff and updating the index (existing Steps 8-9), add:

1. Generate a continuation prompt:
   ```
   Read the handoff at .cowork/handoffs/<date>-<slug>.md, then CONTEXT.md, PRODUCT.md, and DESIGN.md. Resume from where the previous session left off. The handoff contains full context.
   ```
2. Copy it to clipboard: `echo "<prompt>" | pbcopy`
3. Tell user: "Handoff prompt copied to clipboard. `/exit` and paste into new session."

This replaces the earlier `/fork new` subcommand idea. Every fork copies the continuation prompt. No separate subcommand needed.

### Key points

- `pbcopy` is macOS. For cross-platform, detect OS and use `xclip`/`xsel` on Linux, `clip.exe` on WSL. Fall back to displaying the prompt if no clipboard tool available.
- The prompt references actual file paths from the handoff that was just written.
- Include CONTEXT.md, PRODUCT.md, DESIGN.md in the prompt if they exist (check before including).

## Technical Context

### Skill location
`/Users/cdbrooks/Development/Software/Repositories/assistant-setup-toolkit/canonical/skills/fork/SKILL.md`

### Where to add
After Step 9 (index regeneration), before Step 10 (rich surface). Or fold into Step 10's surface output.

## Success Criteria

- `/fork some-feature` writes handoff, copies continuation prompt to clipboard, tells user it's copied
- User can `/exit`, open new session, Cmd+V, Enter — new session has full context
- If `pbcopy` unavailable, falls back to displaying the prompt in a fenced code block
