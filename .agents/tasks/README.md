# Agent Tasks

This directory tracks active and completed agent tasks.

## Status — REVIVED, not retired (HARNESS-063, 2026-08-01)

Measured on 2026-08-01: the active half held **0 documents** against **422** under `completed/`, and
`check-task-archival` therefore examined nothing on every run. That is what put the tree up for a
verdict — revive it with a stated purpose, or retire it together with its scan.

**The verdict is revive.** PROC-006 decided that a unit of work is named a **Task**, and that this
tree becomes its one home; retiring it here would delete the destination that decision depends on.
Until PROC-006 performs the move, the tree is empty of live documents by circumstance rather than by
policy, and `check-task-archival` keeps running — it reports its examined count, so a zero reads as a
zero rather than as a clean sweep.

The purpose, stated: **`.agents/tasks/` holds the live record of a unit of work.** A document belongs
here while the work is open, and under `completed/` once it is done.

## Structure

```
.agents/tasks/
├── README.md
├── <task-name>.md          # Active tasks
└── completed/
    └── <task-name>.md      # Completed/archived tasks
```

## Workflow

1. Create a task file when starting a new piece of work.
2. Update the task file as work progresses.
3. Move to `completed/` when done.

See `.agents/skills/task-tracking/SKILL.md` for the full workflow.
