---
status: approved
type: INFRA
tags: [ci, harness, contracts]
lane: L1
---

# INFRA-153: Align CI contract mirrors with shared verification producers

Paired with `.agents/tasks/INFRA-153-align-ci-contract-mirrors-with-shared-verification-producers.md`. Arising from [issue #2489](https://github.com/woojubb/robota/issues/2489).

## Problem

After INFRA-151 consolidated build and quality setup and routed complete scans to `scans-full.yml`,
`pnpm harness:test:contracts` reports stale assertions that still require the retired workflow shape.
The local CI mirror also reads literal `run:` arguments only, so the new computed `scan_args` variable
is misclassified even though the workflow deliberately derives it from the affected planner.

## Prior Art Research

Waived: internal CI contract alignment following the repository's existing workflow-test precedent

## Architecture Review

### Affected Scope

- `scripts/harness/__tests__/check-pr-body.test.mjs`
- `scripts/harness/__tests__/harness-scripts.test.mjs`
- `scripts/harness/__tests__/pre-push-mirrors-ci-scans.test.mjs`
- `scripts/harness/__tests__/scan-progress-report-quantification-ci-placement.test.mjs`
- `scripts/harness/__tests__/verify-like-ci.test.mjs`
- `scripts/harness/verify-like-ci-dist-free.mjs`
- `packages/agent-core/src/ci-affected-benchmark.ts`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Align the mirrors with the already-delivered workflow contract and teach the two
local parsers the one supported dynamic producer. This preserves strict rejection of unknown dynamic
expressions while avoiding a broader parser framework that the measured failure does not require.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal CI contract alignment following the repository's existing workflow-test precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Point workflow assertions at the jobs that now own each responsibility, allow the intentionally
disabled pull-request CodeQL predecessor, and resolve `scan_args` from the workflow's producer block
in both local mirrors. Keep unsupported dynamic expressions fail-closed. Advance the package marker
only to produce an exact-head, package-owned benchmark after the alignment lands.

## Affected Files

- `scripts/harness/__tests__/check-pr-body.test.mjs`
- `scripts/harness/__tests__/harness-scripts.test.mjs`
- `scripts/harness/__tests__/pre-push-mirrors-ci-scans.test.mjs`
- `scripts/harness/__tests__/scan-progress-report-quantification-ci-placement.test.mjs`
- `scripts/harness/__tests__/verify-like-ci.test.mjs`
- `scripts/harness/verify-like-ci-dist-free.mjs`
- `packages/agent-core/src/ci-affected-benchmark.ts`

## Completion Criteria

- [ ] TC-01: the six affected workflow and mirror Vitest files run together and all tests exit 0.
- [ ] TC-02: `pnpm harness:test:contracts` exits 0 with all repository-contract files passing.
- [ ] TC-03: both local mirror implementations resolve the workflow-owned `scan_args` expression and
      their contract tests reject an unrelated dynamic expression.

## Test Plan

| TC-ID | Test Type | Tool / Approach                           | Notes                                       |
| ----- | --------- | ----------------------------------------- | ------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on six named files | Workflow ownership and mirror expectations  |
| TC-02 | Suite     | `pnpm harness:test:contracts`             | Complete repository-contract regression     |
| TC-03 | Unit      | Local mirror parser tests                 | Supported producer plus fail-closed unknown |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-153-align-ci-contract-mirrors-with-shared-verification-producers.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 빠르게 진행해. 모두 사전 승인합니다. 절차 무시해도 됩니다. Pr없이 머지하세요"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** bf5aafb1bf5e (review 5314b770, type/tags d2e55046)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bf5aafb1bf5e) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (3 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 397 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
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
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bf5aafb1bf5e) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-153-align-ci-contract-mirrors-with-shared-verification-producers.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-153-align-ci-contract-mirrors-with-shared-verification-producers.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
