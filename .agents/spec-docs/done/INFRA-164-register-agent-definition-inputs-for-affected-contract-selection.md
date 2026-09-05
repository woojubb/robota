---
status: done
type: RULE
tags: [harness, governance]
lane: L1
---

# INFRA-164: register agent definition inputs for affected contract selection

Paired with `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md`.

## Problem

The full gate logs "[contract-tests] complete: unknown owner for changed input: .claude/agents/mechanical-refactor-worker.md; 248/248 selected". Agent definition changes have real governance consumers but ownerForRepositoryInput does not recognize their prefix and repository literal harvesting omits it. Registering only the owner would silently select too little because governance selection also requires matching repository inputs.

## Prior Art Research

Waived: local internal input-registry defect with existing owner and matching contracts; no new product architecture or external API choice.

## Architecture Review

### Affected Scope

Internal harness ownership and static repository-input metadata, plus registry and selector regression tests. No core package, executable hook, CI workflow or package manifest change.

### Alternatives Considered

1. Keep unknown-owner complete selection.
   - Pro: conservative coverage.
   - Con: repeats all contract tests for ordinary agent-definition edits.
2. Register the narrow agent-definition owner and every direct/directory consumer together.
   - Pro: selects affected contracts while preserving complete fallback for actual unknowns.
   - Con: requires regression proof against coverage omission.

### Decision

**Delivery mode:** `single`

Choose alternative 2 under the direct owner instruction: "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해. 나는 지금의 목표를 꼭 빠르게 달성해야 하는데 그 목표에 방해되는건 제거해야 하기 때문이야". Keep existing ownership and matching functions as the SSOT; do not add a second selector or hand-maintained test-name shortcut. The unknown-owner fallback itself is correct and stays. Only the missing recognized input class is repaired.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: no product command family or new public surface
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Recognize .claude/agents/ as workspace:governance without recognizing arbitrary .claude paths. Harvest exact file references and actual directory consumers from the existing static import closure. Bind directory references to their member definitions without broadening product domains. Include agent-definition convention, dispatch/depth contracts, orchestration and retired-reference consumers where their actual inputs match; preserve pr-review-fixer direct consumers. Prove this from the real registry, not a selected-count claim. Keep unknown and control-plane complete fallback, safety floor and isolated contracts unchanged. This change touches selector control-plane files, so its own integrated validation is not narrowed.

## Affected Files

- `scripts/harness/contract-test-owners.mjs`
- `scripts/harness/contract-test-inputs.mjs`
- `scripts/harness/__tests__/contract-test-inputs.test.mjs`
- `scripts/harness/__tests__/affected-contract-tests.test.mjs`
- This spec and its paired Task. Implementation scope excludes PROC-034 records and the post-merge ledger; the root-owned predecessor loop closure may accompany the planning prelude under its existing lifecycle contract.

## Completion Criteria

- [x] TC-01: Agent definition inputs resolve to workspace:governance; unrelated unknown .claude paths retain complete fallback.
- [x] TC-02: Direct agent file literals and directory consumers enter the registry and select all their affected consumer tests plus the safety floor, rather than only the safety floor.
- [x] TC-03: Control-plane input changes retain complete selection; existing product selection, isolated tests and unknown-input safety remain unchanged.
- [x] TC-04: Focused registry/selector regression tests and syntax/import checks exit zero after the missing-coverage cases fail on the original code.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                                                                                                                                            | Notes                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| TC-01 | Unit        | `scripts/harness/__tests__/affected-contract-tests.test.mjs` — describe `affected contract selection`                                                                                                                                      | Exact agent prefixes and unknown-path refusal to narrow.   |
| TC-02 | Integration | `scripts/harness/__tests__/contract-test-inputs.test.mjs` — describe `contract-test input registry ownership`; `scripts/harness/__tests__/affected-contract-tests.test.mjs` — describe `affected contract selection`                       | Real closure, direct/directory consumers and safety floor. |
| TC-03 | Regression  | `scripts/harness/__tests__/affected-contract-tests.test.mjs` — describe `affected contract selection`                                                                                                                                      | Complete fallback matrix, product isolation and partition. |
| TC-04 | Regression  | `scripts/harness/__tests__/contract-test-inputs.test.mjs` — describe `contract-test input registry ownership`; `scripts/harness/__tests__/affected-contract-tests.test.mjs` — describe `affected contract selection`; syntax/import checks | Actual RED then GREEN, no duplicate full gate per edit.    |

## Delivery Verification Strategy

The integration owner runs the final full CI-equivalent gate after completion artifacts and receipt closure, before push/merge. This remains mandatory delivery verification, not a prerequisite for creating those completion artifacts; do not run it twice on unchanged inputs to satisfy a circular evidence order.

