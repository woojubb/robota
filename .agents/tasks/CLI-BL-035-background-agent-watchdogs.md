# CLI-BL-035 Background Agent Watchdogs

- **Status**: completed
- **Created**: 2026-05-01
- **Branch**: feat/gemma-provider-transport
- **Scope**: packages/agent-core, packages/agent-sessions, packages/agent-runtime, packages/agent-sdk, packages/agent-cli, packages/agent-provider-openai-compatible, packages/agent-provider-gemma, packages/agent-provider-openai

## Objective

Add production-grade watchdogs for background agent jobs so a provider stream that stops producing useful progress cannot leave an agent in `running` forever. User-facing "timeout" for agent work should mean "no new streamed message/progress arrived within the configured window"; elapsed hard runtime should be a separate guard. SDK-owned shutdown must also terminate managed background agents/processes when the host CLI exits, including Ctrl+C.

## Incident Summary

The captured session `session_1777612207350_zw14yfnzr` started two background agents. `agent_1` completed, while `agent_2` remained `running`.

Observed facts:

- `agent_2` started at `2026-05-01T05:10:20Z`.
- The last transcript delta was written at `2026-05-01T05:15:02Z`.
- More than 10 minutes later, the worker PID was still alive and still held an established TCP connection to `127.0.0.1:1234`.
- The transcript repeated the same sentence many times and emitted Gemma channel markers.
- No terminal `background_task_completed`, `background_task_failed`, or `background_task_cancelled` event was recorded for `agent_2`.

Interpretation:

- This was not an actively useful long-running analysis.
- It was either a degenerate generation loop followed by a non-terminating stream, or a provider stream that stopped producing deltas without closing the HTTP request.
- Robota lacked a progress-based idle timeout and a reconciliation path for stale running jobs.

## Specification

### Terminology

| Term            | Meaning                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `activity`      | Any meaningful task progress: visible text delta, tool start/end, permission event, worker lifecycle event, or result/error message.       |
| `idleTimeoutMs` | Maximum time a running agent may go without activity. This is the user-facing agent "timeout" semantics.                                   |
| `maxRuntimeMs`  | Maximum wall-clock runtime for a job regardless of activity. This is a hard safety cap.                                                    |
| `outputBudget`  | Maximum generated output volume before a job is stopped. Expressed as text bytes, delta count, or provider token cap where available.      |
| `loopDetector`  | A guard that detects repeated streamed text patterns and stops degenerate generations.                                                     |
| `stale`         | A persisted `running` job that has no live worker, or whose last activity exceeds its configured idle timeout after resume/reconciliation. |

### Contract Changes

#### Background Manager Shutdown

Extend the runtime manager contract:

```ts
interface IBackgroundTaskManager {
  shutdown(reason?: string): Promise<void>;
}
```

Rules:

- `shutdown()` is the SDK/runtime-owned lifecycle API for ending all managed background work.
- It cancels queued and running tasks, waits for runner cancellation, and escalates to runner-owned kill/cleanup after `killGraceMs`.
- It is idempotent. Repeated calls return the same in-flight shutdown promise or complete as a no-op after shutdown has finished.
- It must not remove terminal task records or logs. Cleanup/close remains a separate user/session retention concern.
- It must emit terminal cancellation/failure events before resolving whenever possible, so session persistence can record the final state.

#### Interactive Session Shutdown

Expose session-level shutdown through the SDK:

```ts
interface IInteractiveSessionShutdownOptions {
  reason?: string;
}

class InteractiveSession {
  shutdown(options?: IInteractiveSessionShutdownOptions): Promise<void>;
}
```

Rules:

