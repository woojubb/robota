# Agent Executor Specification

> **INFRA-025 (2026-07-04):** the background-task DATA contracts (statuses, states, events,
> errors, requests, results, log pages) and the subagent job state family moved to
> `@robota-sdk/agent-interface-transport` as their SSOT. This package keeps the runtime SPI
> (`BackgroundTaskError`, runner/manager ports, handles) and imports the contracts; its
> public index does not re-export them.

## Scope

`@robota-sdk/agent-executor` owns reusable runtime primitives for long-running Robota work:

- background task lifecycle, queueing, cancellation, events, and state snapshots
- subagent job compatibility facade over the generic background task layer
- subagent runner ports and worktree isolation runner decoration
- provider factory helpers that construct `IAIProvider` instances from serializable config or profiles

This package is a composable material layer. It provides stateful runtime services and ports that higher packages assemble with providers, sessions, processes, transports, and UI.

## Boundaries

- Does not create sessions, tools, prompts, child processes (except via `createManagedShellProcessRunner`), Git worktrees, transports, or TUI state.
- Does not read config files or project context.
- Does not import `agent-framework`, `agent-session`, `agent-tools`, provider packages, or `agent-cli`.
- Provider factory helpers (`src/providers/`) depend only on `@robota-sdk/agent-core` provider definitions; they do not import provider-specific packages.
- Concrete I/O belongs in adapters owned by runtime shells or dedicated adapter packages.
- SDK assembly may re-export this package for compatibility, but this package remains the SSOT for runtime lifecycle contracts.
- **Layer position — below agent-framework.** `agent-framework` consumes agent-executor services;
  agent-executor must never depend on agent-framework. `agent-session` does **not** depend on
  agent-executor. Dependency direction is strictly upward:
  `agent-core` ← `agent-executor` ← `agent-framework`.
- **Contract stability.** Public API shapes are stable runtime lifecycle contracts. Higher-layer
  packages (`agent-framework`) depend on these contracts. Breaking changes to the
  public API surface require coordinating all consumers before merging.

## Architecture Overview

```text
agent-executor
  ├── background-tasks/
  │   ├── state-machine.ts                      -- pure lifecycle transitions
  │   ├── background-task-manager.ts            -- registry, queue, wait/cancel/close/send/read
  │   ├── background-task-manager-helpers.ts    -- internal state helpers and deferred primitives
  │   ├── background-task-manager-state.ts      -- internal state mutation helpers
  │   ├── background-task-watchdogs.ts          -- idle/max-runtime/output watchdog controller
  │   ├── log-pages.ts                          -- output capture and cursor-based log page helpers
  │   ├── runners/
  │   │   ├── managed-shell-process-runner.ts   -- child_process.spawn-based runner
  │   │   └── scheduled-task-runner.ts          -- croner-based scheduled runner
  │   └── types.ts                              -- task requests, state, result, runner ports
  ├── providers/
  │   └── provider-factory.ts                   -- normalizeProviderConfig, createProviderFromConfig/Profile
  └── subagents/
      ├── types.ts                              -- subagent job contracts and runner port
      ├── subagent-manager.ts                   -- compatibility facade over BackgroundTaskManager
      └── worktree-subagent-runner.ts           -- runner decorator using injected worktree adapter (port only; concrete Git adapter lives in agent-cli)
```

Design rules:

- lifecycle transitions are pure and table-driven
- managers own registries and concurrency, not execution I/O
- runners execute one job and report through handles/events
- decorators add behavior by wrapping runner ports
- concrete side effects are injected behind ports

## Type Ownership

### Background Task Primitive Types

