---
title: 'INFRA-191: continue process-overhead reduction — lane-declaration table rows and contract-test log clarity'
status: done
created: 2026-09-06
completed: 2026-09-07
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
no-issue: process-overhead reduction requested directly by the maintainer (see /tmp/robota-issues/PROCESS-OVERHEAD-REPORT.md); no GitHub issue is the source record
---

# INFRA-191: continue process-overhead reduction — lane-declaration table rows and contract-test log clarity

## Problem

`/tmp/robota-issues/PROCESS-OVERHEAD-REPORT.md` proposes seven fixes; INFRA-174 landed two. Three
more remain: (1) `scan-lane-declaration.mjs`'s lifecycle-projection recognizer only accepts a
checklist-bullet row, not the equivalent pipe-table row `INFRA-155`'s child-Task tracking table
actually uses, so a one-line, factually-correct path fix inside that unrelated in-progress document
forces the whole branch to L2; (2) the `work-run reopen`-before-content-commit ordering constraint is
documented only inside the recovery procedure, not stated as a general rule; (3) the contract-test
distributed-shard path prints `changed-file resolution failed closed: changed-file diff was empty`
for its own deliberate `HEAD`-vs-`HEAD` forcing trick, which reads as an error even when the shard's
affected-set narrowing worked correctly.

## Resolution

1. `scan-lane-declaration.mjs`: added `LIFECYCLE_PROJECTION_TABLE_ROW` and accept it alongside the
   existing checklist-row pattern in `isLifecycleProjectionOnly()`.
2. `harness-contract-execution.mjs` / `harness-test-tiers.mjs`: the distributed-shard path now passes
   an explicit `--distributed-shard` flag instead of forcing an empty `HEAD..HEAD` diff, and reports
   `distributed shard: running its pre-filtered affected subset` instead of the misleading
   `changed-file resolution failed closed` text.
3. `.agents/rules/work-run-measurement.md`: documented the reopen-before-content-commit ordering as a
   general rule in the "Git and pull-request identity" list.

## Test Plan

- TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-lane-declaration.test.mjs`
- TC-02: `pnpm exec vitest run scripts/harness/__tests__/harness-test-tiers.test.mjs`
- TC-03: `grep -n "reopen.*before the next content commit" .agents/rules/work-run-measurement.md`
- TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` (`pnpm harness:scan` green)

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal harness/CI tooling (a lane-declaration scan's markdown-row
recognition, a contract-test shard log message, and a rules-doc note); it has no end-user runtime
surface, CLI behavior, SDK contract, or product-facing interaction to execute.
