---
'@robota-sdk/agent-subagent-runner': minor
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-cli': patch
---

Move the concrete `GitWorktreeIsolationAdapter` (git CLI + filesystem I/O) out of the reusable
`@robota-sdk/agent-executor` runtime-primitives package into the `@robota-sdk/agent-cli` composition
root, restoring the executor's "creates no Git worktrees" boundary (ARL-02 / ARCH-FIX-024, INFRA-031).

**Breaking (`@robota-sdk/agent-subagent-runner`):** `worktreeAdapter` is now a **required** option on
`createChildProcessSubagentRunnerFactory` / `IChildProcessSubagentRunnerOptions`. The concrete git
default (`createGitWorktreeIsolationAdapter()`) has been removed — inject the adapter at the composition
root. `@robota-sdk/agent-executor` no longer exports `GitWorktreeIsolationAdapter`,
`createGitWorktreeIsolationAdapter`, or `IGitWorktreeIsolationAdapterOptions` (the
`ISubagentWorktreeAdapter` port and `WorktreeSubagentRunner` remain). CLI runtime behavior is unchanged.
