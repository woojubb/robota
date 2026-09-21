---
title: 'INFRA-2525: preserve the trusted integration base declaration at the real pre-push boundary'
issue: https://github.com/woojubb/robota/issues/2525
status: done
created: 2026-09-21
priority: medium
urgency: now
area: harness pre-push delivery gate
depends_on: []
completed: 2026-09-21
---

# INFRA-2525: preserve the trusted integration base declaration at the real pre-push boundary

Spec: `.agents/spec-docs/done/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`

## Objective

Make the real Git pre-push boundary preserve a validated `HARNESS_BASE_REF` declaration when it
replays the shared post-verdict guard. A clean integration-base sync must receive the same trusted
base evidence at both the outer command boundary and the Git hook boundary.

## Plan

- [x] Add a regression that reproduces the declaration loss in `runPostVerdictGuard`.
- [x] Reconstruct only the validated `origin/integration/agreement-<number>` declaration in the
      synthetic guard command, while retaining the existing bare `git push` path when none is set.
- [x] Fail closed before spawning the guard when a non-empty declaration is not a trusted
      integration-base ref.
- [x] Run the focused pre-push sequence suite and affected harness scans, then complete the L1 gates.

## Evidence

- Registration and observed failure: https://github.com/woojubb/robota/issues/2525#issuecomment-5755462483
- Reproduction: `HARNESS_BASE_REF=origin/integration/agreement-014 git push origin integration/agreement-014`
  reached `.husky/pre-push`, where the replayed guard received only `git push` and rejected the exact
  clean sync merge `3290d394fc088145c5ab520ae47640dc5ada2f5c` as foreign history.
- TDD RED: the new valid-base assertion failed because the payload still contained only `git push`;
  the malformed-base assertion then failed because the guard spawned instead of refusing.
- GREEN: `scripts/harness/__tests__/pre-push-sequence.test.mjs` passed 31/31; the broader pre-push
  set passed 126/126; the affected harness scan passed 61 scans with two pre-existing PR-context
  advisories (`reference-kind-qualified`, `task-merged-citation`).

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This repairs an internal repository delivery guard and changes no Robota CLI, SDK, TUI,
browser, protocol, or other runnable product surface that an end user can execute.
