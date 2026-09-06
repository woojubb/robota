---
title: 'INFRA-179: reconcile the gate audit red findings and restore a truthful green harness'
status: in-progress
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness
  - .agents/spec-docs
  - .agents/tasks
  - documentation examples
depends_on: []
issue: https://github.com/woojubb/robota/issues/2578
---

# INFRA-179: reconcile the gate audit red findings and restore a truthful green harness

## Objective

Resolve the actionable failures recorded by `/tmp/robota-gate-audit.md` against the current
`origin/develop` baseline, while preserving fail-closed gate behavior and the audit's decision that
no protection is deleted merely to obtain a green result.

## Plan

- [x] TC-01: add and pass focused regression tests for citation, examined-marker, expected-empty, and size-boundary behavior.
- [x] TC-02: make the reference, progress-report, and task-merged-citation scans exit 0 on the final tree.
- [x] TC-03: make documentation examples typecheck and preserve non-zero examined/expected-empty output declarations.
- [x] TC-04: bring `gate.mjs` and `run-all-scans.mjs` back within their frozen file-size baselines without raising them.
- [x] TC-05: run the full integration harness scan with no non-advisory failures or adoption drift.
- [x] TC-06: complete the work-run receipt-only closure and re-run the complete focused citation suite.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance and developer-tooling maintenance; it changes no runnable
product surface that an end user can execute directly.

## Test Plan

- The paired spec's TC-N criteria are the authoritative verification plan.
- The final work-run receipt and full harness scan must be recorded before completion.
