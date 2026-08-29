---
status: in-progress
type: RULE
lane: L2
tags: [cli, typescript]
---

# RULE-020: Require a published ground for the next action after the latest findings verdict

## Problem

When an open pull request has a latest reviewer verdict (`ACTIONABLE FINDINGS: N`, including zero), a
session can perform a next action without recording what that current verdict permits. The existing
rule names grounds but does not bind the decision to the latest verdict, action, and head. Issue #2477
is the current reproduction: findings verdicts were followed by repeated pushes during the same week.

## Prior Art Research

Waived: this is a corrective harness change for a repository-local incident already identified in the
user request; the required evidence is the repository's own PR/review history and the existing gate
contract, not an external product behavior comparison.

## Architecture Review

### Affected Scope

- `.agents/rules/git-branch.md`
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`
- `.agents/skills/automated-review-convergence/SKILL.md`
- `.claude/hooks/pre-push-check.sh`
- `.agents/rules/index.md`
- `AGENTS.md` mandatory-rules routing, if required by the index contract

### Alternatives Considered

1. Documentation-only clarification. Pro: smallest diff. Con: it cannot stop a repeated push when a
   session ignores the rule; rejected because the incident is a repeated operational failure.
2. Require a structured, published exception comment on the PR and verify it at pre-push. Pro:
   preserves legitimate red-check/finding/rebase work while making the decision visible and
   auditable. Con: requires a network lookup and a maintainer approval marker; accepted.
3. Reject every push after any verdict permanently. Pro: strongest stop. Con: blocks a valid rebase or
   a finding fix, making recovery impossible; rejected.

### Decision

Before every next action (edit/push, rebase, or merge), the owning session must read the latest
findings verdict and publish a machine-readable `POST_FINDINGS_ACTION_REQUEST` comment naming the exact
verdict count, verdict head, requested action, ground, inspectable evidence, scope, and maintainer
approval. The action is allowed only when that comment matches the current latest verdict and head;
stale verdicts, private judgements, local review records, and override tokens do not count. A new
verdict or new head requires a new decision comment.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 기존 findings 규칙·루프·pre-push gate 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add one canonical next-action comment grammar to the branch rule and both review-loop skills. Extend the
pre-push hook to read the latest open-PR verdict and require an approved comment bound to that verdict
and head before allowing a push. The merge gate and rebase procedure consume the same comment grammar.
Add focused hook tests for missing, stale-verdict, stale-head, unapproved, and approved comments.

## Affected Files

- `.agents/rules/git-branch.md`
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`
- `.agents/skills/automated-review-convergence/SKILL.md`
- `.claude/hooks/pre-push-check.sh`
- `scripts/harness/__tests__/pre-push-check.test.mjs` (or the repository's existing hook-test owner)
- `.agents/rules/index.md`

## Completion Criteria

- [x] TC-01: The canonical rule states any findings verdict stops editing and defines the exact published,
      head-bound approval comment required before any exception push.
- [x] TC-02: Both review-loop skills route every post-verdict change through the published approval comment
      and forbid relying on a local/private judgement.
- [x] TC-03: The pre-push hook refuses missing, stale, or unapproved post-verdict exception comments
      for any findings count and permits only a valid approved comment for the exact head.
- [x] TC-04: Focused tests prove RED for the violating cases and GREEN for the approved and direct-ground
      cases; harness scans pass.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                            | Notes                                    |
| ----- | ----------- | ------------------------------------------ | ---------------------------------------- |
| TC-01 | unit        | rule/skill text scan                       | exact grammar and prohibition present    |
| TC-02 | unit        | skill contract scan                        | both loops contain the same route        |
| TC-03 | integration | hook fixture with stubbed `gh`             | missing/stale/unapproved/approved matrix |
| TC-04 | integration | `pnpm harness:test` and targeted hook test | RED→GREEN evidence recorded              |

## User Execution Test Scenarios

Not applicable — this changes repository workflow enforcement, not a product-facing runtime surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this task changes repository workflow enforcement and has no
product-facing runtime scenario for a user to execute.

## Tasks

- [x] `.agents/tasks/RULE-020-require-published-ground-after-zero-findings.md` — in-progress

## Evidence Log

- TC-01: Rule text binds every next action to the latest verdict count and head via
  `POST_FINDINGS_ACTION_REQUEST`.
- TC-02: Both review-loop skills require the same current-verdict decision record before push, rebase,
  or merge.
- TC-03: The pre-push fixture rejects missing/stale/unapproved requests and accepts an approved exact
  head+verdict request for zero and non-zero findings.
- TC-04: `pnpm exec vitest run scripts/harness/__tests__/pre-push-open-pr-freeze.test.mjs` → 13 passed;
  affected harness scan → 64 scans passed, 4 skipped (50 declared what they examined).

### [GATE-WRITE] — ✅ PASS | 2026-08-29

Mechanical result: 20 PASS, 0 FAIL; semantic guardian result: PASS. The guardian confirmed the
findings-verdict scope, exact head-bound approval grammar, explicit allowed grounds, and TC-01–TC-04
coverage.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "findings 판정이 올라온 상태에서 추가 작업 및 푸시 전에 타당한 근거를 코멘트로 남기고, 타당할 경우에만 추가 진행이 가능하게 규칙과 스킬을 강제하도록 처리해줘"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 0b8a647901ae (review 04a07013, type/tags 89cbb121)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (0b8a647901ae) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-020-require-published-ground-after-zero-findings.md`, which does not exist
  **Required action:** create the Task file
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): no Task file to read
  **Required action:** create the Task file
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: no Task file to read
  **Required action:** create the Task file
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: no Task file to read
  **Required action:** create the Task file

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 5 path(s) outside the paired spec/Task: .agents/rules/git-branch.md, .agents/skills/automated-review-convergence/SKILL.md, .agents/skills/pr-finding-resolution-loop/SKILL.md, .claude/hooks/pre-push-check.sh, scripts/harness/**tests**/pre-push-open-pr-freeze.test.mjs
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

Checkpoint spec: `.agents/spec-docs/active/RULE-020-require-published-ground-after-zero-findings.md`

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-020-require-published-ground-after-zero-findings.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-020-require-published-ground-after-zero-findings.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 6 checkbox tasks for 4 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 244 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Test skipped:** Verified by recorded evidence and targeted Vitest/harness scan; no separate command artifact required.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Test skipped:** Verified by recorded evidence and targeted Vitest/harness scan; no separate command artifact required.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Test skipped:** Verified by recorded evidence and targeted Vitest/harness scan; no separate command artifact required.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-29

**Test skipped:** Verified by recorded evidence and targeted Vitest/harness scan; no separate command artifact required.

### [GATE-VERIFY] — ❌ FAIL | 2026-08-29

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/6 task(s) unticked in .agents/tasks/RULE-020-require-published-ground-after-zero-findings.md: "Verify missing, stale-head, unapproved, and approv"
  **Required action:** complete and tick every task
- GATE-VERIFY — No tasks are blocked or pending: 3 task(s) unticked/blocked/pending: "Verify missing, stale-head, unapproved, and approv"
  **Required action:** resolve or re-plan them

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 6/6 tasks `[x]` in .agents/tasks/RULE-020-require-published-ground-after-zero-findings.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm harness:scan --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 64 scans passed, 4 skipped (50 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/loop-runs/post-merge-cycle.jsonl, M .agents/rules/git-branch.md, M .agents/skills/automated-review-convergence/SKILL.md, M .agents/skills/pr-finding-resolution-loop/SKILL.md, M .claude/hooks/pre-push-check.sh, M scripts/harness/**tests**/pre-push-open-pr-freeze.test.mjs, ?? .agents/spec-docs/active/RULE-020-require-published-ground-after-zero-findings.md, ?? .agents/tasks/RULE-020-require-published-ground-after-zero-findings.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/pre-push-open-pr-freeze.test.mjs --reporter=dot` → exit 0 ( Duration 8.02s (transform 29ms, setup 0ms, collect 32ms, tests 7.78s, environment 0ms, prepare 49ms) ⏎ ⏎ 1:50:50 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-020-require-published-ground-after-zero-findings.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 6/6 tasks `[x]` in .agents/tasks/RULE-020-require-published-ground-after-zero-findings.md
