# Background Task Layer Specification

Status: Proposed
Created: 2026-04-30
Source research: `.agents/tasks/completed/CLI-BL-024-background-task-layer-research.md`
Related spec: `.agents/specs/subagent-process-manager.md`

## Scope

This specification defines a shared background task layer for Robota. The layer manages long-running work started by tool calls or user commands, including background agents and background shell/process work.

The goal is to make background execution a composable library capability rather than a TUI-only feature or a subagent-only feature. Agent jobs and process jobs must share one lifecycle model, one registry, one cancellation model, and one UI/transport event projection.

## Non-Goals

- Full multi-agent team coordination with mailboxes or shared task boards.
- Remote/cloud worker execution.
- Worktree creation and branch cleanup implementation.
- Replacing foreground `Bash` behavior for existing callers.
- Turning every tool call into a background task.
- Persisting resumable running tasks across CLI process restarts.

## Architectural Principles

Robota's background task architecture MUST follow the existing package composition model:

- Lower packages own generic contracts and pure execution semantics.
- Upper packages compose concrete dependencies and UI/runtime adapters.
- Business rules live in SDK/application services, not React components.
- Side effects are behind ports and runner adapters.
- TUI state is a projection of SDK events.
- Provider instances and child process handles never cross package boundaries where they cannot be represented safely.

## Layer Stack

| Layer               | Owner                   | Background responsibility                                                                           | Must not own                                                      |
| ------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `agent-core`        | Core contracts          | Generic value types, event/history primitives already used by execution                             | Background task manager, child processes, TUI state               |
| `agent-tools`       | Tool implementations    | Foreground tool behavior and reusable tool factories                                                | SDK background registry or TUI controls                           |
| `agent-sessions`    | Session runtime         | `Session.run()`, `Session.abort()`, permissions, per-run streaming callbacks                        | Background job registry or child worker orchestration             |
| `agent-sdk`         | Application composition | `BackgroundTaskManager`, state machine, runner ports, task events, `InteractiveSession` integration | Ink components, provider package selection, direct CLI process UI |
| `agent-transport-*` | Protocol adapters       | Forward background task events and expose control messages                                          | Task state transitions or runner implementations                  |
| `agent-cli`         | Runtime shell and TUI   | Provider creation, child process runner wiring, worker entrypoints, Ink rendering from state        | SDK lifecycle logic                                               |

Dependency direction remains:

```text
agent-cli / transports
  -> agent-sdk
    -> agent-sessions
      -> agent-core

agent-sdk
  -> agent-tools
```

`agent-tools` MUST NOT import `agent-sdk`. If a tool needs background behavior, SDK assembly must wrap or replace that tool through dependency injection.

## Composition Model

The background task layer is divided into four composable levels.

```text
Pure state machine
  status + event -> next status

BackgroundTaskManager
  registry, queue, limits, wait/cancel/close/send/read APIs

Runner ports
  task kind specific execution boundary: agent, process

Adapters and shells
  in-process test runners, child process runners, shell process runners, TUI and transports
```

### Functional Core

The lifecycle transition function MUST be pure and table-driven. It owns:

- allowed status transitions
- terminal state detection
- invalid transition errors
- state snapshot projection

It MUST NOT:

- start processes
- create providers
- write logs
- emit UI events
- read settings

### Application Service

`BackgroundTaskManager` is the application service. It owns:

- task IDs
- task registry
- bounded queue
- active task count
- task timeout scheduling
- wait promises
- event emission
- targeted cancellation
- terminal-state close/dismiss behavior

It depends on runner ports and a small event sink. It does not depend on Ink, provider packages, `child_process`, or settings file readers.

### Runner Ports

Runners execute one task. They do not own global task state.

```ts
interface IBackgroundTaskStart<TRequest extends IBackgroundTaskRequest = IBackgroundTaskRequest> {
  taskId: string;
  request: TRequest;
}

interface IBackgroundTaskRunner<TRequest extends IBackgroundTaskRequest = IBackgroundTaskRequest> {
  readonly kind: TRequest['kind'];
  start(task: IBackgroundTaskStart<TRequest>): IBackgroundTaskHandle;
}

interface IBackgroundTaskHandle {
  readonly taskId: string;
  readonly pid?: number;
  result: Promise<IBackgroundTaskResult>;
  cancel(reason?: string): Promise<void>;
  send?(input: IBackgroundTaskInput): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
}
```

Runner implementations MUST report progress through manager events or the handle result. They MUST NOT mutate TUI state directly.

