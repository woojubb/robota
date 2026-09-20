---
title: 'RULE-2664: Allow integration AGREEMENT activation after its atomic prelude'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-20
priority: critical
urgency: now
area: harness user-execution plan-order validation
depends_on: [BRANCH-2664]
---

# RULE-2664: Allow integration AGREEMENT activation after its atomic prelude

## Objective

Remove the bootstrap cycle that prevents a fresh `integration/<agreement-id>` branch from committing
the parent AGREEMENT's GATE-IMPLEMENT transition. The committed atomic AGREEMENT prelude must be a
valid pre-child integration state, while every child merge must still require the parent AGREEMENT to
have reached its active checkpoint first.

Delivery is one atomic scanner-and-regression-test change (`single`).

## Plan

- [ ] Add a regression fixture for a planning-only integration branch with a matching atomic AGREEMENT.
- [ ] Add a regression fixture for staging and committing the parent AGREEMENT activation transition.
- [ ] Keep child merges fail-closed when the parent AGREEMENT has not reached its active checkpoint.
- [ ] Preserve malformed, mismatched, duplicate, and out-of-order integration-history refusals.
- [ ] Run the focused plan-order suite and affected repository verification.

## Test Plan

- Run the focused `scan-user-execution-plan-order` Vitest module.
- Reproduce the real planning-only and staged activation histories in temporary Git repositories.
- Run the affected harness contract suite and repository scans against the final diff.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change affects repository-internal Git history validation and pre-commit admission;
it has no runnable Robota CLI, TUI, browser, or public SDK product surface.
