# SPEC.md — @robota-sdk/agent-subagent-runner

## Scope

Optional package that provides child-process subagent execution for the Robota agent runtime.
Implements `ISubagentRunner` from `@robota-sdk/agent-executor` by forking Node.js child processes,
routing jobs via an IPC protocol, and returning lifecycle handles to the caller.

This package is **opt-in**: install only when child-process subagent support is needed.
Applications that do not use subagents should not carry this dependency.

## Boundaries

- Depends on `@robota-sdk/agent-core`, `@robota-sdk/agent-executor`, `@robota-sdk/agent-framework`,
  `@robota-sdk/agent-interface-transport`, and `@robota-sdk/agent-process`. **ARCH-021 removed the
  `@robota-sdk/agent-builtin-providers` edge**: a neutral runner must not compose the product's surface.
- Must NOT import from `@robota-sdk/agent-command` or `@robota-sdk/agent-cli`.
- Must NOT import from `@robota-sdk/agent-session` directly — session lifecycle is accessed through
  `agent-framework` facades.
- Owns the IPC wire protocol between parent runner and child worker.
- Does NOT own what the product composes. ARCH-021: `ISubagentWorkerComposition` is a PORT — the
  composition root supplies the tool factory and the provider registry, and this package builds the
  child's surface from that recipe rather than from imported defaults. The parameter is **required**;
  an optional one falling back to defaults would reinstate the defect.
- Owns the worker entry point (`child-process-subagent-worker.ts`, entered via `runSubagentWorkerMain()`)
  and the worker-mode argv contract (`worker-entry.ts`). DIST-006: it does NOT own where a worker
  lives on disk — that is a property of the packaging step, which the composition root states.
- Does NOT own subagent lifecycle state machines — those live in `agent-executor`.
- Does NOT own provider creation contracts — `ISerializableProviderProfile` is owned by
  `agent-interface-transport` (`background-task-contracts.ts`); provider config is received as a
  serialized profile from the parent and reconstructed in the worker via `agent-provider`.
- `ISubagentRunner`, `ISubagentJobStart`, `ISubagentJobHandle`, `ISubagentWorktreeAdapter`,
  `createWorktreeSubagentRunner`, `createProviderFromProfile`, and `BackgroundTaskError` are
  consumed from `@robota-sdk/agent-executor`.
- ARCH-031: `ISubagentSpawnRequest` and `ISubagentJobResult` are consumed from
  `@robota-sdk/agent-interface-transport`, their SSOT — they are derived from the background-task
  contracts there and are no longer exported by `agent-executor`.
- `ISerializableProviderProfile` is consumed from `@robota-sdk/agent-interface-transport` (its SSOT).
- `IAgentDefinition`, `IInProcessSubagentRunnerDeps`, `TSubagentRunnerFactory`,
  `getBuiltInAgent`, `createSubagentSession`, `createSubagentLogger` are
  consumed from `@robota-sdk/agent-framework`.

## Architecture Overview

```
agent-cli / composition root
  └── createChildProcessSubagentRunnerFactory(options)
        │   (when worktreeIsolation !== false)
        ├── createWorktreeSubagentRunner(runner, worktreeAdapter, …)
        │     └── ChildProcessSubagentRunner (ISubagentRunner)  ← inner runner
        │           ├── spawn(workerEntry.execPath, […args, --__robota-subagent-worker])
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

worker-entry.ts → SUBAGENT_WORKER_MODE_FLAG / isSubagentWorkerModeArgv / ISubagentWorkerEntry
  DIST-006: this package no longer locates a worker file. The composition root states how to
  start a copy of ITSELF (execPath + args), and enters worker mode via runSubagentWorkerMain().
```

**Opt-in wiring**: The composition root (`agent-cli`) imports
`createChildProcessSubagentRunnerFactory`, `isSubagentWorkerModeArgv` and `runSubagentWorkerMain`
from this package
and passes the factory to `createAgentRuntime()`. The `agent-framework` runtime accepts the factory
as an optional port (`TSubagentRunnerFactory`); no default is injected.

**Worktree wrapping**: `createChildProcessSubagentRunnerFactory` wraps `ChildProcessSubagentRunner`
in `createWorktreeSubagentRunner` (from `agent-executor`) by default, injecting the **required**
`worktreeAdapter` option into the wrapper. Pass `worktreeIsolation: false` to skip the wrapper and use
the runner directly. This package no longer hard-defaults a concrete git adapter (INFRA-031): the
`ISubagentWorktreeAdapter` port is required and supplied by the composition root (`agent-cli`), so the
package carries no concrete git/filesystem dependency.

