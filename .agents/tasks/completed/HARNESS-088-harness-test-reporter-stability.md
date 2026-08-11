---
title: 'HARNESS-088: stabilize the harness test reporter under a full parallel run'
status: done
created: 2026-08-11
completed: 2026-08-12
priority: high
urgency: now
area: scripts/harness, root package scripts
depends_on: []
---

# HARNESS-088 — stabilize the full harness test run

## Objective

Remove the reproducible post-assertion `onTaskUpdate` timeout from the full harness test run while
preserving complete harness coverage.

## Plan

- [x] TC-01: Configure a bounded two-worker thread pool at every harness-suite execution owner.
- [x] TC-02: Add a regression assertion for that pool configuration at every owner.
- [x] TC-03: Run the local CI-equivalent path and record its successful result.

## Test Plan

Run the focused configuration regression test, then run `pnpm harness:test` and
`pnpm harness:pre-push`. The latter is the actual local gate whose full-suite RPC timed out.

## User Execution Test Scenarios

Not applicable: this changes an internal developer verification reporter, not a runnable product surface.

## Progress

### 2026-08-11

- Created after GATE-APPROVAL for the approved root harness-script scope.
- Red/green probe showed the proposed `--reporter=minimal` is not supported by the locked Vitest 3.2.6;
  Vitest attempted to load a package named `minimal` and exited 1. The temporary test and script edit were reverted.
- The user approved the supported `--reporter=dot` replacement; the focused script-contract suite passed
  7/7.
- The full `pnpm harness:test` run with `--reporter=dot` still completed all 173 files and 3,176
  assertions but exited 1 after 88.09 seconds with the same `[vitest-worker]: Timeout calling
"onTaskUpdate"` error. The script and its temporary assertion were reverted because the reporter
  change did not satisfy TC-03.
- The JSON contract assertion was RED before the script change, then GREEN (8/8). A post-change
  full suite produced a successful JSON report with 3,177 passed tests and zero failures.
- The pre-push gate directly invokes Vitest through `verify-change.mjs`, bypassing `harness:test`.
  That owner still reproduced the timeout, so the task remains in progress until it uses the same
  JSON reporter contract.
- The direct execution owner now has the JSON reporter and cache output path too. Its regression
  test passed 9/9; its complete run passed 3,178 tests with zero failures.

## Decisions

- Do not reduce fork parallelism: two forks and file serialization still timed out and were slower.
- Use `--pool=threads --maxWorkers=2 --reporter=dot`. The thread pool removes the fork-worker RPC
  path, while two workers avoid the 10-second hook-test timeouts reproduced under four workers in
  `harness:verify-like-ci`.

## Blockers

- The stale guard-scope ledger was resolved by making `findTestSelectionFindings` reject a missing
  workflow directory and re-freezing the reduced ceiling. No import-safety baseline change is
  needed because the temporary custom reporter was removed.

## Result

`pnpm harness:pre-push` passed from commit `1d5e94fec`: the full 173-file harness suite completed
without an `onTaskUpdate` error, 86 workspace scopes completed their selected checks, and 106 scans
passed (one documented skip and three advisory findings). A later `pnpm harness:verify-like-ci` run
reopened the task after four-worker CPU contention caused seven 10-second hook/scan test timeouts
across its two full-suite invocations. The final two-worker/30-second configuration passed the focused
215-test regression set, all 3,179 harness tests, and all 11 local CI-equivalent stages on 2026-08-12.
