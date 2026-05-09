<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: Create `/note` Skill

## Context

User wants a new Claude Code skill called `/note` that maintains a running scratchpad of quick notes in a `.md` file. The notes live with the conversation and act as a persistent reminder list at the edge of the context window.

This was forked from a session focused on redesigning the Cornerstone landing page using the `/impeccable` skill. The `/note` idea came up mid-session as the user realized they wanted a lightweight way to jot down things to come back to.

## What to Build

A skill at `~/.claude/skills/note/SKILL.md` (or appropriate location) that:

### Core Behavior
- **Invocation**: `/note <text>` appends `- <text>` to a running list in a `.md` file
- **Storage**: A single `.md` file per project (e.g., `.claude/notes.md` or `.cowork/notes.md` — decide on convention)
- **Format**: Simple `- ` prefixed bullet list, newest entries appended
- **Read on load**: The note file should be read into context at session start (or on first `/note` invocation) so the agent is aware of outstanding items
- **Persistence**: Notes survive across conversation turns. They are project-scoped, not global.

### Key Design Questions to Resolve
1. **Where does the file live?** Options: `.claude/notes.md`, `.cowork/notes.md`, project root `NOTES.md`. Consider: should it be gitignored? Is it project-scoped or conversation-scoped?
2. **Ordering**: Append (chronological) or prepend (most recent first)?  User said "most recent part of memory" — suggests prepend so newest is at top.
3. **Clearing/completing notes**: Should there be `/note done <index>` or `/note clear`? Or is deletion manual?
4. **Auto-display**: Should the note list be shown at session start? On every `/note` call? As a periodic reminder?
5. **Timestamps**: Include timestamps on each note? Date only? None?

### User's Mental Model
> "Think of it like a little todo notification at the top (or bottom, whatever the most recent part of your memory is) of your context window you know you have to get to when you get time to."

Key insight: this is NOT a task tracker. It's a scratchpad. Quick jots. "Remember to fix X." "Ask about Y." "Come back to Z." The UX should be zero-friction: type `/note thing`, done.

### Suggested Sub-commands
- `/note <text>` — add a note
- `/note` (no args) — show all notes
- `/note done <number>` — strike/remove a note
- `/note clear` — clear all notes

## Technical Context

- User's skills live at `~/.claude/skills/`
- Existing skill examples: `/impeccable`, `/fork`, `/handoff`, `/commit`
- Skill format: `SKILL.md` file with frontmatter and instructions
- User has ECC (Everything Claude Code) skills installed
- Project uses Claude Code CLI

## Relevant Files
- `~/.claude/skills/` — where the skill should be created
- `~/.claude/CLAUDE.md` — global instructions (for reference on skill conventions)
- Any existing skill's `SKILL.md` — for structural reference

## Implementation Insight: Context Window Positioning

LLM context window = stack. System prompt at top (loaded first), recent turns at bottom (strongest attention). Attention is U-shaped: top + bottom strongest, middle weakest ("lost in middle" problem).

For `/note` to stay in the attention hotspot, notes file should be **re-read near the bottom of context** (appended to recent turns), not just loaded once at system prompt time. Consider re-reading the notes file on each `/note` invocation or periodically, so it stays in the recency attention zone.

```
┌───────────────────────┐
│ SYSTEM PROMPT         │ ← oldest, loaded first
│ MEMORY FILES          │ ← loaded at session start
│ ...older turns...     │ ← middle = weakest recall
│ RECENT TURNS          │
│ ██ ATTENTION HOTSPOT ██│ ← freshest, strongest signal
└───────────────────────┘
```

## Success Criteria
- `/note buy milk` appends `- buy milk` to the notes file
- `/note` with no args displays the current list
- Notes persist across turns in the same session
- Notes are readable by future sessions working in the same project
- Zero friction — no confirmation prompts, no verbose output
