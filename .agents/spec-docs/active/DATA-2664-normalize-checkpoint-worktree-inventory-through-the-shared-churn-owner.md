---
status: in-progress
type: DATA
tags: [typescript]
lane: L2
---

# DATA-2664: Normalize checkpoint worktree inventory through the shared churn owner

Paired with `.agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

`checkpointWorktreePaths(...)` obtains raw `git status --porcelain --untracked-files=all` output and
serializes every path into GATE-IMPLEMENT evidence. It bypasses
`verification-receipt-storage.mjs`, the repository's owner of the two auto-generated lesson files that
do not count as real dirt. A first, continuation, or correction checkpoint generated while either
lesson is regenerated therefore records it in a PASS; `worktreeError(...)` subsequently rejects that
same payload because the lesson path is neither the paired Task/spec nor a permitted loop ledger. The
next continuation then treats the tool-produced prior PASS as invalid and cannot proceed.

The defect reproduces whenever `.agents/evals/lessons/auto-lessons.md` or
`.agents/evals/lessons/weekly-digest.md` is dirty while a checkpoint renderer runs. An unrelated dirty
source path must remain evidence and must still cause the existing validation to fail closed.

## Prior Art Research

Waived: This is a repository-private consistency repair between checkpoint evidence producers and an existing local storage owner; external product documentation cannot determine its internal worktree-inventory contract.

## Architecture Review

### Affected Scope

- `scripts/harness/verification-receipt-storage.mjs` — owner of real working-tree dirt and generated
  churn classification.
- `scripts/harness/gate-checkpoint-evidence-common.mjs` — checkpoint path producer.
- `scripts/harness/gate-checkpoint-evidence.mjs` and
  `scripts/harness/gate-correction-checkpoint-evidence.mjs` — first, continuation, and correction
  consumers of the shared producer.
- `scripts/harness/gate-implement-entry-results.mjs` — existing fail-closed evidence consumer;
  behavior is verified, not duplicated.
- `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs` and
  `scripts/harness/__tests__/verification-receipt.test.mjs` — producer, shared-classifier, and
  consumer-boundary regression coverage.

### Alternatives Considered

1. Reuse the receipt-storage owner by exposing a status-text form of its real-dirt classifier, then
   make checkpoint rendering consume it.
   - Pro: one allowlist and one porcelain interpretation govern receipts and every checkpoint form.
   - Con: the owner needs a small reusable input boundary rather than only a root-based helper.
2. Filter `AUTO_GENERATED_CHURN` again inside `checkpointWorktreePaths(...)`.
   - Pro: smallest apparent local patch.
   - Con: duplicates the owner’s policy and can drift when its excluded dirt changes.
3. Permit auto-generated churn in `worktreeError(...)` and preserve it in checkpoint payloads.
   - Pro: avoids changing producer output.
   - Con: makes invalid evidence look valid and leaves receipt/checkpoint inventories inconsistent.

### Decision

Choose alternative 1. `verification-receipt-storage.mjs` will expose the same real-dirt classification
over supplied porcelain text that its root-based helper already applies. `checkpointWorktreePaths(...)`
will call that owner after its one Git query, then parse only the returned real lines. First,
continuation, and correction payloads already delegate to this producer, so all three forms obtain the
same policy without new allowlists or consumer exceptions.

Reachability is verified from every producer call site; capability preservation is that valid v1/v2
records remain parseable and real unexpected paths remain represented. The adversarial cases are both
generated lesson files, a real unrelated path beside them, a first payload consumed by
`worktreeError(...)`, and a continuation retry after a generated checkpoint.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: This is a repository-private consistency repair between checkpoint evidence producers and an existing local storage owner; external product documentation cannot determine its internal worktree-inventory contract.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. In `verification-receipt-storage.mjs`, factor its existing porcelain filtering into a reusable
   status-text classifier and retain `realDirtyLines(root)` as the root-query convenience API.
2. In `gate-checkpoint-evidence-common.mjs`, retain the single checkpoint Git query but pass its raw
   output through that owner before path extraction.
3. Cover first, continuation, and correction checkpoint rendering with both generated churn files;
   assert none appears in generated payloads.
4. Feed a generated checkpoint payload into the existing evidence consumer and assert it passes; add
   an unrelated source path and assert the same consumer still rejects it.
5. Run the focused checkpoint/receipt suites and affected repository harness checks.

## Affected Files

- `scripts/harness/verification-receipt-storage.mjs`
- `scripts/harness/gate-checkpoint-evidence-common.mjs`
- `scripts/harness/__tests__/verification-receipt.test.mjs`
- `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`
- `scripts/harness/__tests__/gate.test.mjs` (only if its existing evidence-consumer fixture is the
  narrowest owning test home)

## Completion Criteria

- [ ] TC-01: Observable: a first checkpoint rendered while both generated lesson files are dirty
      omits both paths from `worktreePaths`, while an unrelated dirty source path remains in the payload.
- [ ] TC-02: Observable: continuation and correction checkpoint renderers also omit both generated
      lesson paths, proving all three producer forms consume the shared classification.
- [ ] TC-03: Observable: the existing `worktreeError(...)` consumer accepts a generated first
      checkpoint payload with only paired artifacts, but still rejects a payload containing an unrelated
      source path.
- [ ] TC-04: Observable: a retry after a generated checkpoint no longer fails because that earlier
      tool-produced payload carries ignored churn; malformed or genuinely dirty prior evidence remains
      rejected.
- [ ] TC-05: Command: `pnpm exec vitest run scripts/harness/__tests__/verification-receipt.test.mjs scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs scripts/harness/__tests__/gate.test.mjs` exits 0.
- [ ] TC-06: Command: `HARNESS_BASE_REF=fix/2664-gate-correctness node scripts/harness/run-all-scans.mjs --affected --context pr` exits 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                                                                                    | Notes                                                       |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TC-01 | unit        | `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs` fixture with `AUTO_GENERATED_CHURN` and a real path                                                                  | Assert the producer omits only owner-classified churn.      |
| TC-02 | unit        | `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs` continuation/correction fixtures                                                                                     | Exercise every checkpoint form through the shared producer. |
| TC-03 | integration | existing gate evidence-consumer fixture in `scripts/harness/__tests__/gate.test.mjs`                                                                                               | Preserve fail-closed rejection for real unexpected dirt.    |
| TC-04 | integration | continuation fixture in `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`                                                                                              | Generated prior evidence must remain retryable.             |
| TC-05 | suite       | `pnpm exec vitest run scripts/harness/__tests__/verification-receipt.test.mjs scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs scripts/harness/__tests__/gate.test.mjs` | Focused owner, producer, and consumer suites.               |
| TC-06 | integration | `HARNESS_BASE_REF=fix/2664-gate-correctness node scripts/harness/run-all-scans.mjs --affected --context pr`                                                                        | Repository harness verification.                            |

## User Execution Test Scenarios

Not applicable.

**Reason:** There is no runnable user-facing behaviour change; verification evidence is recorded in
the engineering test plan (TC-01 to TC-03). This is recorded as the rule's required choice rather
than skipped.

## Tasks

- [ ] `.agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` — in-progress

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- Mechanical evaluation: PASS — `HARNESS_BASE_REF=fix/2664-gate-correctness node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this>` reported 20 PASS, 0 FAIL, and the seven criteria reserved for the independent guardian.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem identifies the raw checkpoint `git status` path, its bypass of the shared owner, the invalid subsequent `worktreeError(...)` rejection, and the blocked continuation.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem names either generated lesson file being dirty while a first, continuation, or correction checkpoint is rendered.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — the explicit repository-private research waiver leads to the shared-owner alternative and rejects a second allowlist or consumer-side exception.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — a small reusable status-text boundary avoids duplicated policy while preserving a single Git query and fail-closed handling of real dirt.
- GATE-WRITE — New-surface placement (conditional): PASS (N/A) — the change stays inside existing internal harness modules; it adds no package, application, presentation, public interface, or layer/product-family boundary.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 through TC-04 separately cover producer filtering, all checkpoint forms, consumer preservation, and continuation retry; TC-05 and TC-06 cover focused and affected verification.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — every TC states an inspectable payload/rejection result or a concrete command with an exit-zero observation.

**Judged by:** `backlog-gate-guard` semantic evaluator (evidence recorded by the orchestrator because the managed workspace denied the guard's evidence-only append)
**Judged at:** HEAD `5ee95e50972c` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/draft/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `73140b142ff5` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** f2d4e48706ca (review b3b64047, type/tags b84f4f9d)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2d4e48706ca) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5ee95e50972c` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `dc6a9ed739ba` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-20

