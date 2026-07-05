# SPEC.md — @robota-sdk/agent-subagent-runner

## Scope

Optional package that provides child-process subagent execution for the Robota agent runtime.
Implements `ISubagentRunner` from `@robota-sdk/agent-executor` by forking Node.js child processes,
routing jobs via an IPC protocol, and returning lifecycle handles to the caller.

This package is **opt-in**: install only when child-process subagent support is needed.
Applications that do not use subagents should not carry this dependency.

## Boundaries

- Depends on `@robota-sdk/agent-core`, `@robota-sdk/agent-executor`, `@robota-sdk/agent-framework`,
  and `@robota-sdk/agent-provider`.
- Must NOT import from `@robota-sdk/agent-command` or `@robota-sdk/agent-cli`.
- Must NOT import from `@robota-sdk/agent-session` directly — session lifecycle is accessed through
  `agent-framework` facades.
- Owns the IPC wire protocol between parent runner and child worker.
- Owns the worker entry point (`child-process-subagent-worker.ts`) and the worker path resolver.
- Does NOT own subagent lifecycle state machines — those live in `agent-executor`.
- Does NOT own provider creation contracts — `ISerializableProviderProfile` is owned by
  `agent-executor`; provider config is received as a serialized profile from the parent and
  reconstructed in the worker via `agent-provider`.
- `ISubagentRunner`, `ISubagentJobStart`, `ISubagentJobHandle`, `ISubagentJobResult`,
  `ISerializableProviderProfile`, `ISubagentSpawnRequest`, `ISubagentWorktreeAdapter`,
  `createWorktreeSubagentRunner`, `createProviderFromProfile`, and `BackgroundTaskError` are all
  consumed from `@robota-sdk/agent-executor`.
- `IAgentDefinition`, `IInProcessSubagentRunnerDeps`, `TSubagentRunnerFactory`,
  `getBuiltInAgent`, `createSubagentSession`, `createSubagentLogger`, `createDefaultTools` are
  consumed from `@robota-sdk/agent-framework`.

## Architecture Overview

```
agent-cli / composition root
  └── createChildProcessSubagentRunnerFactory(options)
        │   (when worktreeIsolation !== false)
        ├── createWorktreeSubagentRunner(runner, worktreeAdapter, …)
        │     └── ChildProcessSubagentRunner (ISubagentRunner)  ← inner runner
        │           ├── fork() → child-process-subagent-worker.ts
        │           │     ├── ISubagentWorkerStartMessage  (parent → child)
        │           │     ├── ISubagentWorkerSendMessage   (parent → child)
        │           │     ├── ISubagentWorkerCancelMessage (parent → child)
        │           │     ├── ISubagentWorkerReadyMessage  (child → parent)
        │           │     ├── ISubagentWorkerTextDeltaMessage (child → parent)
        │           │     ├── ISubagentWorkerToolStartMessage (child → parent)
        │           │     ├── ISubagentWorkerToolEndMessage   (child → parent)
        │           │     ├── ISubagentWorkerResultMessage    (child → parent)
        │           │     ├── ISubagentWorkerErrorMessage     (child → parent)
        │           │     └── ISubagentWorkerCancelledMessage (child → parent)
        │           ├── createChildProcessSubagentResult()
        │           │     └── ChildProcessSubagentResultController (lifecycle + result promise)
        │           └── child-process-subagent-transport.ts (IChildProcessRuntime, IPC helpers)
        │                  sendWorkerMessage / handleWorkerMessage / cancelChildProcess
        │   (when worktreeIsolation === false)
        └── ChildProcessSubagentRunner (ISubagentRunner)  ← returned directly

worker-path-resolver.ts → getDefaultSubagentWorkerPath()
  Returns path to compiled worker: {dirname}/child-process-subagent-worker.js
```

**Opt-in wiring**: The composition root (`agent-cli`) imports
`createChildProcessSubagentRunnerFactory` and `getDefaultSubagentWorkerPath` from this package
and passes the factory to `createAgentRuntime()`. The `agent-framework` runtime accepts the factory
as an optional port (`TSubagentRunnerFactory`); no default is injected.

**Worktree wrapping**: `createChildProcessSubagentRunnerFactory` wraps `ChildProcessSubagentRunner`
in `createWorktreeSubagentRunner` (from `agent-executor`) by default. Pass
`worktreeIsolation: false` to skip the wrapper and use the runner directly.

## Type Ownership

