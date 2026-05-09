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
  │   ├── log-pages.ts                     -- output capture and cursor-based log page helpers
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

| Type                           | Location                                    | Purpose                                                                                                       |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `IBackgroundTaskManager`       | `src/background-tasks/types.ts`             | Generic background task registry API                                                                          |
| `IBackgroundTaskRunner`        | `src/background-tasks/types.ts`             | Port for executing one task kind                                                                              |
| `IBackgroundTaskState`         | `src/background-tasks/types.ts`             | Immutable task state snapshot shape                                                                           |
| `IBackgroundTaskRequest`       | `src/background-tasks/types.ts`             | Agent/process task request union                                                                              |
| `IBackgroundTaskResult`        | `src/background-tasks/types.ts`             | Completed task output and metadata                                                                            |
| `TBackgroundTaskEvent`         | `src/background-tasks/types.ts`             | Lifecycle/progress event union                                                                                |
| `TBackgroundTaskTimeoutReason` | `src/background-tasks/types.ts`             | Watchdog terminal reason union                                                                                |
| `ILimitedOutputCapture`        | `src/background-tasks/log-pages.ts`         | UTF-8-safe bounded output capture used by process-like adapters                                               |
| `ISerializableProviderProfile` | `src/background-tasks/types.ts`             | Provider profile handoff for background workers, including credential references and provider-owned `options` |
| `ISubagentManager`             | `src/subagents/types.ts`                    | Subagent job compatibility facade                                                                             |
| `ISubagentRunner`              | `src/subagents/types.ts`                    | Port for executing one subagent job                                                                           |
| `ISubagentSpawnRequest`        | `src/subagents/types.ts`                    | Subagent spawn request                                                                                        |
| `ISubagentJobState`            | `src/subagents/types.ts`                    | Subagent job state projection                                                                                 |
| `ISubagentJobResult`           | `src/subagents/types.ts`                    | Subagent completion output and metadata                                                                       |
| `ISubagentWorktreeAdapter`     | `src/subagents/worktree-subagent-runner.ts` | Port for concrete worktree I/O                                                                                |
| `IPreparedSubagentWorktree`    | `src/subagents/worktree-subagent-runner.ts` | Prepared worktree handoff data                                                                                |

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
| `createLimitedOutputCapture`     | function | UTF-8-safe bounded output capture helper             |
| `appendPrefixedLogLines`         | function | Append source-prefixed non-empty log lines           |
| `createBackgroundTaskLogPage`    | function | Cursor-based log pagination helper                   |

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

Task requests may include generic primitive `metadata`. The runtime treats this as opaque
provenance/control-plane data: it clones metadata into `IBackgroundTaskState`, preserves it in state
snapshots, and never interprets SDK-, command-, skill-, transport-, or UI-specific keys. Higher
layers may use metadata for origin projection, grouping, or workspace read models, but lifecycle
transitions, queueing, cancellation, and runner behavior must not depend on those keys.

## Transparent Workflow Relationship

The cross-cutting transparent workflow contract is defined in
[../../../.agents/specs/transparent-workflow.md](../../../.agents/specs/transparent-workflow.md).
`agent-runtime` owns the mechanical background task lifecycle state machine and transition
validation for agent/process work. It does not own command authorization provenance, user-local
preference semantics, memory inspection, or TUI disclosure policy.

Current runtime statuses are `queued`, `running`, `waiting_permission`, `completed`, `failed`, and
`cancelled`. The transparent workflow user-facing vocabulary displays `waiting_permission` as
`waiting-for-input`; a future API change may alias or rename this status only with compatibility
tests. `archived` is a visibility/retention projection over terminal records, not a state that
restarts execution. Runtime `close()` remains the mechanical terminal-record dismissal operation.

## User-Local Storage Relationship

Baseline workflow storage policy is defined in
[../../../.agents/specs/user-local-storage.md](../../../.agents/specs/user-local-storage.md).
`agent-runtime` does not resolve storage roots, validate repository boundaries, or persist baseline
workflow state. It may expose session-local task ids, metadata, events, and state snapshots; SDK
storage contracts decide whether and how higher layers persist those associations.

## Process Execution Relationship

Transparent process execution is specified in
[../../../.agents/specs/process-execution.md](../../../.agents/specs/process-execution.md).
`agent-runtime` owns generic process task lifecycle, stdout/stderr log paging contracts, timeout,
cancellation, send/read controls, exit code, signal code, and state transitions. Runtime does not
own command selection, command meaning, environment-summary presentation, action provenance, or
correctness interpretation.

## Background Work State Relationship

Switchable background work state is specified in
[../../../.agents/specs/background-work-state.md](../../../.agents/specs/background-work-state.md).
`agent-runtime` owns mechanical task lifecycle, events, cancellation, wait, send, close, and log
read operations. It does not own selected workspace entry state, filled/empty UI indicators,
presentation grouping, archive visibility, or TUI detail rendering.

Runtime may expose retention metadata only as task lifecycle or registry state protected by
state-machine tests. `archived` remains a visibility/retention projection over terminal records, not
a status that restarts or resumes execution.