**Status remains:** review-ready
**Failed criterion:** GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document.

- Ordering: PASS — the preceding GATE-WRITE PASS records `draft → review-ready`, and this document remains `status: review-ready` in `backlog/`.
- Direct-approval criterion: FAIL — the recorded instruction is already bound to BEHAVIOR-2664. Its forward-looking automatic-approval clause is standing/category authority, not a `DIRECT` approval demonstrably directed at DATA-2664; no registered CLASS route or measurement was recorded.
- Route-CLASS criteria: PASS (N/A) — the entry declares `DIRECT`, so it invokes no delegated class.
- Architecture review/type/tags unchanged: PASS — the mechanical review fingerprint still matches.
- Independent architecture validation: PASS (N/A) — the proposal changes only existing internal harness modules and introduces no package, app, product/interface/presentation surface, or layer/product-family boundary.
- Pre-approval implementation prohibition: PASS — the worktree contains only this paired Task/spec planning work, with no implementation or test path changed.

**Required action:** obtain a direct approval for DATA-2664 or record a valid pre-existing CLASS authorization, then rerun GATE-APPROVAL.

**Judged by:** `backlog-gate-guard` semantic evaluator (evidence recorded by the orchestrator because the managed read-only sandbox denied the guard's evidence-only append)
**Judged at:** HEAD `5ee95e50972c` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `2c18a035b1e0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "나에게 질문할 때, 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** f2d4e48706ca (review b3b64047, type/tags b84f4f9d)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2d4e48706ca) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5ee95e50972c` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `eb8c42b9ee91` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "나에게 질문할 때, 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation

- GATE-APPROVAL — Ordering: PASS — the recorded GATE-WRITE PASS upgrades `draft → review-ready`, and the document remains `review-ready` in the expected `backlog/` folder.
- GATE-APPROVAL — Direct approval: PASS — the current conversation explicitly binds the quoted automatic-approval rule to the DATA-2664 recommendation: reuse the existing shared churn classifier, remove duplicate allowlists, preserve fail-closed real-dirt rejection, and introduce no public/package/architecture surface. The user then resumed the ordered goal, whose plan requires [issue #2664](https://github.com/woojubb/robota/issues/2664) before [issue #2423](https://github.com/woojubb/robota/issues/2423).
- GATE-APPROVAL — Route-CLASS criteria: PASS (N/A) — the approval uses `DIRECT` and invokes no delegated class.
- GATE-APPROVAL — Architecture review/type/tags unchanged: PASS — the mechanical review fingerprint remains current.
- GATE-APPROVAL — Independent architecture validation: PASS (N/A) — no new package, app, product/interface/presentation surface, or layer/product-family boundary is introduced or reclassified.
- GATE-APPROVAL — Pre-approval implementation prohibition: PASS — only the paired Task/spec planning artifacts are changed; no implementation or test path is modified.

**Judged by:** `backlog-gate-guard` semantic evaluator (evidence recorded by the orchestrator because the managed read-only sandbox denied the guard's evidence-only append)
**Judged at:** HEAD `5ee95e50972c` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `f0db82038ff1` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 245 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md",
  "specPath": ".agents/spec-docs/todo/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md",
    ".agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e15b84320a2e` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/todo/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md` blob `5f0ec4020673` (modified)