- `InteractiveSession.shutdown()` delegates to the session's background task manager and any other SDK-owned disposable runtime resources.
- `InteractiveSession.shutdown()` enters a `shutting_down` lifecycle state before cancelling work, so hosts can render a clear shutdown message and SDK internals can reject new prompts/tasks.
- CLI, headless transport, tests, and future hosts call this SDK method during process/application exit.
- CLI may own signal wiring because it is the Node process adapter, but it must not enumerate tasks, kill subagent workers, or implement task lifecycle decisions directly.
- `/exit`, `/reset`, normal TUI unmount, print/headless completion, `SIGINT`, and `SIGTERM` should all converge on the same SDK shutdown path.
- A second Ctrl+C may force process exit after a short grace window, but the first Ctrl+C must attempt SDK shutdown.

#### Session End Hook

Add Claude Code-compatible session termination hook events.

Claude Code separates hook cadence:

- `SessionStart` and `SessionEnd` fire once per session.
- `UserPromptSubmit`, `Stop`, and `StopFailure` fire once per turn.
- `SubagentStart` and `SubagentStop` fire for subagent lifecycle.

The current codebase already uses `Stop` after each assistant response. Do not overload that per-turn event for host shutdown. Add `SessionEnd` as the explicit session shutdown hook while keeping `Stop` compatible for response-completion behavior.

```ts
type THookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'Stop'
  | 'StopFailure'
  | 'PreCompact'
  | 'PostCompact'
  | 'UserPromptSubmit'
  | 'WorktreeCreate'
  | 'WorktreeRemove';

type TSessionEndReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'bypass_permissions_disabled'
  | 'other';

interface IHookInput {
  transcript_path?: string;
  reason?: TSessionEndReason;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  agent_id?: string;
  agent_type?: string;
  agent_transcript_path?: string;
}
```

Rules:

- `SessionEnd` fires exactly once per interactive session shutdown.
- `SessionEnd` runs during `InteractiveSession.shutdown()`, not in CLI UI code.
- `SessionEnd` input follows Claude Code shape: common fields plus `reason`. Do not add Robota-specific shutdown fields to the hook input unless a future compatibility spec explicitly permits extensions.
- Internal Robota shutdown reasons map to Claude-compatible values. Ctrl+C while prompt input is visible maps to `prompt_input_exit`; other Ctrl+C/SIGTERM/process-dispose paths map to `other` unless a more specific Claude-compatible reason applies.
- `SessionEnd` is awaited with the Claude-compatible timeout policy: default `1_500ms`, configurable per hook, capped at `60_000ms`.
- `SessionEnd` has no decision control and cannot veto process shutdown. Exit code `2` shows/logs stderr for the user but does not block termination.
- `SessionEnd` should run after the SDK has rejected new work and after managed background tasks have reached terminal states where possible, so hook input reflects the final cleanup result.
- `Stop` remains per-turn response completion and keeps `stop_hook_active`/`last_assistant_message` semantics.
- `SubagentStart` and `SubagentStop` should fire for managed subagent lifecycle. `SubagentStop` receives `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`, and `last_assistant_message`.
- Runner-owned lifecycle hooks such as `WorktreeRemove` must still fire during runner cleanup before `SessionEnd` completes.
- The SDK must persist hook start/result/failure summaries to session logs so shutdown can be debugged after resume.

#### Claude-Compatible Hook Order

Shutdown implementation must respect Claude Code's lifecycle order instead of inventing a Robota-specific order.

Supported order for this task:

1. `SessionStart` runs when a session begins or resumes.
2. For each user turn, `UserPromptSubmit` runs before model processing.
3. Tool lifecycle hooks run inside the turn as tool calls happen: `PreToolUse`, permission-related hooks when supported, then `PostToolUse` or `PostToolUseFailure`.
4. Managed subagent lifecycle hooks run around subagent work: `SubagentStart` when a subagent is spawned and `SubagentStop` when it finishes or is cancelled.
5. The turn ends with `Stop` when the assistant finishes responding, or `StopFailure` when the turn ends due to an execution/API failure.
6. Compaction hooks remain outside normal turn completion: `PreCompact` before compaction and `PostCompact` after compaction.
7. `WorktreeCreate` and `WorktreeRemove` are lifecycle hooks for worktree adapters and may fire during subagent setup/cleanup.
8. `SessionEnd` is the terminal session hook and runs when the session terminates.

