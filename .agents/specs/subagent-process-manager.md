# Subagent Process Manager Specification

Status: Proposed
Created: 2026-04-30
Source research: `.agents/tasks/completed/CLI-BL-019-subagent-process-manager-research.md`
Common runtime layer: `.agents/specs/background-task-layer.md`

## Scope

This specification defines Robota CLI subagent process management, parallel execution, lifecycle events, and TUI visibility. It is the agent-specific specialization of the shared background task runtime defined in `.agents/specs/background-task-layer.md`. It spans `agent-runtime`, `agent-sdk`, `agent-cli`, `agent-sessions`, and `agent-core` because the feature crosses reusable lifecycle state, model-callable tools, interactive session orchestration, provider/session isolation, process supervision, and terminal rendering.

The goal is to turn subagents from awaited in-process tool calls into managed agent jobs that can run in foreground or background, be observed in the TUI, be cancelled safely, and later run in isolated worktrees.

## Non-Goals

- Full multi-agent team coordination with shared task lists and agent-to-agent mailboxes.
- Remote/cloud VM execution.
- Pull request creation or GitHub issue assignment.
- Recursive subagent spawning beyond the configured depth limit.
- Worktree isolation implementation. The process manager must expose metadata hooks for worktree integration, but actual worktree creation remains owned by `CLI-BL-013`.

## Current Baseline

Robota currently supports subagents as in-process awaited executions:

- `Agent` tool resolves an agent definition and calls `createSubagentSession()`.
- `createSubagentSession()` creates a child `Session` with filtered tools and a separate conversation history.
- Child sessions reuse the parent provider instance.
- `Agent` tool waits for `session.run(prompt)` and returns JSON containing `success`, `output`, and `agentId`.
- `InteractiveSession` fork skill execution also awaits an in-process subagent session.
- TUI state has no subagent-specific state model.
- Core tool execution supports bounded parallel dispatch and enforces the configured `maxConcurrency`.

This baseline is not sufficient for managed parallel subagent work because it has no durable job registry, no cancellation handle per child, no process isolation, and no TUI thread visibility. Provider callback isolation has been added with per-run streaming callback context while child process provider construction remains future work.

## Target Behavior

Robota MUST support managed subagent jobs with these capabilities:

- Spawn subagents in foreground or background mode.
- Track every spawned subagent in a runtime registry.
- Emit lifecycle events for creation, start, streaming, tool activity, permission requests, completion, failure, cancellation, and close.
- Enforce configurable concurrency and depth limits.
- Cancel or stop a running subagent without cancelling unrelated parent or sibling work.
- Preserve foreground compatibility with the current `Agent` tool result shape.
- Display running and completed subagents in the TUI as distinct rows or threads.
- Route background permission requests with clear source attribution.
- Prevent parent/subagent streaming callbacks from polluting each other.
- Prepare metadata fields for future worktree/branch handoff.

## Architecture

### Layered Design

The implementation MUST use the common background task manager/runner split. Subagent-specific APIs may remain as compatibility facades, but new lifecycle, event, queueing, and TUI projection behavior should be expressed through the generic background task layer first.

