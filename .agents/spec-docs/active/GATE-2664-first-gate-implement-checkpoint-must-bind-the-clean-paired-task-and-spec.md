---
status: in-progress
type: INFRA
tags: [typescript]
lane: L2
---

# GATE-2664: first GATE-IMPLEMENT checkpoint must bind the clean paired Task and spec

Paired with `.agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

`firstCheckpointEvidence(...)` writes `worktreePaths` from only
`checkpointWorktreePaths(root)`. When the paired Task is already committed and clean while the spec
is changed by GATE-IMPLEMENT, the generated first PASS omits the Task path. `gate.mjs advance` then
changes the Task to `in-progress`, and the planning checkpoint's pre-commit consumer rejects the
earlier PASS with `gateImplementFirst.worktreePaths must be the paired Task/spec plus only PLAN ledger
paths`.

This reproduced while opening implementation for `PUSH-2664-P2`: all seven mechanical
GATE-IMPLEMENT criteria passed, but the resulting planning checkpoint could not be committed. The
existing renderer unit test initializes an otherwise empty repository and checks only the evidence
marker and delivery mode, so it does not assert the mandatory paired-path inventory.

## Prior Art Research

Waived: this is conformance between an existing repository-private evidence producer and its already
declared local consumer contract; external product documentation cannot determine the required
Robota checkpoint payload.

## Architecture Review

### Affected Scope

- `scripts/harness/gate-checkpoint-evidence.mjs` — first-checkpoint evidence producer.
- `scripts/harness/gate-checkpoint-evidence-common.mjs` — one shared exact-pair inventory helper.
- `scripts/harness/gate-correction-checkpoint-evidence.mjs` — correction producer migrated to the
  shared helper without changing its payload.
- `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs` — clean-pair producer/consumer
  regression and unrelated-dirt control.
- This Task/spec pair — planning and verification evidence only.

No gate criterion, evidence schema, lifecycle transition, package contract, public API, or product
surface changes. `DATA-2664` remains the owner of generated-churn filtering. Under the approved
MAP-2664 role predicates, this Task is a delivery prerequisite rather than an eighth
`AGREEMENT-2664` child; the seven approved children are terminal, and `MAP-2664` remains the owner of
general dynamic-Task projection governance.

### Alternatives Considered

1. Add one exact-pair inventory helper beside `checkpointWorktreePaths(...)` and route first,
   continuation, and correction producers through it.
   - Pro: makes every producer satisfy one existing exact-pair contract, removes the duplication that
     let first drift, and retains shared real-dirt classification without changing schema or consumer.
   - Con: touches three producer modules instead of changing only the first call site.
2. Relax `worktreeError(...)` so a first payload may omit a clean paired path.
   - Pro: requires no producer change and accepts existing malformed first payloads.
   - Con: weakens the declared durable checkpoint binding and makes first evidence differ from the
     continuation/correction forms.
3. Force both planning files dirty before every first GATE-IMPLEMENT run.
   - Pro: works around the current producer without source changes.
   - Con: makes correctness depend on incidental worktree state and can require meaningless Task
     edits, so a valid plan can still deadlock after a normal prior planning commit.

### Decision

Choose alternative 1. Add a common helper that computes the sorted unique union of `taskRel`,
`specRel`, and `checkpointWorktreePaths(root)`, then make every checkpoint producer use it. This
centralizes the existing exact-pair invariant, preserves all real unexpected dirt for fail-closed
rejection, and changes neither the v2 schema nor the consumer contract.

**Delivery mode:** `single`

Reachability covers all three producers: `checkpointEvidenceForGate(...)` selects first or
continuation from `gate-checkpoint-evidence.mjs`, while correction is imported from
`gate-correction-checkpoint-evidence.mjs`; all three will call the common helper. Capability
preservation is exact: paired paths become unconditional, shared churn filtering remains owned by
`checkpointWorktreePaths(...)`, PLAN ledger paths remain allowed, and unrelated dirt remains in the
payload for `worktreeError(...)` to reject. The adversarial pass covers a completely clean pair, a
dirty spec with a clean Task, duplicate pair paths from status, an allowed PLAN ledger, and an
unrelated real path.

Ownership is also bounded. Under MAP-2664's approved objective predicates, `GATE-2664` is a delivery
prerequisite because the existing seven-child AGREEMENT projection is approved and terminal while
this producer fix is required before remaining initiative work can create a valid first implementation
checkpoint. The implementation does not edit the parent projection or define MAP-2664's general
policy. Before landing, the same focused suite and affected verification must pass against the
DATA-integrated `origin/integration/agreement-2664` state.

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

1. Add a shared exact-pair inventory helper in
   `scripts/harness/gate-checkpoint-evidence-common.mjs` and route all three checkpoint producers
   through it without changing payload fields or DATA-2664's real-dirt owner.
2. Extend the first-checkpoint fixture in
   `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs` so committed clean Task/spec paths
   must appear once in deterministic order and the current implementation fails the assertion.
3. Exercise `evaluateGateImplementEntries(...)` with `priorEntries: []` and the exact current
   `checkpointPaths`, then retain PLAN-ledger acceptance and real unrelated-dirt refusal controls.
4. Run focused tests and affected harness scans on `origin/develop`, then replay the focused
   compatibility verification against `origin/integration/agreement-2664` without changing its
   completed DATA-2664 records.

## Affected Files

- `scripts/harness/gate-checkpoint-evidence.mjs`
- `scripts/harness/gate-checkpoint-evidence-common.mjs`
- `scripts/harness/gate-correction-checkpoint-evidence.mjs`
- `scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`

## Completion Criteria

- [ ] TC-01: Observable: before the source fix, a first checkpoint rendered while both paired files
      are committed and clean omits them from `worktreePaths`; the new focused assertion fails RED.
- [ ] TC-02: Observable: after the fix, the same generated payload contains the exact Task and `todo/`
      spec paths once each in sorted order; first, continuation, and correction all obtain inventory
      from one shared helper.
- [ ] TC-03: Observable: a dirty paired path does not create a duplicate, PLAN ledger paths remain
      allowed, and `evaluateGateImplementEntries(...)` with `priorEntries: []` plus exact
      `checkpointPaths` accepts the clean pair while rejecting an unrelated real worktree path.
- [ ] TC-04: Command: `pnpm exec vitest run scripts/harness/__tests__/gate-checkpoint-evidence.test.mjs`
      and `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      both exit 0 on `origin/develop`, and the focused checkpoint suite also exits 0 against the
      DATA-integrated `origin/integration/agreement-2664` state.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                               | Notes                                                          |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| TC-01 | unit        | clean committed-pair fixture in `gate-checkpoint-evidence.test.mjs`                                                           | Capture RED before changing the producer.                      |
