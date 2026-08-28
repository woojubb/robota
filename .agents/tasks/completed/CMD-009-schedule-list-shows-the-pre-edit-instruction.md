---
title: 'CMD-009: after `/schedule edit` changes the instruction, `/schedule list` keeps showing the old one'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2448#issuecomment-5456241485
created: 2026-08-16
priority: low
urgency: later
area: packages/agent-command, packages/agent-executor
depends_on: []
---

# CMD-009: the schedule list label is not re-derived after an edit

## Problem

`/schedule edit <id> <spec>` accepts a new `agentInstruction` and applies it — `get-background-tasks`
reports the new value — but `/schedule list` continues to render the **pre-edit** instruction in its
description string. A user who edits the instruction and lists to confirm sees their old text and has no
way to tell from that surface whether the edit took.

## Evidence

Observed twice, independently, while gating ARCH-025 (2026-08-16) — once by the scenario author and once
by the `DONE-GATE-STAGE-2` guard re-running the scenario. Same run, two frames:

```
- process_1 [sleeping] 30 18 * * * — Scheduled: run the daily report (next 2026-08-16T09:30:00.000Z)
{"cronExpression":"30 18 * * *","agentInstruction":"run the evening report"}
```

The cron cadence updates in the list line (`30 18 * * *`), so the list IS re-read after the edit; only the
description string is stale. That narrows it: the label is captured at creation rather than derived from
the task's current `agentInstruction`.

## What

Derive the list line's description from the task's current instruction rather than from a value captured
when the schedule was created, so the two frames cannot disagree. Check whether the same capture affects
any other rendered field.

## Test Plan

- Red-first: create a schedule, edit its instruction, assert the list line contains the NEW text.
- Assert the list line and `get-background-tasks` agree on the instruction after an edit.

## User Execution Test Scenarios

To be authored before implementation. The surface is credential-free and already proven executable —
`packages/agent-command/src/schedule/schedule-command.ts` over the `robota --serve` loopback WS command
frame, exactly as ARCH-025's S1 drives it (see that item's command block for a working driver).

## Plan

- [ ] Locate where the list description is captured rather than derived.
- [ ] Derive it, and check the sibling rendered fields for the same capture.
- [ ] Red-proved test plus a scenario over `/schedule edit` → `/schedule list`.

## Blockers

- None.

## Result

Pending.
