---
title: 'PROC-030: allow continuation gate retry after a recorded failure'
status: done
created: 2026-09-02
completed: 2026-09-02
priority: medium
urgency: soon
area: workflow governance and harness gate lifecycle
depends_on: []
---

# PROC-030: allow continuation gate retry after a recorded failure

no-issue: internal harness defect discovered while executing AGREEMENT-006; no new GitHub issue exists
solely for internal implementation sequencing.

## Objective

Make a repaired GATE-IMPLEMENT continuation re-runnable after an earlier continuation attempt recorded
FAIL. Preserve strict ordering for every other gate and continue to re-judge current ancestry, artifact,
Task/PLAN, and worktree conditions on every retry.

## Plan

- [x] TC-01 — synchronize the local gate-test catalogue with the live annotated continuation prior-map
      row and prove the RED fixture fails specifically with
      `last [GATE-IMPLEMENT] entry is ❌ FAIL`.
- [x] TC-02 — make continuation ordering select the most recent prior GATE-IMPLEMENT PASS while leaving
      all current continuation criteria mandatory.
- [x] TC-03 — prove a continuation with no prior PASS still fails and an ordinary gate still treats a
      later FAIL as ordering-blocking.
- [x] TC-04 — on a valid PASS→FAIL retry history, independently make current status, sequenced
      Decision/artifacts, preceding ancestor, Task/PLAN binding, and outside-worktree inventory invalid;
      prove every case still fails.
- [x] TC-05 — run focused gate tests, affected checkpoint/order tests, and repository verification.

## Test Plan

- Add the exact annotated continuation row to the local catalogue fixture and assert ordering output so
  the test cannot pass by skipping the prior-gate check.
- Add RED→GREEN cases in `scripts/harness/__tests__/gate.test.mjs` for PASS→FAIL→retry, FAIL-only,
  ordinary-gate, and current-input-invalid controls.
- Run the focused gate suite plus checkpoint/order contract suites to prove the change does not weaken
  continuation payload, ancestor, Task/PLAN, or worktree validation.
- Run the repository harness and build before completion.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change governs an internal repository planning-gate transition and does not alter a
Robota command, public SDK result, TUI or browser flow, or any product-visible runtime state.
