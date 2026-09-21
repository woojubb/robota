---
title: 'INFRA-2525: preserve the trusted integration base declaration at the real pre-push boundary'
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-21
priority: medium
urgency: now
area: harness pre-push delivery gate
depends_on: []
---

# INFRA-2525: preserve the trusted integration base declaration at the real pre-push boundary

## Objective

Make the real Git pre-push boundary preserve a validated `HARNESS_BASE_REF` declaration when it
replays the shared post-verdict guard. A clean integration-base sync must receive the same trusted
base evidence at both the outer command boundary and the Git hook boundary.

## Plan

- [ ] Add a regression that reproduces the declaration loss in `runPostVerdictGuard`.
- [ ] Reconstruct only the validated `origin/integration/agreement-<number>` declaration in the
      synthetic guard command, while retaining the existing bare `git push` path when none is set.
- [ ] Fail closed before spawning the guard when a non-empty declaration is not a trusted
      integration-base ref.
- [ ] Run the focused pre-push sequence suite and affected harness scans, then complete the L1 gates.

## Evidence

- Registration and observed failure: https://github.com/woojubb/robota/issues/2525#issuecomment-5755462483
- Reproduction: `HARNESS_BASE_REF=origin/integration/agreement-014 git push origin integration/agreement-014`
  reached `.husky/pre-push`, where the replayed guard received only `git push` and rejected the exact
  clean sync merge `3290d394fc088145c5ab520ae47640dc5ada2f5c` as foreign history.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This repairs an internal repository delivery guard and changes no Robota CLI, SDK, TUI,
browser, protocol, or other runnable product surface that an end user can execute.
