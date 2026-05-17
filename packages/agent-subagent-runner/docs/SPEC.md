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
- Does NOT own provider creation contracts — provider config is received as a serialized profile from
  the parent and reconstructed in the worker via `agent-provider`.

## Architecture Overview

```
agent-cli / composition root
  └── createChildProcessSubagentRunnerFactory()
        └── ChildProcessSubagentRunner (ISubagentRunner)
              ├── fork() → child-process-subagent-worker.ts
              │     ├── ISubagentWorkerStartMessage  (parent → child)
              │     ├── ISubagentWorkerSendMessage   (parent → child)
              │     ├── ISubagentWorkerCancelMessage (parent → child)
              │     ├── ISubagentWorkerReadyMessage  (child → parent)
              │     ├── ISubagentWorkerTextDeltaMessage (child → parent)
              │     ├── ISubagentWorkerToolStartMessage (child → parent)
              │     ├── ISubagentWorkerToolEndMessage   (child → parent)
              │     ├── ISubagentWorkerResultMessage    (child → parent)
              │     ├── ISubagentWorkerErrorMessage     (child → parent)
              │     └── ISubagentWorkerCancelledMessage (child → parent)
              ├── ChildProcessSubagentResultController  (lifecycle + result promise)
              └── child-process-subagent-transport.ts   (IPC send/receive helpers)

worker-path-resolver.ts → getDefaultSubagentWorkerPath()
  Returns path to compiled worker: {dirname}/child-process-subagent-worker.js
```

**Opt-in wiring**: The composition root (`agent-cli`) imports
`createChildProcessSubagentRunnerFactory` and `getDefaultSubagentWorkerPath` from this package
and passes the factory to `createAgentRuntime()`. The `agent-framework` runtime accepts the factory
as an optional port (`TSubagentRunnerFactory`); no default is injected.

## Type Ownership

| Type / Interface                          | Kind              | Owner           | Description                                                                                                                             |
| ----------------------------------------- | ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `IChildProcessSubagentRunnerOptions`      | interface (local) | this pkg        | Constructor options: workerPath, providerConfig, execArgv, killGraceMs, env, worktreeIsolation, logsDir                                 |
| `ISubagentWorkerStartPayload`             | interface (local) | this pkg        | IPC payload for `start` message: jobId, request, agentDefinition, parentConfig, parentContext, providerProfile, permissionMode, logsDir |
| `TSubagentWorkerParentMessage`            | type alias        | this pkg        | Union of all parent → child IPC message types                                                                                           |
| `TSubagentWorkerChildMessage`             | type alias        | this pkg        | Union of all child → parent IPC message types                                                                                           |
| `TSubagentWorkerWireValue`                | type alias        | this pkg        | Union of all IPC messages for wire-level validation                                                                                     |
| `ISubagentRunner` (consumed)              | interface         | agent-executor  | Port implemented by `ChildProcessSubagentRunner`                                                                                        |
| `ISubagentJobStart` (consumed)            | interface         | agent-executor  | Input to `runner.start()`                                                                                                               |
| `ISubagentJobHandle` (consumed)           | interface         | agent-executor  | Return value of `runner.start()`                                                                                                        |
| `ISerializableProviderProfile` (consumed) | interface         | agent-framework | Serialized provider profile sent to worker                                                                                              |

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

## Error Taxonomy

| Error scenario                    | Behavior                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Worker process exits unexpectedly | `ISubagentJobHandle.result` rejects with exit code and any captured stderr                       |
| Worker sends `error` message      | `result` rejects with the worker error message string                                            |
| Worker sends `cancelled` message  | `result` rejects with a cancellation result; handle emits a cancellation event                   |
| IPC message fails validation      | `isSubagentWorkerChildMessage` / `isSubagentWorkerParentMessage` return `false`; message dropped |
| Timeout                           | If a timeout is configured in `ISubagentJobStart`, the runner cancels the child and rejects      |
| Fork failure                      | `ChildProcessSubagentRunner.start()` throws synchronously if `child_process.fork()` fails        |

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

### Cross-Package Port Consumers

| Port (Owner)                                     | Consumer                                  | Notes                                                       |
| ------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------- |
| `ISubagentRunner` (agent-executor)               | `ChildProcessSubagentRunner`              | Interface implemented by this package                       |
| `ISubagentJobStart` (agent-executor)             | `runner.start()`                          | Input job descriptor                                        |
| `ISubagentJobHandle` (agent-executor)            | return of `runner.start()`                | Lifecycle handle returned to caller                         |
| `TSubagentRunnerFactory` (agent-framework)       | `createChildProcessSubagentRunnerFactory` | Factory type accepted by `createAgentRuntime()`             |
| `ISerializableProviderProfile` (agent-framework) | `ISubagentWorkerStartPayload`             | Provider profile serialized into IPC start payload          |
| `GitWorktreeIsolationAdapter` (agent-executor)   | default worktree adapter                  | Optional isolation; skipped when `worktreeIsolation: false` |
