---
status: draft
type: AGREEMENT
tags: [harness]
lane: L2
---

# AGREEMENT-2664: Coordinate gate correctness, approval ordering, and fail-closed enforcement

Paired with `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`.
Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

Issue #2664 now contains several independently verifiable causes under one external gate-correctness
outcome. The retained defect is reproducible because `runApprove` judges only GATE-APPROVAL's own
criteria and omits `orderingResult`; a later comment reproduces a second defect where
`checkpointWorktreePaths` records auto-generated lesson churn that `worktreeError` rejects. The inherited
register also contains live metadata, evaluator-routing, endorsement, legacy-approval, and
orchestration-disposition gaps, while three scopes already have active owners elsewhere.

Implementing directly from the umbrella would either combine unrelated causes into one unreviewable
change or duplicate AGREEMENT-012, AGREEMENT-013, and AGREEMENT-2698. Staging several new Tasks without
one relationship owner would also violate the repository's multi-Task planning-order contract.

## Prior Art Research

Waived: the approved Issue-to-Task rules already define cause-aligned Tasks, exact source identity,
AGREEMENT ownership, and atomic conversion manifests. This document applies that repository-local
contract and makes no new product, protocol, package, API, or user-interface design decision.

## Architecture Review

### Affected Scope

- This exact AGREEMENT Task/spec and eight new child Tasks.
- Existing dependency owners AGREEMENT-012, AGREEMENT-013, and AGREEMENT-2698, referenced but not edited
  as part of the conversion manifest.
- Later child work in `scripts/harness/gate*.mjs`, checkpoint evidence, spec-frontmatter validation,
  approval provenance, and gate-catalogue policy; no implementation path changes in this conversion.
- GitHub issue #2664 and exact source Issues #2326, #2380, #2582, #2663, and #2665.

### Alternatives Considered

1. **Implement the umbrella as one Task.**
   - Pro: one planning record.
   - Con: combines distinct causes, verification boundaries, and policy decisions, while duplicating active owners.
2. **Create unrelated Tasks with no shared owner.**
   - Pro: each implementation remains independently reviewable.
   - Con: loses the exact umbrella closure map and makes cross-Task ordering and final reconciliation ownerless.
3. **Create one AGREEMENT with eight new cause-aligned children and explicit external dependencies (chosen).**
   - Pro: preserves independent implementation/review while giving the umbrella one complete reconciliation owner.
   - Con: requires a sequenced initiative and cannot close until both children and named external owners terminate.

### Decision

Choose alternative 3. The new child set contains only currently unowned causes that can reach an
independent completion decision. Existing AGREEMENT owners remain dependencies rather than nested or
duplicate children. Execute BEHAVIOR-2664 first because its ordering omission can invalidate the
approval gate used by every later child. Execute PUSH-2664 second because the Git-hook bridge must
preserve the trusted integration-base declaration before later children can be published; execute
DATA-2664 third because the checkpoint producer can write evidence its own consumer rejects. Wider
governance and historical-policy children follow only after those foundations are corrected.

The initiative uses a shared integration base with one child Task at a time. Each child receives its
own paired spec and gate lifecycle before implementation; no child expands another child's approved
scope. The final umbrella reconciliation compares every register row with exactly one delivered or
explicitly terminal owner before issue closure.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — conversion records, future harness surfaces, and external Task owners are named.
- [x] Sibling scan 완료 — all source Issues, active Task/spec owners, linked PR signals, and current code reproductions were inspected.
- [x] 대안 최소 2개 검토 완료 — three ownership shapes and their costs are recorded.
- [x] 결정 근거 문서화 완료 — cause isolation, non-duplication, and gate-dependency order select the AGREEMENT shape.

## Fallback & Degradation Declaration

None

## Solution

1. Land the exact parent Task/spec and eight child Task records as one conversion prelude.
2. Finalize the issue #2664 Task marker only after the complete manifest passes structural and lifecycle scans.
3. Execute BEHAVIOR-2664, PUSH-2664, and DATA-2664 first, each through its own approved L2 spec and verification.
4. Execute the remaining children in dependency order without absorbing findings from another owner.
5. Reconcile child and external dependency outcomes against the umbrella register and close only on a complete map.

## Affected Files

- `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`
- `.agents/spec-docs/draft/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`
- The eight exact child Task paths listed under `## Tasks`.
- `.agents/loop-runs/user-request-gate.jsonl`

## Completion Criteria

- [ ] TC-01: Observable: the parent Task/spec and all eight child Tasks form one exact-basename, source-cited, lifecycle-open manifest with matching Children/Tasks projections.
- [ ] TC-02: Observable: BEHAVIOR-2664, PUSH-2664, and DATA-2664 precede governance children in that order, while every declared dependency names an existing non-duplicated Task owner.
- [ ] TC-03: Command: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` exits 0 for the atomic conversion prelude.
- [ ] TC-04: Command: Task lifecycle, work-item identity, frontmatter, research, and affected harness scans exit 0 for the committed manifest.
- [ ] TC-05: Observable: issue #2664 contains one readable parent Task marker and a complete child/external-owner map before its priority label is removed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                               | Notes                                                          |
| ----- | ----------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| TC-01 | contract    | AGREEMENT projection and exact source-URL scans                                               | Parent and child sets must match byte-for-byte paths.          |
| TC-02 | contract    | dependency graph and duplicate-owner inspection                                               | Existing AGREEMENT owners remain external dependencies.        |
| TC-03 | integration | `node scripts/harness/scan-user-execution-plan-order.mjs --staged`                            | Runs before the conversion commit.                             |
| TC-04 | integration | focused Task/spec scans plus `node scripts/harness/run-all-scans.mjs --affected --context pr` | No product build scope is introduced.                          |
| TC-05 | integration | `github-issue-triage.mjs convert` dry-run/apply/read-back                                     | Remote mutation occurs only after local manifest verification. |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This conversion changes repository planning records and GitHub ownership only; every child
owns later private harness verification, and no Robota product surface changes in this work unit.

## Tasks

Paired execution record:
`.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`.

- [ ] BEHAVIOR-2664 — todo — `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`
- [ ] PUSH-2664 — todo — `.agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`
- [ ] DATA-2664 — todo — `.agents/tasks/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`
- [ ] RULE-2582 — todo — `.agents/tasks/RULE-2582-require-one-non-empty-spec-tags-contract-at-planning-and-final-validation.md`
- [ ] BEHAVIOR-2663 — todo — `.agents/tasks/BEHAVIOR-2663-bind-mechanical-gate-verify-checks-without-prose-drift.md`
- [ ] RULE-2665 — todo — `.agents/tasks/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`
- [ ] RULE-2326 — todo — `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`
- [ ] RULE-2380 — todo — `.agents/tasks/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`

## Evidence Log
