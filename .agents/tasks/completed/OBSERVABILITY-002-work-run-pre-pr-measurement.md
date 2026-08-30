---
title: 'OBSERVABILITY-002: measure work runs before pull-request creation'
status: done
completed: 2026-08-31
created: 2026-08-30
priority: high
urgency: now
area: .agents, scripts/harness, .husky
depends_on: []
no-issue: directly requested repository workflow instrumentation; no GitHub issue exists
---

# OBSERVABILITY-002: measure work runs before pull-request creation

## Objective

Make the currently invisible claim-to-PR interval measurable by phase without confusing repository-
observed claim time with user-message arrival, and enforce that measurable work carries a validated
receipt before it is pushed.

## Plan

- [x] TC-01: Implement universal topic-branch claim/exclusion and the pure, locked event lifecycle.
- [x] TC-02: Implement receipt revisions, exact Git identity, and authorized post-PR generations.
- [x] TC-03: Add reachable fresh-worktree commit correlation and source-mode tests.
- [x] TC-04: Reuse classification/authorization owners and enforce the versioned cutover locally/in CI.
- [x] TC-05: Add bounded first-PR metrics and separate post-PR rework generations.
- [x] TC-06: Wire metric/eval/harness registries, rule, mandatory workflow skills, and commands.
- [x] TC-07: Record command-level and RED→GREEN proof, then pass focused/full verification.
- [x] TC-08: Remove the measured local harness bottlenecks that obscured this run's pre-PR timing.

## Progress

- 2026-08-30: The first full contract run exceeded 20 minutes. Measurement isolated a global
  `--fileParallelism=false` regression, a duplicate hermetic tier, and repeated shell/Git/grep
  fixture setup. Restored bounded two-file concurrency, removed 73 duplicate test-file executions,
  and replaced repeated fixture processes with isolated seeds, batches, or in-process traversal.
- 2026-08-30: Reviewed `/tmp/robota-large-suite-gating-handoff.md`. This branch changes the harness
  control plane, so it still owes the full repository-contract gate or an exact reusable receipt;
  the optimization keeps that coverage while removing duplicate/serial execution. Moving full-suite
  ownership out of docs/governance-only pre-push is a separate policy change and is not applied here.
- 2026-08-31: Added TC-08 after GATE-IMPLEMENT because this run's own measurement exposed a blocking
  harness-performance regression. The independent before/after sample fell from 96.72 seconds for 136
  tests to 46.02 seconds for 140 tests (52.4% lower wall time), while 73 duplicate hermetic test-file
  executions were removed. Final full-suite evidence remains required before completion.
- 2026-08-31: Removed the final suite-load failure by scheduling the process-heavy Bash oracle as one
  isolated contract invocation without changing tier ownership. The committed contract run passed all
  211 files and 4,784 tests: 210 files/4,562 tests in 220.47 seconds plus the isolated 222-test oracle
  in 32.31 seconds. Exact execution-plan tests prove both `contracts` and `all` contain no duplicate or
  missing file.
- 2026-08-31: The first CI-equivalent run passed 12/13 stages but the root manifest's harness-only
  command changes selected all 92 product scopes, spent 157.2 seconds, and reached intentionally
  Linux-only project-mutation tests on macOS. Extended the existing semantic manifest classifier so
  harness-only scripts select 0 product scopes while mixed product/dependency changes still fail closed;
  the formerly failing `affected-verify` stage now passes in 1.0 second.
- 2026-08-31: The next CI-equivalent run exposed only the file-size ratchet: `check-plan.mjs` and
  `shared.mjs` had grown 6 and 3 lines past their frozen limits. Extracted repository-check and
  manifest-change classification into independently tested, top-level measured modules, reducing the
  owners to 382 and 748 lines and locking those lower baselines. The final mirror passed all 13 stages
  in 5m 27.2s, including 149 scans, the full contract/hermetic suites, typecheck, and lint ceiling.

## Result

- Work-run lifecycle, immutable receipt validation, Git/PR correlation, cutover, reporting, and
  pre-push/required-CI enforcement are implemented under one repository-local schema.
- The harness suite no longer globally serializes files or repeats the stripped hermetic tier, and its
  subprocess-heavy oracle is isolated behind a finite timeout instead of being killed by normal suite
  contention.
- Harness-only root manifest changes now select 0/92 product scopes while retaining repository harness
  checks, and the classification helpers remain inside the file-size and import-safety measurement floors.
- Final gate receipts and the green 13/13 CI-equivalent evidence are recorded in the bound spec document.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this is internal repository workflow instrumentation and Git enforcement with
no Robota product-facing execution surface. Harness CLI and Git-hook fixtures are engineering verification.

## Test Plan

- Run focused Vitest suites for transitions, concurrent storage, receipts, real Git hooks, validation,
  pre-push/CI reachability, reporting, and command-level smoke behavior.
- Run the repository skill validator for `track-work-run`.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`.
- Exercise the real CLI on this branch and record its receipt/report output.

## Bound spec document

`.agents/spec-docs/done/OBSERVABILITY-002-work-run-pre-pr-measurement.md`