Ctrl+C/session shutdown order:

1. CLI renders a shutdown status such as `Shutting down...`.
2. CLI calls `InteractiveSession.shutdown({ reason })`.
3. SDK enters `shutting_down` state and rejects new prompts, tools, and background task spawns.
4. Any active foreground turn is finalized through the existing per-turn lifecycle. If it naturally completed, `Stop` has already fired; if it fails due to shutdown/provider abort, use the same per-turn failure path as execution errors.
5. SDK cancels managed background agents/processes. Subagent runners fire `SubagentStop` for each managed subagent that terminates during shutdown.
6. Runner cleanup fires associated lifecycle hooks such as `WorktreeRemove`.
7. SDK persists final background task and hook summaries.
8. SDK fires `SessionEnd` exactly once with the Claude-compatible `reason` field.
9. CLI exits after SDK shutdown resolves, or force-exits only after the configured shutdown grace window.

Ordering rules:

- Do not fire `SessionEnd` before managed subagents have received their terminal lifecycle events.
- Do not fire `Stop` merely because the host is exiting. `Stop` remains a per-turn response completion event.
- Do not let `SessionEnd` spawn new managed background tasks during shutdown.
- When multiple hooks match the same event, preserve the existing hook runner policy while aligning with Claude Code's model that matching hooks for one event belong to the same event phase.

#### Background Task Request

Extend background task request contracts:

```ts
interface IBaseBackgroundTaskRequest {
  idleTimeoutMs?: number;
  maxRuntimeMs?: number;
}

interface IAgentBackgroundTaskRequest extends IBaseBackgroundTaskRequest {
  outputLimitBytes?: number;
  maxTextDeltas?: number;
  repetitionWindow?: number;
  repetitionThreshold?: number;
}
```

Compatibility:

- Keep existing `timeoutMs` temporarily as a legacy alias.
- For `kind: "process"`, legacy `timeoutMs` continues to mean wall-clock process timeout until migrated.
- For new `kind: "agent"` code paths, use `idleTimeoutMs` for no-progress timeout and `maxRuntimeMs` for elapsed hard deadline.
- If an older caller passes only `timeoutMs` for an agent, map it to `idleTimeoutMs` and record a compatibility note in code comments and SPEC docs.

#### Background Task State

Extend task state:

```ts
interface IBackgroundTaskState {
  lastActivityAt?: string;
  timeoutReason?: 'idle' | 'max_runtime' | 'output_limit' | 'repetition' | 'stale_worker';
}
```

Rules:

- `lastActivityAt` is set on start.
- `lastActivityAt` updates on any meaningful runner event.
- High-frequency text deltas may throttle `background_task_updated` events, but internal `lastActivityAt` must update for every delta.
- Terminal timeout/cancellation/failure state must preserve `timeoutReason` where applicable.

### Default Policy

Default values should be conservative and configurable:

| Setting                 |          Default | Reason                                                                                   |
| ----------------------- | ---------------: | ---------------------------------------------------------------------------------------- |
| `agentIdleTimeoutMs`    |        `240_000` | Gives local models and parallel agent jobs more room while still catching stuck streams. |
| `agentMaxRuntimeMs`     |              `0` | No default wall-clock cap; long agentic work continues under idle/runaway guards.        |
| `agentOutputLimitBytes` |        `256_000` | Prevent runaway transcript growth while preserving useful logs.                          |
| `agentMaxTextDeltas`    |         `20_000` | Stops pathological tiny-token streams.                                                   |
| `repetitionWindow`      |            `800` | Check repeated suffixes over recent generated text.                                      |
| `repetitionThreshold`   |              `8` | Stop if the same meaningful phrase repeats too many times.                               |
| `killGraceMs`           | existing `2_000` | Preserve current graceful-cancel window before process kill.                             |

Configuration ownership:

