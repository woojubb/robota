---
status: draft
type: FLOW
tags: [workflow, harness]
lane: L2
---

# PROC-018: Record the PROC-017 post-merge continuation scope

Paired with `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md`. Arising from [issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

Repair the post-merge sequencing omission in PROC-017: its accepted plan requires a committed
candidate measurement after PR #2542 merges, but its `### Decision` section does not name the
artifacts for that required later PR. Record the exact closeout scope before attempting the
continuation checkpoint, without weakening the branch-local planning guard.

Reproduction: read the merged document at
`.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`.
TC-06 requires a post-merge evidence commit, while `continuationArtifacts(...)` reports a missing
`Architecture Review/Decision` declaration, so the required later branch cannot form the
continuation checkpoint mandated by `backlog-execution.md`.

## Prior Art Research

Waived: Repository-local recovery planning uses the existing continuation contract and requires no external prior art.

## Architecture Review

### Affected Scope

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`
  — add the existing contract's exact continuation declaration only.
- No rule, gate, parser, package, or product behavior changes.

### Alternatives Considered

1. Add the exact closeout artifact declaration to PROC-017 before its continuation branch is cut.
   - Pro: satisfies the existing parent-spec binding without weakening the scanner or changing the
     continuation contract.
   - Con: requires this small preparatory PR before the evidence closeout PR.
2. Teach the scanner to accept a declaration introduced inside the continuation checkpoint.
   - Pro: avoids the preparatory PR.
   - Con: weakens the parent-spec ancestry guarantee and changes an L2 enforcement surface.
3. Close PROC-017 without committing candidate evidence.
   - Pro: no additional repository changes.
   - Con: violates PROC-017 TC-06 and leaves the measured claim unverified; rejected.

### Decision

**Alternative 1.** Add one exact `**Continuation artifacts:**` line under PROC-017's existing
Decision. The line lists only the six non-pair artifacts already prepared for closeout, in the order
the continuation evidence contract must preserve:

1. `.agents/evidence/PROC-017-candidate.json`
2. `.agents/loop-runs/pr-finding-resolution-loop.jsonl`
3. `.agents/skills/backlog-execution-orchestrator/SKILL.md`
4. `.agents/skills/user-request-gate/SKILL.md`
5. `scripts/harness/__tests__/conversion-evidence.test.mjs`
6. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

The paired PROC-017 Task/spec paths remain bound separately by the continuation payload's `taskPath`
and `specPath`; the predecessor post-merge ledger already landed in this preparation branch and is not
part of the later closeout scope. This preserves the existing parent-spec binding and fail-closed
behavior.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: Repository-local recovery planning uses the existing continuation contract and requires no external prior art.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Insert the single contract-owned declaration in PROC-017's Decision. Verify it by parsing the live
backlog rule and active spec with `continuationArtifacts`, checking the exact ordered array and unique
line count, then run the affected scan. No code or contract implementation changes.

## Affected Files

- `.agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`

## Completion Criteria

- [ ] TC-01: a Node assertion using `parseCheckpointEvidenceContract` and
      `continuationArtifacts` exits 0 and returns the six Decision artifacts above in exact order.
- [ ] TC-02: `rg -c '^\*\*Continuation artifacts:\*\* ' <PROC-017-active-spec>` prints `1`, and
      `git diff --name-only <planning-checkpoint>..HEAD` names only the PROC-017 active spec.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 after the documentation change is committed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                | Notes                                                                                                   |
| ----- | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| TC-01 | Contract    | Node assertion over `checkpoint-evidence-contract.mjs` exports                 | Test skipped: document instance uses the existing tested parser; live exact-value assertion is stronger |
| TC-02 | Static/diff | exact `rg -c` plus `git diff --name-only`                                      | Test skipped: single-document scope is verified directly                                                |
| TC-03 | Suite       | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Repository regression gate                                                                              |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-018-record-the-proc-017-post-merge-continuation-scope.md` — todo

## Evidence Log
