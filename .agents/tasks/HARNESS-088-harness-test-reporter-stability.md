---
title: 'HARNESS-088: stabilize the harness test reporter under a full parallel run'
status: in-progress
created: 2026-08-11
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

- [x] TC-01: Select JSON result output for the complete harness suite without changing concurrency.
- [x] TC-02: Add a regression assertion for the reporter and ignored output destination.
- [ ] TC-03: Run the local pre-push path and record its successful result.

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

## Decisions

- Do not change `maxWorkers` or `forks.maxForks`. Full probes with two forks and without file
  parallelism still timed out, so reducing concurrency makes the gate slower without solving it.
- Use `--reporter=json` with `node_modules/.cache/robota/harness-test-report.json`: the complete
  3,176-assertion run exited 0 in about 81 seconds, while default and dot modes timed out.

## Blockers

- (none)

## Result

(Pending implementation and verification.)