| TC-02 | integration | assert first/continuation/correction call the shared pair-inventory helper and emit the exact sorted pair                     | Prevent producer drift without changing the evidence contract. |
| TC-03 | adversarial | evaluate a current first entry with `priorEntries: []`, exact `checkpointPaths`, PLAN ledger, and unrelated dirt variants     | Exercise the failing current-entry consumer path.              |
| TC-04 | suite       | focused Vitest and affected scans on develop, then focused compatibility verification on the DATA-integrated initiative state | Verify both required bases.                                    |

## User Execution Test Scenarios

Not applicable.

**Reason:** This changes only an internal repository planning-checkpoint producer and commit guard;
it adds no Robota CLI, TUI, browser, public SDK, configuration, or runtime behavior for an end user.

## Tasks

- [ ] `.agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md` — todo
- Planning checkpoint prepared after the approved state was committed.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate with no predecessor; the document is in `draft/` and declares `status: draft`.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem names `firstCheckpointEvidence(...)`, the omitted clean paired Task path, and the resulting `gateImplementFirst.worktreePaths` planning-checkpoint rejection.
- GATE-WRITE — Contains a reproduction condition: PASS — the failure is bounded to a first GATE-IMPLEMENT run where the paired Task is committed and clean while the spec is changed by the gate transition; the PUSH-2664-P2 occurrence supplies a concrete instance.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — the explicit waiver correctly limits the evidence source to the repository-local producer/consumer contract, and that contract drives the comparison between centralizing exact-pair inventory, weakening the consumer, and relying on incidental dirt.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the Decision preserves fail-closed exact-pair binding and real-dirt rejection at the cost of routing three producers through a shared helper, rejecting both a weaker consumer contract and worktree-state dependence.
- GATE-WRITE — New-surface placement: N/A — the change is confined to existing internal checkpoint producers, their shared helper, and tests; it introduces no package, app, presentation/interface surface, layer boundary, or product-family reclassification.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers the required RED reproduction, TC-02 the exact sorted pair and shared producer path, TC-03 deduplication/PLAN-ledger/unrelated-dirt behavior, and TC-04 verification on both required integration bases.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — TC-01 through TC-03 specify inspectable payload or evaluator outcomes, and TC-04 names commands with exit-zero expectations.
- GATE-WRITE — TC count cross-check: PASS — four Completion Criteria items (`TC-01`–`TC-04`) have four corresponding Test Plan rows; the supplied mechanical evaluation reported 20 PASS and no mechanical failure.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `3b35d6aecc404496dee45bb2d66eec264b59cb7e` · base `origin/develop@5801343acb92e3807c6416912a928a7b8fbe36ac` · document `.agents/spec-docs/draft/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md` blob `32fd855e7e85d4bad9ddbde7e750056cf3b434d1` (tracked)

GATE VERDICT: PASS

### [RECOMMENDATION-REVIEW] — ✅ ENDORSE | 2026-09-21

- Canonical loop run: `r20260921020517`
- Projection digest: `7a9dd6a6fd34f8b9fa787c98057ee0fe0a6be4a374e2bc66c30b5bdc15b0e6af`
- Independent `proposal-reviewer` verdict: `ENDORSE` with 0 actionable findings.
- Premises verified: the first producer alone omits clean paired paths; continuation and correction
  already union the pair; the independent consumer requires the exact pair and rejects unrelated dirt.
- Design verdict: one producer-side sorted, deduplicating pair-inventory helper is the correct SSOT;
  the consumer remains independent and DATA-2664 filtering remains owned by the existing dirt scanner.
- Ownership verdict: the approved MAP-2664 predicates correctly classify GATE-2664 as a delivery
  prerequisite rather than an eighth AGREEMENT child.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "GATE-2664 설계안을 승인합니다."
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 2de3d905c138 (review 3c432742, type/tags 74b52707)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the verbatim instruction names `GATE-2664`, approves its design, and is neither a clarification response nor approval of another item.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the mutually exclusive approval route is `DIRECT`; no delegated class is named or relied upon.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2de3d905c138) equals the document's current fingerprint
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — the Architecture Review limits the change to existing internal checkpoint producers, one shared helper, and focused tests; it introduces no package, app, interface or presentation surface, and does not reclassify a layer or product-family boundary.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `494b7500170b` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/backlog/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md` blob `9ea115b56809` (tracked)

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 460 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md",
  "specPath": ".agents/spec-docs/todo/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md",
    ".agents/tasks/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `589e3390b461` · base `origin/develop@5801343acb92` · document `.agents/spec-docs/todo/GATE-2664-first-gate-implement-checkpoint-must-bind-the-clean-paired-task-and-spec.md` blob `ba14b34d7cf0` (modified)
