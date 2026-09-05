---
status: approved
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

- [ ] TC-01: Agent definition inputs resolve to workspace:governance; unrelated unknown .claude paths retain complete fallback.
- [ ] TC-02: Direct agent file literals and directory consumers enter the registry and select all their affected consumer tests plus the safety floor, rather than only the safety floor.
- [ ] TC-03: Control-plane input changes retain complete selection; existing product selection, isolated tests and unknown-input safety remain unchanged.
- [ ] TC-04: Focused registry/selector regression tests and syntax/import checks exit zero after the missing-coverage cases fail on the original code.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                              | Notes                                                                             |
| ----- | ----------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| TC-01 | Unit        | scripts/harness/**tests**/affected-contract-tests.test.mjs                                   | Exact agent prefixes and unknown-path refusal to narrow.                          |
| TC-02 | Integration | scripts/harness/**tests**/contract-test-inputs.test.mjs and affected-contract-tests.test.mjs | Real closure, literal file/directory shapes, consumer inclusion and safety floor. |
| TC-03 | Regression  | scripts/harness/**tests**/affected-contract-tests.test.mjs                                   | Existing complete fallback matrix, product isolation and deterministic partition. |
| TC-04 | Regression  | Both .test.mjs suites and syntax/import checks                                               | Initial RED then current GREEN; no duplicate full gate per edit.                  |

## Delivery Verification Strategy

The integration owner runs the final full CI-equivalent gate after completion artifacts and receipt closure, before push/merge. This remains mandatory delivery verification, not a prerequisite for creating those completion artifacts; do not run it twice on unchanged inputs to satisfy a circular evidence order.

## User Execution Test Scenarios

Not applicable.

**Reason:** This change affects repository-internal contract-test selection metadata, not a shipped CLI, SDK, browser or core package behavior. Real registry and selector regression tests cover the execution-planning boundary; no product user scenario is introduced.

## Tasks

- [ ] `.agents/tasks/INFRA-164-register-agent-definition-inputs-for-affected-contract-selection.md` — created; implementation not begun

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
