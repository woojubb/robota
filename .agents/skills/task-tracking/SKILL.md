---
name: task-tracking
description: Track work using task files in .agents/tasks/. Use when starting, progressing, or completing a task to maintain a persistent record of work.
---

# Task Tracking

## Rule Anchor

- [backlog-execution.md](../../rules/backlog-execution.md) — Completion Steps and Status Invariants
- [`.agents/tasks/README.md`](../../tasks/README.md) — Task schema and lifecycle vocabulary
- [issue-to-backlog](../issue-to-backlog/SKILL.md) — GitHub Issue → Task conversion and cause grouping

## Use This Skill When

- Starting a new task or feature that involves multiple steps.
- Resuming work from a previous session.
- Completing a task and archiving the record.
- Converting a GitHub issue into executable Task document(s).

## Directory Structure

```
.agents/tasks/
├── <task-name>.md          # Active tasks
└── completed/
    └── <task-name>.md      # Completed/archived tasks
```

## Task File Format

Use the canonical schema in [`.agents/tasks/README.md`](../../tasks/README.md). Do not reproduce a
second frontmatter or body template here. A Task converted from a GitHub issue must cite the issue URL.

Before creating a Task, classify the source request by cause and independent verification. A single
feature may remain one Task across several packages. If one issue contains several related causes, create
a parent `AGREEMENT` Task and its paired spec-doc, then connect the child Tasks to it.

## Execution Steps

### Starting a Task

1. If the work originated as a GitHub issue, run [issue-to-backlog](../issue-to-backlog/SKILL.md)
   before creating Task files. Do not close the issue or start implementation during conversion.
2. Create `.agents/tasks/<task-name>.md` using the canonical schema in `tasks/README.md`.
   - Use a descriptive kebab-case name: `agents-test-coverage`, `runtime-refactor`, `harness-cleanup`.
   - Set the status required by the schema and cite the source issue when applicable.
   - Write one cause, its independent completion outcome, and the initial plan.

3. If the task requires a branch, follow the `branch-guard` skill.

### During a Task

4. Update the Task's progress and decisions according to the canonical schema and execution rules.

### Completing a Task

5. Set frontmatter status to the correct terminal value and add `completed: YYYY-MM-DD`.
6. Move the file to `completed/` with `git mv`:
   ```bash
   git mv .agents/tasks/<task-name>.md .agents/tasks/completed/<task-name>.md
   ```
7. Update every declaring AGREEMENT Task `## Children` row and paired spec `## Tasks` row.
8. Commit the status, move, and parent projections **in the same commit as the work it tracks**.

### Archival Timing (when exactly to move) — enforced

A task file is terminal and must be archived when its YAML frontmatter status is `done`, `wontfix`,
`skipped`, or `superseded`. Body prose and checkbox state never declare lifecycle. Every terminal
status requires `completed: YYYY-MM-DD`.

Archive in the **same commit** that completes the work. This is enforced by the
`task-archival` harness scan (`pnpm harness:scan:task-archival`, part of
`pnpm harness:scan`): a done task file left in `.agents/tasks/` fails the scan.
The SessionStart/Stop hooks flag the same files as `DONE, needs archival`.

The shared classifier is `scripts/harness/task-lifecycle.mjs`; placement, archival, and the session
hook must consume it rather than implementing their own status regex.

### Resuming a Task

9. Check `.agents/tasks/` for active Task files.
10. Read the Task file to restore context.
11. Continue from the last progress entry.

## Naming Convention

- `<scope>-<description>.md` — e.g., `agents-test-coverage.md`, `harness-spec-expansion.md`
- Keep names short but descriptive.
- No date prefix needed — the Created field inside the file tracks this.

## Stop Conditions

- Do not create task files for trivial, single-step changes (e.g., fixing a typo).
- Do not create one Task per package, file, adapter, or test suite when they serve one cause.
- Do not create a Task directly from a broad parent issue without first classifying its causes.
- Do not create a new GitHub issue solely for internal implementation sequencing.
- Do not leave completed tasks in the active directory.

## Checklist

- [ ] Task file created in `.agents/tasks/`
- [ ] Objective and plan written
- [ ] Progress updated at milestones
- [ ] Status reflects current state
- [ ] Moved to `completed/` when done
- [ ] Result section filled before archiving

## Anti-Patterns

- Creating a task file but never updating it.
- Leaving completed tasks in the active directory indefinitely.
- Writing excessively detailed progress (keep it concise — milestones, not play-by-play).
- Creating task files for work that fits in a single commit.
