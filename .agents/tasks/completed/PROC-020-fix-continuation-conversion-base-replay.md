---
title: 'PROC-020: Fix continuation conversion-base replay'
issue: https://github.com/woojubb/robota/issues/2514
status: done
created: 2026-08-30
completed: 2026-08-30
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

- [x] TC-01: Add a failing continuation fixture with conversion evidence whose original base differs
      from the later branch base, then make it pass.
- [x] TC-02: Keep replay fail-closed when the Task or recorded conversion base changes.
- [x] TC-03: Restore [PROC-017's continuation declaration](../spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md) to the exact six undelivered paths.
- [x] TC-04: Run focused tests, affected scans, and contract verification.

## Test Plan

- Extend `scan-user-execution-plan-order.test.mjs` with real temporary Git history covering the
  first checkpoint merge, later base, and continuation checkpoint.
- Run focused Vitest, affected scans, and the repository contract tier.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this is repository-internal planning enforcement with no CLI, TUI, browser,
SDK, configuration, or product behavior.

## Result

- Continuations reuse the immutable conversion receipt base only when the Task is unchanged and the
  recorded commit is an ancestor of the continuation parent.
- Task, receipt-base, and ancestry mutations remain fail-closed.
- PROC-017 now declares exactly the six artifacts still awaiting final delivery.
- Verification passed: 134 focused tests, 55 affected scans (1 skipped), and 4,296 contract tests.
