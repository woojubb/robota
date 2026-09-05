---
status: approved
type: INFRA
tags: [harness, ci]
lane: L1
---

# INFRA-167: Batch CI verification with fail-fast boundaries

## Problem

The CI mirror runs eleven semantic stages serially, and continues expensive product stages after cheap metadata failures. Recent S2 runs failed dist-free metadata checks yet still spent minutes on build and product checks. This delays correcting the actual blocking error while offering no path to a successful receipt.

## Prior Art Research

Waived: repository execution scheduling correction; existing CI already runs contract and hermetic verification concurrently.

## Architecture Review

### Affected Scope

CI mirror execution, scheduling and reporting, with focused orchestration tests only.

### Alternatives Considered

1. Keep serial stages and only rename groups.
   - Pro: no concurrency risk.
   - Con: does not reduce execution barriers or wasted work.
2. Batch independent checks and stop subsequent work on failure.
   - Pro: reduces real waiting and prevents expensive downstream execution after a known failure.
   - Con: requires settlement and failure reporting across concurrent children.

### Decision

**Delivery mode:** `single`

Choose alternative 2. Run format and commitlint concurrently, then dist-free checks before contract/hermetic tests, which run concurrently as CI already does. Build is exclusive. Built readers remain sequential because shared output contention has not been proven safe. Preserve eleven semantic checks, --only selection, applicability decisions and exact receipt conditions. Report execution batches and check counts separately, not eleven checks removed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal repository scheduler, not a product command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Introduce one explicit scheduler owner for safe batches. Finish every running child before leaving its batch, including exceptions. A failed batch blocks every selected downstream check without spawning it; blocked is neither PASS nor applicability N/A. Preserve failure/throw propagation and suppress full receipts. Keep build/read dependencies and all existing semantic mappings. No cache, policy thresholds, lint limits, selectors or CI workflow changes.

## Affected Files

- `scripts/harness/verify-like-ci-execution.mjs`
- A small scheduler owner module if needed to retain existing file-size ceilings.
- `scripts/harness/verify-like-ci-reporting.mjs`
- `scripts/harness/__tests__/verify-like-ci-execution.test.mjs`
- `scripts/harness/__tests__/verify-like-ci.test.mjs`
- This spec and paired Task.

## Completion Criteria

- [ ] TC-01: Cheap and dist-free failures prevent expensive downstream runner calls, report blocked checks and emit no full receipt.
- [ ] TC-02: Independent cheap checks and contract/hermetic checks overlap only within declared batches; all children settle before environment restoration, even on throw.
- [ ] TC-03: Build never overlaps built readers; all eleven semantic checks and --only selection retain their coverage and receipt contract.
- [ ] TC-04: Output distinguishes selected/applicable checks from actual execution batches, and focused regression suites plus syntax checks exit zero.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                   | Notes                                                                                      |
| ----- | ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TC-01 | Regression  | `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` > CI mirror execution base context  | Actual failure RED, downstream call counts zero, no receipt.                               |
| TC-02 | Integration | Same file and describe                                                                            | Deferred children prove overlap and settlement before base environment restoration.        |
| TC-03 | Integration | Same file and describe; `scripts/harness/__tests__/verify-like-ci.test.mjs` > CI_STAGES           | Build exclusive; selected checks and partial receipt refusal preserved.                    |
| TC-04 | Unit        | `scripts/harness/__tests__/verify-like-ci.test.mjs` > summarize; execution tests and node --check | Honest batch/check counts; root final full after completion artifacts and receipt closure. |

## User Execution Test Scenarios

Not applicable.

**Reason:** Internal repository scheduling machinery; no shipped product behavior or latent product capability.

## Tasks

- [ ] `.agents/tasks/INFRA-167-batch-ci-verification-with-fail-fast-boundaries.md` — implementation pending

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "11단계도 줄여라. 지금 이렇게 오래 걸리는건 심각한 문제다"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 35ca9e0d6282 (review 05ac92bc, type/tags 5f52f5f7)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (35ca9e0d6282) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `9cfb459251d4` · base `origin/develop@9cfb459251d4` · document `.agents/spec-docs/draft/INFRA-167-batch-ci-verification-with-fail-fast-boundaries.md` blob `9fdb97934526` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 319 chars, 3 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (35ca9e0d6282) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-167-batch-ci-verification-with-fail-fast-boundaries.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-167-batch-ci-verification-with-fail-fast-boundaries.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `9cfb459251d4` · base `origin/develop@9cfb459251d4` · document `.agents/spec-docs/draft/INFRA-167-batch-ci-verification-with-fail-fast-boundaries.md` blob `8550cbbe9aae` (untracked)