- Package defaults live in the runtime/SDK owner package, not CLI UI code.
- CLI may expose settings fields later, but the first implementation can use constants plus test overrides.
- Provider `timeout` remains request/socket timeout and is not a substitute for task idle watchdogs.

### Runtime Behavior

#### Idle Watchdog

When a background agent enters `running`:

1. Start an idle watchdog timer.
2. Reset/refresh it on every activity.
3. If it fires, cancel the task with category `timeout`, `timeoutReason: "idle"`, and message `Background agent idle timeout`.
4. Propagate cancellation to:
   - `BackgroundTaskManager`
   - child-process runner
   - worker session
   - provider request `AbortSignal`
   - HTTP stream/reader where supported
5. If graceful cancellation does not exit the worker within `killGraceMs`, kill the child process.

#### Max Runtime Watchdog

When a background agent enters `running`:

1. Start a non-refreshing hard deadline timer.
2. If it fires, cancel with category `timeout`, `timeoutReason: "max_runtime"`.
3. Preserve partial transcript path and task metadata.

This guard should be rare; it exists for actively streaming but unbounded work.

#### Output Budget

The manager or runner tracks visible text/output budget:

- Stop when output byte count exceeds `outputLimitBytes`.
- Stop when text delta count exceeds `maxTextDeltas`.
- Mark `timeoutReason: "output_limit"`.
- Preserve transcript data written before termination.

Provider-level token caps should also be applied where possible:

- OpenAI-compatible requests should set `max_tokens` when the higher-level request provides `maxTokens`.
- Agent background jobs should have a default max output token budget where the provider interface can carry it.

#### Repetition Detector

Detect degenerate loops in streamed assistant text:

- Maintain a bounded rolling buffer of recent visible text.
- Normalize whitespace before comparison.
- Ignore very short fragments.
- If the same meaningful suffix or sentence appears at least `repetitionThreshold` times within `repetitionWindow`, cancel the job with `timeoutReason: "repetition"`.
- Record a short diagnostic sample in the task error message without storing excessive repeated text in state.

This detector must run after provider-specific projection so Gemma channel markers do not dominate repetition matching.

#### Resume/Reconciliation

When loading persisted sessions:

1. For each persisted `running` background task, check whether `pid` still exists.
2. If PID is missing, mark as failed with `timeoutReason: "stale_worker"`.
3. If PID exists but `lastActivityAt` exceeds `idleTimeoutMs`, mark as failed and attempt cancellation.
4. If PID exists and still active within timeout, keep as running and reattach/continue log reads where supported.
5. Emit a reconciliation event into JSONL so the change is auditable.

#### Host Shutdown

When the hosting process or app exits:

1. The host calls `InteractiveSession.shutdown({ reason })`.
2. The SDK resolves the active session's `BackgroundTaskManager`.
3. The manager cancels all queued and running managed tasks.
4. Each runner receives the same cancellation path used by manual cancel and watchdog timeout.
5. Child-process runners forward cancel to workers, abort the active provider/session request, then terminate the worker after `killGraceMs` if it does not exit.
6. The SDK persists terminal task state and append-only shutdown events before the host exits where possible.

Responsibility split:

- `agent-runtime` owns background task shutdown semantics and manager-level all-task cancellation.
- `agent-sdk` owns session-level lifecycle composition and exposes `InteractiveSession.shutdown()`.
- `agent-cli` owns OS/TUI signal wiring only. It calls SDK shutdown and exits after completion or force-exit grace.
- Runner adapters own concrete cleanup for their resources, such as child process termination, stream abort, PTY close, shell process kill, or worktree cleanup hooks.

### Logging and Persistence

Session JSONL must capture:

- task created/started/updated/completed/failed/cancelled
- `timeoutReason`
- `lastActivityAt`
- transcript path
- worker PID
- cancellation propagation result
- provider/request abort result where known
- SDK shutdown start/completion events, including whether shutdown was graceful or force-exited by the host

Subagent transcript JSONL must capture:

