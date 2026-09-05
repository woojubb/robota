---
status: in-progress
type: INFRA
tags: [infra, harness]
lane: L2
---

# INFRA-178: Preserve a planning checkpoint for the branch-policy CI change

## Problem

The requested branch-policy alignment must retain release-branch protections while allowing the
explicitly authorized integration-branch workflow. The repository gate also requires a recorded
planning checkpoint before implementation changes are evaluated.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-maintainer workflow enforcement and has no end-user runtime surface,
CLI behavior, SDK contract, or product-facing interaction to execute.

## Prior Art Research

Waived: this is a repository-local policy alignment with no external product or protocol behavior.

## Architecture Review

### Affected Scope

- `.agents/rules/git-branch.md`
- `.claude/hooks/branch-guard.sh`
- `.husky/pre-commit`

### Alternatives Considered

1. Change only the policy prose. Pro: smallest edit. Con: local guards would remain inconsistent.
2. Align the policy and local guards together. Pro: one coherent enforcement contract. Con: direct
   integration-branch operations remain available only by explicit maintainer request.

### Decision

Choose alternative 2 so the written policy and local enforcement agree while `main` and `master`
remain protected.

**Delivery mode:** `single`

## Completion Criteria

- [ ] TC-01: policy and local guards permit the explicitly requested `develop` workflow.
- [ ] TC-02: repository CI scans pass for the final tree.

## Test Plan

| TC-ID | Test Type | Tool / Approach            | Notes                                               |
| ----- | --------- | -------------------------- | --------------------------------------------------- |
| TC-01 | Unit      | Focused harness assertions | Confirm release branches remain protected.          |
| TC-02 | CI        | `pnpm harness:scan`        | Use the pull-request CI result as final acceptance. |

## Tasks

- [ ] `.agents/tasks/INFRA-178-branch-policy-ci-planning-anchor.md` — in-progress

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "변경은 매우 쉬운 작업이니 빨리 작업해서 develop 을 베이스브랜치로 pr올려서 바로 pr을 머지하세요"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 2cef3716bbf8 (review 52dfb75b, type/tags 2327459a)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2cef3716bbf8) equals the document's current fingerprint

**Judged at:** HEAD `d0a6da389db5` · base `origin/develop@230ce537463d` · document `.agents/spec-docs/active/INFRA-178-branch-policy-ci-planning-anchor.md` blob `05b2057613b3` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-178-branch-policy-ci-planning-anchor.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-178-branch-policy-ci-planning-anchor.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 2 checkbox tasks for 2 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 181 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-178-branch-policy-ci-planning-anchor.md",
  "specPath": ".agents/spec-docs/todo/INFRA-178-branch-policy-ci-planning-anchor.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Keep branch-policy documentation and local guards aligned."
    },
    {
      "kind": "checkbox",
      "value": "Confirm the repository CI scan accepts the resulting policy."
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-178-branch-policy-ci-planning-anchor.md",
    ".agents/tasks/INFRA-178-branch-policy-ci-planning-anchor.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `d0a6da389db5` · base `origin/develop@230ce537463d` · document `.agents/spec-docs/todo/INFRA-178-branch-policy-ci-planning-anchor.md` blob `85b8ce406834` (untracked)
