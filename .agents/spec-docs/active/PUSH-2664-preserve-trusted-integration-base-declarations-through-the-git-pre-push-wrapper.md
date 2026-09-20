---
status: in-progress
type: INFRA
tags: [harness]
lane: L2
---

# PUSH-2664: Preserve trusted integration-base declarations through the Git pre-push wrapper

Paired with `.agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

BRANCH-2664 made a statement-bound
`HARNESS_BASE_REF=origin/integration/<agreement-id> git push` declaration the only supported route
for publishing a stacked child whose inherited merge commits are contained by its remote integration
base. The direct shell-hook fixture accepts that command, but the real Git hook path still refuses it
with `carries merge commits in its range over origin/develop`.

The reproduction occurs because `.husky/pre-push` invokes `pnpm harness:pre-push`, whose
`runPostVerdictGuard()` bridge synthesizes `{ command: "git push" }` unconditionally. The environment
still contains `HARNESS_BASE_REF`, but the shell guard deliberately trusts only a declaration bound
to the push statement. The bridge therefore discards the authority-carrying input before the owner
can validate it.

## Prior Art Research

Waived: This is a repository-local Git hook bridge defect; the existing BRANCH-2664 contract, executable hook code, and measured failed stacked-child push are the authoritative prior art.

## Architecture Review

### Affected Scope

- `scripts/harness/pre-push-local-checks.mjs` — Git-hook-to-shell-guard payload bridge.
- `scripts/harness/__tests__/pre-push-sequence.test.mjs` — public bridge regressions.
- The existing `.claude/hooks/pre-push-check.sh` trusted-base parser, consumed unchanged.

### Alternatives Considered

1. Read `HARNESS_BASE_REF` directly inside the shell guard even when the command carries no declaration.
   - Pro: the current bridge needs no change.
   - Con: removes statement binding and lets ambient process state authorize a push the command did not declare.
2. Reimplement trusted-ref validation in the Node bridge.
   - Pro: malformed values can be rejected before the shell process starts.
   - Con: creates a second policy owner that can drift from the existing adversarial parser.
3. Project the exact present environment value into the synthetic command consumed by the existing guard.
   - Pro: preserves statement binding and leaves all identity, ancestry, and adversarial validation in one owner.
   - Con: the bridge must prove that hostile text remains inert parser input and cannot become executable shell.

### Decision

Choose alternative 3. `runPostVerdictGuard` already serializes a command as JSON and passes that JSON
on stdin to a parser; it never executes the synthesized command. When `HARNESS_BASE_REF` is present,
the bridge renders `HARNESS_BASE_REF=<exact-value> git push`; when absent or empty, it retains bare
`git push`. The existing shell guard remains the sole validator and rejects whitespace, quoting,
untrusted identities, duplicate declarations, and extra statements.

Reachability is the actual `.husky/pre-push` → `harness:pre-push` → `runPostVerdictGuard` path.
Capability preservation is demonstrated by the unchanged absent-value payload and ordinary
foreign-merge refusal. The adversarial pass supplies metacharacter, whitespace, quoted, and malformed
values to the bridge and proves they reach the parser as inert data and cannot earn a pass.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: This is a repository-local Git hook bridge defect; the existing BRANCH-2664 contract, executable hook code, and measured failed stacked-child push are the authoritative prior art.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Extend `pre-push-sequence.test.mjs` with RED assertions for present, absent, and adversarial
   `HARNESS_BASE_REF` payloads at the public `runPostVerdictGuard` boundary.
2. Update `pre-push-local-checks.mjs` to project a present exact value into the synthetic command
   while passing the same environment to the shell guard.
3. Run the focused bridge and trusted-base suites, then the affected repository scans against the
   current integration base.

## Affected Files

- `scripts/harness/pre-push-local-checks.mjs`
- `scripts/harness/__tests__/pre-push-sequence.test.mjs`

## Completion Criteria

- [ ] TC-01: Command: `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs`
      exits nonzero before implementation because a present valid declaration is rendered as bare `git push`.
- [ ] TC-02: Observable: a present exact `HARNESS_BASE_REF` appears once before `git push` in the
      JSON payload, while absent and empty values preserve exactly `git push`.
- [ ] TC-03: Observable: whitespace, quote, newline, metacharacter, and untrusted-ref values remain
      inert payload data and receive no approval from the existing trusted-base guard.
- [ ] TC-04: Commands: `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs
  scripts/harness/__tests__/review-before-push.test.mjs` and
      `HARNESS_BASE_REF=origin/integration/agreement-2664 node scripts/harness/run-all-scans.mjs
  --affected --context pr --base origin/integration/agreement-2664` both exit 0 apart from
      runner-classified repository-baseline advisories.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                     | Notes                                     |
| ----- | ----------- | --------------------------------------------------- | ----------------------------------------- |
| TC-01 | Unit        | `pre-push-sequence.test.mjs`                        | RED before bridge projection, GREEN after |
| TC-02 | Unit        | Captured JSON payload matrix                        | Exact present/absent command rendering    |
| TC-03 | Integration | Captured payload plus existing shell-guard fixtures | No second validator or executable shell   |
| TC-04 | Suite       | Two focused Vitest files and affected scans         | Public bridge plus policy owner           |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter and structure: PASS — the mechanical evaluator reported 20 PASS, 0 FAIL, and seven semantic criteria reserved for the guardian.
- GATE-WRITE — Contains a concrete symptom: PASS — the real pre-push path rejects a valid trusted-base push with `carries merge commits in its range over origin/develop`.
- GATE-WRITE — Contains a reproduction condition: PASS — `.husky/pre-push` reaches `runPostVerdictGuard()`, which replaces the declared command with bare `git push`.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — the BRANCH-2664 contract, executable guard, and measured failure directly motivate preserving statement binding and retaining one validation owner.
- GATE-WRITE — Decision references the driving trade-off: PASS — alternative 3 preserves statement binding without duplicating validation while explicitly retaining hostile-input handling.
- GATE-WRITE — New-surface placement: PASS (N/A) — the change introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- GATE-WRITE — Completion Criteria cover each distinct sub-item: PASS — TC-01 through TC-04 cover RED proof, present/absent rendering, adversarial values, focused regressions, and affected scans.
- GATE-WRITE — Completion Criteria use command or observable form: PASS — each criterion supplies an executable command or a bounded payload/guard observation.
- GATE-WRITE — Test Plan and Task binding: PASS — four populated rows map one-to-one to TC-01 through TC-04, and the exact paired Task path is present.

**Judged by:** independent guardian agent Ohm plus `gate.mjs` mechanical evaluator
**Judged at:** HEAD `df02719373ca` · base `origin/integration/agreement-2664@df02719373ca` · document `.agents/spec-docs/draft/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md` blob `dbc8ad23252e` (untracked, hashed before this entry)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 7c979ce4f131 (review 93309252, type/tags cf40db57)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7c979ce4f131) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the reasoned PUSH-2664 recommendation and independent GATE-WRITE PASS satisfy the recorded standing conditional auto-approval in this conversation.
- GATE-APPROVAL — The item is inside the named delegated class: PASS (N/A) — the mutually exclusive route is DIRECT, so no delegated class boundary is asserted.
- GATE-APPROVAL — Independent architecture validation: PASS (N/A) — this narrow bridge repair adds no package, app, product/interface surface, layer, or contract owner.
- GATE-APPROVAL — NON-COMPLIANCE trigger: not triggered — only the paired untracked Task/spec exist; both affected executable/test paths remain identical to HEAD.

**Judged by:** independent guardian agent Ohm plus `gate.mjs` mechanical evaluator
**Judged at:** HEAD `df02719373ca` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md` blob `68a345bb495a` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 286 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md",
  "specPath": ".agents/spec-docs/todo/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md",
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
    ".agents/spec-docs/todo/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md",
    ".agents/tasks/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d2ea325135a0` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/PUSH-2664-preserve-trusted-integration-base-declarations-through-the-git-pre-push-wrapper.md` blob `0b9e7fbcae9a` (tracked)
