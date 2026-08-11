---
status: in-progress
type: INFRA
tags: [cli, typescript]
---

# HARNESS-088: Stabilize full harness tests under a parallel run

## Problem

`pnpm harness:pre-push` runs the complete 173-file harness suite. All assertions can pass while
Vitest then exits non-zero because its progress-update RPC (`onTaskUpdate`) times out in the
configured fork pool. The result blocks a feature-branch push although no test assertion failed.

## Prior Art Research

Vitest documents `maxWorkers` as a worker ceiling and pool selection separately. The repository
already sets `forks.maxForks: 4`; direct full-suite probes with two forks and with file parallelism
disabled still timed out, while the serial run took 475.82 seconds. Reducing fork concurrency is
therefore not the deciding cause.

A JSON reporter probe was not a durable remedy: the local pre-push path calls Vitest directly and
could still receive the worker RPC timeout. A thread-pool probe with `--maxWorkers=2` completed the
full suite without that error. `maxWorkers` is meaningful here because this command explicitly
selects `--pool=threads`; it does not override the existing fork-specific `maxForks` setting.
`dot` is retained only as compact terminal output, not as the timeout fix. Official references:
[parallelism](https://v3.vitest.dev/guide/parallelism),
[configuration](https://v3.vitest.dev/config/), and [terminal reporter performance issue](https://github.com/vitest-dev/vitest/issues/2602).

## Architecture Review

### Affected Scope

- `package.json` — root `harness:test` script only.
- `scripts/harness/verify-change.mjs` — direct `harness-tests` repository-check invocation.
- `scripts/harness/__tests__/self-check-glob-gate.test.mjs` — script contract regression test.

### Alternatives Considered

1. Reduce the fork worker ceiling below four. Pro: lower concurrent event pressure. Con: a two-fork
   full run still timed out and took 208.92 seconds.
2. Disable file parallelism. Pro: strongest worker reduction. Con: the complete run still timed out,
   took 475.82 seconds, and exposed a load-sensitive 10-second test timeout.
3. Run the harness suite in a bounded thread pool. Pro: the 173-file full run completes without the
   fork-worker RPC timeout while retaining two-way parallelism. Con: fork-specific worker heap
   settings do not apply to threads, so this command must retain its explicit worker ceiling.

### Decision

Choose option 3. The reporter-only and fork-concurrency probes were insufficient. The dedicated
root harness script and the direct pre-push verification owner both select a two-worker thread
pool. Package test configuration remains unchanged. A script-contract regression test pins the
pool and worker ceiling at both execution owners.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: root harness script has no CLI command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Pass `--pool=threads --maxWorkers=2 --reporter=dot` from both the root `harness:test` script and
the direct `harness-tests` repository check. Extend the existing script-contract test to require
the pool and worker ceiling at both execution owners. Repair the test-selection guard so its
exported finder also fails closed when `.github/workflows` is absent, then re-freeze the resulting
guard-ledger ceiling.

## Affected Files

- `package.json`
- `scripts/harness/verify-change.mjs`
- `scripts/harness/__tests__/self-check-glob-gate.test.mjs`
- `scripts/harness/scan-test-selection-tolerance.mjs`
- `scripts/harness/__tests__/scan-test-selection-tolerance.test.mjs`
- `scripts/harness/scan-guard-scope-fail-closed.mjs`
- `scripts/harness/guard-ledger-ceilings.json`

## Completion Criteria

- [x] TC-01: `harness:test` invokes Vitest for the complete harness test directory with
      `--pool=threads --maxWorkers=2`.
- [x] TC-02: the script-contract test fails if either direct harness-test execution owner loses the
      thread pool or worker ceiling; the test-selection finder fails closed without workflows.
- [ ] TC-03: `pnpm harness:test`, `pnpm harness:pre-push`, and `pnpm harness:verify-like-ci` complete
      with zero exit status and no hook-test timeout or
      `[vitest-worker]: Timeout calling "onTaskUpdate"` error.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                  | Notes                                             |
| ----- | ---------------------- | ------------------------------------------------ | ------------------------------------------------- |
| TC-01 | Unit                   | Vitest script-contract assertion                 | Reads both direct execution owners.               |
| TC-02 | Regression             | Focused Vitest guard and contract tests          | Pins thread settings and absent-workflow failure. |
| TC-03 | CI pipeline smoke test | `pnpm harness:test` then `pnpm harness:pre-push` | Exercises the same pre-push path.                 |

## Tasks

- [ ] `.agents/tasks/HARNESS-088-harness-test-reporter-stability.md` — active implementation record

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-11

**Status remains:** draft
**Failed criteria:**

- Evidence Log first-run state: the section contains a pre-gate draft note; GATE-WRITE requires the
  Evidence Log to be empty before this first gate run.
  **Required action:** Move the draft observation into `## Problem` (or another substantive section),
  then leave `## Evidence Log` empty before rerunning GATE-WRITE.

### [GATE-WRITE] — ✅ PASS | 2026-08-11

**Status upgrade:** draft → review-ready

- Frontmatter: YAML block begins the file; `status: draft`, `type: INFRA`, and non-empty `tags: [cli, typescript]` are present.
- Problem: names the failing `pnpm harness:pre-push` command, the post-assertion `onTaskUpdate` timeout, and the interactive full-suite reproduction condition; contains no TBD/TODO or vague one-sentence description.
- Prior Art Research: cites Vitest’s official `maxWorkers`, `fileParallelism`, and reporters documentation; the findings directly support alternatives 1–3 and the option-3 decision.
- Architecture Review: all four checklist items are checked; the sibling scan explicitly records N/A with its root-harness rationale; three alternatives contain pro/con trade-offs; the decision selects the narrow output-policy change based on the progress-RPC versus throughput trade-off. New-surface placement is N/A because this introduces no package, app, interface surface, or boundary reclassification.
- Completion Criteria: TC-01 through TC-03 cover the reporter invocation, its regression guard, and the observable pre-push success path; every criterion is command/observable-behavior form and avoids prohibited vague language.
- Test Plan: three TC rows exactly match TC-01 through TC-03; each has a non-empty test type and approach, and none uses manual testing.
- Structure: `## Tasks` contains the required post-approval placeholder; the Evidence Log is present; the body contains neither `## Status` nor `## Classification`.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-11

**Status remains:** review-ready
**Failed criteria:**

- Explicit approval in the current conversation: no direct, unambiguous user sign-off for `HARNESS-088` is recorded. The user requested a recommendation with reasons before pre-approval, but did not approve this spec document or authorize its implementation.
  **Required action:** Present the validated HARNESS-088 recommendation and obtain a direct approval statement for this spec document (for example, “HARNESS-088 승인, 진행해”) before rerunning GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-11

**Status upgrade:** review-ready → approved

- Ordering: the preceding `[GATE-WRITE] — ✅ PASS` entry is present and the document frontmatter is `status: review-ready`, the required input state.
- Explicit approval: the user stated `승인` in the current conversation after the HARNESS-088 recommendation, directly authorizing this reviewed design and implementation.
- Post-approval stability: the Architecture Review remains the documented root `harness:test` reporter decision, and frontmatter remains `type: INFRA` with `tags: [cli, typescript]`; neither surface was modified after that approval.
- Independent architecture validation: N/A — this change adds no package, app, interface surface, or layer/product-family reclassification; it changes only the root harness test-script output policy and its regression test.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-11

**Status upgrade:** approved → in-progress

- Task record created: `.agents/tasks/HARNESS-088-harness-test-reporter-stability.md`.
- TC-aligned tasks created: TC-01 configures the reporter, TC-02 pins it with a script-contract test, and TC-03 runs the pre-push verification path.
- The task record contains an engineering `## Test Plan` with focused red/green coverage plus the full `pnpm harness:pre-push` gate.

### [IMPLEMENTATION EVIDENCE] — ❌ FAIL | 2026-08-11

- The approved `--reporter=dot` implementation did not meet TC-03: `pnpm harness:test` completed all
  173 files and 3,176 assertions, then exited 1 after 88.09 seconds with the same
  `[vitest-worker]: Timeout calling "onTaskUpdate"` error.
- The reporter script and its temporary regression assertion were reverted. Follow-up full-suite
  probes disproved worker concurrency as the cause: two forks and file serialization also timed out.
  The separately measured JSON reporter run passed all 3,176 assertions with exit 0; the refreshed
  decision adopts that evidence-backed result mode.

### [IMPLEMENTATION EVIDENCE] — ⏳ IN PROGRESS | 2026-08-11

- The new script-contract assertion was proven RED before the script change (`--reporter=json` was
  absent), then GREEN with all 8 focused assertions passing.
- A complete post-change run produced a JSON result with 3,177 passed assertions, zero failures,
  and `success: true`. The one additional assertion is the new script-contract test.
- The first `pnpm harness:pre-push` verification exposed an execution-owner gap: its
  `verify-change.mjs` path calls Vitest directly rather than invoking `harness:test`, so it retained
  the default reporter and reproduced the timeout. The same JSON policy must be applied there.

### [IMPLEMENTATION EVIDENCE] — ⏳ IN PROGRESS | 2026-08-11

- The direct `verify-change.mjs` command was changed under RED→GREEN coverage. The focused contract
  suite passed 9/9, and its complete JSON-mode run passed 3,178 assertions with zero failures.
- TC-01 and TC-02 are met. TC-03 remains pending the committed-tree `pnpm harness:pre-push` run.

### [IMPLEMENTATION EVIDENCE] — ⏳ IN PROGRESS | 2026-08-11

- The JSON reporter conclusion above was superseded: it did not remove the worker-side RPC timeout
  from every direct execution path. Both owners now use `--pool=threads --maxWorkers=2`, with dot
  output only for compact diagnostics.
- The stale guard ledger exposed by the thread-pool run was repaired: the exported test-selection
  finder now rejects a missing workflow directory, and the frozen vacuous ceiling moved from 4 to 3.
- Focused regression tests passed 56/56. `pnpm harness:test` passed 173 files and 3,179 tests in
  101.93 seconds without an `onTaskUpdate` error. The pre-push gate is the remaining verification.

### [IMPLEMENTATION EVIDENCE] — ✅ PASS | 2026-08-11

- `pnpm harness:pre-push` passed from commit `1d5e94fec`. It ran the full 173-file harness suite
  successfully in the bounded thread pool, completed the selected checks for all 86 workspace
  scopes, and finished with 106 scans passed, one documented skip, and three advisory findings.
- No `[vitest-worker]: Timeout calling "onTaskUpdate"` error occurred. TC-01 through TC-03 are met.

### [CI-EQUIVALENT EVIDENCE] — ❌ FAIL | 2026-08-11

- `pnpm harness:verify-like-ci` ran the full harness suite twice. The four-worker thread pool avoided
  `onTaskUpdate`, but CPU contention caused four 10-second hook-test timeouts in `harness-self-test`
  and three in `affected-verify`; every other local CI mirror stage passed.
- Focused reproduction with the five affected files and `--maxWorkers=2` passed. The worker ceiling
  is reduced to two and TC-03 is reopened until the full CI-equivalent gate passes.
