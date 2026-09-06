---
title: 'BEHAVIOR-2650: ARCH-042 scenario leaks ambient GIT_DIR breaking identity isolation in a git-hook context'
issue: https://github.com/woojubb/robota/issues/2650
status: todo
created: 2026-09-07
priority: medium
urgency: soon
area: packages/agent-framework
depends_on: []
---

# BEHAVIOR-2650: ARCH-042 scenario leaks ambient GIT_DIR breaking identity isolation in a git-hook context

## Objective

`packages/agent-framework/examples/verify-workspace-project-authority.ts`'s `GitWorkspaceIdentityResolver.resolve()`
shells out to `git -C <cwd> rev-parse --show-toplevel|--absolute-git-dir` without stripping ambient
`GIT_*` environment variables. When this scenario runs inside a `git push` pre-push hook invoked from a
linked worktree, Git exports `GIT_DIR` (pointing at the hook's own repository) into the hook's process
tree; Node's `spawnSync`/`execFileSync` inherit `process.env` by default, so the scenario's nested
`git -C <tempRepo> ...` calls silently ignore `-C` and resolve to the ambient `GIT_DIR` instead —
collapsing the scenario's two independent temp repositories onto the same identity key, so
`pnpm scenario:verify:workspace-authority` (and therefore any `git push` from a linked worktree that
touches `packages/agent-framework`) fails with "a grant for one repository was accepted for a different
root", even though the scenario passes cleanly with no ambient `GIT_DIR`.

This exact hazard is already known and defended against elsewhere in this codebase:
`packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`'s `createGitEnvironment()` strips
every `GIT_*`-prefixed env var before shelling out ("Git hooks export GIT_* variables that force child
git commands back to the hook repository"), with its own test asserting exactly this. The scenario file
never received the same treatment.

## Plan

- [x] Give `GitWorkspaceIdentityResolver.resolve()` the same `GIT_*`-stripping environment (mirroring
      `createGitEnvironment()`'s pattern) before its two `execFileSync('git', ...)` calls.
- [x] Add regression coverage: the scenario passes even with `GIT_DIR`/`GIT_WORK_TREE` set in the
      ambient environment (mirroring `git-worktree-isolation-adapter.test.ts`'s existing pattern).

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a fix to an internal scenario-test fixture's git-shelling robustness (no production
`IWorkspaceIdentityResolver` implementation shares this pattern); there is no end-user-observable
surface — the fix is proven by the scenario command itself passing under a simulated hook environment,
which is the automated Completion Criteria evidence, not a manual user-run scenario.