| Layer                        | Owner                                     | Responsibility                                                                                 |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SubagentManager`            | `agent-runtime`                           | Job registry facade over `BackgroundTaskManager`, lifecycle projection, wait/cancel/close APIs |
| `SubagentRunner` port        | `agent-runtime`                           | Abstract execution boundary for a single subagent job                                          |
| `WorktreeSubagentRunner`     | `agent-runtime`                           | Runner decorator for worktree handoff, cleanup metadata, and lifecycle hooks                   |
| `InProcessSubagentRunner`    | `agent-sdk`                               | Testable runner and migration bridge using `Session` directly                                  |
| `ChildProcessSubagentRunner` | `agent-cli`                               | Production runner that supervises Node child processes and IPC                                 |
| Subagent worker entrypoint   | `agent-cli`                               | Creates provider/session in child process and streams structured events to parent              |
| Git worktree adapter         | `agent-cli`                               | Concrete local Git/filesystem implementation of `ISubagentWorktreeAdapter`                     |
| Session/provider isolation   | `agent-sessions` and provider composition | Ensures child streaming and callbacks are isolated from the parent                             |
| Tool batch concurrency       | `agent-core`                              | Enforces `maxConcurrency` when model emits parallel tool calls                                 |
| TUI state/rendering          | `agent-cli`                               | Converts subagent lifecycle events into visible terminal state                                 |

### SubagentManager

`SubagentManager` MUST be the canonical subagent facade over `agent-runtime` background task state.

It MUST provide APIs equivalent to:

```ts
interface ISubagentManager {
  spawn(request: ISubagentSpawnRequest): Promise<ISubagentJobState>;
  wait(jobId: string): Promise<ISubagentJobResult>;
  list(): ISubagentJobState[];
  get(jobId: string): ISubagentJobState | undefined;
  cancel(jobId: string, reason?: string): Promise<void>;
  close(jobId: string): Promise<void>;
  send(jobId: string, prompt: string): Promise<void>;
}
```

`send()` MAY initially reject for completed jobs or unsupported runners. The API exists so the lifecycle model can evolve toward follow-up routing without redesign.

Through `BackgroundTaskManager`, `SubagentManager` MUST enforce:

- `maxConcurrent` active jobs.
- `maxDepth` spawn nesting.
- Per-job timeout if configured.
- Terminal states are immutable except for `close()`.
- A background job must not block `InteractiveSession.submit()` for unrelated parent prompts.

### SubagentRunner

`SubagentRunner` is the execution port for one job. It MUST not own global job state.

```ts
interface ISubagentRunner {
  start(job: ISubagentJobStart): ISubagentJobHandle;
}

interface ISubagentJobHandle {
  readonly jobId: string;
  readonly pid?: number;
  result: Promise<ISubagentJobResult>;
  cancel(reason?: string): Promise<void>;
  send?(prompt: string): Promise<void>;
}
```

The runner MUST report progress only through structured events. It MUST NOT mutate TUI state directly.

### Child Process Runner

The production runner SHOULD use `child_process.fork()` for Node child workers because it provides an IPC channel for structured parent/child messages.

The parent process MUST own:

- `pid`
- `exitCode`
- `signalCode`
- timeout timer
- cancellation signal
- stdout/stderr capture
- log path
- job status transition on child crash or clean exit

The child process MUST own:

- provider creation from serializable provider profile
- subagent `Session` creation
- prompt execution
- child-local abort handling
- structured event emission to parent

The child process MUST NOT receive a live provider instance from the parent.

### IPC Protocol

IPC messages MUST be versioned and discriminated.

```ts
type TSubagentWorkerToParentMessage =
  | { version: 1; type: 'ready'; jobId: string }
  | { version: 1; type: 'started'; jobId: string }
  | { version: 1; type: 'text_delta'; jobId: string; delta: string }
  | {
      version: 1;
      type: 'tool_start';
      jobId: string;
      toolName: string;
      toolArgs?: Record<string, unknown>;
    }
  | {
      version: 1;
      type: 'tool_end';
      jobId: string;
      toolName: string;
      success: boolean;
      error?: string;
    }
  | {
      version: 1;
      type: 'permission_request';
      jobId: string;
      requestId: string;
      toolName: string;
      toolArgs: Record<string, unknown>;
    }
  | { version: 1; type: 'result'; jobId: string; output: string }
  | { version: 1; type: 'error'; jobId: string; error: string }
  | { version: 1; type: 'heartbeat'; jobId: string; at: string };
```

```ts
type TSubagentParentToWorkerMessage =
  | { version: 1; type: 'start'; jobId: string; request: ISubagentWorkerStartRequest }
  | { version: 1; type: 'cancel'; jobId: string; reason?: string }
  | { version: 1; type: 'permission_response'; jobId: string; requestId: string; allowed: boolean }
  | { version: 1; type: 'send'; jobId: string; prompt: string };
```

Unknown message versions or types MUST fail closed and mark the job failed with protocol metadata.

## Job State

`ISubagentJobState` is the single source of truth for a runtime job.

```ts
interface ISubagentJobState {
  id: string;
  type: string;
  label: string;
  parentSessionId: string;
  status: TSubagentJobStatus;
  mode: 'foreground' | 'background';
  depth: number;
  pid?: number;
  cwd: string;
  isolation?: 'none' | 'worktree';
  worktreePath?: string;
  branchName?: string;
  promptPreview: string;
  currentTool?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}

