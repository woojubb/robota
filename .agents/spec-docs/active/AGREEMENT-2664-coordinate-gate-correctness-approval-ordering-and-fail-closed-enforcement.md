---
status: in-progress
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
- `.agents/spec-docs/todo/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`
- The eight exact child Task paths listed under `## Tasks`.
- `.agents/loop-runs/user-request-gate.jsonl`

## Completion Criteria

- [ ] TC-01: Observable: the parent Task/spec and all eight child Tasks form one exact-basename, source-cited, lifecycle-open manifest with matching Children/Tasks projections.
- [ ] TC-02: Observable: BEHAVIOR-2664, PUSH-2664, and DATA-2664 precede governance children in that order, while every declared dependency names an existing non-duplicated Task owner.
- [ ] TC-03: Command: `node scripts/harness/scan-user-execution-plan-order.mjs --staged` exits 0 for the atomic conversion prelude.
- [ ] TC-04: Command: `node scripts/harness/scan-task-frontmatter-fields.mjs`, `node scripts/harness/scan-work-item-id-collision.mjs`, `node scripts/harness/scan-spec-research.mjs`, and `node scripts/harness/run-all-scans.mjs --affected --context pr` each exit 0 for the committed manifest.
- [ ] TC-05: Observable: issue #2664 contains one readable parent Task marker and a complete child/external-owner map before its priority label is removed.
- [ ] TC-06: Observable: every child Task/spec reaches its terminal gate with a merged landing witness, and no child absorbs a finding owned by another child or dependency without a new approval record.
- [ ] TC-07: Observable: final issue #2664 reconciliation maps all eight children and AGREEMENT-012, AGREEMENT-013, and AGREEMENT-2698 to delivered or explicit terminal evidence before the umbrella receives its closure record.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                            | Notes                                                           |
| ----- | ----------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TC-01 | contract    | AGREEMENT projection and exact source-URL scans                            | Parent and child sets must match byte-for-byte paths.           |
| TC-02 | contract    | dependency graph and duplicate-owner inspection                            | Existing AGREEMENT owners remain external dependencies.         |
| TC-03 | integration | `node scripts/harness/scan-user-execution-plan-order.mjs --staged`         | Runs before the conversion commit.                              |
| TC-04 | integration | exact four commands named in TC-04                                         | Every command must exit 0; partial success is not accepted.     |
| TC-05 | integration | `github-issue-triage.mjs convert` dry-run/apply/read-back                  | Remote mutation occurs only after local manifest verification.  |
| TC-06 | contract    | child terminal gate, PR landing, and affected-path read-back               | Compare approved scope with each terminal diff and finding log. |
| TC-07 | integration | GitHub register, Task/spec lifecycle, PR, and merge-witness reconciliation | Every declared owner needs exact terminal evidence.             |

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

### [GATE-WRITE] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- Completion Criteria — At least 1 criterion per distinct feature or sub-item: Solution items 3–5 require child lifecycle completion, cross-owner scope isolation, and terminal umbrella reconciliation, but no TC explicitly covers those three outcomes; TC-02 covers ordering and owner existence, and TC-05 covers the issue map before label removal.
  **Required action:** Add TC-N criteria that explicitly cover each child's completed gate lifecycle, isolation of findings and scope across owners, and final reconciliation of every child and external owner to a delivered or explicitly terminal outcome before umbrella closure.
- Completion Criteria — Each criterion uses Command form or Observable behavior form: TC-04 is labelled `Command` but names scan categories rather than exact executable commands and bounded expected outputs; its Test Plan row likewise leaves the focused scans unnamed and provides no bounded result beyond a broad exit-0 claim.
  **Required action:** Name the exact command or commands for every scan TC-04 requires and state the bounded success output or exit condition for each.

