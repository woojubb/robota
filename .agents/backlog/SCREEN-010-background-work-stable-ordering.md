---
title: 'SCREEN-010: Background work list keeps reordering — give it a stable order'
status: in-progress
created: 2026-06-30
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-transport-tui
depends_on: []
---

# Background work list keeps reordering

The "Background work" panel re-sorts on every activity tick, so rows jump around constantly
while tasks run and the list is hard to read or point at.

## What

`createExecutionWorkspaceSnapshot` (`execution-workspace-projection.ts`) sorts background tasks via
`sortTasks`, which orders by `lastActivityAt` **descending**. Every time a running agent emits
activity its `lastActivityAt` updates and it jumps to the top — so the order churns on every frame.

Fix: order background tasks by a **stable key that does not change as the task runs** — the task's
creation/start order (ascending `startedAt`, falling back to `updatedAt`/insertion order for tasks
without `startedAt`). Once a task appears it keeps its slot; new tasks append. Terminal/collapsed
visibility rules are unchanged. The same stable order should drive both the inline panel and the
switcher so they never disagree.

## Test Plan

- Unit test on the projection: given tasks whose `lastActivityAt` changes across snapshots, the
  emitted `entries` order is invariant (keyed on creation order), and a newly added task appends
  last rather than jumping to the top.
- typecheck / lint / `pnpm --filter @robota-sdk/agent-framework test` green.

## User Execution Test Scenarios

- Prereq: built CLI; a session that can spawn ≥3 background agents (e.g. a parallel command).
- Steps: run `robota`, kick off ≥3 background agents, watch the "Background work" panel for ~20s
  while they stream activity.
- Expected: after the rows first appear, their top-to-bottom order stays stable as they run (no
  reshuffling on each activity tick); only newly spawned tasks appear, appended at the end.
- Evidence: Engineering — `execution-workspace-projection.test.ts` › "orders background tasks by
  startedAt, not by lastActivityAt" passes: the entry order is invariant when `lastActivityAt` is
  reshuffled across snapshots. Live-TUI confirmation (watch ≥3 streaming agents ~20s) pending a user run.
