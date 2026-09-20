---
title: 'HARNESS-2774: Re-bind a drifted DONE-GATE-STAGE-1 payload on a continuation checkpoint'
issue: https://github.com/woojubb/robota/issues/2774
status: done
completed: 2026-09-21
created: 2026-09-20
priority: high
urgency: now
area: scripts/harness
lane: L1
depends_on: []
---

# HARNESS-2774: Re-bind a drifted DONE-GATE-STAGE-1 payload on a continuation checkpoint

## Objective

A Task's `doneGateStageOne` payload binds the authored scenario text VERBATIM. Nothing refuses an
implementation commit that amends that text — implementation commits are not read by
`scan-user-execution-plan-order`. So a unit that redesigns a scenario mid-delivery, which the process
explicitly allows, silently drifts out of its own binding.

From then on the unit is sealed. Every checkpoint re-validates the binding and fails it; repairing
the binding means editing the Task, and `isCheckpointTransition` requires the Task to be byte-identical
to its parent in both the continuation and the correction form once the pair is `in-progress`; and the
archive route freezes `## User Execution Test Scenarios` byte-identical, so an `evidence: pending`
left behind can never be filled and `unearned-done-claims` then refuses the archive.

Measured on SCREEN-2002, whose three work units are merged and verified: its payload binds 5291 bytes
of scenario text against 5615 bytes now authored, diverging at offset 497. Its record cannot be
closed in any commit shape. That is the other half of the develop red tracked by issue #2756.

## Plan

- [x] TC-01: a continuation checkpoint may carry one Task change and only one — re-recording the
      DONE-GATE-STAGE-1 entry so its payload binds the scenario text the Task already carries.
      Byte-identical outside that entry, drifted before, binding after; anything else is still
      refused, and a payload that already binds has nothing to repair.
- [x] TC-02: engineering verification — the harness contract tier and the full scan, with every
      finding attributed.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                | Notes                          |
| ----- | ------------------------ | -------------------------------------------------------------- | ------------------------------ |
| TC-01 | Unit                     | Vitest over `evaluatePlanTexts` / `isCheckpointTransition`     | Seven cases; case 1 red before |
| TC-02 | Engineering verification | `node scripts/harness/harness-test-tiers.mjs --tier contracts` | No test file — skipped by kind |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** this changes which SHAPE of commit a repository scan accepts. Nothing a user types, sees
or runs at a product surface changes — `robota` behaves identically before and after, and the only
observable is whether a record-repair commit is accepted, which is a contract internal to this
repository between the gate writer and the scan that reads it.
