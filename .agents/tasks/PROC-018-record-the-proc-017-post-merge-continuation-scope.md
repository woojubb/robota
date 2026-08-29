---
title: 'PROC-018: Record the PROC-017 post-merge continuation scope'
issue: https://github.com/woojubb/robota/issues/2514
status: in-progress
created: 2026-08-30
priority: medium
urgency: soon
area: workflow harness documentation
depends_on: []
---

# PROC-018: Record the PROC-017 post-merge continuation scope

## Objective

Repair the post-merge sequencing omission in PROC-017: its accepted plan requires a committed
candidate measurement after PR #2542 merges, but its `### Decision` section does not name the
artifacts for that required later PR. Record the exact closeout scope before attempting the
continuation checkpoint, without weakening the branch-local planning guard.

## Plan

- [ ] TC-01: Add one exact `Continuation artifacts` declaration to PROC-017's Decision for the
      evidence, workflow-document, loop-ledger, and regression-test paths that the closeout PR must
      land, then verify its exact parsed order.
- [ ] TC-02: Verify the declaration occurs exactly once and the implementation commit changes only
      PROC-017's active spec.
- [ ] TC-03: Run the affected repository scan after committing the declaration.

## Test Plan

- Run a focused parser assertion against `continuationArtifacts` using PROC-017's active spec and
  assert the resulting ordered artifact list is exactly the closeout scope.
- Run `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
  after the documentation change is committed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this work changes repository-internal planning metadata only. It exposes no
Robota CLI, TUI, browser, or public SDK behavior that a user can execute.
