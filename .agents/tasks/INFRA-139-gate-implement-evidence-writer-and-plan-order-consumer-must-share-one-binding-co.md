---
title: 'INFRA-139: gate implement evidence writer and plan-order consumer must share one binding contract'
issue: https://github.com/woojubb/robota/issues/2433
status: todo
created: 2026-08-29
priority: high
urgency: now
area: scripts/harness/gate.mjs, scripts/harness/scan-user-execution-plan-order.mjs,
  scripts/harness/__tests__/gate.test.mjs,
  scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs
depends_on: []
---

# INFRA-139: gate implement evidence writer and plan-order consumer must share one binding contract

## Objective

Make the GATE-IMPLEMENT evidence writer and the planning-checkpoint consumer share one exact binding
contract. A PASS entry produced by `gate.mjs judge --gate GATE-IMPLEMENT` for a valid Task/spec pair
must be accepted by plan-order without hand-amending gate evidence, while malformed or mismatched Task,
spec, scenario, and worktree bindings remain fail-closed.

Source issue: https://github.com/woojubb/robota/issues/2433.

## Conversion Decision

The issue becomes one Task because all listed symptoms have one cause and one independent completion
outcome: the sole GATE-IMPLEMENT evidence writer omits a token required by its plan-order consumer.
The writer, matcher, catalogue alignment, and cross-component tests are implementation steps of that
single contract; they are not independently deliverable causes. This item is separate from INFRA-138,
whose administrative terminal-edge checkpoint remains stashed until this blocker lands.

## Existing Evidence

- `completeGateImplementEntry()` requires an exact paired Task path, an exact `todo/` or `active/` spec
  path, the Task's exact `SCENARIO DRAFTED` outcome/count, and the whole-worktree signal.
- `gate.mjs judge --gate GATE-IMPLEMENT` currently records the Task path, scenario signal, and
  whole-worktree result, but no exact spec path.
- On the INFRA-138 branch, the generated GATE-IMPLEMENT entry passed 7/7 mechanical criteria. The
  exact Task/spec/ledger planning commit was then refused twice by the pre-commit plan-order scan;
  after the Task status was corrected to `in-progress`, the remaining diagnostic was:
  `checkpoint is neither the first GATE-IMPLEMENT PASS transitioning the exact Task/spec pair into
in-progress nor one continuation PASS`.
- Issue #2433 reports the same reproduction on a different work unit and notes that hand-adding the
  paired spec path makes the scan accept the checkpoint. Issue #2395 separately owns the opaque
  diagnostic and is not absorbed here.

## Plan

- [ ] Establish which artifact owns the exact GATE-IMPLEMENT evidence-binding schema and record the
      writer/consumer contract there.
- [ ] Add a cross-component RED test that feeds the real `gate.mjs` PASS entry to the real plan-order
      checkpoint matcher for a first checkpoint.
- [ ] Cover the continuation entry form without implementing issue #2422's missing continuation mode.
- [ ] Make the writer emit, or the consumer derive, the exact shared binding without weakening
      mismatched-path, scenario-signal, or worktree refusal tests.
- [ ] Run focused gate and plan-order tests, affected harness scans, and CI-equivalent verification.

## Test Plan

- Focused RED/GREEN integration test over the actual GATE-IMPLEMENT writer output and plan-order
  consumer, including the exact Task/spec path and scenario binding.
- Focused adversarial tests for another basename, wrong lifecycle folder, mismatched scenario signal,
  and missing whole-worktree evidence.
- Existing `scripts/harness/__tests__/gate.test.mjs` and
  `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` suites.
- `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`.
- `pnpm harness:verify-like-ci` before publishing.

## User Execution Test Scenarios

Not applicable — this changes a repository-internal gate evidence contract and commit guard. It adds no
runnable product command, UI flow, public SDK behavior, configuration contract, or runtime output; the
executable surface belongs in the engineering Test Plan.

## Conversion Verification

- `node scripts/harness/task-lifecycle.mjs classify <this Task>` → `open`.
- `pnpm harness:scan` → 147/148 scans passed (99.3%). Every Task schema, lifecycle, issue-link,
  collision, placement, and scenario-section scan passed. The sole failure is a host-transcript
  conduct finding from two earlier progress messages; it is unrelated to this Task conversion and is
  not absorbed into INFRA-139.