## User Execution Test Scenarios

Not applicable.

**Reason:** This change affects repository-internal contract-test selection metadata, not a shipped CLI, SDK, browser or core package behavior. Real registry and selector regression tests cover the execution-planning boundary; no product user scenario is introduced.

## Tasks

- [x] `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` — scoped implementation and verification complete; final delivery gate pending

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해. 나는 지금의 목표를 꼭 빠르게 달성해야 하는데 그 목표에 방해되는건 제거해야 하기 때문이야"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** e581c71c0916 (review bb1a572c, type/tags a2fda961)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e581c71c0916) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `e7a176df8f10` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/draft/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `b120c69c33ac` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (0 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 435 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows = 4 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 4 rows with Test Type and Tool, no TBD
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e581c71c0916) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `e7a176df8f10` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/draft/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `32b15d2a440f` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해. 나는 지금의 목표를 꼭 빠르게 달성해야 하는데 그 목표에 방해되는건 제거해야 하기 때문이야"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 161f4b5f17cf (review bb1a572c, type/tags beb69ef8)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (161f4b5f17cf) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `e7a176df8f10` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/todo/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `e3645951d25d` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/contract-test-inputs.test.mjs","scripts/harness/__tests__/affected-contract-tests.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/proc034-approved-recovery

·······························

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  18:44:41
   Duration  5.02s (transform 52ms, setup 0ms, collect 98ms, tests 9.26s, environment 0ms, prepare 51ms)

6:44:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `67481d444934` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/todo/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `2fc5c2b0a7c8` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/contract-test-inputs.test.mjs","scripts/harness/__tests__/affected-contract-tests.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/proc034-approved-recovery

·······························

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  18:44:41
   Duration  5.02s (transform 52ms, setup 0ms, collect 98ms, tests 9.26s, environment 0ms, prepare 51ms)

6:44:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `67481d444934` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/todo/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `72e156636bef` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/contract-test-inputs.test.mjs","scripts/harness/__tests__/affected-contract-tests.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/proc034-approved-recovery

·······························

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  18:44:41
   Duration  5.02s (transform 52ms, setup 0ms, collect 98ms, tests 9.26s, environment 0ms, prepare 51ms)

6:44:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `67481d444934` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/todo/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `7c88ab377032` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs"; const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/contract-test-inputs.test.mjs","scripts/harness/__tests__/affected-contract-tests.test.mjs"]); process.stdout.write(r.stdout??""); process.stderr.write(r.stderr??""); process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
RUN  v3.2.6 /private/tmp/robota-worktrees/proc034-approved-recovery

·······························

 Test Files  2 passed (2)
      Tests  31 passed (31)
   Start at  18:44:41
   Duration  5.02s (transform 52ms, setup 0ms, collect 98ms, tests 9.26s, environment 0ms, prepare 51ms)

6:44:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged at:** HEAD `67481d444934` · base `origin/develop@e7a176df8f10` · document `.agents/spec-docs/todo/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` blob `1cadfe80fc62` (modified)

### [GATE-DONE] — ❌ FAIL | 2026-09-05

**Status remains:** approved
**Ordering:** L1 combined DONE (supported alias GATE-DONE) follows the existing GATE-PLAN PASS. Current approved status and todo/ location agree. This independent review uses existing execution results only; no test or build was rerun.
**Failed criteria:**

- GATE-COMPLETE — One of the following is recorded (Test written: test file path + test function/describe name; or Test skipped: explicit reason): TC-01 through TC-03 name files but no test function/describe; TC-04 says only "Both .test.mjs suites", not an exact file/function reference. Existing successful execution does not supply the missing row binding.
  **Required action:** The author must bind the four Test Plan rows to the already-written tests. Available exact describes are `scripts/harness/__tests__/contract-test-inputs.test.mjs > contract-test input registry ownership` and `scripts/harness/__tests__/affected-contract-tests.test.mjs > affected contract selection`. No implementation or verification rerun is required for this evidence-reference correction.
- GATE-COMPLETE — Test Plan updated with test references or skip reasons for all TC-N rows: TC-04 lacks an explicit file reference and all rows lack the required function/describe binding above.
  **Required action:** Complete the same four row references without changing test scope or claiming a new execution.

**Other criteria reviewed:**

