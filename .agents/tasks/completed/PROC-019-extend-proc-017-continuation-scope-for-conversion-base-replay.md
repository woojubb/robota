---
title: 'PROC-019: Extend PROC-017 continuation scope for conversion-base replay'
issue: https://github.com/woojubb/robota/issues/2514
status: done
created: 2026-08-30
completed: 2026-08-30
priority: critical
urgency: now
area: workflow harness documentation
depends_on: [PROC-018]
---

# PROC-019: Extend PROC-017 continuation scope for conversion-base replay

## Objective

Authorize the smallest additional PROC-017 closeout artifact required to fix the measured
`conversion-evidence-base-mismatch` failure on a valid continuation checkpoint. The preparatory
change adds the plan-order scanner source path to PROC-017's existing continuation declaration;
the source fix itself remains forbidden until the later continuation checkpoint is committed.

## Plan

- [x] TC-01: Add `scripts/harness/scan-user-execution-plan-order.mjs` to PROC-017's exact ordered
      `Continuation artifacts` declaration and verify the seven-item parser result.
- [x] TC-02: Verify the declaration occurs exactly once and the implementation commit changes only
      PROC-017's active spec.
- [x] TC-03: Run the affected repository scan after committing the declaration.

## Test Plan

- Run a focused `continuationArtifacts` assertion against the live backlog rule and PROC-017 spec,
  requiring the exact seven ordered paths.
- Run the affected scan command and verify the implementation range contains only the parent spec.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this work changes repository-internal planning metadata only and exposes no
Robota CLI, TUI, browser, SDK, configuration, or product behavior.

## Result

- PROC-017 now declares the plan-order scanner source as the seventh closeout artifact.
- The live continuation parser returned the exact ordered list and the declaration occurs once.
- The implementation commit changed only PROC-017's active spec, and all 36 affected scans passed.
