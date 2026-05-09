<!-- /fork hybrid handoff — read referenced files for full depth -->
<!-- CONTEXT: CONTEXT.md -->

# Handoff: Create `/explain` Skill

## Context

Forked from a Cornerstone design session where a three-layer explanation format emerged organically during domain concept communication. When explaining NBA evaluation concepts (lineup combinations, skill taxonomies, cohesion composites), a pattern of **human language + visual analogy + caveman diagram** consistently produced the clearest understanding in the shortest time.

The format proved effective enough to warrant extracting into a reusable skill that works across any project, not just Cornerstone.

## What to Build

A skill at `~/.claude/skills/explain/SKILL.md` that explains any concept in three layers:

### Output Format

```
## [Concept], explained

[1-2 paragraph human-readable explanation]

### Analogy
[Relatable comparison]

### Caveman
[ASCII diagram / terse illustration]
```

### Layer Definitions

1. **Human language** — concise, easily digestible explanation in plain English. 1-2 paragraphs max. No jargon unless the concept itself is technical, in which case define terms inline.

2. **Visual analogy** — a relatable analogy that maps the concept to something familiar. Should create an "aha" moment. The analogy must be structurally accurate, not just superficially similar.

3. **Caveman illustration** — a terse ASCII/text diagram using the caveman communication style:
   - Fragments OK, drop articles (a/an/the)
   - Technical terms stay exact
   - Tree diagrams with `├──` and `└──`
   - Box diagrams with `┌─┐ │ │ └─┘`
   - Arrow flows with `──▶` and `──┤`
   - Terse labels, no fluff
   - Should compress the concept into something scannable in 5 seconds

### Invocation

`/explain <concept>`

The concept can be:
- A domain term from the current project's `CONTEXT.md`
- A general programming/architecture concept
- A library or framework pattern
- Any abstract idea that benefits from multi-layer explanation

## Example Output

For `/explain Team hierarchy`:

```
## Team hierarchy, explained

In professional basketball, a team is organized into nested layers. The franchise
is the top-level business entity. Under it sits a single roster of up to 15 players.
Within that roster, a coaching staff assembles lineups — specific 5-player groups
that take the court together. Lineups are the atomic unit of on-court play; everything
above them is organizational scaffolding.

### Analogy
A team is like a restaurant. The franchise is the restaurant brand (ownership, branding,
market). The roster is the full kitchen staff — everyone employed. A lineup is the
specific crew working a single dinner service: head chef, sous chef, line cooks, prep,
expeditor. The restaurant can shuffle who works which shift, but exactly 5 people are
always on the line during service.

### Caveman
Franchise
├── Roster (≤15 players)
│   ├── Lineup A (5 on court)
│   │   ├── PG ──▶ runs offense
│   │   ├── SG ──▶ perimeter scoring
│   │   ├── SF ──▶ two-way wing
│   │   ├── PF ──▶ interior/stretch
│   │   └── C  ──▶ rim protection
│   ├── Lineup B (5 on court)
│   └── Lineup C (5 on court)
└── Coaching Staff
    └── decides which lineup when
```

## Technical Context

- User's skills live at `~/.claude/skills/`
- Existing skill examples: `/impeccable`, `/fork`, `/handoff`, `/note`, `/commit`
- Skill format: `SKILL.md` file with instructions for Claude Code
- User has ECC (Everything Claude Code) skills installed
- Caveman style is already defined in `~/.claude/rules/caveman-activate.md` — the Caveman layer should follow those conventions
- If the current project has a `CONTEXT.md`, the skill should check it for domain-specific definitions of the requested concept

### Skill Behavior Notes

- No confirmation prompts. User types `/explain X`, gets the three layers immediately.
- If the concept is ambiguous, pick the most likely interpretation in context and note alternatives at the bottom.
- Keep total output under ~40 lines. Brevity is the point.
- The Caveman layer is the differentiator — it should feel like a cheat sheet you'd tape to your monitor.

## Relevant Files

- `~/.claude/skills/` — where the skill should be created (`explain/SKILL.md`)
- `~/.claude/rules/caveman-activate.md` — caveman communication style reference
- `~/.claude/CLAUDE.md` — global instructions (for skill conventions)
- Any existing skill's `SKILL.md` — for structural reference

## Success Criteria

- `/explain <concept>` produces all three layers in the specified format
- Human layer is readable by a non-technical person
- Analogy is structurally accurate, not just a surface-level metaphor
- Caveman layer uses tree/box/arrow ASCII art and drops all filler
- Total output stays under ~40 lines
- Works for domain concepts (with `CONTEXT.md` awareness) and general concepts alike
- No interactive prompts — single invocation, immediate output
