# Background Task Layer Research

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: feat/background-task-layer
- **Scope**: .agents/specs, packages/agent-sdk, packages/agent-cli, packages/agent-core, packages/agent-sessions

## Objective

Research a shared background task layer that can manage tool-called processes and agents as background threads, then support TUI access and control.

## Plan

- [x] Audit current subagent manager, tool execution, process execution, and TUI state paths.
- [x] Identify reusable primitives for a generic background task registry and runner model.
- [x] Compare product/reference patterns for background agent/process control.
- [x] Define the recommended spec direction and implementation slices.
- [x] Report findings before writing the final spec document.

## Test Plan

- Research-only task. No production code changes are expected in this slice.
- If a spec document is created in a follow-up slice, run `pnpm harness:scan:specs` and `pnpm harness:scan`.

## Progress

### 2026-04-30

- Created branch from latest `develop`.
- Started codebase and product research for a generic background task layer.
- Audited current `SubagentManager`, `Agent` tool routing, fork skill execution, TUI state bridge, transport specs, and `Bash` process execution.
- Reviewed official references for Node child processes/worker threads, Claude Code subagents, Codex subagents, and GitHub Copilot cloud agent.

## Research Notes

### Current Robota State

- `agent-sdk/src/subagents/` now contains a provider-neutral `SubagentManager` with job registry, queueing, bounded concurrency, `wait/list/get/cancel/close/send`, and an injected runner port.
- `Agent` tool execution is foreground-only today. It calls `SubagentManager.spawn()` and then immediately `wait()`, preserving the current JSON result shape.
- `InteractiveSession.runSkillInFork()` still bypasses `SubagentManager` and directly creates an awaited subagent session.
- `InteractiveSession` emits parent-level events only: `text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `error`, `context_update`, and `interrupted`.
- `TuiStateManager` is already the right thin boundary for TUI behavior. It is pure TypeScript, unit-tested, and owns render state derived from `InteractiveSession` events.
- `agent-cli` renders only one foreground execution stream. There is no background task list, focused task view, result unread marker, or task control surface.
- `agent-transport-ws` and `agent-transport-headless` forward `InteractiveSession` events. If background task events are added at the SDK layer, transport packages can expose the same model without TUI-specific logic.
- `Bash` currently runs `child_process.spawn()` directly inside `agent-tools`. On timeout it resolves immediately and leaves child cleanup to the process lifecycle. There is no addressable process ID, background log, explicit cancel, output follow, or TUI visibility.
- `agent-tools` must not depend on `agent-sdk`, so background-aware process execution should be added by SDK assembly/wrapping or by a separate tool that can receive a background manager dependency.

### External Reference Findings

- Node `child_process.fork()` is a special `spawn()` case for Node child processes and includes an IPC channel. Spawned child processes have independent memory and V8 instances, so this is the right isolation primitive for agent workers.
- Node `subprocess.send()` supports parent/child IPC for `fork()` workers and returns backpressure information when the send queue is overloaded.
- Node `worker_threads` supports message events and resource limits, but it shares the parent process and is better for CPU work than process/tool isolation.
- Claude Code subagent definitions support fields such as `background`, `permissionMode`, `maxTurns`, `tools`, and `model`; subagents cannot spawn their own subagents.
- Codex exposes global subagent controls under `[agents]`, including `max_threads`, `max_depth`, and per-worker runtime timeout.
- GitHub Copilot cloud agent is explicitly asynchronous/background and frames the handoff around a branch, logs, review, and optional pull request. Robota should preserve branch/worktree metadata even if local worktree support is deferred.

### Design Implications

- A subagent-only manager is now too narrow. The next layer should be a generic `BackgroundTaskManager` with task `kind` specializations for `agent` and `process`.
- Existing `SubagentManager` logic can be migrated or wrapped into this generic manager because it already has most registry/queue/cancel/wait primitives.
- Background task events should be SDK-owned and UI-neutral, then bridged into `TuiStateManager`.
- Process execution should use a managed runner, not direct fire-and-forget shell execution, when the model requests background execution.
- Agent child process execution should use a process runner that reconstructs provider/session inside the child from serializable settings. The live provider instance should not cross the process boundary.
- Background permission handling should fail closed initially unless the action is already allowed by inherited policy. Interactive cross-thread prompts can be added later.

## Decisions

- Treat background agent execution as a specialization of a more general background task runtime, not as a subagent-only manager.
- Place the common background task manager in `agent-sdk`, because `InteractiveSession` and transports are SDK-owned and UI-neutral.
- Keep process/agent runner adapters behind ports. CLI can own child-process agent runner composition because CLI owns provider profile creation.
- Keep TUI state as a projection of SDK events; do not put task orchestration in React components.

## Blockers

- None.

## Result

- Initial research is complete. Recommended direction is a generic SDK-owned `BackgroundTaskManager` with `agent` and `process` task kinds, runner ports, SDK-level lifecycle events, TUI state projections, and CLI-owned child-process agent runner composition.
