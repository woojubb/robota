---
title: 'INFRA-147: keep the pre-push gate present in unprepared worktrees'
status: done
completed: 2026-08-30
created: 2026-08-29
priority: high
urgency: now
area: git hooks and worktree safety
depends_on: []
no-issue: direct user request to mechanically prevent hook bypass
---

# INFRA-147: keep the pre-push gate present in unprepared worktrees

## Objective

Ensure a linked worktree cannot silently bypass the repository pre-push gate when the shared Git
configuration points `core.hooksPath` at Husky's generated `.husky/_` directory before dependencies
have been installed.

## Plan

- [x] TC-01: provide a tracked, executable fail-closed pre-push bootstrap and keep Husky v9 hooks
      compatible with it.
- [x] TC-02: verify the bootstrap both with and without Husky's generated dispatcher.

## User Execution Test Scenarios

Reason: not applicable because this is internal Git hook enforcement with no user-facing product
surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Recorded reason: not applicable because this is internal Git hook enforcement with no user-facing product surface.

## Test Plan

Run the hook with the generated dispatcher removed, run the harness hook tests, and run the
repository's relevant shell/script checks. Confirm the hook fails closed rather than treating a
missing generated path as success.

## Tasks

- [x] TC-01: add and restore the tracked pre-push bootstrap.
- [x] TC-02: test prepared and unprepared worktrees.

## Completion evidence

- Focused harness tests: 104 passed (`harness-scripts.test.mjs`, `pre-push-sequence.test.mjs`).
- Manual fail-closed check: removing `.husky/_/h` still invokes the tracked bootstrap and blocks
  the push instead of silently succeeding.
- Contract-tier file execution is serialized while retaining the two-worker ceiling, preventing
  concurrent fixture cleanup from making the gate nondeterministic.
