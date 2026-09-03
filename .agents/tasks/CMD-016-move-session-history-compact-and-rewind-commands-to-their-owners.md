---
title: 'CMD-016: move session, history, compact, and rewind commands to their owners'
issue: https://github.com/woojubb/robota/issues/2122
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: session lifecycle command slices
depends_on: [CMD-010, CMD-011]
---

# CMD-016: move session, history, compact, and rewind commands to their owners

## Objective

Move session, history, compact, and rewind command semantics to their owning slices as required by [issue #2122](https://github.com/woojubb/robota/issues/2122).

## Plan

- [ ] Assign every command definition and handler to its session-lifecycle owner.
- [ ] Remove framework-owned forwarding and duplicate registration paths.
- [ ] Preserve history mutation, compaction, rewind, validation, and output semantics.
- [ ] Run command integration tests, typecheck, build, and boundary scans.

## User Execution Test Scenarios

Create a session history, invoke list/compact/rewind operations, and reload the session. Expected: the same valid transitions and output occur from the new owner slices. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