### Adapter Shells

Adapters implement runner ports:

- `InProcessAgentTaskRunner` for unit tests and foreground compatibility.
- `ChildProcessAgentTaskRunner` for CLI runtime agent isolation.
- `ManagedShellProcessRunner` for addressable background shell/process jobs.
- `FakeBackgroundTaskRunner` for deterministic tests.

CLI composition wires concrete runners into the SDK manager. SDK code owns the ports, not the Node-specific implementations.

## Type Model

### Task Kinds

```ts
type TBackgroundTaskKind = 'agent' | 'process';
type TBackgroundTaskMode = 'foreground' | 'background';
```

### Task Status

```ts
type TBackgroundTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

Terminal states are `completed`, `failed`, and `cancelled`. Terminal states are immutable except for `close()` removing the task from the registry.

### Task State

```ts
interface IBackgroundTaskState {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  pid?: number;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  promptPreview?: string;
  commandPreview?: string;
  currentAction?: string;
  unread: boolean;
  result?: IBackgroundTaskResult;
  error?: IBackgroundTaskError;
  logPath?: string;
  transcriptPath?: string;
  worktreePath?: string;
  branchName?: string;
}
```

### Requests

```ts
type IBackgroundTaskRequest = IAgentBackgroundTaskRequest | IProcessBackgroundTaskRequest;

interface IBaseBackgroundTaskRequest {
  kind: TBackgroundTaskKind;
  label: string;
  mode: TBackgroundTaskMode;
  parentSessionId: string;
  parentTaskId?: string;
  depth: number;
  cwd: string;
  timeoutMs?: number;
}

interface IAgentBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'agent';
  agentType: string;
  prompt: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  permissionPolicy: TBackgroundPermissionPolicy;
  providerProfile?: ISerializableProviderProfile;
}

interface IProcessBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  kind: 'process';
  command: string;
  shell?: string;
  env?: Record<string, string>;
  stdin?: string;
  outputLimitBytes?: number;
}
```

`ISerializableProviderProfile` is a data-only snapshot. It may include provider type, model, base URL, timeout, and API key reference. It MUST NOT include live SDK client instances.

```ts
type TBackgroundPermissionPolicy = 'inherit-allowlist' | 'preapproved' | 'prompt' | 'deny';

interface ISerializableProviderProfile {
  profileName?: string;
  type: string;
  model: string;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  timeout?: number;
}
```

### Results

```ts
interface IBackgroundTaskResult {
  taskId: string;
  kind: TBackgroundTaskKind;
  output: string;
  exitCode?: number;
  signalCode?: string;
  metadata?: Record<string, string | number | boolean>;
}

interface IBackgroundTaskError {
  category:
    | 'validation'
    | 'capacity'
    | 'permission'
    | 'timeout'
    | 'runner'
    | 'crash'
    | 'provider'
    | 'process';
  message: string;
  recoverable: boolean;
}
```

### Control and Logs

```ts
interface IBackgroundTaskListFilter {
  kind?: TBackgroundTaskKind;
  status?: TBackgroundTaskStatus;
  mode?: TBackgroundTaskMode;
  includeClosed?: boolean;
}

interface IBackgroundTaskInput {
  prompt?: string;
  stdin?: string;
}

interface IBackgroundTaskLogCursor {
  offset: number;
}

