# Worktree Support Hardening

## What

Harden Robota's Git worktree support so write-capable agent work can run in isolated worktrees predictably, expose useful handoff metadata, and clean up safely.

## Why

Worktree isolation exists, but it needs to behave like a reliable product feature. Users need to know when a worker ran in a worktree, where changes were left, how to review them, when cleanup happened, and how worktree mode interacts with background jobs, `/agent`, permissions, and rollback.

## Current Signals

- `packages/agent-runtime/src/subagents/worktree-subagent-runner.ts` owns runner decoration and cleanup decisions through an injected worktree adapter.
- `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts` owns concrete local Git worktree operations.
- `packages/agent-cli/docs/SPEC.md` documents worktree isolation and dirty worktree preservation.
- `.agents/specs/agent-invocation-router.md` says background write-capable agent work should default to worktree isolation when available.
- Completed `CLI-BL-013-subagent-worktree-isolation` implemented the first slice; this backlog is for hardening and productizing the behavior.

## Scope

- Audit current worktree behavior across `/agent`, model-invoked `Agent` tool calls, and background task views.
- Decide default isolation policy for write-capable agent jobs.
- Ensure clean worktrees are removed and dirty worktrees are preserved with clear metadata.
- Surface preserved `worktreePath` and `branchName` in CLI/TUI/headless results.
- Add commands or documented workflows for reviewing, merging, diffing, and deleting preserved worktrees.
- Handle branch-name collisions, nested repositories, non-Git directories, detached HEAD, and uncommitted parent changes.
- Ensure cancellation and failed worker startup clean up or preserve worktrees according to the same policy.

## Recommendation

Keep worktree isolation explicit until reporting and cleanup are hardened, then make it the default for write-capable background agent jobs when the current directory is a supported Git repository.

Recommended policy after hardening:

- read-only jobs may continue without worktree isolation;
- write-capable `/agent` and model-invoked `Agent` jobs default to worktree isolation;
- unsupported Git states fail with an actionable message unless the user explicitly requests non-isolated execution;
- dirty worktrees are preserved and reported;
- clean worktrees are removed automatically;
- dirty parent checkouts are allowed only if the worktree branch point and risk are surfaced clearly.

Rationale: default isolation is valuable, but silent fallback or poor handoff metadata would be worse than explicit local execution. Productize observability first, then change defaults.

## Non-Goals

- Do not make `agent-runtime` call Git directly.
- Do not silently merge worktree changes into the parent checkout.
- Do not delete dirty worktrees without an explicit user action or documented cleanup policy.
- Do not require worktree isolation for read-only background jobs unless the policy explicitly chooses that later.

## Acceptance Criteria

- [ ] Worktree isolation has a documented default policy for `/agent` and model-invoked agent jobs.
- [ ] Dirty worktrees are preserved and reported with path, branch, status, and next action.
- [ ] Clean worktrees are removed consistently on success, failure, and cancellation.
- [ ] Non-Git or unsupported contexts fail with actionable messages or fall back only when explicitly allowed.
- [ ] CLI/TUI/headless surfaces can list or link preserved worktrees.
- [ ] Tests cover branch collisions, parent dirty state, nested repo detection, cancellation, startup failure, clean cleanup, and dirty preservation.

## Test Plan

- Extend `GitWorktreeIsolationAdapter` tests for Git edge cases.
- Extend `WorktreeSubagentRunner` tests for cancellation and startup-failure cleanup.
- Add CLI/TUI view-model tests for preserved worktree metadata.
- Add integration smoke tests in a temporary Git repository with real `git worktree` commands.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-worktree-support-hardening.md`.
2. Start with an audit of current behavior against the documented SPEC.
3. Implement metadata/reporting improvements before changing default isolation policy.
