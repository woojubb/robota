---
title: 'PROC-020: Fix continuation conversion-base replay'
issue: https://github.com/woojubb/robota/issues/2514
status: in-progress
created: 2026-08-30
priority: critical
urgency: now
area: workflow harness
depends_on: [PROC-019]
---

# PROC-020: Fix continuation conversion-base replay

## Objective

Make a valid later-PR continuation checkpoint replay the immutable conversion receipt against its
original base instead of the later branch merge base, without permitting Task or receipt changes.
After the fix is delivered here, remove the scanner source from PROC-017's remaining continuation
artifact list so its final closeout checkpoint binds only artifacts still to be delivered.

## Plan

- [ ] TC-01: Add a failing continuation fixture with conversion evidence whose original base differs
      from the later branch base, then make it pass.
- [ ] TC-02: Keep replay fail-closed when the Task or recorded conversion base changes.
- [ ] TC-03: Restore PROC-017's remaining continuation declaration to the exact six undelivered paths.
- [ ] TC-04: Run focused tests, affected scans, and contract verification.

## Test Plan

- Extend `scan-user-execution-plan-order.test.mjs` with real temporary Git history covering the
  first checkpoint merge, later base, and continuation checkpoint.
- Run focused Vitest, affected scans, and the repository contract tier.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this is repository-internal planning enforcement with no CLI, TUI, browser,
SDK, configuration, or product behavior.
