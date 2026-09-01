---
title: 'INFRA-148: Pre-push CI-mirror scan drops Work-Run observation mode'
status: in-progress
created: 2026-09-01
priority: medium
urgency: soon
area: harness pre-push verification and Work-Run measurement
depends_on: []
---

# INFRA-148: Pre-push CI-mirror scan drops Work-Run observation mode

## Objective

Ensure every Work-Run measurement executed within one local pre-push operation observes the pending
head as `pre-push`, including the nested mirror of the required `scans` context. GitHub CI must keep
using the `post-push` default after the head exists remotely, and an invalid observation value must
fail closed instead of silently selecting either meaning.

no-issue: This repository-internal defect was reproduced directly during PR #2566 pre-push
verification. Its cause is that the enclosing pre-push context is not propagated into the nested
scan process.

## Existing Evidence

- PR #2566 generation 1 passed the dedicated pre-push Work-Run gate, which calls
  `validateWorkRunRange` with `prObservation: pre-push`.
- The same push then passed 222 contract files / 4,617 tests, the 222-test stripped follow-up, and
  71 hermetic files / 1,118 tests before the nested affected scan failed with
  `work-run-measurement: post-pr-local-fix`.
- `scripts/harness/pre-push-verification-execution.mjs` invokes the mirrored `harness:scan` as a new
  process without carrying the observation mode.
- `scripts/harness/scan-work-run-measurement.mjs` therefore falls back to repository validation's
  `post-push` default while the candidate HEAD is still local.
- The exact run and diagnosis are recorded in
  [PR #2566 evidence](https://github.com/woojubb/robota/pull/2566#issuecomment-5495529533).

## Scope Boundary

- Own only the observation-context bridge from pre-push verification into its nested scan process.
- Keep the standalone/CI scanner default as `post-push`.
- Validate the bridge value against the closed `pre-push | post-push` vocabulary and fail closed on
  any other value.
- Preserve the existing CI command mirror; context propagation must not pretend CI runs a different
  command.
- Do not weaken Work-Run authorization, receipt immutability, post-push head matching, or the ban on
  hook bypasses.

## Plan

- [x] TC-01: Add a regression test proving the nested local `harness:scan` receives `pre-push`
      context and evaluates the unpublished authorized generation with that observation.
- [x] TC-02: Add scanner-boundary tests proving absent context retains `post-push` and both valid
      values reach repository validation unchanged.
- [x] TC-03: Prove an invalid explicit observation fails with a named diagnostic before repository
      validation is called.
- [x] TC-04: Propagate the observation only around the nested required-scans mirror while preserving
      inherited environment entries and the exact CI command/argv projection.
- [ ] TC-05: Run focused suites, contract/hermetic tiers, the root build, and every substantive
      scan through `pnpm harness:scan -- --skip work-run-measurement`, then obtain an independent
      local review without a hook bypass. The exact full scan and normal PR #2566 push remain the
      parent consolidation plan’s downstream delivery acceptance steps.

> **Contained — INFRA-150.** The repository-wide lifecycle currently cannot bind a terminal Work-Run
> receipt and also require that receipt’s full scan before Task/spec terminalization changes the head.
> Issue #2568 owns the common ordering repair; this Task records the smallest truthful sequencing hold.

## Completion Criteria

- A post-findings generation push does not fail merely because the nested local scan observes the
  pre-push candidate before it exists remotely.
- GitHub CI and standalone scans continue to use `post-push` semantics by default.
- Invalid observation context is rejected with a specific diagnostic.
- The required-scans command projection remains byte-for-byte aligned with CI.
- Focused tests, harness contract/hermetic tiers, the root build, and every substantive scan pass
  before completion; after receipt-only closure, the exact full scan and normal PR push provide the
  parent consolidation plan’s delivery acceptance evidence.

> **Contained — INFRA-150.** This split is temporary and visible because the common lifecycle has no
> non-circular single-head ordering yet; issue #2568 owns that repository-wide correction.

## Test Plan

- Extend the pre-push verification execution tests with environment propagation assertions.
- Extend `scripts/harness/__tests__/scan-work-run-measurement.test.mjs` for absent, valid, and invalid
  observation context.
- Run the focused pre-push and Work-Run suites.
- Run `pnpm harness:test:contracts`, `pnpm harness:test:hermetic`, the root build, and
  `pnpm harness:scan -- --skip work-run-measurement` before lifecycle completion.
- After the receipt-only closure, run exact `pnpm harness:scan`, integrate into PR #2566, and record
  the normal push as the parent consolidation plan’s delivery acceptance evidence.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this Task changes internal repository push governance and exposes no
Robota CLI, TUI, browser, or public SDK behavior. Its observable proof belongs to the pre-push hook
and harness contract tests.
