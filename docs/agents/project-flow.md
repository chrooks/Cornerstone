# Project Flow

This repository uses a project-management and development loop built around repo-local docs, GitHub issue records, milestones, Projects, and focused Skills.

## Skill Boundary

- `/project-flow-setup` configures a repository for the workflow.
- `/to-issues` creates, updates, and closes issue records.
- `/roadmap` chooses, prioritizes, sequences, and reshapes work.
- `/scope` decides whether to execute, plan, or grill.
- `/execute` implements selected ready work.
- `/verification-loop` proves the work.
- `/prep-pr` packages the final diff for review or PR.

Related repo-local docs:

- `docs/agents/project-flow.md`
- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`

## First-Time Setup

Run:

```text
/project-flow-setup
```

Bare `/project-flow-setup` audits the repository, explains missing docs or GitHub setup, asks before writing docs, asks before mutating GitHub labels, milestones, or Project fields, and ends with the next useful workflow command.

Direct setup commands:

```text
/project-flow-setup audit
/project-flow-setup docs
/project-flow-setup apply
```

## Daily Loop

Start by choosing the next ready issue record:

```text
/roadmap next
```

Then run the implementation and proof loop:

```text
/execute #issue
/verification-loop
/to-issues close #issue
```

When the diff is ready:

```text
/prep-pr
```

## Fuzzy-Work Loop

For unclear ideas or broad requests:

```text
/scope "idea or request"
```

Then route to the selected workflow:

```text
/execute
/plan
/grill-me
/to-prd
```

Once the work has a clear plan, task list, or PRD:

```text
/to-issues <source>
/roadmap next
```

## Issue Tracker Shape

Use GitHub this way:

- Issues are issue records.
- Sub-issues break parent work into Vertical Slices.
- Milestones are goal or release buckets.
- Projects are the Kanban/status/priority Surface.
- Labels are taxonomy and routing metadata.

Recommended Project fields:

```text
Status: Inbox, Backlog, Ready, In Progress, Blocked, Review, Done
Priority: P0, P1, P2, P3
Size: XS, S, M, L
Mode: AFK, HITL
```

## Operating Rules

- Use `/to-issues update` when follow-up work appears during implementation.
- Use `/to-issues close` only after verification evidence exists.
- Use `/roadmap reprioritize` or `/roadmap board` when board status, milestone fit, priority, or blockers need reshaping.
- Use `/scope` again when an issue record is too vague to execute.
