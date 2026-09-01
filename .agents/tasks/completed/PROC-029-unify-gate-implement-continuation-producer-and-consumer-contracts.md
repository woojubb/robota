---
title: 'PROC-029: Unify GATE-IMPLEMENT continuation producer and consumer contracts'
issue: https://github.com/woojubb/robota/issues/2422
status: done
created: 2026-09-01
completed: 2026-09-01
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

- [x] TC-01 — extend the existing versioned checkpoint contract and enforce complete first-checkpoint
      continuation readiness for PROC-026.
- [x] TC-02 — add native `gate.mjs judge --gate GATE-IMPLEMENT --continuation` routing, ordering,
      evidence generation, and annotated prior-gate parsing.
- [x] TC-03 — make not-applicable reason validation structural and substantive without requiring the
      literal phrase `not applicable`, while continuing to reject absent or thin reasons.
- [x] TC-04 — add RED→GREEN regressions for all three historical failures and run the affected harness
      contract and scan suites.
- [x] TC-05 — after verification, complete PROC-026 and HARNESS-134 under their own criteria and preserve
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

## User Execution Close-out

**User-execution route:** `NOT-APPLICABLE`
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
**Reason:** This work governs how repository contributors record and validate planning checkpoints and
continuation evidence; no Robota product runtime path consumes these contracts, so a user has no product
behavior to execute or observe.
**DONE-GATE-STAGE-1:** N/A — not invoked; the subject-bound PLAN terminal outcome is `NOT-APPLICABLE`.
**DONE-GATE-STAGE-2:** N/A — not invoked; Phase 4 is skipped for `NOT-APPLICABLE`.

## Verification

- `pnpm build` exited 0 across all workspace packages.
- The initial pre-review focused harness verification passed 261/261 tests. Independent local review
  then found four contract gaps, and its re-review found one remaining delivery-binding gap; all five
  were reproduced and corrected before the first push.
- Post-review focused verification passed 269/269 tests across 13 owning files, including 142/142
  plan-order history cases and explicit rejection of both a v2 `single` predecessor under a sequenced
  Decision and continuation artifact drift. `pnpm build` exited 0 again. The full repository scan passed
  149/150 before work-run closure; its sole failure was the expected active-run
  `invalid-closure-commit`, which is resolved only by the receipt-only closure.
- The first plain `pnpm test` exposed the unchanged macOS `/var` versus `/private/var` defect recorded as
  issue #2564. With a canonical temporary root that package passed 119/119; the later full run reached
  unrelated Linux-only stable-no-follow tests in `agent-session`. Neither package is changed by this work.
- Outcome-specific, explicitly unmerged delivery evidence was recorded on issues #2422, #2561, and #2261;
  each issue remains open for the delivery PR to close on merge.
- Independent user-execution guardian verdict: `PASS`; the route is `NOT-APPLICABLE`, so engineering
  verification above is not user-execution evidence.