type TSubagentJobStatus =
  | 'queued'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';
```

Allowed state transitions:

| From                 | To                                                       |
| -------------------- | -------------------------------------------------------- |
| `queued`             | `running`, `cancelled`                                   |
| `running`            | `waiting_permission`, `completed`, `failed`, `cancelled` |
| `waiting_permission` | `running`, `failed`, `cancelled`                         |
| `completed`          | closed/removed only                                      |
| `failed`             | closed/removed only                                      |
| `cancelled`          | closed/removed only                                      |

The manager MUST reject invalid state transitions.

## Agent Command Contract

The model-callable route is the SDK-projected `robota_command_agent` command tool. A separate
model-visible `Agent` tool must not be registered for the same behavior.

Command execution:

- The command spawns managed jobs through `SubagentManager`.
- Foreground and grouped command paths wait for terminal summaries when their command contract requires it.
- The command returns JSON compatible with the current runtime result shapes.

```json
{
  "success": true,
  "output": "result text",
  "agentId": "agent_x"
}
```

Background mode:

- The tool spawns a managed job.
- The tool returns immediately with job metadata.

```json
{
  "success": true,
  "background": true,
  "agentId": "agent_x",
  "status": "running"
}
```

The parent model MUST be instructed to summarize completed foreground results to the user. Background results MUST surface through TUI state and later through explicit wait/open/summary flows.

## Configuration

Subagent runtime configuration SHOULD be added under an `agents` or `subagents` namespace. The final name must match existing config conventions at implementation time.

Minimum fields:

```ts
interface ISubagentRuntimeConfig {
  enabled: boolean;
  maxConcurrent: number;
  maxDepth: number;
  defaultMode: 'foreground' | 'background';
  jobTimeoutMs?: number;
  processIsolation: 'in-process' | 'child-process';
  disableBackgroundTasks?: boolean;
}
```

Defaults:

- `enabled`: `true`
- `maxConcurrent`: `4`
- `maxDepth`: `1`
- `defaultMode`: `foreground`
- `processIsolation`: `child-process` for CLI runtime, `in-process` for tests unless overridden
- `disableBackgroundTasks`: `false`

## Permission Model

Foreground subagents MAY use the same interactive permission flow as the parent.

Background subagents MUST satisfy one of these policies before executing privileged tools:

- Pre-approval: collect required approvals before launch.
- Session-inherited allowlist: only use already approved allow rules.
- Fail closed: deny fresh permission requests and report the denial.

The first implementation SHOULD use session-inherited allowlist plus fail-closed behavior for fresh background requests. Interactive cross-thread permission prompts MAY be added later, but every prompt MUST show the source subagent label and job ID.

## Provider Isolation

A subagent job MUST NOT share mutable provider callback state with its parent or siblings.

Acceptable implementations:

- create a new provider instance per subagent job; or
- refactor provider streaming callbacks to be per request/session rather than mutable properties on a shared provider object.

Current implementation uses the second approach for in-process sessions: `ISessionOptions.onTextDelta` is stored on the `Session` and passed to `Robota.run()` as `IRunOptions.onTextDelta`, which is threaded through `IExecutionContext` and preferred over provider-level callback fallback.

The child process runner MUST create providers inside the child process from serializable provider profile data.

## TUI Requirements

The TUI MUST represent subagents as managed rows or threads independent of normal tool summaries.

Minimum visible state per row:

- label or type
- status
- mode
- elapsed time
- current tool/action, if any
- completion or error marker
- unread result marker for completed background jobs

The TUI state manager MUST own a pure `subagents` view model that can be unit-tested without Ink.

Recommended commands or controls:

- list subagents
- open transcript/result
- stop running subagent
- dismiss completed subagent
- send follow-up to a running/open subagent

Ink components MUST remain thin renderers of state manager output.

## Persistence and Logs

The process manager SHOULD persist or expose:

- per-job transcript path
- stdout/stderr log path for child process runner
- final result
- failure metadata
- worktree/branch handoff metadata when available

Persistence format is not mandated in this spec, but it MUST be structured enough for future resume/open flows.

## Concurrency Requirements

`agent-core` MUST enforce `maxConcurrency` for parallel tool execution. Parallel tool dispatch MUST use a bounded worker pool or equivalent limiter rather than mapping all tool calls into unbounded `Promise.allSettled()` execution.

`SubagentManager` MUST enforce its own `maxConcurrent` independently of core tool batch concurrency.

Cancellation MUST propagate:

- from parent interrupt to active foreground subagent;
- from explicit subagent cancel to only the target job;
- from timeout to target job;
- from parent shutdown to all running child processes.

## Worktree Integration Contract

This spec defines the process-manager compatibility contract for worktree isolation. `agent-runtime` owns reusable worktree runner orchestration, and runtime shells own concrete worktree adapters such as local Git.

Worktree integration requires:

- `cwd` can differ per job.
- job state can include `isolation: 'worktree'`.
- job metadata can include `worktreePath` and `branchName`.
- completion can return handoff metadata.
- cleanup can distinguish unchanged worktrees from worktrees with edits.

## Error Handling

Errors MUST be classified at least as:

| Category     | Examples                                        | Recoverable |
| ------------ | ----------------------------------------------- | ----------- |
| `validation` | unknown agent type, invalid mode, invalid depth | yes         |
| `capacity`   | max concurrent jobs reached, queue rejected     | yes         |
| `permission` | denied tool request, missing approval           | yes         |
| `timeout`    | job exceeded runtime                            | yes         |
| `runner`     | child spawn failed, IPC protocol error          | maybe       |
| `crash`      | child process exited unexpectedly               | maybe       |
| `provider`   | provider request failed                         | maybe       |

Errors returned to the model MUST be concise and structured. Detailed process logs belong in job logs/transcripts.

## Test Plan

### Unit Tests

- `SubagentManager` state transitions.
- Bounded concurrency queue behavior.
- Foreground wait behavior.
- Background immediate-return behavior.
- Cancellation of queued and running jobs.
- Timeout handling.
- Invalid state transition rejection.
- Depth-limit rejection.
- Provider callback isolation.
- TUI state manager subagent row updates.
- IPC protocol message validation using fake transport.

### Integration Tests

- Multiple model-emitted `Agent` tool calls are bounded and tracked as separate jobs.
- Foreground subagent result remains compatible with current `Agent` JSON response.
- Background subagent returns job metadata and continues running.
- Child process crash marks only that job failed.
- Parent interrupt cancels foreground child process.

### Manual Verification

- Run Robota TUI and spawn a background subagent.
- Confirm the prompt remains usable while the subagent runs.
- Confirm subagent row status changes from running to completed or failed.
- Confirm stop/dismiss behavior.
- Confirm no child process remains after cancel or CLI exit.

## Implementation Order

1. Add types and unit tests for `SubagentManager`, `SubagentRunner`, and job state transitions. (Completed in `agent-runtime`; keep regression coverage.)
2. Implement manager with fake runner coverage in `agent-runtime` and in-process adapter coverage in `agent-sdk`.
3. Route `agent` command execution through manager APIs. (Completed in `agent-sdk`; keep regression coverage.)
4. Enforce `maxConcurrency` in core parallel tool execution. (Completed in `agent-core`; keep regression coverage.)
5. Fix provider callback isolation. (Completed in `agent-core` and `agent-sessions`; keep regression coverage.)
6. Add background mode and manager events to `InteractiveSession`.
7. Add TUI state manager and rendering for subagent rows.
8. Add child process runner and worker IPC protocol.
9. Add CLI controls for list/open/cancel/dismiss/follow-up.
10. Connect worktree metadata and CLI worktree isolation adapter. (Completed by `CLI-BL-013` on `feat/background-agent-jobs`.)

## Acceptance Criteria

- Existing `agent` command behavior remains compatible for callers.
- Multiple subagents can run in parallel within configured limits.
- Background subagents do not block the parent prompt.
- Each subagent has an addressable job ID and visible lifecycle state.
- Cancelling one subagent does not cancel siblings or parent work.
- Child process runner starts and stops without orphaning processes.
- Parent and child streaming output stay isolated.
- TUI displays subagent lifecycle state independently from normal tool summaries.
- Unit and integration tests cover the behavior listed in this spec.