- text deltas
- tool calls/results
- timeout/watchdog events
- SDK shutdown cancellation requests
- cancellation request and acknowledgement
- final state if the worker exits

Logging policy:

- `info`: task start, task terminal state, timeout cancellation.
- `warn`: timeout/repetition/output-budget stop that preserved partial output.
- `error`: worker crash, cancellation failure, malformed IPC, unrecoverable provider failure.
- `debug`: high-frequency deltas and watchdog refresh internals only when debug logging is enabled.

### TUI Behavior

The TUI should show enough information to make stuck work obvious:

- Running task row includes elapsed time and last activity age.
- Idle timeout terminal state appears as `timed out`, not generic `failed`.
- Repetition/output budget stops appear with a concise reason.
- Task detail/read view exposes the transcript path and final timeout reason.
- Completed/failed/cancelled tasks still follow the existing cleanup policy after user acknowledgement/close.

### Command Behavior

`/background cancel <task-id>` and `/agent stop <agent-id>` remain manual controls.

New behavior:

- Timeout-triggered cancellation should use the same cancellation path as manual cancel.
- If a task is already terminal, repeated cancel is a no-op.
- `background list` should include `lastActivityAt` or derived idle age for running jobs.
- `background read` should continue to work after timeout because transcript logs are preserved.

## Implementation Plan

1. Add `idleTimeoutMs`, `maxRuntimeMs`, output budget fields, `lastActivityAt`, and `timeoutReason` to `agent-runtime` background task contracts.
2. Add pure helpers for activity tracking, timeout reason normalization, and repetition detection.
3. Update `BackgroundTaskManager` to refresh internal activity on text/tool/permission events and emit throttled task updates.
4. Add idle and max-runtime watchdog timers in the manager or runner boundary; ensure timers are cleared on all terminal states.
5. Update `ChildProcessSubagentRunner` to pass watchdog cancellation through IPC, then kill after `killGraceMs`.
6. Update `child-process-subagent-worker` to own an `AbortController` for the active session run and abort provider/session execution on cancel.
7. Update OpenAI-compatible stream assembly to cooperate with abort signals and surface abort/timeout as typed errors rather than hanging promises.
8. Add repetition/output budget enforcement after provider-specific text projection.
9. Add resume reconciliation for persisted running background tasks.
10. Add `BackgroundTaskManager.shutdown()` to cancel all queued/running managed tasks and wait for cancellation/kill completion.
11. Add `InteractiveSession.shutdown()` to delegate runtime cleanup through SDK-owned lifecycle composition.
12. Update CLI signal and exit paths to call `InteractiveSession.shutdown()` instead of exiting immediately while managed background tasks may be alive.
13. Update TUI view-model and background/agent commands to show timeout reason and idle age.
14. Update package SPEC files for `agent-runtime`, `agent-sdk`, `agent-cli`, and affected provider packages.
15. Run targeted package tests, builds, lint, and `pnpm harness:scan`.

## Test Plan

Testing must prove the lifecycle behavior with deterministic fake streams before using real providers. Unit coverage owns timeout, cancellation, repetition, output-budget, and resume reconciliation contracts; integration coverage verifies CLI/TUI/headless surfaces observe the same terminal state and preserved transcripts.

### Unit Tests

