# Agent Runtime Specification

## Scope

Owns reusable runtime primitives for long-running Robota work:

- background task lifecycle, queueing, cancellation, events, and state snapshots
- subagent job compatibility facade over the generic background task layer
- subagent runner ports and worktree isolation runner decoration

This package is a composable material layer. It provides stateful runtime services and ports that higher packages assemble with providers, sessions, processes, transports, and UI.

## Boundaries

- Does not create providers, sessions, tools, prompts, child processes, Git worktrees, transports, or TUI state.
- Does not read config files or project context.
- Does not import `agent-sdk`, `agent-sessions`, `agent-tools`, provider packages, or `agent-cli`.
- Concrete I/O belongs in adapters owned by runtime shells or dedicated adapter packages.
- SDK assembly may re-export this package for compatibility, but this package remains the SSOT for runtime lifecycle contracts.

## Architecture Overview

```text
agent-runtime
  ├── background-tasks/
  │   ├── state-machine.ts                 -- pure lifecycle transitions
  │   ├── background-task-manager.ts       -- registry, queue, wait/cancel/close/send/read
  │   └── types.ts                         -- task requests, state, result, runner ports
  └── subagents/
      ├── types.ts                         -- subagent job contracts and runner port
      ├── subagent-manager.ts              -- compatibility facade over BackgroundTaskManager
      └── worktree-subagent-runner.ts      -- runner decorator using injected worktree adapter
```

Design rules:

- lifecycle transitions are pure and table-driven
- managers own registries and concurrency, not execution I/O
- runners execute one job and report through handles/events
- decorators add behavior by wrapping runner ports
- concrete side effects are injected behind ports

## Type Ownership

| Type                        | Location                                    | Purpose                                 |
| --------------------------- | ------------------------------------------- | --------------------------------------- |
| `IBackgroundTaskManager`    | `src/background-tasks/types.ts`             | Generic background task registry API    |
| `IBackgroundTaskRunner`     | `src/background-tasks/types.ts`             | Port for executing one task kind        |
| `IBackgroundTaskState`      | `src/background-tasks/types.ts`             | Immutable task state snapshot shape     |
| `IBackgroundTaskRequest`    | `src/background-tasks/types.ts`             | Agent/process task request union        |
| `IBackgroundTaskResult`     | `src/background-tasks/types.ts`             | Completed task output and metadata      |
| `TBackgroundTaskEvent`      | `src/background-tasks/types.ts`             | Lifecycle/progress event union          |
| `ISubagentManager`          | `src/subagents/types.ts`                    | Subagent job compatibility facade       |
| `ISubagentRunner`           | `src/subagents/types.ts`                    | Port for executing one subagent job     |
| `ISubagentSpawnRequest`     | `src/subagents/types.ts`                    | Subagent spawn request                  |
| `ISubagentJobState`         | `src/subagents/types.ts`                    | Subagent job state projection           |
| `ISubagentJobResult`        | `src/subagents/types.ts`                    | Subagent completion output and metadata |
| `ISubagentWorktreeAdapter`  | `src/subagents/worktree-subagent-runner.ts` | Port for concrete worktree I/O          |
| `IPreparedSubagentWorktree` | `src/subagents/worktree-subagent-runner.ts` | Prepared worktree handoff data          |

Hook event types and hook execution are owned by `agent-core`.

## Public API Surface

### Background Tasks

| Export                           | Kind     | Description                                          |
| -------------------------------- | -------- | ---------------------------------------------------- |
| `BackgroundTaskManager`          | class    | In-memory task registry and scheduler                |
| `BackgroundTaskError`            | class    | Typed runtime error with category and recoverability |
| `transitionBackgroundTaskStatus` | function | Pure state transition function                       |
| `isTerminalBackgroundTaskStatus` | function | Terminal-state predicate                             |
| `getBackgroundTaskTransitions`   | function | Transition table snapshot for tests/audits           |

### Subagents

| Export                         | Kind     | Description                                                     |
| ------------------------------ | -------- | --------------------------------------------------------------- |
| `SubagentManager`              | class    | Subagent facade over `BackgroundTaskManager`                    |
| `WorktreeSubagentRunner`       | class    | Decorates an `ISubagentRunner` with worktree isolation behavior |
| `createWorktreeSubagentRunner` | function | Factory for `WorktreeSubagentRunner`                            |

The package entrypoint exports these symbols explicitly from `src/index.ts`. SDK compatibility barrels may re-export the same symbols, but they must not redefine the contracts.

## Extension Points

Consumers extend the runtime by implementing ports:

