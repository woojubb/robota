---
status: in-progress
type: INFRA
tags: [ci, typescript]
lane: L2
---

# INFRA-2581: post-merge completion can archive a task after squash merge

Paired with `.agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md`. Arising from [issue #2581](https://github.com/woojubb/robota/issues/2581).

## Problem

On a fresh branch cut from `origin/develop`, moving a fully verified in-progress Task/spec pair to
`.agents/tasks/completed/` and `.agents/spec-docs/done/` is rejected by
`node scripts/harness/scan-user-execution-plan-order.mjs --staged` with
`proposed checkpoint does not stage the exact active Task/spec pair`. The delivering PR's squash
merge preserved the final documents but not the original planning-checkpoint ancestry, so the
required completion commit is classified as retrospective implementation. The same shape causes the
PR scan to see the base's active pair and the branch's archived pair as duplicate records.

## Prior Art Research

Waived: User explicitly prohibited subagents and additional worktrees; repository-local harness
contracts, the existing issue record, and the reproduced local failure are the authoritative
references for this narrow repository-internal fix.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md`
- `.agents/spec-docs/active/SECURITY-2465-complete-the-workspace-trust-boundary.md`

### Alternatives Considered

1. Permit any active-to-archived Task/spec move after a merge.
   - Pro: minimal implementation and it unblocks the immediate closeout.
   - Con: an incomplete or unrelated record could be archived without a causal post-merge proof.
2. Require one append-only, verified post-merge ledger record and validate the terminal Task/spec
   evidence before accepting the exact four-path archival shape.
   - Pro: preserves causal ordering, keeps the exception narrow, and works when squash merges hide
     the original checkpoint commit.
   - Con: completion commits must carry the ledger append and the validator must inspect both trees.

### Decision

**Alternative 2.** The validator will accept only the exact same-basename Task/spec archive, require
the parent tree to hold the open in-progress pair, require the destination documents to carry the
terminal completion state and evidence, and require a single append-only post-merge record whose
verified merge commit is already in the topic base. This trades a small amount of evidence parsing
for a fail-closed boundary against partial or implementation-mixed archival.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: User explicitly prohibited subagents and additional worktrees; repository-local harness contracts and the existing issue record are the authoritative references for this narrow fix.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add a plan-order record predicate for a post-merge completion closeout. It reads the parent and
   resulting trees, validates the four same-basename archive paths, checks terminal Task/spec status
   and completion evidence, and accepts only one verified post-merge ledger append alongside them.
2. Keep ordinary pre-checkpoint and implementation ordering unchanged; reject missing ledger proof,
   incomplete evidence, duplicate basenames, and any non-document implementation path.
3. Add hermetic regression fixtures covering a squash-merged base, staged closeout, valid committed
   closeout, incomplete archive, and mixed source/implementation changes.
4. Record the existing SECURITY-2465 delivery's closeout evidence and archive its Task/spec through
   the new bounded path.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md`
- `.agents/spec-docs/active/SECURITY-2465-complete-the-workspace-trust-boundary.md`

## Completion Criteria

- [ ] TC-01: The plan-order fixture reproduces the squash-merge archival refusal before the fix and
      accepts the exact closeout shape after the fix while rejecting incomplete and mixed variants.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      exits 0 for the whole registered regression file.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 with no duplicate backlog record and no plan-order finding.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                                                                     | Notes                                                                |
| ----- | ---------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| TC-01 | Unit       | hermetic Git fixtures in `scan-user-execution-plan-order.test.mjs`                                  | Red before the predicate, green after it; negative variants stay red |
| TC-02 | Regression | `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`            | Runs the complete focused file                                       |
| TC-03 | Harness    | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Affected repository gate                                             |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → review-ready

- GATE-WRITE — concrete symptom: PASS — the Problem names the exact staged scan command and its `proposed checkpoint does not stage the exact active Task/spec pair` refusal after a squash merge.
- GATE-WRITE — reproduction condition: PASS — the Problem identifies a fresh branch from `origin/develop`, an already-delivered squash-merged implementation, and the exact Task/spec archival operation that triggers the refusal.
- GATE-WRITE — research/waiver feeds the decision: PASS — the explicit no-subagent waiver points to the existing issue and local harness contract; the Decision rejects an unconstrained archive exception and selects a ledger-bound, evidence-validated shape.
- GATE-WRITE — Decision trade-off: PASS — Alternative 2 explicitly trades a small amount of parent/destination evidence parsing for fail-closed protection against partial or implementation-mixed archival.
- GATE-WRITE — new-surface placement: N/A — this changes existing repository harness classification and documentation records, not a package, app, presentation, interface, or product-family boundary.
- GATE-WRITE — completion-criteria coverage: PASS — TC-01 covers the reproduction and negative cases, TC-02 covers staged/history acceptance and refusal, and TC-03 covers the focused regression plus affected scan.
- GATE-WRITE — criterion form and test-plan cross-check: PASS — all three criteria use observable command/result forms and each has one matching Test Plan row.

**Judged by:** single-agent manual semantic review; subagents are prohibited by the user for this session.
**Judged at:** HEAD `101fda832bb4e09dfe3231080543ee2a05a3bcfb` · base `origin/develop@101fda832bb4e09dfe3231080543ee2a05a3bcfb` · document `.agents/spec-docs/draft/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` blob `9c3307b3eff177f13896cf5668c5771e6aaf35aa` (untracked)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** 8cc8acc230b1 (review d61d4058, type/tags 8d7fd89f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8cc8acc230b1) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `101fda832bb4` · base `origin/develop@101fda832bb4` · document `.agents/spec-docs/backlog/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` blob `5f6c8b3a34ce` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Semantic review:** The user's explicit standing approval, "다 사전승인함", applies to this
INFRA-2581 Task/spec conversion and its bounded implementation. The selected design is limited to
an exact Task/spec archive plus one verified post-merge ledger record and terminal evidence; the
negative cases reject partial, unbound, and implementation-mixed archives. No new user-facing
surface or architecture boundary is introduced, so the DIRECT route is sufficient.

- GATE-APPROVAL — approval route: observed DIRECT under the user's explicit standing approval
- GATE-APPROVAL — authorisation: observed the verbatim instruction "다 사전승인함" in this session
- GATE-APPROVAL — scope: observed the bounded archive, ledger, evidence, and negative-case design
- GATE-APPROVAL — review freshness: observed unchanged type/tags and Architecture Review since the recorded fingerprint

**Judged by:** single-agent manual semantic review; subagents are prohibited by the user for this session.
**Judged at:** HEAD `101fda832bb4e09dfe3231080543ee2a05a3bcfb` · base `origin/develop@101fda832bb4e09dfe3231080543ee2a05a3bcfb`

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-10

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `101fda832bb4` · base `origin/develop@101fda832bb4` · document `.agents/spec-docs/todo/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` blob `43db466cbd2e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** 8883c31f8aa6 (review da816e49, type/tags 8d7fd89f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8883c31f8aa6) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `101fda832bb4` · base `origin/develop@101fda832bb4` · document `.agents/spec-docs/todo/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` blob `5e1e9bfb4ace` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-10; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 398 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md",
  "specPath": ".agents/spec-docs/todo/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md",
    ".agents/tasks/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `101fda832bb4` · base `origin/develop@101fda832bb4` · document `.agents/spec-docs/todo/INFRA-2581-post-merge-completion-can-archive-a-task-after-squash-merge.md` blob `fcfc338301e6` (untracked)
