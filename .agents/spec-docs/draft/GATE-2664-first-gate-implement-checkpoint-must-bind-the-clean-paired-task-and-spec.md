---
status: draft
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

## Evidence Log
