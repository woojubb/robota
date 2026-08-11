---
status: done
type: BEHAVIOR
tags: [async, typescript]
---

# BEHAVIOR-007: Make coalesced persistence ownership handoff atomic

## Problem

`packages/dag-adapters-local/src/json-collection-file.ts` coalesces file writes through
`queuedSources` and `pendingWrites`. `drainQueue()` can observe an empty queue and settle while the
derived promise's `finally` cleanup has not yet deleted `pendingWrites[filePath]`. A new persistence
request arriving in that promise-job boundary queues a newer source, sees the old owner, and receives
the old nearly-settled promise. Cleanup then removes the owner without starting a successor, so the
call reports success while the latest state remains only in memory.

Reproduction condition: pause an owner's completion cleanup after its final queue-empty observation,
submit a second `persistCollection()` request for the same path, then allow cleanup to run. The second
request's promise resolves although no writer consumes its queued source and the file retains the
first snapshot. This violates the package SPEC's restart-survival guarantee.

## Prior Art Research

### References consulted

- [Node.js event-loop and microtask ordering](https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate)
  documents that promise callbacks run from the microtask queue before the next macrotask.
- [ECMAScript `Promise.prototype.finally`](https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-promise.prototype.finally)
  specifies `finally` as a promise reaction producing a derived promise, so cleanup is not a
  synchronous extension of the operation that just settled.
