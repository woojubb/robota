---
status: done
type: INFRA
tags: [harness, ci]
lane: L1
---

# INFRA-166: Propagate CI mirror base context

## Problem

CI mirror --base-ref selects one comparison range but children that read HARNESS_BASE_REF instead receive the ambient environment or origin/develop. During INFRA-165 completion the same run selected the original range yet plan-order and work-run scans judged only later metadata, rejecting a real prior plan and receipt. Passing the base globally also exposed an independently corrected fixture isolation defect.

## Prior Art Research

Waived: bounded internal execution-context bug; existing option parsing and receipt identity remain authoritative.

## Architecture Review

### Affected Scope

CI mirror execution orchestration and its focused tests; no product package or policy changes.

### Alternatives Considered

1. Establish one execution-scoped environment from the parsed base, restoring it in finally.
   - Pro: all existing inherited-environment consumers and receipt creation see one selected base.
   - Con: scope must be restored on every exit and is for serial CLI execution.
2. Thread explicit environment arguments through every downstream adapter.
   - Pro: supports concurrent in-process runs.
   - Con: widens unrelated adapter signatures despite the serial CLI contract.

### Decision

**Delivery mode:** `single`

Choose alternative 1 for the serial CLI owner. CLI parsing retains precedence and the scoped environment covers preflight, context resolution, all stages and receipt writing. Preserve the original environment on success, failure and throw. Concurrent in-process main calls are not an existing supported invocation contract.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal repository machinery, no product command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Bind the parsed options.baseRef to HARNESS_BASE_REF at the single main execution boundary, then restore its prior presence and value in finally. Keep stage selection, exit handling and receipt base arguments unchanged. Verify actual stage and receipt consumers through existing test seams. Do not change selector fallback logging, product code, fixture policy or gate thresholds.

## Affected Files

- `scripts/harness/verify-like-ci-execution.mjs`
- `scripts/harness/__tests__/verify-like-ci.test.mjs` and a focused execution test file if existing import-mocking boundaries require isolation.
- This spec and paired Task.

## Completion Criteria

- [x] TC-01: Explicit CLI base is observed by all stage children and the verification receipt instead of an inherited conflicting base.
- [x] TC-02: The original environment is restored after successful, failed and throwing verification execution, including an originally absent base.
- [x] TC-03: Focused CI mirror regression tests and native Node syntax checks exit zero after a reproduced RED.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                                                       | Notes                                                                                                    |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration | `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` > CI mirror execution base context                                                      | Stage and receipt observe CLI base; inherited conflicting base cannot win.                               |
| TC-02 | Unit        | `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` > CI mirror execution base context                                                      | Successful, failed, thrown exits and absent original value.                                              |
| TC-03 | Regression  | `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` > CI mirror execution base context; existing mirror and checkpoint suites; node --check | Actual RED then GREEN; root final full gate after completion artifacts and receipt closure, before push. |

## User Execution Test Scenarios

Not applicable.

**Reason:** Internal repository verification machinery only; no shipped product user behavior or latent product capability.

## Tasks