- Given a running agent receives no text/tool/progress event for `idleTimeoutMs`, when the watchdog fires, then the task transitions to `failed` with category `timeout` and `timeoutReason: "idle"`.
- Given a running agent keeps receiving text deltas, when each delta arrives before `idleTimeoutMs`, then the idle watchdog is refreshed and the task remains running.
- Given a running agent exceeds `maxRuntimeMs` while still streaming, when the hard deadline fires, then the task is cancelled with `timeoutReason: "max_runtime"`.
- Given a child-process worker is cancelled by a watchdog, when it acknowledges cancellation, then the task resolves terminal cancellation/failure without leaving a live child process.
- Given a child-process worker ignores cancellation, when `killGraceMs` elapses, then the runner kills the process and marks the task terminal.
- Given an OpenAI-compatible stream receives an aborted signal, when the stream loop awaits the next chunk, then it exits or rejects deterministically instead of hanging.
- Given projected visible text repeats the same sentence above the threshold, when the repetition detector evaluates the buffer, then the task stops with `timeoutReason: "repetition"`.
- Given Gemma channel markers are projected out, when repetition detection runs, then marker-only repetition does not trigger false positives.
- Given generated text exceeds `outputLimitBytes`, when the budget check runs, then the task stops with `timeoutReason: "output_limit"` and transcript path remains readable.
- Given `BackgroundTaskManager.shutdown()` is called with queued tasks, when shutdown runs, then queued tasks are cancelled without being started.
- Given `BackgroundTaskManager.shutdown()` is called with running agent and process tasks, when shutdown runs, then every handle receives `cancel()` and all managed tasks reach terminal state before shutdown resolves or escalates.
- Given a runner ignores shutdown cancellation, when `killGraceMs` elapses, then runner-owned cleanup is escalated and no child process remains alive.
- Given `BackgroundTaskManager.shutdown()` is called twice, when the first call is still pending, then the second call is idempotent and does not double-cancel runners.
- Given `InteractiveSession.shutdown()` is called, when the session has a background task manager, then it delegates to manager shutdown and persists terminal background task state.
- Given `InteractiveSession.shutdown()` runs, when hooks are configured, then the SDK fires `SessionEnd` exactly once with Claude-compatible `reason` input.
- Given Ctrl+C shutdown cancels running subagents, when hook events are recorded, then each affected subagent receives `SubagentStop` before the parent session receives `SessionEnd`.
- Given a normal assistant turn already completed before `/exit`, when shutdown runs, then `Stop` is not fired again solely because the session is ending.
- Given `SessionEnd` hook exits with code `2`, when shutdown runs, then the hook result is logged but shutdown is not blocked.
- Given a persisted running task has a missing PID on resume, when reconciliation runs, then it is marked failed with `timeoutReason: "stale_worker"`.
- Given a persisted running task has a live PID but stale `lastActivityAt`, when reconciliation runs, then cancellation is attempted and the task becomes terminal.
- Given text deltas arrive at high frequency, when task state updates are emitted, then `lastActivityAt` is accurate internally while UI update events are throttled.
- Given `timeoutMs` is provided for an agent by legacy code, when the request is normalized, then it maps to `idleTimeoutMs` and a compatibility path is covered.
- Given `timeoutMs` is provided for a process task, when the process runner starts, then the current wall-clock timeout behavior is preserved.

### Integration Tests

- TUI starts two background agents; one completes, one stops after idle timeout; the panel shows one `completed` and one `timed out`.
- TUI receives Ctrl+C while background agents are running; the CLI calls `InteractiveSession.shutdown()`, the SDK cancels managed workers, and no subagent child PID remains after exit.
- TUI displays `Shutting down...` immediately after Ctrl+C while SDK shutdown and hook execution are in progress.
- `/exit` while background processes are running follows the same SDK shutdown path as Ctrl+C.
- Headless/print mode exits through SDK shutdown after completion so background tasks spawned by tools do not outlive the process.
- Headless `stream-json` emits background task timeout events with `timeoutReason`.
- Child-process subagent talking to a fake never-ending stream is cancelled without leaving an orphaned PID.
- Resume loads a session with a stale running task and reconciles it to terminal state.

### Verification Commands

```bash
pnpm --filter @robota-sdk/agent-runtime test
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-provider-openai-compatible test
pnpm --filter @robota-sdk/agent-provider-gemma test
pnpm --filter @robota-sdk/agent-runtime build
pnpm --filter @robota-sdk/agent-sdk build
pnpm --filter @robota-sdk/agent-cli build
pnpm harness:scan
```

## Acceptance Criteria

