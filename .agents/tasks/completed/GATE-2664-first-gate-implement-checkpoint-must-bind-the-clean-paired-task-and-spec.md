---
title: 'GATE-2664: first GATE-IMPLEMENT checkpoint must bind the clean paired Task and spec'
issue: https://github.com/woojubb/robota/issues/2664
status: done
created: 2026-09-21
priority: high
urgency: now
area: scripts/harness GATE-IMPLEMENT checkpoint evidence
depends_on: []
completed: 2026-09-21
---

# GATE-2664: first GATE-IMPLEMENT checkpoint must bind the clean paired Task and spec

Spec: `.agents/spec-docs/done/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md`

## Objective

Make the first GATE-IMPLEMENT checkpoint record the paired Task and spec even when either file is
clean at render time. The generated PASS must satisfy the existing exact-inventory consumer after
the lifecycle advance changes the pair, without weakening rejection of unrelated worktree dirt.

Source issue: https://github.com/woojubb/robota/issues/2664.

## Existing Evidence

- `firstCheckpointEvidence(...)` currently writes only `checkpointWorktreePaths(root)`, so a clean
  paired Task is absent from the payload.
- Continuation and correction checkpoint producers already union the paired paths into the
  inventory; the first producer is the isolated inconsistency.
- `worktreeError(...)` requires both `taskPath` and `specPath`, so a mechanically generated first
  PASS can be rejected by the staged pre-commit consumer after `gate.mjs advance` dirties the Task.
- `DATA-2664` owns exclusion of generated lesson churn. This Task instead owns inclusion of the
  mandatory paired paths and does not reopen or duplicate that completed cause.
- Finding-depth review classified this as `LOCAL`; `MAP-2664` remains the owner of any later change
  to the umbrella AGREEMENT child projection.
- Ownership disposition: under the approved MAP-2664 role predicates this is a delivery prerequisite,
  not an eighth `AGREEMENT-2664` child. All seven approved children are terminal, this defect exists
  on `origin/develop`, and reopening the child manifest would conflate delivery with the projection
  policy owned by `MAP-2664`. Compatibility with the DATA-integrated initiative state remains
  mandatory before landing.

## Plan

- [x] TC-01: add a RED regression proving a first checkpoint rendered with a clean pair omits the
      required Task/spec inventory before the implementation change.
- [x] TC-02: add one shared pair-inventory helper that unions, deduplicates, and sorts `taskRel`,
      `specRel`, and the shared real-dirt inventory, then route first, continuation, and correction
      producers through it.
- [x] TC-03: prove the generated first payload binds through the existing consumer while unrelated
      real dirt remains represented and rejected.
- [x] TC-04: run the complete checkpoint-evidence test file, affected harness scans, and the focused
      compatibility suite against the DATA-integrated `origin/integration/agreement-2664` state.

## Test Plan

Add a focused Vitest fixture with both paired files committed and clean before rendering. Parse the
generated v2 payload, assert the exact sorted pair, and pass it through the existing current-entry
consumer with `priorEntries: []` and exact `checkpointPaths`. Retain a control with unrelated real
dirt, then run the entire checkpoint-evidence suite and affected PR-context harness scans on both
the fresh develop base and the DATA-integrated initiative state.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

- **Canonical loop run:** `r20260921020517`

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes only an internal repository planning-checkpoint producer and commit guard;
it adds no Robota CLI, TUI, browser, public SDK, configuration, or runtime behavior for an end user.

## Progress

- 2026-09-21: Approval committed; first GATE-IMPLEMENT checkpoint prepared before source changes.
- 2026-09-21: RED reproduced an empty clean-pair inventory; GREEN centralizes the sorted pair
  inventory for first, continuation, and correction producers while preserving PLAN-ledger allowance
  and unrelated-dirt rejection. Focused tests pass on develop and on
  `origin/integration/agreement-2664@4214cb540a54`; affected PR-context scans pass with two unrelated
  advisory findings.
