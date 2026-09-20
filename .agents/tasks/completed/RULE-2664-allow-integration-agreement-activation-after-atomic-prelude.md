---
title: 'RULE-2664: Allow integration AGREEMENT activation after its atomic prelude'
issue: https://github.com/woojubb/robota/issues/2664
status: done
created: 2026-09-20
priority: critical
urgency: now
area: harness user-execution plan-order validation
depends_on: [BRANCH-2664]
completed: 2026-09-20
---

# RULE-2664: Allow integration AGREEMENT activation after its atomic prelude

## Objective

Remove the bootstrap cycle that prevents a fresh `integration/<agreement-id>` branch from committing
the parent AGREEMENT's GATE-IMPLEMENT transition. The committed atomic AGREEMENT prelude must be a
valid pre-child integration state, while every child merge must still require the parent AGREEMENT to
have reached its active checkpoint first.

Delivery is one atomic scanner-and-regression-test change (`single`).

## Spec

Spec: `.agents/spec-docs/done/RULE-2664-allow-integration-agreement-activation-after-atomic-prelude.md`

## Plan

- [x] Add a regression fixture for a planning-only integration branch with a matching atomic AGREEMENT.
- [x] Add a regression fixture for staging and committing the parent AGREEMENT activation transition.
- [x] Keep child merges fail-closed when the parent AGREEMENT has not reached its active checkpoint.
- [x] Preserve malformed, mismatched, duplicate, and out-of-order integration-history refusals.
- [x] Run the focused plan-order suite and affected repository verification.

## Test Plan

- Run the focused `scan-user-execution-plan-order` Vitest module.
- Reproduce the real planning-only and staged activation histories in temporary Git repositories.
- Run the affected harness contract suite and repository scans against the final diff.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change affects repository-internal Git history validation and pre-commit admission;
it has no runnable Robota CLI, TUI, browser, or public SDK product surface.

## Verification Evidence

- RED: the new integration-prelude regression failed with the expected
  matching-valid-atomic-AGREEMENT finding before the scanner change.
- GREEN: the isolated `scan-user-execution-plan-order` suite passed 267/267 assertions.
- Affected contracts: 239 submitted, 0 not invoked, 0 failed shards.
- Affected scans: 61 passed, 1 skipped, and 2 unrelated historical advisory findings were tolerated;
  both owned scans passed.
- Regression red proof: `REGRESSION_RED_PROOF_ENFORCE=1` reported
  `scan-user-execution-plan-order.mjs: red-proof-ok (assertion-fail)`.
- Post-implementation checklist: run `r20260920074935` converged with 0 findings.