## Error Taxonomy

`BackgroundTaskError` is the package error class for lifecycle and runner failures.

| Category     | Recoverable | Typical source                                                        |
| ------------ | ----------- | --------------------------------------------------------------------- |
| `validation` | yes         | Invalid depth, unknown runner kind, invalid state transition          |
| `capacity`   | yes         | Future queue/capacity enforcement                                     |
| `permission` | yes         | Future permission flow denial or timeout                              |
| `timeout`    | yes         | Idle, max runtime, output limit, repetition, or stale worker watchdog |
| `runner`     | yes         | Runner start, cancellation, unsupported send/log operations           |
| `crash`      | no          | Future process crash projection from adapters                         |
| `provider`   | yes         | Provider failure projected by a runner                                |
| `process`    | yes         | Shell/process task failure projected by a runner                      |

Adapters may map external failures into `BackgroundTaskError` categories, but they must not expose vendor-specific error objects through public runtime state.

## Event Architecture

`BackgroundTaskManager` emits `TBackgroundTaskEvent` through:

- an optional constructor `eventSink`
- zero or more `subscribe(listener)` registrations

Events contain cloned task snapshots or primitive progress data. Consumers may project these events into TUI rows, transport messages, or logs, but event listeners must not mutate manager state directly.

## Watchdog and Shutdown Contract

`BackgroundTaskManager` owns provider-neutral watchdog semantics for long-running agent tasks:

- `idleTimeoutMs` means no new runner progress event has arrived within the configured window. Text deltas, tool start/end events, and permission requests all refresh `lastActivityAt`.
- `maxRuntimeMs` is a separate wall-clock cap. The default is `0`, so background agents do not have a default wall-clock cap; consumers may opt in per request or manager configuration. Legacy agent `timeoutMs` maps to `idleTimeoutMs`; process `timeoutMs` remains the runner-owned wall-clock process timeout.
- Agent requests may set `outputLimitBytes`, `maxTextDeltas`, `repetitionWindow`, and `repetitionThreshold` to stop runaway streams.
- Watchdog failures set `IBackgroundTaskState.timeoutReason` to `idle`, `max_runtime`, `output_limit`, `repetition`, or `stale_worker`, cancel the runner handle when possible, and fail the task with `BackgroundTaskError` category `timeout`.
- Terminal task records, logs, and transcript paths remain in the registry until `close()` is called.

`IBackgroundTaskManager.shutdown(reason?)` is the runtime-owned graceful shutdown API. It is idempotent, rejects new spawns after shutdown starts, cancels all queued/running tasks through their handles, emits terminal events before resolving when possible, and never deletes terminal records.

## Worktree Runner Contract

`WorktreeSubagentRunner` depends on:

- an inner `ISubagentRunner`
- an `ISubagentWorktreeAdapter`
- optional hooks and hook executors

For non-worktree requests it delegates unchanged. For `isolation: 'worktree'` it must:

- prepare a worktree through the adapter
- pass `cwd`, `worktreePath`, and `branchName` to the inner runner
- fire `WorktreeCreate` after preparation
- remove clean worktrees exactly once on success, async failure, sync start failure, or successful cancellation
- preserve dirty worktrees and return `worktreePath`, `branchName`, `worktreeStatus`, and `worktreeNextAction` metadata
- propagate adapter-provided `baseRevision` and `parentStatus` as handoff metadata when available
- preserve existing result metadata
- fire `WorktreeRemove` when a clean worktree is removed

## Package Integration

- `agent-sdk` imports this package and composes it with config/context/session assembly.
- `agent-cli` injects concrete adapters such as child-process runners and Git worktree adapters through SDK/runtime ports.
- Transport packages consume task events and controls but do not own task transitions.

## Test Strategy

Unit tests cover:

- background state-machine transitions
- background task manager lifecycle, queueing, cancellation, progress, metadata projection, watchdogs, and shutdown
- bounded output capture and cursor-based log pagination helpers
- subagent manager lifecycle facade behavior
- worktree runner clean/dirty/failure/delegation/hook behavior with fake adapters

Adapter packages or shells must add integration tests for concrete side effects such as local Git or child processes.

## Class Contract Registry

| Class                    | Implements               | Depends on                                                                       |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| `BackgroundTaskManager`  | `IBackgroundTaskManager` | `IBackgroundTaskRunner`, `TBackgroundTaskEventListener`, pure transition helpers |
| `SubagentManager`        | `ISubagentManager`       | `IBackgroundTaskManager`, `IBackgroundTaskRunner`, `ISubagentRunner`             |
| `WorktreeSubagentRunner` | `ISubagentRunner`        | inner `ISubagentRunner`, `ISubagentWorktreeAdapter`, agent-core hook runner      |

Pure helper contracts:

- `createLimitedOutputCapture()` owns bounded output truncation semantics for adapters that need a
  provider-neutral output string.
- `appendPrefixedLogLines()` owns source-prefixed log line projection.
- `createBackgroundTaskLogPage()` owns cursor pagination for append-only task logs.

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