| Type / Interface                          | Kind              | Owner           | Description                                                                                                                             |
| ----------------------------------------- | ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `IChildProcessSubagentRunnerOptions`      | interface (local) | this pkg        | Constructor options: workerPath, providerConfig, execArgv, killGraceMs, env, worktreeIsolation, worktreeAdapter, logsDir                |
| `ISubagentWorkerStartPayload`             | interface (local) | this pkg        | IPC payload for `start` message: jobId, request, agentDefinition, parentConfig, parentContext, providerProfile, permissionMode, logsDir |
| `IChildProcessRuntime`                    | interface (local) | this pkg        | Internal runtime context passed between transport helpers: job, child, killGraceMs, killTimer                                           |
| `ICancellationResult`                     | interface (local) | this pkg        | Cancellable promise wrapper: promise + reject(reason?)                                                                                  |
| `IChildProcessSubagentResultOptions`      | interface (local) | this pkg        | Options passed to `createChildProcessSubagentResult`: runtime, payload, resolveTranscriptPath                                           |
| `TSubagentWorkerParentMessage`            | type alias        | this pkg        | Union of all parent → child IPC message types                                                                                           |
| `TSubagentWorkerChildMessage`             | type alias        | this pkg        | Union of all child → parent IPC message types                                                                                           |
| `TSubagentWorkerWireValue`                | type alias        | this pkg        | Serializable value type for IPC wire-level validation                                                                                   |
| `ISubagentRunner` (consumed)              | interface         | agent-executor  | Port implemented by `ChildProcessSubagentRunner`                                                                                        |
| `ISubagentJobStart` (consumed)            | interface         | agent-executor  | Input to `runner.start()`                                                                                                               |
| `ISubagentJobHandle` (consumed)           | interface         | agent-executor  | Return value of `runner.start()`                                                                                                        |
| `ISubagentJobResult` (consumed)           | interface         | agent-executor  | Result shape resolved by `ISubagentJobHandle.result`                                                                                    |
| `ISubagentSpawnRequest` (consumed)        | interface         | agent-executor  | Spawn request embedded in `ISubagentWorkerStartPayload.request`                                                                         |
| `ISerializableProviderProfile` (consumed) | interface         | agent-executor  | Serialized provider profile sent to worker (NOT agent-framework)                                                                        |
| `ISubagentWorktreeAdapter` (consumed)     | interface         | agent-executor  | Worktree isolation adapter injected via `worktreeAdapter` option                                                                        |
| `IAgentDefinition` (consumed)             | interface         | agent-framework | Agent definition resolved from registry or built-in catalog                                                                             |
| `IInProcessSubagentRunnerDeps` (consumed) | interface         | agent-framework | Dependency bag injected into runner constructor by factory                                                                              |
| `TSubagentRunnerFactory` (consumed)       | type alias        | agent-framework | Factory type returned by `createChildProcessSubagentRunnerFactory`                                                                      |

## Public API Surface

| Export                                    | Kind       | Description                                                                           |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `ChildProcessSubagentRunner`              | class      | Implements `ISubagentRunner`. Forks child processes and returns `ISubagentJobHandle`. |
| `createChildProcessSubagentRunnerFactory` | factory    | Returns `TSubagentRunnerFactory` for injection into `createAgentRuntime()`.           |
| `IChildProcessSubagentRunnerOptions`      | interface  | Construction options (workerPath, killGraceMs, logsDir, worktreeIsolation, etc.)      |
| `getDefaultSubagentWorkerPath`            | function   | Returns the compiled worker entry path for the installed package version.             |
| `isSubagentWorkerParentMessage`           | type guard | Runtime validation for parent → child IPC messages.                                   |
| `isSubagentWorkerChildMessage`            | type guard | Runtime validation for child → parent IPC messages.                                   |
| `ISubagentWorkerStartPayload`             | interface  | IPC start message payload shape.                                                      |
| `TSubagentWorkerParentMessage`            | type alias | Union of all parent → child message types.                                            |
| `TSubagentWorkerChildMessage`             | type alias | Union of all child → parent message types.                                            |
| `TSubagentWorkerWireValue`                | type alias | Union of all IPC message types for wire-level validation.                             |

## Extension Points

- **Custom worker path**: Pass `workerPath` in `IChildProcessSubagentRunnerOptions` to use a
  non-default worker script (e.g., for testing or extended worker behavior).
- **Custom worktree adapter**: Pass `worktreeAdapter` to override the default git worktree
  isolation adapter. Useful for environments without git or for test doubles.
- **Custom provider config**: Pass `providerConfig` to override the parent provider configuration
  serialized into the start payload.
- **Log directory**: Pass `logsDir` to enable transcript logging per job; reads are exposed through
  `ISubagentJobHandle.readLog()`.
- **Kill grace period**: `killGraceMs` (default 2000ms) controls how long the runner waits for a
  graceful shutdown before sending SIGTERM.

## Worker Lifecycle & IPC Integrity (CORE-024)

- **Result flush before exit.** The worker must not `process.exit()` until the IPC channel has
  drained the `result` / `error` / `cancelled` message it just sent. `process.send` is
  asynchronous; exiting before the write flushes makes the parent's `onExit` fire before the
  result arrives, so a **successful** run is misreported as a `crash` and its `usage` payload is
  lost (RUNTIME-20). The worker sends the terminal message with a completion callback (or awaits
  the drain) and exits only from that callback.
- **`usage` is schema-validated at the IPC boundary.** The child→parent `result` message guard
  validates the `usage` field (numeric token/cost shape) when present, not just `output`
  (RUNTIME-47). A malformed `usage` object is rejected as a malformed message rather than spread
  verbatim into the parent's token/cost accounting.

## Error Taxonomy