| Port                           | Implemented by                                    | Contract                                                               |
| ------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| `IBackgroundTaskRunner`        | SDK, CLI, test, or transport-adapter packages     | Executes one task kind and returns a cancellable handle                |
| `ISubagentRunner`              | SDK in-process runner or CLI child-process runner | Executes one subagent job and reports structured progress              |
| `ISubagentWorktreeAdapter`     | CLI or a future Node adapter package              | Creates, inspects, and removes concrete worktrees                      |
| `TBackgroundTaskEventListener` | SDK, transports, CLI state manager                | Receives task lifecycle/progress events without mutating runtime state |

Runtime ports own required shapes. Adapter packages own concrete I/O and must not add global task registries outside `BackgroundTaskManager`.

Runner handles may expose `logPath` and `transcriptPath` for append-only diagnostic streams. `BackgroundTaskManager` projects those paths into task state immediately after runner start and preserves matching result metadata on completion.

## Error Taxonomy

`BackgroundTaskError` is the package error class for lifecycle and runner failures.

| Category     | Recoverable | Typical source                                               |
| ------------ | ----------- | ------------------------------------------------------------ |
| `validation` | yes         | Invalid depth, unknown runner kind, invalid state transition |
| `capacity`   | yes         | Future queue/capacity enforcement                            |
| `permission` | yes         | Future permission flow denial or timeout                     |
| `timeout`    | yes         | Future task timeout handling                                 |
| `runner`     | yes         | Runner start, cancellation, unsupported send/log operations  |
| `crash`      | no          | Future process crash projection from adapters                |
| `provider`   | yes         | Provider failure projected by a runner                       |
| `process`    | yes         | Shell/process task failure projected by a runner             |

Adapters may map external failures into `BackgroundTaskError` categories, but they must not expose vendor-specific error objects through public runtime state.

## Event Architecture

`BackgroundTaskManager` emits `TBackgroundTaskEvent` through:

- an optional constructor `eventSink`
- zero or more `subscribe(listener)` registrations

Events contain cloned task snapshots or primitive progress data. Consumers may project these events into TUI rows, transport messages, or logs, but event listeners must not mutate manager state directly.

## Worktree Runner Contract

`WorktreeSubagentRunner` depends on:

- an inner `ISubagentRunner`
- an `ISubagentWorktreeAdapter`
- optional hooks and hook executors

For non-worktree requests it delegates unchanged. For `isolation: 'worktree'` it must:

- prepare a worktree through the adapter
- pass `cwd`, `worktreePath`, and `branchName` to the inner runner
- fire `WorktreeCreate` after preparation
- remove clean worktrees on success, async failure, or sync start failure
- preserve dirty worktrees and return `worktreePath` plus `branchName` metadata
- preserve existing result metadata
- fire `WorktreeRemove` when a clean worktree is removed

## Package Integration

- `agent-sdk` imports this package and composes it with config/context/session assembly.
- `agent-cli` injects concrete adapters such as child-process runners and Git worktree adapters through SDK/runtime ports.
- Transport packages consume task events and controls but do not own task transitions.

## Test Strategy

Unit tests cover:

- background state-machine transitions
- background task manager lifecycle, queueing, cancellation, progress, and metadata projection
- subagent manager lifecycle facade behavior
- worktree runner clean/dirty/failure/delegation/hook behavior with fake adapters

Adapter packages or shells must add integration tests for concrete side effects such as local Git or child processes.

## Class Contract Registry

| Class                    | Implements               | Depends on                                                                       |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| `BackgroundTaskManager`  | `IBackgroundTaskManager` | `IBackgroundTaskRunner`, `TBackgroundTaskEventListener`, pure transition helpers |
| `SubagentManager`        | `ISubagentManager`       | `IBackgroundTaskManager`, `IBackgroundTaskRunner`, `ISubagentRunner`             |
| `WorktreeSubagentRunner` | `ISubagentRunner`        | inner `ISubagentRunner`, `ISubagentWorktreeAdapter`, agent-core hook runner      |

Cross-package port consumers:

- `agent-sdk` consumes `SubagentManager`, `IBackgroundTaskRunner`, `ISubagentRunner`, and `TBackgroundTaskEvent`.
- `agent-cli` consumes runtime contracts through SDK re-exports and implements concrete child-process/Git adapters.
- Transport packages consume task events and control APIs through SDK `InteractiveSession`.

## Dependencies

Production dependencies:

| Package                  | Reason                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `@robota-sdk/agent-core` | Hook types and hook runner used by `WorktreeSubagentRunner` |

This package must not depend on SDK, sessions, tool, provider, transport, or CLI packages.
