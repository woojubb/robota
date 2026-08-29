---
status: done
type: INFRA
tags: [git-hooks, worktrees, fail-closed]
lane: L2
---

# INFRA-146: keep the pre-push gate present in unprepared worktrees

Paired with `.agents/tasks/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md`.

## Problem

Git treats a configured but missing `core.hooksPath` entry as a successful no-op. Linked worktrees
share repository configuration, so a worktree that has not run Husky's `prepare` can push without
running `.husky/pre-push` at all.

## Decision

Track a fail-closed `.husky/_/pre-push` bootstrap and restore it after Husky generates its dispatchers.
Remove obsolete Husky v8 `husky.sh` sourcing from the tracked hooks so the Husky v9 dispatcher and
the unprepared fallback both reach the same pre-push gate.

## Scope

Only Git hook installation and dispatch are changed. No package, API, runtime, CI, or policy
behavior is changed.

## Completion Criteria

- [x] TC-01: an unprepared worktree executes a tracked pre-push path and fails closed.
- [x] TC-02: a prepared worktree still reaches the same harness gate.

## User Execution Test Scenarios

Reason: not applicable because this is internal Git hook enforcement with no user-facing product
surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Test Plan

Exercise the tracked fallback with `.husky/_/h` absent, exercise it after `pnpm run prepare`, and
run the focused harness tests.

## Tasks

- [x] `.agents/tasks/completed/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md`
- [x] TC-01 and TC-02: implement and verify the two hook states.

## Completion evidence

- Focused harness tests: 104 passed (`harness-scripts.test.mjs`, `pre-push-sequence.test.mjs`).
- Manual fail-closed check: removing `.husky/_/h` still invokes the tracked bootstrap and blocks
  the push instead of silently succeeding.

## Evidence Log

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- Task record: `.agents/tasks/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md` exists and is bound above.
- Subject-bound PLAN: `SCENARIO DRAFTED: not-applicable | 0`, because this is internal Git hook enforcement with no user-facing product surface.
- Whole-worktree precondition: only the exact paired spec and Task changed at this checkpoint.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md",
  "specPath": ".agents/spec-docs/todo/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md",
  "taskItems": [
    { "kind": "tc-id", "value": "TC-01" },
    { "kind": "tc-id", "value": "TC-02" }
  ],
  "plan": { "outcome": "not-applicable", "count": 0 },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md",
    ".agents/tasks/INFRA-146-tracked-pre-push-fallback-for-unprepared-worktrees.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `DIRECT`
**Given:** 2026-08-29, this conversation
**Evidence condition met:** the user explicitly requested mechanical Git-hook or agent-hook enforcement.
**Instruction (verbatim):** "우회하지 못하게 git hooks이나 에이전트의 훅으로 기계적으로 제한하라"
