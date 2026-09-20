---
title: 'AGREEMENT-2664: Coordinate gate correctness, approval ordering, and fail-closed enforcement'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-20
priority: critical
urgency: now
area: repository gate evaluation, approval provenance, and checkpoint evidence
depends_on: [AGREEMENT-012, AGREEMENT-013, AGREEMENT-2698]
children:
  - BEHAVIOR-2664
  - PUSH-2664
  - DATA-2664
  - RULE-2582
  - BEHAVIOR-2663
  - RULE-2665
  - RULE-2326
  - RULE-2380
---

# AGREEMENT-2664: Coordinate gate correctness, approval ordering, and fail-closed enforcement

## Objective

Resolve [issue #2664](https://github.com/woojubb/robota/issues/2664) as a cause-aligned initiative.
Deliver the direct approval-ordering and checkpoint defects first, then reconcile the inherited gate,
approval, and orchestration criteria without duplicating work already owned by AGREEMENT-012,
AGREEMENT-013, or AGREEMENT-2698.

## Source Ownership

- BEHAVIOR-2664 owns the retained target defect in `gate.mjs approve`.
- PUSH-2664 owns the Git-hook bridge prerequisite discovered after BEHAVIOR-2664 landed; it must
  precede later child publication so their trusted integration-base declaration reaches the guard.
- DATA-2664 owns the later checkpoint-inventory defect recorded on issue #2664.
- RULE-2582, BEHAVIOR-2663, RULE-2665, RULE-2326, and RULE-2380 preserve the exact source-Issue
  outcomes transferred into the umbrella.
- AGREEMENT-012 owns issue #2066; AGREEMENT-013 owns the remaining issue #2075 leaf; AGREEMENT-2698
  owns the issue #2391 diagnostic-first outcome. This initiative depends on those records and does
  not clone them.

## Plan

- [ ] TC-01 — Validate every declared child Task against its exact source Issue and dependency order.
- [ ] TC-02 — Deliver the approval-ordering and checkpoint-inventory children before wider governance work.
- [ ] TC-03 — Reconcile inherited source rows against their child or external owner with no duplicate execution record.
- [ ] TC-04 — Verify all child and dependency outcomes, then update the umbrella register with exact delivery evidence.
- [ ] TC-05 — Reconcile issue #2664 only after every retained criterion has a delivered or explicitly terminal owner.
- [ ] TC-06 — Preserve each child's approved scope and route every cross-owner finding to its existing owner.
- [ ] TC-07 — Read back one terminal owner and landing witness for every umbrella register row.

## Children

- [x] BEHAVIOR-2664 — done — `.agents/tasks/completed/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`
- [x] PUSH-2664 — done — `.agents/tasks/completed/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`
- [x] DATA-2664 — done — `.agents/tasks/completed/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`
- [x] RULE-2582 — done — `.agents/tasks/completed/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`
- [x] BEHAVIOR-2663 — done — `.agents/tasks/completed/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`
- [x] RULE-2665 — done — `.agents/tasks/completed/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`
- [ ] RULE-2326 — todo — `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`
- [ ] RULE-2380 — todo — `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`

## Test Plan

Run the exact Task/spec projection scan, Task lifecycle classification, affected harness tests, and
the GitHub issue-triage read-back after each lifecycle mutation. Final verification compares every
umbrella row with one delivered or explicitly terminal owner and runs the full repository harness scan.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This agreement coordinates private repository planning, gate tooling, and GitHub records;
it changes no Robota CLI, TUI, browser, public SDK, or installed-package behavior for an end user.
