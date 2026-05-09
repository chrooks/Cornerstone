<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: Create `/vocabulary` Skill

## Context

Forked from a Cornerstone design session where domain vocabulary management became a recurring need. The project's `CONTEXT.md` file serves as the source-of-truth glossary for shared terminology between human and agent. Currently, glossary updates require manually editing the file. This skill automates that.

The user's `~/.claude/CLAUDE.md` already instructs agents to treat `CONTEXT.md` as the vocabulary contract, use terms strictly, and define them in conversation. This skill closes the loop by making glossary maintenance a first-class operation.

## What to Build

A skill at `~/.claude/skills/vocabulary/SKILL.md` with three sub-commands:

### `/vocabulary <term>`
Add or update a glossary entry in the project's `CONTEXT.md` file.

- If the term already exists in the `## Language` section, update its definition in place.
- If the term does not exist, append it to the `## Language` section.
- Prompt the user for the definition and _Avoid_ line if not provided inline.
- Use the existing entry format (see Technical Context below).

### `/vocabulary list`
List all terms currently defined in the `## Language` section of `CONTEXT.md`.

- Display as a compact list: bold term name + first sentence of definition.
- Include count of total terms.

### `/vocabulary remove <term>`
Remove a term from the glossary. Alias: `/vocabulary delete <term>`.

- Remove the full entry block (term name, definition, _Avoid_ line).
- Confirm removal before executing.
- Warn if the term is referenced in the `## Relationships`, `## Example dialogue`, or `## Flagged ambiguities` sections.

### Passive Recognition

When the user writes CamelCase or PascalCase nouns in conversation (e.g., `PlayerPool`, `RookieDeal`, `SalaryCap`), the agent should:

1. Check if the term exists in the glossary.
2. If it does, use it correctly per the glossary definition.
3. If it does NOT exist, offer to define it: _"PlayerPool looks like a domain term but isn't in the glossary yet. Want me to add it?"_

This passive behavior should be documented in the skill instructions so the agent adopts it whenever the skill is loaded.

## Technical Context

### Skill location
`~/.claude/skills/vocabulary/SKILL.md`

### CONTEXT.md location
`<PROJECT_ROOT>/CONTEXT.md` (discovered via git root or cwd).

### Glossary entry format
Each entry in the `## Language` section follows this pattern:

```markdown
**TermName**:
Definition text. Can span multiple sentences.
_Avoid_: Alternate terms that should not be used
```

Entries are separated by a blank line. Terms use **bold** formatting. The _Avoid_ line is italicized and lists terms to not use when the glossary term applies.

### Relationships and other sections
The skill only modifies the `## Language` section. It does NOT touch `## Relationships`, `## Example dialogue`, `## Flagged ambiguities`, or any other section. When removing a term, it warns if the term appears in those sections so the user can clean up references manually.

### Existing project conventions
- `CONTEXT.md` is checked into version control (not gitignored).
- The user's `~/.claude/CLAUDE.md` says: _"If a `CONTEXT.md` file exists, treat it as the source-of-truth for shared vocabulary."_
- Terms are used strictly in conversation. The agent defines vocabulary words when using them until told to stop.

## Success Criteria

- `/vocabulary SalaryCap` with no existing entry prompts for a definition, then appends a correctly formatted entry to `## Language`.
- `/vocabulary SalaryCap` with an existing entry updates the definition in place without duplicating.
- `/vocabulary list` outputs all terms with a count.
- `/vocabulary remove Build` removes the Build entry and warns that it appears in `## Flagged ambiguities`.
- `/vocabulary delete Build` works identically (alias).
- Writing `ChemistryScore` in conversation (a term not in the glossary) triggers an offer to define it.
- Writing `Cornerstone` in conversation (a term already in the glossary) does not trigger an offer — the agent just uses it correctly.
- The skill never modifies sections outside `## Language`.
- If `CONTEXT.md` does not exist, the skill creates it with a minimal scaffold (`# <ProjectName>` + `## Language` section).