- A background agent cannot remain `running` forever after the provider stream stops producing activity.
- User-facing timeout behavior for agents is based on no new streamed/progress message, not simply elapsed runtime.
- A separate hard runtime cap still protects against endless active streaming.
- Timeout/cancel/failure states are visible in TUI, commands, session JSON, and JSONL logs.
- Child-process cancellation reaches the active provider request through an `AbortSignal` path.
- Ctrl+C, `/exit`, and headless process completion call SDK-owned shutdown and do not leave managed background workers alive.
- CLI signal handling only invokes SDK lifecycle APIs; background task enumeration, cancellation, and child cleanup remain SDK/runtime responsibilities.
- Stale running jobs are reconciled on resume.
- Existing background process timeout behavior is preserved or migrated explicitly without silent semantic drift.

## Decisions

- Use `idleTimeoutMs` for the user-facing agent timeout semantics requested by the user.
- Keep `maxRuntimeMs` as a separate hard cap so actively streaming but useless work can still be bounded.
- Avoid overloading provider `timeout`; provider/socket timeout is a lower-level transport setting and cannot manage task lifecycle alone.
- Run repetition detection after provider-specific projection so model-family markup does not distort loop detection.
- Treat host exit cleanup as an SDK/runtime lifecycle contract. CLI owns the OS signal adapter, but SDK owns managed background task shutdown.

## References

- Claude Code hooks reference: hook events are grouped by cadence; `SessionStart`/`SessionEnd` are once per session, `Stop`/`StopFailure` are once per turn, and `SubagentStart`/`SubagentStop` belong to subagent lifecycle.
- Claude Code hooks reference: `SessionEnd` receives a `reason` field, has no decision control, defaults to a short timeout, and cannot block session termination.
- OpenAI Agents SDK streaming guidance: abort the provided signal or cancel the stream reader when stopping a stream early, then wait for stream completion/cleanup.
- Anthropic API guidance: long requests over roughly 10 minutes are vulnerable to network and idle connection timeouts; streaming or batch/polling avoids uninterrupted connection assumptions.
- Node.js timer guidance: timers and promisified timer waits can be cancelled with `AbortSignal`, and timeout handles must be cleared on completion.
- OpenAI response length guidance: output caps reduce cost, latency, and irrelevant or runaway responses.

## Progress

### 2026-05-01

- Created the watchdog specification from the observed stuck `agent_2` session.
- Defined timeout as idle/no-new-message time for agent work while separating hard runtime caps.
- Added implementation, test, logging, TUI, and resume reconciliation requirements.
- Added SDK-owned shutdown requirements so Ctrl+C and other host exits terminate managed background agents/processes without putting lifecycle logic in CLI.
- Aligned shutdown hooks with Claude Code hook events and ordering, including `SessionEnd`, `SubagentStart`, `SubagentStop`, `Stop`, and `StopFailure`.
- Implemented runtime agent watchdogs for idle timeout, hard max runtime, output byte/delta budget, repeated-output detection, and legacy agent `timeoutMs` compatibility.
- Implemented `BackgroundTaskManager.shutdown()` and `InteractiveSession.shutdown()` so queued/running managed tasks are cancelled through SDK/runtime lifecycle before host exit.
- Added `SessionEnd`, `StopFailure`, `SubagentStart`, and `SubagentStop` hook events and wired background task lifecycle to subagent hooks.
- Updated CLI TUI, `/exit`, setup/restart paths, headless mode, Ctrl+C, `SIGINT`, and `SIGTERM` to call SDK shutdown instead of bypassing managed background cleanup.
- Persisted background text deltas and reconciled restored non-terminal background tasks to `stale_worker` when live reattachment is unavailable.
- Hardened OpenAI-compatible stream assembly and the core provider stream wrapper so abort can settle even while awaiting the next provider chunk.
- Updated affected package SPEC files and split new manager/runner helper modules to keep changed runtime/CLI files within the package structure rules.

## Blockers

- None.

## Result

Implemented and verified. `pnpm harness:scan` exits successfully; it still reports the repository's existing file-size backlog warnings for unrelated and previously large files.