- GATE-VERIFY — Every Plan item is complete: PASS — Exact paired Task TC-01 through TC-04 are checked.
- GATE-VERIFY — No Plan item is blocked/pending: PASS — No pending item in Plan; final delivery verification is explicitly separate.
- GATE-VERIFY — Build passes for affected packages: PASS — No package/app source is changed. Root's actual existing `node --check scripts/harness/contract-test-owners.mjs` and `node --check scripts/harness/contract-test-inputs.mjs` plus real registry import probe exited 0; this attribution is not a guardian re-execution or full-build claim.
- GATE-VERIFY — Tests pass for affected packages: PASS — Guardian read `/tmp/infra164-green.log`: 2 files, 31 tests PASS, 5.02s; root observed canonical vitestInvocation exit 0. The prior `/tmp/infra164-red.log` retains 2 failures/29 passes before implementation.
- GATE-COMPLETE — Every TC checkbox is checked: PASS — Four checked criteria.
- GATE-COMPLETE — Each TC has exact command/result/exit evidence: PASS — Four GATE-COMPLETE TC entries name the existing invocation, observed 31 PASS and exit 0.
- GATE-COMPLETE — No TC silently unaddressed: FAIL only for the Test Plan reference omission specified above; no behavioral test failure found.
- GATE-COMPLETE — Completion Criteria checkboxes all checked: PASS — TC-01 through TC-04.
- GATE-COMPLETE — Tasks section names exact active Task: PASS — Existing `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md`.
- GATE-COMPLETE — Task is completion-ready: PASS — All four scoped Plan items checked; no blocked item.

**Binding:** HEAD `67481d444934cfed6b7d1a2c4a07a63d80919672`. Guardian independently read matching current SHA256 values: owners `0ced721ffb0e074893f7a40504d51e23b59377cb7374e6ebfe74be2d0a68a8f1`; inputs `d214b15f3d0459275f405d32117b185b6521a90a7c16668532627639cc347223`; input test `eaa64b70e7e82ddfccb9346547fd542b3ba2aac8bfea5d251e020c2263166524`; affected test `734484db21e397146ea7631da3a8ed81e3e166b7d9852dc2485d487054725c51`.
**Scope:** Product scenario is genuinely not applicable, as the exact Task's author outcome states. Final CI-equivalent verification after completion/receipt closure remains mandatory and is not claimed passed by this scoped review.

### [GATE-DONE] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → done
**Ordering:** L1 prior GATE-PLAN PASS remains present; approved/todo input state is unchanged. The preceding FAIL is preserved. This bounded re-judgement checks the four repaired Test Plan rows against actual test declarations and reuses the unchanged scoped verification evidence above.

- GATE-VERIFY — Every Plan item is marked complete: PASS — Exact Task TC-01 through TC-04 remain checked.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — All scoped Plan work is complete; final delivery verification remains a separate mandatory boundary.
- GATE-VERIFY — Build passes for all affected packages: PASS — Harness-MJS-only scope, no affected package/app build. Existing two module syntax checks and registry import probe exited 0, attributed to root as recorded in the preceding review.
- GATE-VERIFY — Tests pass for all affected packages: PASS — Existing canonical vitestInvocation result in `/tmp/infra164-green.log` is 2 files / 31 tests PASS, exit 0; no source/test bytes changed and no test was rerun for this entry.
- GATE-COMPLETE — The checkbox is checked: PASS — Each TC-01 through TC-04 is checked.
- GATE-COMPLETE — A GATE-COMPLETE TC-N Evidence Log entry exists with exact command, output and exit: PASS — All four existing entries retain the actual invocation, 31 PASS output and exit 0.
- GATE-COMPLETE — One of the following is recorded, test path plus test function/describe or explicit skip: PASS — TC-01 and TC-03 now bind `scripts/harness/__tests__/affected-contract-tests.test.mjs > affected contract selection`; TC-02 and TC-04 bind that describe plus `scripts/harness/__tests__/contract-test-inputs.test.mjs > contract-test input registry ownership`. Guardian read both actual describe declarations and matched their spelling.
- GATE-COMPLETE — No TC-N is silently unaddressed: PASS — All four rows now carry exact existing test references.
- GATE-COMPLETE — Completion Criteria checkboxes are all checked: PASS — Four of four.
- GATE-COMPLETE — Test Plan updated with test references or skip reasons for all TC-N rows: PASS — Four of four repaired rows now satisfy the named reference requirement.
- GATE-COMPLETE — Tasks section names the exact active Task path: PASS — `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md`.
- GATE-COMPLETE — Active Task exists and is completion-ready: PASS — Existing exact Task has all scoped Plan items checked and no pending item.

**Disposition:** The sole named FAIL class, Test Plan reference binding, is resolved without implementation changes or verification repetition. Previous execution/hash binding and historical RED remain valid and preserved. This is scoped L1 DONE, not a claim that the later full CI-equivalent delivery gate, receipt closure or remote landing has run. Guardian makes no status/location change.
