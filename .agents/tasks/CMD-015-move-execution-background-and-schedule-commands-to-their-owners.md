---
title: 'CMD-015: move execution, background, and schedule commands to their owners'
issue: https://github.com/woojubb/robota/issues/2121
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: execution, background, and schedule command slices
depends_on: [CMD-010, CMD-011]
---

# CMD-015: move execution, background, and schedule commands to their owners

## Objective

Move execution, background-task, and schedule command semantics to their owning slices as required by [issue #2121](https://github.com/woojubb/robota/issues/2121).

## Plan

- [ ] Map each command's definition, handler, policy, and presentation to one owning slice.
- [ ] Move the commands without compatibility registries or framework-owned forwarding modules.
- [ ] Preserve discovery, invocation, cancellation, and output behavior with integration tests.
- [ ] Run affected package tests, CLI scenarios, typecheck, build, and boundary scans.

## User Execution Test Scenarios

Invoke representative execution, background, and schedule commands through the product shell. Expected: discovery, validation, execution, and output match the pre-migration behavior. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