- [x] `.agents/tasks/completed/INFRA-166-propagate-ci-mirror-base-context.md` — focused verification complete; independent DONE passed

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "발견절차문제 즉시수정/develop"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** acfef82ce4bb (review f4fe5bc6, type/tags 5f52f5f7)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (acfef82ce4bb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `5c10d330b11a` · base `origin/develop@5c10d330b11a` · document `.agents/spec-docs/draft/INFRA-166-propagate-ci-mirror-base-context.md` blob `b9a6090878b7` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 412 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (acfef82ce4bb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-166-propagate-ci-mirror-base-context.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-166-propagate-ci-mirror-base-context.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `5c10d330b11a` · base `origin/develop@5c10d330b11a` · document `.agents/spec-docs/draft/INFRA-166-propagate-ci-mirror-base-context.md` blob `c5ed72084a47` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/verify-like-ci-execution.test.mjs","scripts/harness/__tests__/verify-like-ci.test.mjs","scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/ci-mirror-base-context

···················································································

 Test Files  3 passed (3)
      Tests  83 passed (83)
   Start at  19:54:33
   Duration  3.92s (transform 979ms, setup 0ms, collect 1.40s, tests 3.83s, environment 0ms, prepare 258ms)

7:54:33 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `b954a1937cfb` · base `origin/develop@5c10d330b11a` · document `.agents/spec-docs/todo/INFRA-166-propagate-ci-mirror-base-context.md` blob `1f81dba4826b` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/verify-like-ci-execution.test.mjs","scripts/harness/__tests__/verify-like-ci.test.mjs","scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/ci-mirror-base-context

···················································································

 Test Files  3 passed (3)
      Tests  83 passed (83)
   Start at  19:54:33
   Duration  3.92s (transform 979ms, setup 0ms, collect 1.40s, tests 3.83s, environment 0ms, prepare 258ms)

7:54:33 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `b954a1937cfb` · base `origin/develop@5c10d330b11a` · document `.agents/spec-docs/todo/INFRA-166-propagate-ci-mirror-base-context.md` blob `37138962b36f` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/verify-like-ci-execution.test.mjs","scripts/harness/__tests__/verify-like-ci.test.mjs","scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/ci-mirror-base-context

···················································································

 Test Files  3 passed (3)
      Tests  83 passed (83)
   Start at  19:54:33
   Duration  3.92s (transform 979ms, setup 0ms, collect 1.40s, tests 3.83s, environment 0ms, prepare 258ms)

7:54:33 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `b954a1937cfb` · base `origin/develop@5c10d330b11a` · document `.agents/spec-docs/todo/INFRA-166-propagate-ci-mirror-base-context.md` blob `15af31e7782b` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → done

**Guardian:** recover_approved_artifacts. Independent completion judgment using existing actual evidence; no test/build rerun and no author-content changes.

**Ordering:** PASS — L1 document is approved in todo/, with GATE-PLAN PASS recorded before the planning checkpoint `b954a1937cfb898764cafda601429cc8158a31fd`.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): PASS — exact INFRA-166 Task Plan has TC-01 through TC-03 checked, 3/3.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — none of the three Plan items is blocked or pending.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS — no product package is affected; changed source is native Node ESM, without a compilation target. The implementation worker reports actual `node --check` exit 0 for `scripts/harness/verify-like-ci-execution.mjs` and `scripts/harness/__tests__/verify-like-ci-execution.test.mjs`. This is scoped syntax evidence, not a claim that a product build ran.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS — existing canonical vitestInvocation command recorded in all three TC entries ran the execution, mirror and checkpoint suites; `/tmp/infra166-focused.log` confirms 3 files, 83 tests PASS, exit 0, 3.92 seconds.
- GATE-COMPLETE — The checkbox is checked (`[x]`): PASS — TC-01, TC-02 and TC-03 are individually checked.
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: PASS — each of TC-01, TC-02 and TC-03 has its own entry containing the exact three-suite command, actual output and exit 0.
- GATE-COMPLETE — **One of the following is recorded:** PASS — every TC row records `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` and actual describe `CI mirror execution base context`.
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: PASS — all three rows have explicit test references; none skipped silently.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: PASS — 3/3.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: PASS — TC-01 through TC-03 reference the exact execution suite.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: PASS — `.agents/tasks/INFRA-166-propagate-ci-mirror-base-context.md`.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: PASS — exact active Task exists, Plan complete; terminal status/date and archive remain post-PASS actions.

**Behavior evidence:** TC-01 observes the selected base in actual spawned child processes and the receipt invocation. TC-02 covers successful, failing, throwing, receipt-throw and early-return paths, including originally absent environment values. `/tmp/infra166-red.log` preserves original failure (`caller-base` instead of `selected-base`). No original failure is relabelled or hidden.

**Evidence binding:** HEAD `b954a1937cfb898764cafda601429cc8158a31fd` plus reviewed implementation; base `5c10d330b11a944b9a70cd319b189632e9bddbeb`. Source SHA256 `48aefdf2c949c54a1f74d94646e929d8987092f4366d3db4f9b9566a06103941`; execution test SHA256 `3f9a028c3ceb7eb4f45a2c2fd79a33d4147baa738c43bcdadc557ee7cde6bf45`; current bytes match independent review and focused verification. ACTIONABLE FINDINGS: 0.

**Scope boundary:** Exact Task records `SCENARIO DRAFTED: not-applicable | 0` for repository-only machinery. Root's integrated final verification after completion artifacts/receipt remains mandatory and pending; this scoped DONE judgment does not assert that it has run or that remote delivery is complete.