interface IBackgroundTaskLogPage {
  taskId: string;
  cursor?: IBackgroundTaskLogCursor;
  nextCursor?: IBackgroundTaskLogCursor;
  lines: string[];
}
```

## State Machine

Allowed transitions:

| From                 | Event                | To                   |
| -------------------- | -------------------- | -------------------- |
| `queued`             | `START`              | `running`            |
| `queued`             | `CANCEL`             | `cancelled`          |
| `running`            | `REQUEST_PERMISSION` | `waiting_permission` |
| `running`            | `COMPLETE`           | `completed`          |
| `running`            | `FAIL`               | `failed`             |
| `running`            | `CANCEL`             | `cancelled`          |
| `waiting_permission` | `PERMISSION_ALLOWED` | `running`            |
| `waiting_permission` | `PERMISSION_DENIED`  | `failed`             |
| `waiting_permission` | `CANCEL`             | `cancelled`          |

Any unlisted transition MUST return a typed transition error. The transition function MUST be covered by table-driven tests.

## Manager API

The generic manager API MUST be equivalent to:

```ts
interface IBackgroundTaskManager {
  spawn(request: IBackgroundTaskRequest): Promise<IBackgroundTaskState>;
  wait(taskId: string): Promise<IBackgroundTaskResult>;
  list(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  get(taskId: string): IBackgroundTaskState | undefined;
  cancel(taskId: string, reason?: string): Promise<void>;
  close(taskId: string): Promise<void>;
  send(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readLog(taskId: string, cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
  subscribe(listener: TBackgroundTaskEventListener): () => void;
}
```

Manager behavior:

- `spawn()` creates an addressable task record and either starts it or queues it.
- `wait()` resolves or rejects when the task reaches a terminal state.
- `list()` returns cloned immutable snapshots.
- `cancel()` targets exactly one task.
- `close()` removes only terminal tasks.
- `send()` is optional per runner and MUST reject when unsupported.
- `readLog()` is optional per runner and MUST return a structured unsupported error when unavailable.

## Events

The SDK owns background task events. They are emitted by `InteractiveSession` and forwarded by transports and TUI bridges.

```ts
type TBackgroundTaskEventListener = (event: TBackgroundTaskEvent) => void;

type TBackgroundTaskEvent =
  | { type: 'background_task_created'; task: IBackgroundTaskState }
  | { type: 'background_task_started'; task: IBackgroundTaskState }
  | { type: 'background_task_updated'; task: IBackgroundTaskState }
  | { type: 'background_task_text_delta'; taskId: string; delta: string }
  | { type: 'background_task_tool_start'; taskId: string; toolName: string; firstArg?: string }
  | {
      type: 'background_task_tool_end';
      taskId: string;
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      type: 'background_task_permission_request';
      taskId: string;
      requestId: string;
      toolName: string;
      toolArgs: Record<string, string | number | boolean>;
    }
  | { type: 'background_task_completed'; task: IBackgroundTaskState }
  | { type: 'background_task_failed'; task: IBackgroundTaskState }
  | { type: 'background_task_cancelled'; task: IBackgroundTaskState }
  | { type: 'background_task_closed'; taskId: string };
```

Interactive session event names MAY mirror the `type` values directly or expose a single `background_task_event` event with this union. The first implementation SHOULD prefer one event carrying the discriminated union to avoid listener explosion.

## Agent Task Specialization

Agent background tasks replace the current subagent-specific runtime as the generic manager matures.

Foreground agent flow:

1. `Agent` tool validates the agent type.
2. It calls `BackgroundTaskManager.spawn({ kind: 'agent', mode: 'foreground', ... })`.
3. It waits on `manager.wait(taskId)`.
4. It returns the existing JSON shape:

```json
{ "success": true, "output": "result text", "agentId": "task_1" }
```

Background agent flow:

1. `Agent` tool receives a background mode request from schema, config, or explicit command.
2. It calls `BackgroundTaskManager.spawn({ kind: 'agent', mode: 'background', ... })`.
3. It returns immediately:

```json
{ "success": true, "background": true, "agentId": "task_1", "status": "running" }
```

`SubagentManager` MAY remain as a compatibility facade while implementation migrates:

```text
SubagentManager
  -> BackgroundTaskManager(kind='agent')
```

After migration, subagent-specific types should either become aliases or be deprecated in favor of background task types.

## Process Task Specialization

Process background tasks manage shell commands or other spawned local processes.

The first implementation SHOULD NOT silently change existing foreground `Bash` behavior. Instead, SDK assembly may add one of these background-aware compositions:

1. A separate model-callable `BackgroundProcess` tool.
2. A SDK-composed `Bash` wrapper with an optional `background: boolean` field.

If option 2 is chosen, `agent-sdk` must compose the wrapper in `createDefaultTools()` or `createSession()` because `agent-tools` cannot depend on `agent-sdk`.

Foreground process behavior remains:

- command runs to completion
- result returns in the tool result
- existing callers are compatible

Background process behavior:

- command starts through `ManagedShellProcessRunner`
- tool returns task metadata immediately
- stdout/stderr are captured into task logs
- TUI can open/follow/cancel the task
- cancellation sends `SIGTERM`, then escalates to `SIGKILL` after a grace period

## Permission Model

Foreground tasks MAY use the existing interactive permission prompt.

Background tasks MUST fail closed unless one of these is true:

- the tool/action is already allowed by inherited permission rules
- the task was launched after explicit pre-approval
- a future cross-thread permission UI routes and resolves the permission request

The initial implementation SHOULD use inherited allow rules plus fail-closed behavior for new permission requests. Every denied background action must be visible in the task result or log.

## Configuration

Background task settings SHOULD live under a `backgroundTasks` namespace.

```ts
interface IBackgroundTaskConfig {
  enabled: boolean;
  maxConcurrent: number;
  maxDepth: number;
  defaultAgentMode: 'foreground' | 'background';
  defaultProcessMode: 'foreground' | 'background';
  agentIsolation: 'in-process' | 'child-process';
  processTimeoutMs: number;
  agentTimeoutMs?: number;
  logRetentionDays?: number;
}
```

Defaults:

| Field                | Default                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `enabled`            | `true`                                                                                     |
| `maxConcurrent`      | `4`                                                                                        |
| `maxDepth`           | `1`                                                                                        |
| `defaultAgentMode`   | `foreground`                                                                               |
| `defaultProcessMode` | `foreground`                                                                               |
| `agentIsolation`     | `in-process` for tests, `child-process` for CLI runtime when provider serialization exists |
| `processTimeoutMs`   | `120000`                                                                                   |
| `agentTimeoutMs`     | unset                                                                                      |

## TUI Projection

The TUI MUST treat background tasks as first-class render state, not as normal tool summaries.

`TuiStateManager` should own:

```ts
interface IBackgroundTaskViewModel {
  id: string;
  kind: TBackgroundTaskKind;
  label: string;
  status: TBackgroundTaskStatus;
  mode: TBackgroundTaskMode;
  currentAction?: string;
  elapsedMs?: number;
  unread: boolean;
  preview: string;
  resultPreview?: string;
  errorPreview?: string;
}
```

Required TUI behavior:

- show running and recently completed background tasks in a distinct panel or thread list
- show status, kind, label, and current action
- indicate unread completed results
- allow stop/cancel for running tasks
- allow dismiss/close for terminal tasks
- allow open/follow to inspect transcript or logs

TUI components MUST remain thin renderers. Keyboard/input behavior should live in flow modules that can be unit-tested without Ink.

## Transport Projection

Transport packages should forward SDK-owned task events and expose control messages.

Minimum WebSocket additions:

| Client message        | Payload               | Maps to                           |
| --------------------- | --------------------- | --------------------------------- |
| `background-list`     | optional filter       | `session.listBackgroundTasks()`   |
| `background-cancel`   | `{ taskId, reason? }` | `session.cancelBackgroundTask()`  |
| `background-close`    | `{ taskId }`          | `session.closeBackgroundTask()`   |
| `background-send`     | `{ taskId, input }`   | `session.sendBackgroundTask()`    |
| `background-read-log` | `{ taskId, cursor? }` | `session.readBackgroundTaskLog()` |

Server events should carry `TBackgroundTaskEvent`.

Headless transport should not render interactive controls. It may expose background task events in `stream-json` mode once the SDK event exists.

## Process and Agent Isolation

Agent child process execution SHOULD use `child_process.fork()` because it provides structured IPC and process isolation for Node workers.

Shell process execution SHOULD use `child_process.spawn()` because it runs arbitrary commands and exposes stdout/stderr streams.

Child workers MUST receive serializable data only:

- task request
- cwd
- provider profile snapshot
- permission policy
- agent definition or agent lookup metadata
- config/context snapshot

Child workers MUST NOT receive:

- live provider instances
- live `Session` instances
- React callbacks
- parent `AbortController` objects

## Logging and Persistence

The manager keeps runtime state in memory. Runners may write structured logs.

Recommended paths:

```text
<logsDir>/<sessionId>/background/<taskId>.jsonl
<logsDir>/<sessionId>/background/<taskId>.stdout.log
<logsDir>/<sessionId>/background/<taskId>.stderr.log
```

JSONL records SHOULD include:

- timestamp
- taskId
- event type
- status snapshot or delta payload
- output chunk metadata
- error metadata

Running task resume across process restarts is out of scope. Completed task log inspection is in scope.

## Cancellation and Shutdown

Cancellation must be targeted:

- cancelling one task must not cancel siblings
- parent foreground abort cancels only foreground child tasks attached to that run
- background tasks continue when the parent prompt completes
- CLI shutdown cancels or terminates all owned background child processes
- process cancellation sends `SIGTERM` first, then `SIGKILL` after a grace timeout

The manager must treat cancellation as a terminal state even if the runner later resolves or rejects.

## Error Taxonomy

| Category     | Examples                                                    | Recoverable |
| ------------ | ----------------------------------------------------------- | ----------- |
| `validation` | unknown kind, invalid depth, missing command                | yes         |
| `capacity`   | queue rejected, max concurrent exceeded under reject policy | yes         |
| `permission` | background action not pre-approved                          | yes         |
| `timeout`    | task runtime exceeded                                       | yes         |
| `runner`     | runner missing, unsupported send/log                        | maybe       |
| `crash`      | child process exited unexpectedly                           | maybe       |
| `provider`   | model/provider request failed                               | maybe       |
| `process`    | shell spawn failed, non-cancellable process                 | maybe       |

Errors returned to the model must be concise and structured. Detailed logs belong in task logs.

## Test Strategy

### Unit Tests

- Given a valid transition table, when each allowed event is applied, then the expected status is returned.
- Given a terminal state, when any non-close transition is requested, then a typed invalid transition error is returned.
- Given `maxConcurrent = 1`, when two tasks spawn, then the second remains queued until the first reaches terminal state.
- Given a queued task, when it is cancelled, then no runner starts and wait rejects with cancellation.
- Given a running task, when it is cancelled, then only that handle receives `cancel()`.
- Given a background task event, when `TuiStateManager` receives it, then the view model updates without React.
- Given a completed task, when it is closed, then it disappears from list output.
- Given unsupported `send()` or `readLog()`, when called, then the manager returns a structured unsupported error.

### Integration Tests

- Foreground `Agent` tool still returns `{ success, output, agentId }`.
- Background `Agent` tool returns metadata immediately and later emits completion.
- A managed background process returns metadata immediately and writes stdout/stderr logs.
- Parent prompt remains usable while a background task runs.
- Cancelling a background process terminates only that process.
- Child process crash marks only the affected task as failed.
- WebSocket transport forwards task events and maps cancel/list/open controls.

### TUI Tests

- `TuiStateManager` projects task created/running/completed/failed/cancelled rows.
- Background panel renders status, kind, label, current action, and unread marker.
- Stop/dismiss/open key flows produce pure actions before React wiring.
- Permission prompt source attribution includes task label and ID when cross-thread prompts are added.

### Manual Verification

- Start a background agent from the TUI and continue chatting in the parent prompt.
- Start a background process and open/follow its output.
- Cancel one running background task while another continues.
- Exit the CLI and confirm no owned child process remains.

## Implementation Order

1. Add `background-tasks` types, pure state machine, and unit tests in `agent-sdk`.
2. Implement `BackgroundTaskManager` with fake runner tests.
3. Add `InteractiveSession` background task APIs and a single `background_task_event` event.
4. Add `TuiStateManager` background task projection and unit tests.
5. Migrate `SubagentManager` to delegate to `BackgroundTaskManager` for `kind: 'agent'` while preserving public compatibility.
6. Add background mode to the `Agent` tool with foreground compatibility tests.
7. Add managed process runner and SDK-composed background process tool/wrapper. (Completed for CLI shell processes via `BackgroundProcess` + `ManagedShellProcessRunner`; keep regression coverage.)
8. Add TUI background task panel and pure input flow controls. (Panel and `/background` slash controls completed; dedicated key-flow modules remain future work.)
9. Add CLI child process agent runner and worker IPC protocol.
10. Extend WebSocket/headless transports with background task events and controls. (Completed for WebSocket event forwarding/control messages and headless `stream-json` event output.)
11. Update `.agents/specs/subagent-process-manager.md` to reference this spec as the common runtime layer.

## Acceptance Criteria

- Background task lifecycle is generic and not subagent-specific.
- Agent and process background work use the same registry and control API.
- Existing foreground `Agent` and `Bash` behavior remains compatible.
- Background tasks do not block unrelated parent prompts.
- Every background task has an addressable ID, visible status, and targeted cancellation.
- TUI can list, open, stop, and dismiss background tasks through state-manager projections.
- Transport packages can forward task events without knowing runner internals.
- Child process runners do not receive live provider/session instances.
- Unit tests cover lifecycle, queueing, cancellation, and TUI projection behavior.

## Source References

- Node.js child process API: <https://nodejs.org/api/child_process.html>
- Node.js worker threads API: <https://nodejs.org/api/worker_threads.html>
- Claude Code SDK subagents: <https://code.claude.com/docs/en/agent-sdk/subagents>
- Codex subagents: <https://developers.openai.com/codex/subagents>
- GitHub Copilot cloud agent: <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent>
