---
title: 'INFRA-2644: branch-guard.sh cannot detect an in-progress merge inside a git worktree'
issue: https://github.com/woojubb/robota/issues/2644
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area:
  - .claude/hooks/branch-guard.sh
depends_on: []
---

# INFRA-2644: branch-guard.sh cannot detect an in-progress merge inside a git worktree

## Objective

Make `.claude/hooks/branch-guard.sh`'s merge-in-progress check resolve `MERGE_HEAD` through the
same worktree indirection Git itself uses, so a real merge on a protected branch name is recognized
from inside a git worktree instead of being refused as an ordinary direct commit.

## Plan

- [x] Reproduce the defect: from inside a git worktree, start a real conflicting merge on `main`,
      resolve it, and confirm `git commit` is blocked with the protected-branch refusal even though
      `MERGE_HEAD` genuinely exists.
- [x] Replace the hardcoded `$PROJECT_DIR/.git/MERGE_HEAD` path test with a resolution that respects
      the `gitdir:` pointer a worktree's `.git` file carries, using an ABSOLUTE path so the check
      does not depend on the hook script's own cwd.
- [x] Add a regression test covering: (a) the worktree+merge case now allowed, (b) an ordinary
      non-merge commit on a protected branch from a worktree still blocked, (c) the pre-existing
      non-worktree+merge case still allowed.
- [x] Run the fixed and full existing `branch-guard` test files, and the affected harness scan set.

## Test Plan

Add `scripts/harness/__tests__/branch-guard-worktree-merge.test.mjs`, invoking
`.claude/hooks/branch-guard.sh` via `spawnSync` against scratch repositories built with the standard
`makeTemp` helper — the same convention the five pre-existing `branch-guard-*.test.mjs` files use.
Three cases: a real conflicting merge resolved from a linked worktree (must be allowed), an ordinary
non-merge commit from a worktree on the same protected branch (must still be refused), and the
pre-existing non-worktree merge case (must still be allowed). Then run every existing
`branch-guard-*.test.mjs` file to confirm no regression.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository-internal PreToolUse hook that mediates the agent's own `git`
commands; it ships no CLI command, TUI action, browser flow, or public SDK surface for an end user
to run, and its own red/green fixture cases in `## Test Plan` are the observable proof.
