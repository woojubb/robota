---
title: 'RULE-2655: distinguish partial delivery from terminal-state debt'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-12
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
completed: 2026-09-12
---

# RULE-2655: distinguish partial delivery from terminal-state debt

Spec: `.agents/spec-docs/done/RULE-2655-distinguish-partial-delivery-from-terminal-state-debt.md`

## Objective

Unblock Issue #2655 verification without falsely completing STRUCT-012: the terminal-state scan must
recognize a merged named Plan unit which the Task records as complete while other Plan work remains.
Reuse the existing citation and Plan parsers; preserve findings for unreconciled or whole-item delivery.

## Plan

- [x] TC-01: Reproduce the named partial-delivery false positive and correct its classification.
- [x] TC-02: Verify the current affected scans without changing unfinished Task records or baselines.
- [x] TC-03: Cover negative cases and preserve the existing age, status and delivery boundaries.

## Test Plan

Use `scripts/harness/__tests__/scan-item-terminal-state.test.mjs` and the existing citation suite.
Run the affected scan suite and the local CI mirror after the coherent change.

## Delivery

This is a prerequisite repair only. Issue #2655 remains open until every original source outcome is delivered.

## Results

The new named-unit case failed before the fix (1 failure, 2 passes); after implementation the terminal
and citation suites pass 33/33 tests. The actual terminal-state scan passes with STRUCT-012 unchanged.
Affected verification passes 61 scans with one declared skip. The first local CI mirror attempt found
a new fixture using direct temporary-directory creation; it was corrected to the existing `makeTemp`
owner, which manages cleanup. The corrected local CI mirror passed all five applicable stages
(six stages not applicable) in 3m 58.3s. Remote checks and landing remain delivery requirements.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** People still run the same conversations, commands and interfaces; only repository maintainers
see a corrected interpretation of a partially completed work record.
