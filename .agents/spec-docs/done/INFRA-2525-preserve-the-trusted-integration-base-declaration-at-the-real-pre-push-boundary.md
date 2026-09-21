---
status: done
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-2525: preserve the trusted integration base declaration at the real pre-push boundary

Paired with `.agents/tasks/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`. Arising from [issue #2525](https://github.com/woojubb/robota/issues/2525).

## Problem

The documented clean integration-base push form
`HARNESS_BASE_REF=origin/integration/agreement-014 git push origin integration/agreement-014`
passes the trusted-base declaration to Git, but `.husky/pre-push` invokes
`scripts/harness/pre-push.mjs`, whose `runPostVerdictGuard` adapter synthesizes a second tool payload
containing only `git push`. The shared guard therefore cannot see the trusted base and rejects the
otherwise valid single clean sync merge as foreign history. This reproduces whenever an
`integration/agreement-<number>` branch must be synchronized after `origin/develop` advances.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- Harness runtime adapter: `scripts/harness/pre-push-local-checks.mjs`
- Harness regression coverage: `scripts/harness/__tests__/pre-push-sequence.test.mjs`
- Work records: paired INFRA-2525 Task/spec, `.agents/learn.md`, and the user-request-gate ledger

### Alternatives Considered

1. Rehydrate only a syntactically validated `HARNESS_BASE_REF` in the synthetic command built by
   `runPostVerdictGuard`.
   - Pro: preserves the evidence already present at the real Git boundary without changing the
     authoritative shell guard or override semantics.
   - Con: the adapter must maintain one narrow validation rule for trusted integration refs.
2. Change `.claude/hooks/pre-push-check.sh` to accept `HARNESS_BASE_REF` directly from ambient process
   state when the synthetic command omits it.
   - Pro: centralizes the fallback in the guard that consumes the declaration.
   - Con: changes an L2 policy hook and weakens the existing requirement that each push statement
     visibly owns its declaration.
3. Skip the repeated guard at the Git hook boundary for integration-base syncs.
   - Pro: avoids duplicate parsing.
   - Con: bypasses the real-boundary enforcement this adapter exists to provide and is therefore
     unacceptable.

### Decision

**Alternative 1.** The valid declaration is already inherited by the Git hook as process state, so
the smallest honest repair is to project that one validated value back into the synthetic command the
shared guard actually judges. The shell guard remains the sole policy owner; absent declarations keep
the exact existing `git push` behavior, and malformed non-empty values fail closed before spawning.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Extend `runPostVerdictGuard` with an injectable environment. When `HARNESS_BASE_REF` is absent, retain
the current `git push` payload. When it exactly matches
`origin/integration/agreement-<number>`, prefix the synthetic command with that declaration. Reject a
non-empty value outside that grammar without spawning the shared guard. Add focused tests for all
three paths and retain the existing explicit-zero/non-zero guard-result contract.

## Affected Files

- `scripts/harness/pre-push-local-checks.mjs`
- `scripts/harness/__tests__/pre-push-sequence.test.mjs`
- `.agents/tasks/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`
- `.agents/spec-docs/**/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`
- `.agents/learn.md`
- `.agents/loop-runs/user-request-gate.jsonl`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1` → exits 0, and the valid-base regression fails with the implementation reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: the focused suite proves absent declarations remain `git push`, a valid trusted base is preserved exactly once, and a malformed non-empty base is rejected before the guard spawns

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1` | `scripts/harness/__tests__/pre-push-sequence.test.mjs` — `describe('post-verdict guard reaches the real Git pre-push boundary')` / `it('preserves a trusted integration-base declaration in the replayed command')`; RED with the fix reverted, GREEN with it |
| TC-02 | Suite     | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Affected scans plus `scripts/harness/__tests__/pre-push-sequence.test.mjs` — `describe('post-verdict guard reaches the real Git pre-push boundary')` / `it('preserves a trusted integration-base declaration in the replayed command')` |
| TC-03 | Unit      | `scripts/harness/__tests__/pre-push-sequence.test.mjs` spawn-input assertions | `describe('post-verdict guard reaches the real Git pre-push boundary')` / `it('refuses when the shared agent guard returns a non-zero status')`, `it('preserves a trusted integration-base declaration in the replayed command')`, and `it('rejects a malformed non-empty base declaration before spawning the guard')` |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` — done

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-21

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된 추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다."
**Given:** 2026-09-21, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <4 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 4 changed path(s) — committed and working-tree changes vs origin/develop (merge base 120a895cca0e) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md) is at or above the floor L0)
**Review fingerprint:** 97b1549a82c1 (review 48cd6e5b, type/tags 2433998c)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `120a895cca0e` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/draft/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `aff7038db327` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-21, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <4 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 4 changed path(s) — committed and working-tree changes vs origin/develop (merge base 120a895cca0e) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md) is at or above the floor L0)
**Review fingerprint:** 97b1549a82c1 (review 48cd6e5b, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (97b1549a82c1) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `120a895cca0e` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/draft/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `87dfdf946baf` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 598 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (97b1549a82c1) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `120a895cca0e` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/draft/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `f20aa09cc6e8` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

[pre-push] Blocked: HARNESS_BASE_REF must name origin/integration/agreement-<number> at the Git pre-push boundary.
[pre-push] Blocked: post-verdict action-request guard did not approve this push.
 ✓ scripts/harness/__tests__/pre-push-sequence.test.mjs (31 tests) 6ms

 Test Files  1 passed (1)
      Tests  31 passed (31)
   Start at  13:43:02
   Duration  157ms (transform 40ms, setup 0ms, collect 50ms, tests 6ms, environment 0ms, prepare 23ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6353115de986` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/todo/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `177b85df2383` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 193 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c36-c2t-c2u-c2t-c36-c2t-c32-c2r-c2t-c19-c2z-c2x-c32-c2s-c19-c35-c39-c2p-c30-c2x-c2u-c2x-c2t-c2s [finding] scan:reference-kind-qualified
  evidence: Scan reference-kind-qualified exited with status 1.
  recommendation: Inspect the reference-kind-qualified scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

61 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (64 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (reference-kind-qualified, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6353115de986` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/todo/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `bd19f92b45b6` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

[pre-push] Blocked: HARNESS_BASE_REF must name origin/integration/agreement-<number> at the Git pre-push boundary.
[pre-push] Blocked: post-verdict action-request guard did not approve this push.
 ✓ scripts/harness/__tests__/pre-push-sequence.test.mjs (31 tests) 6ms

 Test Files  1 passed (1)
      Tests  31 passed (31)
   Start at  13:43:02
   Duration  157ms (transform 40ms, setup 0ms, collect 50ms, tests 6ms, environment 0ms, prepare 23ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `6353115de986` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/todo/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `20241bb26240` (modified)

### [GATE-DONE] — ❌ FAIL | 2026-09-21

**Status remains:** approved
**Failed criteria:**

- GATE-COMPLETE — For each TC-N in `## Test Plan`, a written test records the test file path plus the test function/describe name: TC-01, TC-02, and TC-03 name `scripts/harness/__tests__/pre-push-sequence.test.mjs`, but none records the exact `describe`/`it` name that supplies its evidence.
  **Required action:** update each Test Plan row with the exact test reference under `post-verdict guard reaches the real Git pre-push boundary` (and retain the scan command for TC-02), or record an explicit skip reason where no automated test exists.
- GATE-COMPLETE — No TC-N is silently unaddressed: all three rows have a test-file path, but the catalogue-defined test-reference form is incomplete without a function/describe name.
  **Required action:** bind TC-01 through TC-03 to their exact `describe`/`it` names.
- GATE-COMPLETE — `## Test Plan` is updated with test references or skip reasons for all TC-N rows: the current rows stop at a file or generic "spawn-input assertions" description and therefore do not meet the required reference shape.
  **Required action:** replace the generic references with exact file-plus-test-name references.

**Observed verification:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1` → exit 0, 31/31 tests passed; `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0, 61 scans passed with two unrelated PR-context advisories.
**Judged by:** `backlog-gate-guard` independent semantic review

### [GATE-DONE] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → done

- GATE-DONE — ordering: recorded `[GATE-PLAN] — ✅ PASS` upgraded this L1 document from `draft` to its current `approved` status.
- GATE-VERIFY — Every item in the exact Task's `## Plan` is marked complete: 4/4 items are `[x]`.
- GATE-VERIFY — No Plan item is blocked or pending: all four items are complete and none is labelled blocked or pending.
- GATE-VERIFY — Build passes for the affected scope: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exited 0 with 61 scans passed; the two reported failures are unrelated advisories explicitly tolerated in PR context.
- GATE-VERIFY — Tests pass for the affected scope: `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs --pool=threads --maxWorkers=1 --minWorkers=1` exited 0 with 31/31 tests passed.
- GATE-COMPLETE — Every Completion Criteria checkbox is checked: TC-01 through TC-03 are `[x]`.
- GATE-COMPLETE — Every TC has a verification entry: `[GATE-COMPLETE: TC-01]`, `[GATE-COMPLETE: TC-02]`, and `[GATE-COMPLETE: TC-03]` each record the exact command, observed output, and exit 0.
- GATE-COMPLETE — Every Test Plan row records a complete automated-test reference: each names `scripts/harness/__tests__/pre-push-sequence.test.mjs` plus the exact `describe` and applicable `it` name(s); TC-02 also retains the affected-scan command.
- GATE-COMPLETE — No TC is silently unaddressed: TC-01, TC-02, and TC-03 each have both verification evidence and an exact test reference.
- GATE-COMPLETE — The spec's `## Completion Criteria` is complete: 3/3 checkboxes are `[x]`.
- GATE-COMPLETE — The spec's `## Test Plan` is complete: 3/3 rows carry file-plus-test-name references.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active Task path under `.agents/tasks/`.
- GATE-COMPLETE — The active Task exists and is completion-ready: its four Plan items are `[x]`, with no pending or blocked item.

**Judged by:** `backlog-gate-guard` independent semantic review
**Judged at:** HEAD `6353115de986` · base `origin/develop@120a895cca0e` · document `.agents/spec-docs/todo/INFRA-2525-preserve-the-trusted-integration-base-declaration-at-the-real-pre-push-boundary.md` blob `e1ec494cfe83` (modified)