| Error scenario                         | Behavior                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker process exits unexpectedly      | `ISubagentJobHandle.result` rejects with `BackgroundTaskError('crash', …)` describing the exit code or signal (`stdio` is fully ignored — no stderr is captured)                             |
| Worker sends `error` message           | `result` rejects with `BackgroundTaskError('runner', message)` using the worker error message string                                                                                         |
| Worker sends `cancelled` message       | `result` rejects with `BackgroundTaskError('runner', reason)`; parent-side cancellation promise also rejects                                                                                 |
| IPC child message fails validation     | `ChildProcessSubagentResultController` rejects with `BackgroundTaskError('runner', 'Received malformed subagent worker message')` — the message is NOT silently dropped                      |
| IPC parent message fails validation    | Worker sends back `{ type: 'error', message: 'Malformed subagent worker parent message' }` and the parent result rejects                                                                     |
| Timeout (`timeoutMs` on spawn request) | `ChildProcessSubagentResultController` fires `cancelChildProcess` then rejects with `BackgroundTaskError('timeout', 'Subagent worker timed out')` after `ISubagentSpawnRequest.timeoutMs` ms |
| Fork failure                           | `child_process.fork()` throws synchronously; `ChildProcessSubagentRunner.start()` propagates the error to the caller                                                                         |
| IPC channel closed before send         | `sendWorkerMessage` rejects with `BackgroundTaskError('crash', 'Subagent worker IPC channel is closed')` when `child.connected` is false                                                     |

## Test Strategy

### Current State

- **1 test file**: `src/__tests__/child-process-subagent-runner.test.ts` — 6 integration specs
  covering: result resolution with child pid, text/tool progress events, transcript path and log
  reading, follow-up prompt forwarding, cancellation flow, and IPC message validation guards.
- **Test fixture**: `src/__tests__/fixtures/subagent-worker-fixture.mjs` — mock worker used in tests.

### Gaps

- No unit tests for `ChildProcessSubagentResultController` in isolation.
- No unit tests for `child-process-subagent-transport.ts` helpers.
- No unit tests for `worker-path-resolver.ts`.

## Class Contract Registry

### Class Implementations

| Class                                  | Defined In                                    | Implements        | Notes                                             |
| -------------------------------------- | --------------------------------------------- | ----------------- | ------------------------------------------------- |
| `ChildProcessSubagentRunner`           | `src/child-process-subagent-runner.ts`        | `ISubagentRunner` | Main runner; uses `fork()` and IPC                |
| `ChildProcessSubagentResultController` | `src/child-process-subagent-runner-result.ts` | (internal)        | Wraps child process lifecycle into result promise |

### Module-Level Factory Functions

| Function                           | Defined In                                    | Visibility   | Description                                                                       |
| ---------------------------------- | --------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `createChildProcessSubagentResult` | `src/child-process-subagent-runner-result.ts` | pkg-internal | Constructs the result promise via `ChildProcessSubagentResultController`          |
| `createCancellationResult`         | `src/child-process-subagent-runner-result.ts` | pkg-internal | Returns `ICancellationResult` — a rejectable promise for parent-side cancellation |

### Cross-Package Port Consumers

| Port (Owner)                                     | Consumer                                  | Notes                                                                      |
| ------------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------- |
| `ISubagentRunner` (agent-executor)               | `ChildProcessSubagentRunner`              | Interface implemented by this package                                      |
| `ISubagentJobStart` (agent-executor)             | `runner.start()`                          | Input job descriptor                                                       |
| `ISubagentJobHandle` (agent-executor)            | return of `runner.start()`                | Lifecycle handle returned to caller                                        |
| `ISubagentJobResult` (agent-executor)            | `createChildProcessSubagentResult`        | Resolved value of the result promise                                       |
| `ISubagentSpawnRequest` (agent-executor)         | `ISubagentWorkerStartPayload.request`     | Spawn request embedded in IPC start payload                                |
| `ISerializableProviderProfile` (agent-executor)  | `ISubagentWorkerStartPayload`             | Provider profile serialized into IPC start payload                         |
| `ISubagentWorktreeAdapter` (agent-executor)      | `options.worktreeAdapter`                 | Injected adapter; defaults to `createGitWorktreeIsolationAdapter()` output |
| `createWorktreeSubagentRunner` (agent-executor)  | `createChildProcessSubagentRunnerFactory` | Wraps runner with worktree isolation when `worktreeIsolation !== false`    |
| `createProviderFromProfile` (agent-executor)     | `child-process-subagent-worker.ts`        | Reconstructs provider in worker from serialized profile                    |
| `BackgroundTaskError` (agent-executor)           | transport, result, worker                 | Error class used throughout for typed rejection                            |
| `TSubagentRunnerFactory` (agent-framework)       | `createChildProcessSubagentRunnerFactory` | Factory type accepted by `createAgentRuntime()`                            |
| `IInProcessSubagentRunnerDeps` (agent-framework) | `ChildProcessSubagentRunner` constructor  | Dependency bag provided by runtime at factory invocation                   |
| `IAgentDefinition` (agent-framework)             | `ISubagentWorkerStartPayload`             | Agent definition resolved from registry and sent to worker                 |
