---
title: 'PROC-018: Record the PROC-017 post-merge continuation scope'
issue: https://github.com/woojubb/robota/issues/2514
status: todo
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

- [ ] Add one exact `Continuation artifacts` declaration to PROC-017's Decision for the evidence,
      workflow-document, loop-ledger, and regression-test paths that the closeout PR must land.
- [ ] Verify the declaration is uniquely parseable by the existing checkpoint evidence contract and
      that the affected repository scans remain green.

## Test Plan

- Run a focused parser assertion against `continuationArtifacts` using PROC-017's active spec and
  assert the resulting ordered artifact list is exactly the closeout scope.
- Run `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
  after the documentation change is committed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this work changes repository-internal planning metadata only. It exposes no
Robota CLI, TUI, browser, or public SDK behavior that a user can execute.
