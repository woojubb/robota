---
status: done
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-143: reference kinds are not enforced before document authoring completes

Paired with `.agents/tasks/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md`. Arising from [issue #2510](https://github.com/woojubb/robota/issues/2510).

## Problem

Guarantee that governed documents emit or validate kind-qualified GitHub references before authoring
is considered complete. A new document must not reach a late integration scan with a bare `#NNNN`
that should say `issue #NNNN`, `PR #NNNN`, or another declared kind.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `harness document authoring and reference qualification`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 2.** The shared boundary delegates parsing to the existing canonical predicate and
is called by both governed-document generators, so newly authored content is rejected before either
the dry-run or the filesystem write completes while the integration scan remains independent.

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

Add `document-authoring-reference.mjs` as the single pre-completion adapter around
`reference-kind.mjs`. Call it from `new-spec.mjs` before returning a dry-run/generated document and
from `allocate-work-item-id.mjs` before its atomic `wx` Task write. Preserve all canonical parser
exemptions and report every finding with the prospective path, line, reference, and accepted forms.

## Affected Files

- `scripts/harness/document-authoring-reference.mjs`
- `scripts/harness/new-spec.mjs`
- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/__tests__/document-authoring-reference.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/document-authoring-reference.test.mjs` → exits 0; the red fixture rejects bare `#1916` before dry-run completion.
- [x] TC-02: `node scripts/harness/scan-reference-kind-qualified.mjs` → exits 0 without widening the frozen baseline.
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/reference-kind.test.mjs scripts/harness/__tests__/document-authoring-reference.test.mjs` → exits 0 for 89 tests.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                                                                                                      | Notes                                                                |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/document-authoring-reference.test.mjs`                                                                                               | Bare `#1916` is refused; qualified and exempt forms remain accepted. |
| TC-02 | Scan      | `node scripts/harness/scan-reference-kind-qualified.mjs`                                                                                                                             | Independent integration floor remains green.                         |
| TC-03 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/reference-kind.test.mjs scripts/harness/__tests__/document-authoring-reference.test.mjs` | 89 tests passed across all affected seams.                           |

## User Execution Test Scenarios

Not applicable.

**Reason:** This change governs internal Markdown authoring and exposes no runnable CLI, UI, API,
SDK, or runtime behaviour; verification evidence is recorded in the engineering test plan TC-01 to
TC-03.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md` — done

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "Owner-authorized implementation of issue #2510 using the existing canonical reference-kind predicate."
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 22330a174dc6) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md) is at or above the floor L1)
**Review fingerprint:** c06ccafb1655 (review 0cdcc080, type/tags 2433998c)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/draft/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md` blob `dda270ccb450` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <6 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 6 changed path(s) — committed and working-tree changes vs origin/develop (merge base 22330a174dc6) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md) is at or above the floor L1)
**Review fingerprint:** c06ccafb1655 (review 0cdcc080, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c06ccafb1655) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/draft/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md` blob `57f0e6d7593f` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 267 chars, 2 sentences
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <6)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c06ccafb1655) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/draft/INFRA-143-reference-kinds-are-not-enforced-before-document-authoring-completes.md` blob `4976a3052aad` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-06

- `pnpm exec vitest run scripts/harness/__tests__/document-authoring-reference.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/reference-kind.test.mjs` → 3 files, 89 tests passed.
- `node scripts/harness/scan-reference-kind-qualified.mjs` → exit 0; 3391 tracked documents examined and the frozen baseline was unchanged.
- The red fixture proves a bare `#1916` is rejected before `new-spec` dry-run output is emitted; qualified, closing-keyword, and inline-code forms pass.

### [GATE-COMPLETE] — ✅ PASS | 2026-09-06

The common authoring adapter is wired before both the spec-generator return path and the allocator's
single-syscall Task write. The Task is archived with status `done` and the paired spec is archived
under `done/` in the same change.
