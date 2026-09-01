---
title: 'PROC-029: Unify GATE-IMPLEMENT continuation producer and consumer contracts'
issue: https://github.com/woojubb/robota/issues/2422
status: in-progress
created: 2026-09-01
priority: medium
urgency: soon
area: workflow governance and harness checkpoint lifecycle
depends_on: []
---

# PROC-029: Unify GATE-IMPLEMENT continuation producer and consumer contracts

## Objective

Make the L2 GATE-IMPLEMENT producer, native continuation judge, and plan-order consumer implement one
continuation-readiness contract. A first checkpoint must establish every immutable fact a later branch
needs; a later branch must be judged by `gate.mjs` rather than a manual-only exception; and a complete
`not-applicable | 0` PLAN must be accepted from its structured signal plus substantive reason rather than
an undeclared English phrase.

This Task owns issue #2422 and coordinates the user-approved single-PR batch with two distinct related
roots that share the same gate contract and regression boundary: PROC-026 / issue #2561 owns
first-checkpoint readiness, while HARNESS-134 / issue #2261 owns the shared not-applicable reason
contract. The three causes remain separately attributable in Tasks, tests, and close-out evidence.

## Plan

- [ ] TC-01 — extend the existing versioned checkpoint contract and enforce complete first-checkpoint
      continuation readiness for PROC-026.
- [ ] TC-02 — add native `gate.mjs judge --gate GATE-IMPLEMENT --continuation` routing, ordering,
      evidence generation, and annotated prior-gate parsing.
- [ ] TC-03 — make not-applicable reason validation structural and substantive without requiring the
      literal phrase `not applicable`, while continuing to reject absent or thin reasons.
- [ ] TC-04 — add RED→GREEN regressions for all three historical failures and run the affected harness
      contract and scan suites.
- [ ] TC-05 — after verification, complete PROC-026 and HARNESS-134 under their own criteria and preserve
      truthful outcome-specific delivery records for all three source Issues.

## Test Plan

- Extend `scripts/harness/__tests__/gate.test.mjs` for native continuation argument parsing, annotated
  prior-gate selection, input ordering, semantic/mechanical residue, and exact evidence output.
- Extend `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` with the immutable
  AGREEMENT-006 reason shape: structured `not-applicable | 0` plus a long concrete reason that does not
  repeat the English token. Prove the fixture fails before the fix and passes afterward.
- Add or extend checkpoint-contract fixtures proving the first producer rejects sequenced delivery when
  continuation artifacts or atomic Task/spec lifecycle facts are missing.
- Run focused Vitest files, affected harness scans, full pre-push verification, and the exact
  AGREEMENT-006 continuation dry-run before completion.

## User Execution Test Scenarios

Not applicable. This Task changes repository-internal gate, checkpoint, and reason-validation machinery
only; it does not add or alter any runnable Robota product command, public SDK result, TUI or browser
interaction, or product-visible state.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable.

**Reason:** This work governs how repository contributors record and validate planning checkpoints and
continuation evidence; no Robota product runtime path consumes these contracts, so a user has no product
behavior to execute or observe.