## Type Ownership

| Type / Interface                          | Kind              | Owner                     | Description                                                                                                                                                  |
| ----------------------------------------- | ----------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IChildProcessSubagentRunnerOptions`      | interface (local) | this pkg                  | Constructor options: **required** workerEntry, providerConfig, killGraceMs, handshakeBudgetMs, env, worktreeIsolation, **required** worktreeAdapter, logsDir |
| `ISubagentWorkerStartPayload`             | interface (local) | this pkg                  | IPC payload for `start` message: taskId, request, worktree?, agentDefinition, parentConfig, parentContext, providerProfile, permissionMode, logsDir          |
| `IChildProcessRuntime`                    | interface (local) | this pkg                  | Internal runtime context passed between transport helpers: job, child, killGraceMs, killTimer                                                                |
| `ICancellationResult`                     | interface (local) | this pkg                  | Cancellable promise wrapper: promise + reject(reason?)                                                                                                       |
| `IChildProcessSubagentResultOptions`      | interface (local) | this pkg                  | Options passed to `createChildProcessSubagentResult`: runtime, payload, resolveTranscriptPath                                                                |
| `TSubagentWorkerParentMessage`            | type alias        | this pkg                  | Union of all parent → child IPC message types                                                                                                                |
| `TSubagentWorkerChildMessage`             | type alias        | this pkg                  | Union of all child → parent IPC message types                                                                                                                |
| `TSubagentWorkerWireValue`                | type alias        | this pkg                  | Serializable value type for IPC wire-level validation                                                                                                        |
| `ISubagentRunner` (consumed)              | interface         | agent-executor            | Port implemented by `ChildProcessSubagentRunner`                                                                                                             |
| `ISubagentJobStart` (consumed)            | interface         | agent-executor            | Input to `runner.start()`                                                                                                                                    |
| `ISubagentJobHandle` (consumed)           | interface         | agent-executor            | Return value of `runner.start()`                                                                                                                             |
| `ISubagentJobResult` (consumed)           | interface         | agent-interface-transport | Result shape resolved by `ISubagentJobHandle.result`                                                                                                         |
| `ISubagentSpawnRequest` (consumed)        | interface         | agent-interface-transport | Spawn request embedded in `ISubagentWorkerStartPayload.request`                                                                                              |
| `ISerializableProviderProfile` (consumed) | interface         | agent-interface-transport | Serialized provider profile sent to worker; SSOT in `agent-interface-transport` (NOT agent-executor, NOT agent-framework)                                    |
| `ISubagentWorktreeAdapter` (consumed)     | interface         | agent-executor            | Worktree isolation adapter injected via `worktreeAdapter` option                                                                                             |
| `IAgentDefinition` (consumed)             | interface         | agent-framework           | Agent definition resolved from registry or built-in catalog                                                                                                  |
| `IInProcessSubagentRunnerDeps` (consumed) | interface         | agent-framework           | Dependency bag injected into runner constructor by factory                                                                                                   |
| `TSubagentRunnerFactory` (consumed)       | type alias        | agent-framework           | Factory type returned by `createChildProcessSubagentRunnerFactory`                                                                                           |

## Public API Surface

| Export                                    | Kind       | Description                                                                                                                     |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `ChildProcessSubagentRunner`              | class      | Implements `ISubagentRunner`. Spawns a copy of the running artifact in worker mode (DIST-006) and returns `ISubagentJobHandle`. |
| `createChildProcessSubagentRunnerFactory` | factory    | Returns `TSubagentRunnerFactory` for injection into `createAgentRuntime()`.                                                     |
| `IChildProcessSubagentRunnerOptions`      | interface  | Construction options (workerEntry, killGraceMs, logsDir, worktreeIsolation, etc.)                                               |
| `SUBAGENT_WORKER_MODE_FLAG`               | const      | The argv flag that puts a composition root's own entry into subagent-worker mode.                                               |
| `isSubagentWorkerModeArgv`                | function   | True when this process was started as a subagent worker.                                                                        |
| `runSubagentWorkerMain`                   | function   | Enters worker mode with the product's composition (**required**); refuses loudly and exits 2 without an IPC channel.            |
| `ISubagentWorkerComposition`              | interface  | ARCH-021: the product's `createTools({ cwd })` + `providerDefinitions`, supplied by the composition root.                       |
| `ISubagentWorkerEntry`                    | interface  | How to spawn a copy of the running artifact: `execPath`, `args`, optional `execArgv`.                                           |
| `isSubagentWorkerParentMessage`           | type guard | Runtime validation for parent → child IPC messages.                                                                             |
| `isSubagentWorkerChildMessage`            | type guard | Runtime validation for child → parent IPC messages.                                                                             |
| `ISubagentWorkerStartPayload`             | interface  | IPC start message payload shape.                                                                                                |
| `TSubagentWorkerParentMessage`            | type alias | Union of all parent → child message types.                                                                                      |
| `TSubagentWorkerChildMessage`             | type alias | Union of all child → parent message types.                                                                                      |
| `TSubagentWorkerWireValue`                | type alias | Union of all IPC message types for wire-level validation.                                                                       |
| `ISubagentWorkerAgentDefinitionDto`       | interface  | The wire shape of an `IAgentDefinition` in the worker start message — declared fields only, no runtime aliasing.                |
| `ISubagentWorkerContextFileEntryDto`      | interface  | One context file (`filePath`, `content`) carried inside the parent-context DTO.                                                 |
| `ISubagentWorkerParentContextDto`         | interface  | The wire shape of the issue #2317 parent-context projection (`agentsMd`, `projectNotesMd`, …) the worker receives.              |
| `encodeAgentDefinition`                   | function   | Project an `IAgentDefinition` onto its DTO; only declared fields cross the process boundary.                                    |
| `decodeAgentDefinitionDto`                | function   | Total decode of an unknown value as `ISubagentWorkerAgentDefinitionDto` — a result, never a cast or a throw.                    |
| `restoreAgentDefinition`                  | function   | Explicit restore in the worker: builds the runtime `IAgentDefinition` from the DTO's fields (copied, not aliased).              |
| `encodeParentContext`                     | function   | Project the issue #2317 parent-context projection (or anything structurally wider) onto `ISubagentWorkerParentContextDto`.      |
| `decodeParentContextDto`                  | function   | Total decode of an unknown value as `ISubagentWorkerParentContextDto`.                                                          |
| `restoreParentContext`                    | function   | Explicit restore in the worker: builds the runtime parent-context model from the DTO's fields.                                  |

## Extension Points

- **Worker entry (required)**: `workerEntry` states how to start a copy of the running artifact.
  DIST-006 replaced `workerPath` with it: a path to a worker FILE is a property of the packaging
  step, not of this library, and the previous seam was wrong twice for that reason — once when the
  file was never emitted, and again when a downstream bundler inlined this package into another
  artifact. There is no "default": the only party that knows how a process is packaged is that
  process, so the composition root supplies it. Tests point it at a fixture entry the same way.
- **Worktree adapter (required)**: `worktreeAdapter` is a **required** option — the concrete
  `ISubagentWorktreeAdapter` (git/filesystem I/O) is injected by the composition root, not defaulted
  here (INFRA-031). Supply a git-backed adapter for real isolation, or a test double / no-git double
  for environments without git.
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

| Error scenario                         | Behavior                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker sends `error` message           | `result` rejects with `BackgroundTaskError('runner', message)` using the worker error message string                                                                                                                                                                                                      |
| Worker sends `cancelled` message       | `result` rejects with `BackgroundTaskError('runner', reason)`; parent-side cancellation promise also rejects                                                                                                                                                                                              |
| IPC child message fails validation     | `ChildProcessSubagentResultController` rejects with `BackgroundTaskError('runner', 'Received malformed subagent worker message')` — the message is NOT silently dropped                                                                                                                                   |
| IPC parent message fails validation    | Worker sends back `{ type: 'error', message: 'Malformed subagent worker parent message' }` and the parent result rejects                                                                                                                                                                                  |
| Timeout (`timeoutMs` on spawn request) | `ChildProcessSubagentResultController` fires `cancelChildProcess` then rejects with `BackgroundTaskError('timeout', 'Subagent worker timed out')` after `ISubagentSpawnRequest.timeoutMs` ms                                                                                                              |
| Spawn failure                          | `child_process.spawn()` emits `'error'` and no `'exit'`; `onError` rejects with `error.message` only — an ENOENT `execPath` never produced output to append                                                                                                                                               |
| Child exited before a result           | `onExit` rejects with the exit code/signal **and the captured stderr tail appended**, so the cause is in the message rather than only in a stream nothing read (DIST-006). The tail is agent-core's `createBoundedOutput` in `tail` mode, 4 KiB (ARCH-056 #2161) — the shared contract, not a local slice |
| Worker never signalled ready           | `BackgroundTaskError('runner', 'Subagent worker never signalled ready within …ms')` after `handshakeBudgetMs` (default 30s) — guards an entry wired to something that never enters worker mode                                                                                                            |
| IPC channel closed before send         | `sendWorkerMessage` rejects with `BackgroundTaskError('crash', 'Subagent worker IPC channel is closed')` when `child.connected` is false                                                                                                                                                                  |

## Test Strategy

### Current State

- **1 test file**: `src/__tests__/child-process-subagent-runner.test.ts` — 6 integration specs
  covering: result resolution with child pid, text/tool progress events, transcript path and log
  reading, follow-up prompt forwarding, cancellation flow, and IPC message validation guards.
- **Test fixture**: `src/__tests__/fixtures/subagent-worker-fixture.mjs` — mock worker used in tests.

### Gaps

- No unit tests for `ChildProcessSubagentResultController` in isolation.
- No unit tests for `child-process-subagent-transport.ts` helpers.
- The built-artifact contract is covered by `agent-cli`'s build-gated
  `subagent-worker-entry.bintest.ts`, not from this package: only an artifact can be asked whether
  its worker starts, and DIST-006 is what a shape-only unit test failed to catch.

## Class Contract Registry

### Class Implementations

| Class                                  | Defined In                                    | Implements        | Notes                                             |
| -------------------------------------- | --------------------------------------------- | ----------------- | ------------------------------------------------- |
| `ChildProcessSubagentRunner`           | `src/child-process-subagent-runner.ts`        | `ISubagentRunner` | Main runner; uses `spawn()` + IPC (DIST-006)      |
| `ChildProcessSubagentResultController` | `src/child-process-subagent-runner-result.ts` | (internal)        | Wraps child process lifecycle into result promise |

### Module-Level Factory Functions

| Function                           | Defined In                                    | Visibility   | Description                                                                       |
| ---------------------------------- | --------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| `createChildProcessSubagentResult` | `src/child-process-subagent-runner-result.ts` | pkg-internal | Constructs the result promise via `ChildProcessSubagentResultController`          |
| `createCancellationResult`         | `src/child-process-subagent-runner-result.ts` | pkg-internal | Returns `ICancellationResult` — a rejectable promise for parent-side cancellation |

### Cross-Package Port Consumers

| Port (Owner)                                               | Consumer                                  | Notes                                                                                 |
| ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `ISubagentRunner` (agent-executor)                         | `ChildProcessSubagentRunner`              | Interface implemented by this package                                                 |
| `ISubagentJobStart` (agent-executor)                       | `runner.start()`                          | Input job descriptor                                                                  |
| `ISubagentJobHandle` (agent-executor)                      | return of `runner.start()`                | Lifecycle handle returned to caller                                                   |
| `ISubagentJobResult` (agent-interface-transport)           | `createChildProcessSubagentResult`        | Resolved value of the result promise                                                  |
| `ISubagentSpawnRequest` (agent-interface-transport)        | `ISubagentWorkerStartPayload.request`     | Spawn request embedded in IPC start payload                                           |
| `ISerializableProviderProfile` (agent-interface-transport) | `ISubagentWorkerStartPayload`             | Provider profile serialized into IPC start payload                                    |
| `ISubagentWorktreeAdapter` (agent-executor)                | `options.worktreeAdapter`                 | Required injected adapter (no concrete-git default; supplied by the composition root) |
| `createWorktreeSubagentRunner` (agent-executor)            | `createChildProcessSubagentRunnerFactory` | Wraps runner with worktree isolation when `worktreeIsolation !== false`               |
| `createProviderFromProfile` (agent-executor)               | `child-process-subagent-worker.ts`        | Reconstructs provider in worker from serialized profile                               |
| `BackgroundTaskError` (agent-executor)                     | transport, result, worker                 | Error class used throughout for typed rejection                                       |
| `TSubagentRunnerFactory` (agent-framework)                 | `createChildProcessSubagentRunnerFactory` | Factory type accepted by `createAgentRuntime()`                                       |
| `IInProcessSubagentRunnerDeps` (agent-framework)           | `ChildProcessSubagentRunner` constructor  | Dependency bag provided by runtime at factory invocation                              |
| `IAgentDefinition` (agent-framework)                       | `ISubagentWorkerStartPayload`             | Agent definition resolved from registry and sent to worker                            |