**Judged at:** HEAD `7ac8509cf2133332c73e41fb2e8b27a492ca873e` · base `origin/develop@c81dd4ff75695e3f6a72566d4b3256f42e6479e7` · document `.agents/spec-docs/draft/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md` blob `6005786383503c8ffed81bf586ce94e52fd3ddc1` (tracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter: mechanical evaluation reports all required frontmatter criteria PASS (`status: draft`, `type: AGREEMENT`, `tags: [harness]`, and the opening YAML block).
- GATE-WRITE — Problem — concrete symptom: PASS — the document identifies `runApprove` omitting `orderingResult` and `checkpointWorktreePaths` recording lesson churn that `worktreeError` rejects.
- GATE-WRITE — Problem — reproduction condition: PASS — the failure locations and triggering evaluator/checkpoint-consumer paths are named, including approval judgement without the ordering result and checkpoint evidence containing churn rejected by its consumer.
- GATE-WRITE — Problem — mechanical wording check: PASS — the mechanical evaluator reports no banned placeholder or vague-description failure.
- GATE-WRITE — Prior Art Research — research feeds Alternatives Considered / Decision: PASS — the waiver names the approved Issue-to-Task ownership and atomic-conversion contract, and the alternatives and decision apply those constraints to select cause-aligned children, preserve existing owners as dependencies, and retain one reconciliation owner.
- GATE-WRITE — Prior Art Research — mechanical checks: PASS — the section is present and carries an explicit substantiated waiver.
- GATE-WRITE — Architecture Review — Decision references the driving trade-off: PASS — it chooses independent reviewability and non-duplication with one umbrella reconciliation owner despite the sequencing cost.
- GATE-WRITE — Architecture Review — new-surface placement: N/A — this planning conversion introduces no package, app, presentation/interface surface, or layer/product-family reclassification; it creates planning records and delegates later harness changes to child work.
- GATE-WRITE — Architecture Review — mechanical checks: PASS — all four checklist items are checked, the sibling scan carries completion evidence, and three alternatives each state a pro and con.
- GATE-WRITE — Completion Criteria — coverage per distinct feature/sub-item: PASS — TC-01 covers the exact manifest, TC-02 dependency order and owner uniqueness, TC-03/TC-04 structural and lifecycle scans, TC-05 the issue marker/map, TC-06 terminal child lifecycles and cross-owner isolation, and TC-07 final umbrella reconciliation and closure ordering.
- GATE-WRITE — Completion Criteria — command or observable form: PASS — TC-01, TC-02, and TC-05–TC-07 state bounded observable outcomes; TC-03 and TC-04 name exact executable commands and require exit 0.
- GATE-WRITE — Completion Criteria — mechanical checks: PASS — all seven items have TC-N prefixes and use none of the prohibited phrases.
- GATE-WRITE — Test Plan: PASS — seven non-empty rows map one-to-one to TC-01 through TC-07, with Test Type and Tool / Approach populated and no manual-tool row; Completion Criteria count 7 equals Test Plan count 7.
- GATE-WRITE — Structure: PASS — the Tasks and Evidence Log sections are present, prior evidence is preserved for this recheck, and no body-level Status or Classification section exists.
- GATE-WRITE — Mechanical evaluator: 20 PASS, 0 FAIL, and 7 PENDING-GUARDIAN; all seven semantic criteria above PASS or are explicitly N/A with reason.

**Judged at:** HEAD `7ac8509cf2133332c73e41fb2e8b27a492ca873e` · base `origin/develop@c81dd4ff75695e3f6a72566d4b3256f42e6479e7` · document `.agents/spec-docs/draft/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md` blob `e88e1a01f8830cbb352d82c24b2dde1f4556171a` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 7dec86b05ed1 (review 2363bc66, type/tags 61c4ebe4)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7dec86b05ed1) equals the document's current fingerprint
- GATE-APPROVAL — ordering (guardian): PASS — the prior-gate map declares `recorded-pass` for GATE-APPROVAL. This Evidence Log contains a GATE-WRITE PASS with `**Status upgrade:** draft → review-ready`, the current frontmatter is `status: review-ready`, and the document is in `.agents/spec-docs/backlog/`, which `spec-workflow.md` maps to that status.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the DIRECT-route instruction `승인함.` is the catalogue's canonical explicit-approval form, and `gate.mjs approve` recorded it against this exact AGREEMENT-2664 document in this conversation; it is not a clarification answer, silence, or an instruction relayed from another record.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the mutually exclusive approval route is `DIRECT`, so no delegated class or class boundary is asserted.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — the spec creates and coordinates planning/ownership records and delegates later harness work to separately gated child items; it introduces no package, app, product/interface/presentation surface, or layer/product-family reclassification. The GATE-WRITE architecture-placement judgement independently reached the same N/A conclusion.
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate ran): not triggered — `origin/develop...HEAD` contains only this planning spec and eight Task records, while the current worktree contains only the parent Task/spec transition and the subject-bound user-request ledger; no package, app, script, or other implementation path was committed, staged, or modified.
- GATE-APPROVAL — semantic set judged by `backlog-gate-guard` at HEAD `7ac8509cf2133332c73e41fb2e8b27a492ca873e`, document blob `182344b26b09db81cf21409e4222e7e81d238be2` (modified, hashed before these lines were appended); the earlier five criterion lines written by `gate.mjs` are the mechanical set and were not re-judged here.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7ac8509cf213` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/backlog/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md` blob `e4c98ca308c7` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 9180a93eebe0 (review f6b0b5e6, type/tags 61c4ebe4)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9180a93eebe0) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `8b1dcac3472f` · base `origin/develop@58f24c1b73e2` · document `.agents/spec-docs/todo/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md` blob `acacb33f3725` (modified)
### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (7)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 302 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md",
    ".agents/tasks/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `89dc4a558823` · base `origin/develop@f8dc5a0458c4` · document `.agents/spec-docs/todo/AGREEMENT-2664-coordinate-gate-correctness-approval-ordering-and-fail-closed-enforcement.md` blob `03f00a942834` (tracked)