- [p-queue `onIdle()` documentation](https://github.com/sindresorhus/p-queue#onidle) distinguishes an
  empty waiting queue from an idle queue with zero running promises; each `add()` retains its own task
  promise.
- [p-limit documentation](https://github.com/sindresorhus/p-limit#limitfunctionfn-options) documents
  concurrency-one invocation serialization while preserving a completion promise per invocation.
- [Node.js `LockManager.request()`](https://nodejs.org/api/worker_threads.html#locksrequestname-options-callback)
  keeps exclusive ownership through settlement of the callback promise. It is experimental and was
  added in Node 24.5, so it is a lifecycle reference rather than an implementation option for this
  repository's Node 22 runtime.

### Observed common behavior and Robota constraint

The references separate queue emptiness from owner completion and keep ownership through the full
settlement boundary. A successor either joins an owner that is guaranteed to observe it or receives a
new completion promise; delayed unconditional cleanup must not erase successor ownership. Robota needs
that guarantee per file path while preserving latest-state coalescing, unrelated-path concurrency,
atomic write-and-rename, final-attempt error semantics, zero new dependency, and Node 22 support.

### Recommendation

Retain the dependency-free coalescing design, but represent per-path ownership explicitly and perform
the final empty check plus owner release in one synchronous continuation. Install ownership before the
asynchronous drain begins and guard cleanup by owner identity. A request after release creates and
returns a successor owner promise. Add a deterministic completion-boundary regression that proves the
successor promise cannot resolve before its state is durable.

## Architecture Review

### Affected Scope

- `packages/dag-adapters-local/src/json-collection-file.ts` — per-path coalescing ownership state.
- `packages/dag-adapters-local/src/__tests__/json-collection-file.test.ts` — deterministic boundary
  interleaving coverage.
- `packages/dag-adapters-local/docs/SPEC.md` — persistence completion and coalescing contract.
- Sibling scan: `FileStoragePort` run/task persistence and `FileRunDraftStore` call this helper;
  definition and cost-meta persistence use separate implementations and are not changed.

### Alternatives Considered

1. **Promise tail per request.** Chain each physical write after the previous tail and identity-guard
   tail deletion. Pro: every request has an unambiguous promise. Con: writes every intermediate state
   and removes the intended bounded coalescing.
2. **General concurrency-one queue or mutex.** Use p-queue/p-limit or a userland lock. Pro: mature
   serialization lifecycle. Con: adds machinery and still needs custom latest-state coalescing;
   Node's built-in lock is unavailable on Node 22.
3. **Atomic owner handoff in the existing coalescer (chosen).** Couple final queue inspection and
   owner release synchronously, with identity-aware ownership. Pro: preserves coalescing, per-path
   independence, and existing failure semantics without dependencies. Con: the state machine needs a
   focused deterministic interleaving test to keep its handoff invariant visible.

### Decision

Choose alternative 3. The defect is not write ordering inside `drainQueue`; it is the gap between the
last empty observation and delayed ownership deletion. Keeping that transition synchronous directly
closes the reachable race while preserving every current caller and filesystem boundary. Consumers
retain the same `persistCollection()` API, atomic publication, and latest-state semantics. Adversarial
review covers requests before drain, during write, at completion handoff, and after owner release,
including a final write failure.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — helper consumers and sibling persistence implementations inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Red-prove the completion-boundary interleaving through an injected owner-drain seam or exported pure
state transition that cannot alter production behavior. Replace the separate `finally` deletion with
an explicit per-path owner whose drain loop consumes the latest queued source and releases itself only
after an uninterrupted final empty check. Cleanup must delete only the owner whose identity is still
registered. Preserve final-attempt error behavior and allow a post-release request to install a new
owner immediately.

## Affected Files

- `packages/dag-adapters-local/docs/SPEC.md`
- `packages/dag-adapters-local/src/json-collection-file.ts`
- `packages/dag-adapters-local/src/__tests__/json-collection-file.test.ts`
- `.agents/tasks/BEHAVIOR-007-persistence-drain-handoff.md`

## Completion Criteria

- [x] TC-01: A deterministic completion-boundary test submits a successor after the prior owner has
      observed an empty queue; the successor promise remains pending until its state is written and
      the final serialized file contains that successor state.
- [x] TC-02: Concurrent requests for one file remain coalesced and serialized, while requests for
      different file paths remain independently writable.
- [x] TC-03: A failure of the final write attempt rejects the owning promise, while an earlier failure
      superseded by a later successful latest-state write resolves with the latest state durable.
- [x] TC-04: `pnpm --filter @robota-sdk/dag-adapters-local test` and
      `pnpm --filter @robota-sdk/dag-adapters-local build` exit 0.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                                                                                                                                                                                                                       | Notes                                                                            |
| ----- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TC-01 | Async state unit test | `packages/dag-adapters-local/src/__tests__/json-collection-file.test.ts` > `persistCollection` > `TC-01 keeps a successor queued at owner release pending until it is durable`                                                                                        | Proves the exact P0 interleaving.                                                |
| TC-02 | Async state unit test | Same file > `TC-02 keeps different file owners independent`; `the FINAL state wins after concurrent writes`                                                                                                                                                           | Preserves coalescing and path isolation.                                         |
| TC-03 | Unit test             | Same file > `drainQueue` > both `TC-03` later-success and final-failure tests                                                                                                                                                                                         | Preserves current error contract.                                                |
| TC-04 | Package regression    | Automated test skipped: this criterion is the aggregate execution of `pnpm --filter @robota-sdk/dag-adapters-local test` and `pnpm --filter @robota-sdk/dag-adapters-local build`; a dedicated test would only test the package scripts rather than product behavior. | The commands execute all 6 package test files / 79 tests and both build formats. |

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-007-persistence-drain-handoff.md` — TC-01 through TC-04 implementation and verification

## Evidence Log

### Implementation Evidence | 2026-08-12

- RED: with only a behavior-preserving injection seam over the pre-fix delayed-cleanup algorithm,
  focused Vitest failed TC-01 because `initialSettled` was already `true` at the owner-release
  boundary (expected `false`, actual `true`); the other 11 tests passed. Exit code 1. This directly
  reproduced the successful-promise-before-successor-durability defect rather than a missing symbol.
- GREEN: `json-collection-file.test.ts` passed 12/12, including TC-01 atomic handoff, TC-02 path
  independence, and both TC-03 error cases. Package regression passed 6/6 files and 79/79 tests.
- Package verification: lint completed with 0 errors (7 existing warning-class findings), typecheck
  exited 0, and build exited 0.
- Mechanical conformance: `pnpm harness:conformance` exited 0 with `dependencyDirection: pass`,
  `packageNameViolations: 0`, `unknownPackageTokens: []`, and `conformant: true`; `pnpm harness:scan`
  passed 107 scans with 2 context skips.
- Independent architecture re-audits both classified the former completion-boundary P0 as RESOLVED,
  found no new P0, and returned `ACTIONABLE FINDINGS: 0` for BEHAVIOR-007.

### [GATE-COMPLETE: TC-01] | 2026-08-12

- Command: `pnpm --filter @robota-sdk/dag-adapters-local exec vitest run src/__tests__/json-collection-file.test.ts --reporter=dot`.
- Result: 1 file and 12 tests passed; `TC-01 keeps a successor queued at owner release pending until it is durable` held the cohort promise pending until the second write completed.
- Exit code: 0.

### [GATE-COMPLETE: TC-02] | 2026-08-12

- Command: `pnpm --filter @robota-sdk/dag-adapters-local exec vitest run src/__tests__/json-collection-file.test.ts --reporter=dot`.
- Result: TC-02 proved a blocked first path did not block a second path; the 50-call final-state and overtaking cases preserved same-path coalescing and serialization.
- Exit code: 0.

### [GATE-COMPLETE: TC-03] | 2026-08-12

- Command: `pnpm --filter @robota-sdk/dag-adapters-local exec vitest run src/__tests__/json-collection-file.test.ts --reporter=dot`.
- Result: both TC-03 cases passed: later success superseded an earlier failure, and an unsuperseded final failure rejected.
- Exit code: 0.

### [GATE-COMPLETE: TC-04] | 2026-08-12

- Commands: `pnpm --filter @robota-sdk/dag-adapters-local test`; `pnpm --filter @robota-sdk/dag-adapters-local build`.
- Result: package regression passed 6/6 files and 79/79 tests; CJS and ESM builds completed.
- Exit codes: 0 and 0.

### [GATE-WRITE] — ✅ PASS | 2026-08-12

**Status upgrade:** draft → review-ready

- Frontmatter: valid YAML block begins the file; `status: draft`, allowed singleton `type: BEHAVIOR`, and non-empty `tags` are present.
- Problem: identifies the concrete stale-owner promise race in `json-collection-file.ts`, gives the exact completion-cleanup interleaving needed to reproduce it, and contains no TBD/TODO or vague placeholder description.
- Prior Art Research: cites Node.js and ECMAScript lifecycle documentation plus queue/limit API documentation, derives the ownership-through-settlement requirement, and feeds that evidence into the three alternatives and the chosen decision.
- Architecture Review: all four checklist items are checked; affected scope and sibling consumers/implementations are named; three alternatives each state pros and cons; the Decision names atomic handoff as the trade-off preserving coalescing, path independence, and failure semantics. New-surface placement is N/A because this spec changes an existing internal persistence helper and introduces no package, app, presentation/interface surface, or layer/product-family boundary.
- Completion Criteria: 4 criteria are present as `TC-01` through `TC-04`; each distinct behavior or regression sub-item has an observable or command-form criterion, with none of the prohibited vague phrases.
- Test Plan: 4 rows map one-to-one to the 4 Completion Criteria; every row has a non-empty Test Type and Tool / Approach, and no row uses a manual tool requiring a skip explanation.
- Structure: Tasks contains the required post-approval creation placeholder; Evidence Log was present and empty before this first gate entry; no body `## Status` or `## Classification` section exists.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-12

**Status remains:** review-ready
**Failed criteria:**

- Explicit approval directed at this spec: the cited statements — `자꾸 왜 목표를 차단하나? 해결하면서 가야지`, `모든 브랜치는 main브랜치에 머지되어야 하며 워크트리도 다 분산되어 있는거 제거되며 통합되어야 함`, and the later permission to commit — authorize continued resolution, repository integration, and commits in general, but do not identify or unambiguously approve `BEHAVIOR-007` or its atomic-owner-handoff design. The spec was not the stated object of those approvals.
  **Required action:** obtain a direct, unambiguous user statement approving this spec's recommended atomic owner-handoff design and authorizing its implementation, then re-run GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-12

**Status upgrade:** review-ready → approved

- Explicit approval: the user's standing directive was `그런거 나에게 뭍너보지 말고 타당한 이유와 함께 추천안을 제시하면 타당할 경우 내가 사전 승인합키다`; the exact recommendation presented before this gate identified a release-blocking P0 durability defect and proposed a red-first deterministic test plus synchronous atomic owner handoff while preserving coalescing, per-path concurrency, error semantics, Node 22 support, and zero dependency/API expansion. Those concrete reasons are technically supported by this spec's Problem, Prior Art Research, Alternatives, and Decision, so the recommendation satisfies the stated condition and activates the user's preapproval for this narrowly scoped fix.
- Direct and unambiguous scope: the recommendation maps directly to `BEHAVIOR-007`'s named defect, chosen alternative, affected files, and TC-01–TC-04 rather than to unrelated backlog work; the user's later `자꾸 왜 목표를 차단하나? 해결하면서 가야지` confirms that qualifying fixes should proceed instead of being paused for repetitive approval.
- Approval integrity: the inspected frontmatter `type: BEHAVIOR` and `tags: [async, typescript]`, Architecture Review, and Decision match the approved recommendation; no post-approval change to those surfaces was identified in the supplied conversation or current repository state.
- Independent architecture validation: N/A because the spec changes an existing internal persistence helper and introduces no package, app, presentation/interface surface, or layer/product-family boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-12

**Status upgrade:** approved → in-progress

- Ordering: the latest `GATE-APPROVAL` entry is a structured PASS and the document is in the expected `approved` state under `spec-docs/todo/`.
- Task artifact: `.agents/tasks/BEHAVIOR-007-persistence-drain-handoff.md` exists and is recorded in this document's `## Tasks` section.
- TC-01 task: add the deterministic empty-observation/owner-release RED test and make the successor promise await durable publication.
- TC-02 task: preserve same-path coalescing/serialization and independent different-path writes.
- TC-03 task: preserve final-attempt rejection and earlier-failure supersession semantics.
- TC-04 task: run package tests, build, affected verification, and release conformance re-audit.
- Task test plan: the task contains a substantive `## Test Plan` naming focused Vitest, package test/build, `harness:conformance`, and branch verification commands; it exceeds the required 50 characters.
- Premature implementation check: the affected source, test, and package SPEC have no working-tree diff, and their latest recorded commits predate this task; no source implementation of BEHAVIOR-007 was found before task creation.

### [GATE-VERIFY] — ✅ PASS | 2026-08-12

**Status upgrade:** in-progress → verifying

- Task completion: `.agents/tasks/BEHAVIOR-007-persistence-drain-handoff.md` has all four Plan items TC-01 through TC-04 checked; its Progress and Result describe the completed owner-handoff implementation, and `## Blockers` states `None` with no pending or blocked task recorded.
- Focused verification: `pnpm --filter @robota-sdk/dag-adapters-local exec vitest run src/__tests__/json-collection-file.test.ts` exited 0; 1 test file passed and all 12 tests passed, including TC-01, TC-02, and TC-03 coverage.
- Affected-package tests: `pnpm --filter @robota-sdk/dag-adapters-local test` exited 0; 6 test files passed and all 79 tests passed.
- Affected-package build: `pnpm --filter @robota-sdk/dag-adapters-local build` exited 0; both CJS and ESM outputs completed successfully.

### [GATE-CONFORMANCE] — ✅ PASS | 2026-08-12

**Status upgrade:** verifying → verifying (standalone gate; no status transition)

- Mechanical conformance: `pnpm harness:conformance` was run independently and exited 0.
- CONFORMANCE_JSON summary: `dependencyDirection` is `pass`, `packageNameViolations` is `0`, `unknownPackageTokens` is `[]`, and `conformant` is `true`.
- Analytic architecture result: both architecture re-audits found the former completion-boundary durability P0 RESOLVED; unresolved P0 count is 0 and the BEHAVIOR-007 change returned `ACTIONABLE FINDINGS: 0`.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-12

**Status remains:** verifying
**Failed criteria:**

- TC-04 Test Plan traceability: TC-04 records the package test/build commands and their successful results, but it records neither an automated test reference in the required `test file path + test/describe name` form nor an explicit reason why a separate automated test was not written. A command-form completion criterion does not by itself satisfy the catalogue's per-Test-Plan-row test-reference-or-skip requirement.
  **Required action:** update the TC-04 Test Plan row or its completion evidence with an explicit test-skipped reason explaining that TC-04 is the package-level regression command gate rather than behavior requiring a distinct test function, then re-run GATE-COMPLETE.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-12

**Status upgrade:** verifying → done

- Completion Criteria: TC-01 through TC-04 are all checked and each has a matching `[GATE-COMPLETE: TC-N]` entry with the exact verification command, observed result, and exit code 0.
- TC-01 test traceability: `packages/dag-adapters-local/src/__tests__/json-collection-file.test.ts` > `persistCollection` > `TC-01 keeps a successor queued at owner release pending until it is durable` exists and passed.
- TC-02 test traceability: the same test file contains `TC-02 keeps different file owners independent` and `the FINAL state wins after concurrent writes`; both are recorded for path independence and same-path coalescing.
- TC-03 test traceability: the same test file's `drainQueue` suite contains both named TC-03 later-success and final-failure tests, and both passed.
- TC-04 test disposition: the Test Plan now explicitly records `Automated test skipped` with the specific reason that TC-04 is itself the aggregate package test/build command gate and a dedicated test would only test package scripts; its two commands separately record exit code 0.
- Task archive: `.agents/tasks/completed/BEHAVIOR-007-persistence-drain-handoff.md` exists with `status: done`, `completed: 2026-08-12`, all four plan items checked, no blockers, and a completed Result; the former active task path is absent.
- Pointers: this document's `## Tasks` section references the archived task path, and the archived task's Spec pointer names the required post-gate destination `.agents/spec-docs/done/BEHAVIOR-007-persistence-drain-handoff.md`.
- Final summary: all four criteria have verification and test/disposition traceability, affected-package test/build passed, the task is archived, and no completion blocker remains.