| Type                             | Location                                                  | Purpose                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TBackgroundTaskKind`            | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `'agent' \| 'process' \| 'scheduled'`                                                                                                                                                          |
| `TBackgroundTaskMode`            | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `'foreground' \| 'background'`                                                                                                                                                                 |
| `TBackgroundTaskIsolation`       | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `'none' \| 'worktree'`                                                                                                                                                                         |
| `TBackgroundTaskStatus`          | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `'queued' \| 'running' \| 'waiting_permission' \| 'sleeping' \| 'paused' \| 'completed' \| 'failed' \| 'cancelled'` (SELFHOST-012: `paused` = non-destructively paused schedule, non-terminal) |
| `TBackgroundPermissionPolicy`    | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `'inherit-allowlist' \| 'preapproved' \| 'prompt' \| 'deny'`                                                                                                                                   |
| `TBackgroundTaskTimeoutReason`   | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Watchdog terminal reason union                                                                                                                                                                 |
| `TBackgroundTaskErrorCategory`   | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Error category union used by `BackgroundTaskError`                                                                                                                                             |
| `TBackgroundPrimitive`           | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | `string \| number \| boolean` — opaque metadata value type                                                                                                                                     |
| `TBackgroundTaskEvent`           | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Lifecycle/progress event union emitted by `BackgroundTaskManager`                                                                                                                              |
| `TBackgroundTaskEventListener`   | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Listener callback type for `TBackgroundTaskEvent`                                                                                                                                              |
| `TBackgroundTaskRunnerEvent`     | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Events reported by runners to the manager during execution                                                                                                                                     |
| `TBackgroundTaskIdFactory`       | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025) | Function type for custom task ID generation                                                                                                                                                    |
| `TBackgroundTaskTransitionEvent` | `src/background-tasks/state-machine.ts`                   | State machine input events (e.g. `START`, `SLEEP`, `WAKE`, `CANCEL`)                                                                                                                           |

### Background Task Interface Types

| Type                                 | Location                                                       | Purpose                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `IBackgroundTaskError`               | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Structured error shape with category and recoverability                                                       |
| `ISerializableProviderProfile`       | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Provider profile handoff for background workers, including credential references and provider-owned `options` |
| `IBaseBackgroundTaskRequest`         | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Common fields for all task request variants                                                                   |
| `IAgentBackgroundTaskRequest`        | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Agent task request (`kind: 'agent'`)                                                                          |
| `IProcessBackgroundTaskRequest`      | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Shell process task request (`kind: 'process'`)                                                                |
| `IScheduledBackgroundTaskRequest`    | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Cron-scheduled task request (`kind: 'scheduled'`)                                                             |
| `TBackgroundTaskRequest`             | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Union of all three task request variants                                                                      |
| `IBackgroundTaskResult`              | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Completed task output and metadata                                                                            |
| `IBackgroundTaskState`               | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Immutable task state snapshot shape                                                                           |
| `IBackgroundTaskInput`               | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Input sent to a running task via `send()`                                                                     |
| `IBackgroundTaskLogCursor`           | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Cursor for paginated log reads                                                                                |
| `IBackgroundTaskLogPage`             | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Paginated log page result                                                                                     |
| `IBackgroundTaskListFilter`          | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Filter shape for `list()` queries                                                                             |
| `IBackgroundTaskStart`               | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Argument passed from manager to runner `start()` call                                                         |
| `IBackgroundTaskHandle`              | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Cancellable handle returned by `IBackgroundTaskRunner.start()`                                                |
| `IBackgroundTaskRunner`              | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Port for executing one task kind                                                                              |
| `IBackgroundTaskManager`             | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Generic background task registry API                                                                          |
| `IBackgroundTaskManagerOptions`      | `@robota-sdk/agent-interface-transport` (SSOT; INFRA-025)      | Constructor options for `BackgroundTaskManager`                                                               |
| `IManagedShellProcessRunnerOptions`  | `src/background-tasks/runners/managed-shell-process-runner.ts` | Options for the shell process runner factory                                                                  |
| `IScheduledTaskRunnerOptions`        | `src/background-tasks/runners/scheduled-task-runner.ts`        | Options for the scheduled task runner factory                                                                 |
| `ILimitedOutputCapture`              | `src/background-tasks/log-pages.ts`                            | UTF-8-safe bounded output capture used by process-like adapters                                               |
| `ICreateLimitedOutputCaptureOptions` | `src/background-tasks/log-pages.ts`                            | Options for `createLimitedOutputCapture()`                                                                    |

### Subagent Types

| Type                              | Location                                                                                   | Purpose                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `TSubagentJobStatus`              | `@robota-sdk/agent-interface-transport` (SSOT; re-exported at `src/subagents/types.ts:18`) | Subagent job status union — derived `Exclude<TBackgroundTaskStatus, 'paused'>` (TYPE-003)             |
| `TSubagentJobMode`                | `@robota-sdk/agent-interface-transport` (SSOT; re-exported at `src/subagents/types.ts:18`) | `'foreground' \| 'background'`                                                                        |
| `ISubagentSpawnRequest`           | `src/subagents/types.ts:20` (owned)                                                        | Subagent spawn request                                                                                |
| `ISubagentJobState`               | `@robota-sdk/agent-interface-transport` (SSOT; re-exported at `src/subagents/types.ts:18`) | Subagent job state projection                                                                         |
| `ISubagentJobResult`              | `src/subagents/types.ts` (owned)                                                           | Subagent completion output and metadata; `usage` is agent-core's `ITokenUsage` SSOT triple (TYPE-003) |
| `ISubagentJobStart`               | `src/subagents/types.ts:52` (owned)                                                        | Argument passed from manager to runner `start()` call                                                 |
| `ISubagentJobHandle`              | `src/subagents/types.ts:58` (owned)                                                        | Cancellable handle returned by `ISubagentRunner.start()`                                              |
| `ISubagentRunner`                 | `src/subagents/types.ts:69` (owned)                                                        | Port for executing one subagent job                                                                   |
| `ISubagentManager`                | `src/subagents/types.ts:73` (owned)                                                        | Subagent job compatibility facade                                                                     |
| `ISubagentManagerOptions`         | `src/subagents/types.ts:84` (owned)                                                        | Constructor options for `SubagentManager`                                                             |
| `ISubagentWorktreeAdapter`        | `src/subagents/worktree-subagent-runner.ts`                                                | Port for concrete worktree I/O                                                                        |
| `ISubagentWorktreePrepareRequest` | `src/subagents/worktree-subagent-runner.ts`                                                | Request passed to `ISubagentWorktreeAdapter.prepare()`                                                |
| `IPreparedSubagentWorktree`       | `src/subagents/worktree-subagent-runner.ts`                                                | Prepared worktree handoff data                                                                        |
| `IWorktreeSubagentRunnerOptions`  | `src/subagents/worktree-subagent-runner.ts`                                                | Constructor options for `WorktreeSubagentRunner`                                                      |

Hook event types and hook execution are owned by `agent-core`.

## Public API Surface

### Background Tasks

| Export                                  | Kind     | Description                                          |
| --------------------------------------- | -------- | ---------------------------------------------------- |
| `BackgroundTaskManager`                 | class    | In-memory task registry and scheduler                |
| `BackgroundTaskError`                   | class    | Typed runtime error with category and recoverability |
| `transitionBackgroundTaskStatus`        | function | Pure state transition function                       |
| `isTerminalBackgroundTaskStatus`        | function | Terminal-state predicate                             |
| `getBackgroundTaskTransitions`          | function | Transition table snapshot for tests/audits           |
| `createLimitedOutputCapture`            | function | UTF-8-safe bounded output capture helper             |
| `appendPrefixedLogLines`                | function | Append source-prefixed non-empty log lines           |
| `createBackgroundTaskLogPage`           | function | Cursor-based log pagination helper                   |
| `DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE` | constant | Default page size (200 lines) for log pagination     |

### Background Task Runners (Concrete — default implementations)

The following are concrete `IBackgroundTaskRunner` implementations provided by this package.
They depend on Node.js `child_process`. CLI and SDK shells use them as default runners;
test environments may substitute no-op runners through the `IBackgroundTaskRunner` port.

| Export                            | Kind     | Description                                                                          |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `createManagedShellProcessRunner` | function | Spawns a shell command via `node:child_process.spawn`; streams stdout/stderr as logs |
| `createScheduledTaskRunner`       | function | Schedules cron-pattern tasks via `croner`; triggers a child runner on each firing    |

**`croner` production dependency**: `croner@^10.0.1` is used by `createScheduledTaskRunner`
to parse cron expressions and fire scheduled background tasks. It has no Node.js native
bindings and is safe for any Node.js runtime target.

**SELFHOST-012 — non-destructive schedule lifecycle.** `IBackgroundTaskManager` exposes
`pauseScheduledTask`/`resumeScheduledTask`/`editScheduledTask(taskId, patch)` for `kind: 'scheduled'` tasks,
wiring croner's own `.pause()`/`.resume()` on the handle (`IBackgroundTaskHandle.pause`/`resume`/`editSchedule`)
— distinct from the irreversible `.stop()` that `cancel` uses. A `paused` schedule holds no concurrency slot
(like `sleeping`), does not fire, and keeps its identity across `pause → resume`; `edit` re-arms the croner job
in place (same task id + `schedule`). No new scheduler is introduced — this is a thin lifecycle extension over
the existing runner. (Persistence of `paused` across restart is the FLOW-003 re-arm path — a later slice.)

### Subagents

| Export                         | Kind     | Description                                                     |
| ------------------------------ | -------- | --------------------------------------------------------------- |
| `SubagentManager`              | class    | Subagent facade over `BackgroundTaskManager`                    |
| `WorktreeSubagentRunner`       | class    | Decorates an `ISubagentRunner` with worktree isolation behavior |
| `createWorktreeSubagentRunner` | function | Factory for `WorktreeSubagentRunner`                            |

**Note on the concrete worktree adapter (ARCH-FIX-024 — DONE)**: The concrete
`GitWorktreeIsolationAdapter` (calls `execFileSync`, performs Git operations) has been moved out of
this package to `agent-cli/src/subagents/git-worktree-isolation-adapter.ts` (the composition root),
completing ARCH-FIX-024 (INFRA-031). `agent-executor` now owns only the `ISubagentWorktreeAdapter`
port and the pure `WorktreeSubagentRunner` decorator — its "does not create Git worktrees" boundary is
literally true. (This package still legitimately uses `node:child_process`/`fs` for its managed-shell
and scheduled task runners; that usage is documented above and is unrelated to worktree creation.)

The package entrypoint exports these symbols explicitly from `src/index.ts`. SDK compatibility barrels may re-export the same symbols, but they must not redefine the contracts.

### Provider Factory

Functions in `src/providers/` resolve serializable provider config or profiles into live `IAIProvider` instances. They depend only on `@robota-sdk/agent-core` provider definitions and are provider-package-agnostic.

| Export                      | Kind     | Description                                                                                    |
| --------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `normalizeProviderConfig`   | function | Merges explicit settings with definition defaults; resolves `$ENV:` references in `apiKey`     |
| `resolveProfileApiKey`      | function | Resolves `apiKey` (direct or `$ENV:`) or `apiKeyEnv` from an `ISerializableProviderProfile`    |
| `createProviderFromConfig`  | function | Creates an `IAIProvider` from a resolved `IProviderConfig` using injected provider definitions |
| `createProviderFromProfile` | function | Convenience: normalizes a profile and delegates to `createProviderFromConfig`                  |

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
`agent-executor` owns the mechanical background task lifecycle state machine and transition
validation for agent/process work. It does not own command authorization provenance, user-local
preference semantics, memory inspection, or TUI disclosure policy.

Current runtime statuses are `queued`, `running`, `waiting_permission`, `sleeping`, `completed`, `failed`, and
`cancelled`. The transparent workflow user-facing vocabulary displays `waiting_permission` as
`waiting-for-input`; a future API change may alias or rename this status only with compatibility
tests. `archived` is a visibility/retention projection over terminal records, not a state that
restarts execution. Runtime `close()` remains the mechanical terminal-record dismissal operation.

## User-Local Storage Relationship

Baseline workflow storage policy is defined in
[../../../.agents/specs/user-local-storage.md](../../../.agents/specs/user-local-storage.md).
`agent-executor` does not resolve storage roots, validate repository boundaries, or persist baseline
workflow state. It may expose session-local task ids, metadata, events, and state snapshots; SDK
storage contracts decide whether and how higher layers persist those associations.

## User-Local Memory Relationship

Inspectable user-local memory behavior is specified in
[../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md).
`agent-executor` may expose task ids, group ids, lifecycle state, and metadata that SDK projections
use for user-local associations. Runtime must not read or write user-local memory, project memory,
or command-history preferences, and remembered values must not influence runtime command execution.

## Process Execution Relationship

Transparent process execution is specified in
[../../../.agents/specs/process-execution.md](../../../.agents/specs/process-execution.md).
`agent-executor` owns generic process task lifecycle, stdout/stderr log paging contracts, timeout,
cancellation, send/read controls, exit code, signal code, and state transitions. Runtime does not
own command selection, command meaning, environment-summary presentation, action provenance, or
correctness interpretation.

## Background Work State Relationship

Switchable background work state is specified in
[../../../.agents/specs/background-work-state.md](../../../.agents/specs/background-work-state.md).
`agent-executor` owns mechanical task lifecycle, events, cancellation, wait, send, close, and log
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

## Concurrency and Slot Accounting (CORE-024)

The manager admits at most `maxConcurrent` (default 4) **actively-executing** tasks; the rest queue. A slot is held only while a task is doing work, never while it merely exists:

- A task acquires a slot when it starts executing and releases it when it transitions to a non-executing state — terminal (`completed`/`failed`/`cancelled`) **or `sleeping`**.
- **Scheduled tasks must release their slot while sleeping.** A cron task spends nearly all its life in `sleeping` between fires; holding a slot there permanently wedges the budget (RUNTIME-17: four sleeping schedules starved every other spawn). It re-acquires a slot when it wakes to fire, and releases it again when the fire completes and it returns to `sleeping`.
- Slot accounting is idempotent and keyed by task id (a set of slot-holders), so a release for a task that already released is a no-op — sleep/wake cycles and a terminal transition from either state stay consistent. Releasing a slot drains the queue.

### Scheduled Fire Watchdog (CORE-024)

The scheduled runner uses croner `protect: true`, which skips a fire while the previous one is still running. A fire that hangs therefore starves **every** subsequent fire (RUNTIME-18). Each fire is bounded by a per-fire timeout: when a fired child exceeds it, the child is killed (`killProcessTree`, process-group) and the schedule returns to `sleeping` so the next fire can run. The timeout is the request's `timeoutMs` when set; the fire watchdog is independent of the manager-level agent watchdogs.

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

- `agent-framework` imports this package and composes it with config/context/session assembly.
- `agent-cli` injects concrete adapters such as child-process runners and Git worktree adapters through SDK/runtime ports.
- Transport packages consume task events and controls but do not own task transitions.

## Test Strategy

Unit tests cover:

- background state-machine transitions (including `sleeping`/`SLEEP`/`WAKE` paths)
- background task manager lifecycle, queueing, cancellation, progress, metadata projection, watchdogs, and shutdown
- bounded output capture and cursor-based log pagination helpers
- managed shell process runner and scheduled task runner (unit-level with mock child process)
- subagent manager lifecycle facade behavior
- worktree runner clean/dirty/failure/delegation/hook behavior with fake adapters
- provider factory: `normalizeProviderConfig`, `resolveProfileApiKey`, `createProviderFromConfig`, `createProviderFromProfile`

Adapter packages or shells must add integration tests for concrete side effects such as local Git or child processes.

## Class Contract Registry

| Class                    | Implements               | Depends on                                                                                      |
| ------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `BackgroundTaskManager`  | `IBackgroundTaskManager` | `IBackgroundTaskRunner`, `TBackgroundTaskEventListener`, pure transition helpers, watchdog ctrl |
| `BackgroundTaskError`    | `IBackgroundTaskError`   | none (plain Error subclass)                                                                     |
| `SubagentManager`        | `ISubagentManager`       | `IBackgroundTaskManager`, `IBackgroundTaskRunner`, `ISubagentRunner`                            |
| `WorktreeSubagentRunner` | `ISubagentRunner`        | inner `ISubagentRunner`, `ISubagentWorktreeAdapter`, agent-core hook runner                     |

Pure helper contracts:

- `createLimitedOutputCapture()` owns bounded output truncation semantics for adapters that need a
  provider-neutral output string.
- `appendPrefixedLogLines()` owns source-prefixed log line projection.
- `createBackgroundTaskLogPage()` owns cursor pagination for append-only task logs.
- `createDefaultBackgroundTaskRunners()` returns `[createManagedShellProcessRunner(), createScheduledTaskRunner()]` as the default runner set for CLI/SDK assembly.

Provider factory functions (`normalizeProviderConfig`, `resolveProfileApiKey`, `createProviderFromConfig`, `createProviderFromProfile`) are pure utilities that depend only on `@robota-sdk/agent-core` provider definition types and produce `IAIProvider` instances.

Cross-package port consumers:

- `agent-framework` consumes `SubagentManager`, `IBackgroundTaskRunner`, `ISubagentRunner`, and `TBackgroundTaskEvent`.
- `agent-cli` consumes runtime contracts through SDK re-exports and implements concrete child-process/Git adapters.
- Transport packages consume task events and control APIs through SDK `InteractiveSession`.

## Dependencies

Production dependencies:

| Package                                 | Reason                                                                                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@robota-sdk/agent-core`                | Hook types, hook runner (`WorktreeSubagentRunner`), and provider definition types (factories)                                                                      |
| `@robota-sdk/agent-interface-transport` | Contract SSOT (INFRA-025) for background-task/subagent state families (`src/background-tasks/types.ts`, `src/subagents/types.ts`)                                  |
| `@robota-sdk/agent-process`             | `killProcessTree`/`DEFAULT_KILL_GRACE_MS` for process-tree teardown in the background-task runners (`scheduled-task-runner.ts`, `managed-shell-process-runner.ts`) |
| `croner`                                | Cron expression parsing and scheduling for `createScheduledTaskRunner`                                                                                             |

This package must not depend on SDK, sessions, tool, concrete-provider, concrete-transport, or CLI packages (the `agent-interface-transport` contract SSOT above is not a concrete transport).
