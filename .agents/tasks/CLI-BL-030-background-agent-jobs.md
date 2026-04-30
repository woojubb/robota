# Background Agent Jobs

- **Status**: in-progress
- **Created**: 2026-04-30
- **Branch**: feat/background-agent-jobs
- **Scope**: packages/agent-sdk, packages/agent-cli

## Objective

Implement the first production slices of Robota's shared background task layer so managed agent and process jobs can run through a generic registry, emit lifecycle events, and be visible/control-ready from CLI/TUI surfaces.

## Plan

- [x] Add `agent-sdk` background task types, pure lifecycle transition function, and manager tests.
- [x] Implement `BackgroundTaskManager` with queueing, targeted cancellation, close, send, read-log, and lifecycle events.
- [x] Migrate `SubagentManager` to delegate to the generic background manager while preserving existing public behavior.
- [x] Add Agent tool background mode with immediate metadata return while keeping foreground compatibility.
- [x] Add `InteractiveSession` background task APIs/events and `/background` system command controls.
- [x] Add `TuiStateManager` background task projection and render a thin background task panel.
- [x] Add SDK-composed `BackgroundProcess` tool and CLI-managed shell process runner.
- [x] Run final targeted verification after the process runner slice.
- [x] Update package specs and run targeted verification.
- [x] Add an SDK subagent runner factory seam so runtime shells can replace the default in-process runner.
- [x] Add a CLI child-process subagent runner with typed IPC, cancellation, follow-up send, and worker lifecycle supervision.
- [x] Add a CLI worker entrypoint that reconstructs provider/session state inside the child process instead of sharing live objects.
- [x] Wire CLI print/TUI modes to use child-process subagents while keeping tests able to inject fake runners.
- [x] Add focused unit tests for runner injection, IPC validation, child-process completion, cancellation, and follow-up send.
- [x] Project child-process subagent text/tool IPC messages into `BackgroundTaskManager` progress events and TUI previews.
- [x] Extend WebSocket/headless transports with background task events and controls.

## Progress

### 2026-04-30

- Created branch `feat/background-agent-jobs` from updated `develop`.
- Confirmed existing cross-cutting specs define the shared background task layer and subagent migration order.
- Added SDK background task contracts, transition table, manager, and unit tests.
- Routed `SubagentManager` through `BackgroundTaskManager` for `kind: 'agent'` jobs.
- Added Agent tool `background` mode, `InteractiveSession` background APIs/events, `/background` command controls, and TUI background task projection.
- Updated `agent-sdk` and `agent-cli` package specs for the implemented slice.
- Split the background task manager helpers so new implementation files stay below the 300-line file-size guard.
- Verified `agent-sdk` and `agent-cli` with package harness checks, full harness scan, and whitespace diff check.
- Added `BackgroundProcess` as a separate SDK-composed tool when a process runner is injected, preserving existing `Bash` behavior.
- Added CLI `ManagedShellProcessRunner` with stdout/stderr capture, stdin send support, log paging, timeout failure, and targeted termination hook.
- Extended `/background` with `read <task-id> [offset]` for log inspection.
- Final verification passed for `agent-sdk`, `agent-cli`, full `harness:scan`, and `git diff --check`.

### 2026-05-01

- Committed and pushed the first background runtime slice as `099aa9404 feat(agent): add background task runtime`.
- Started the child-process subagent isolation slice on the same branch.
- Confirmed current SDK assembly always creates `createInProcessSubagentRunner(agentToolDeps)`, so the next change must introduce a runner factory seam before the CLI can own process isolation.
- Confirmed CLI already composes `BackgroundProcess` via `backgroundTaskRunners`; the child-process agent runner should follow the same runtime-shell composition style.
- Added `subagentRunnerFactory` to SDK session assembly and interactive session options, preserving the in-process runner as the default.
- Added CLI `ChildProcessSubagentRunner`, typed IPC guards, worker entrypoint, and provider-profile reconstruction for worker-side provider creation.
- Wired CLI print and TUI modes to inject the child-process runner factory with the same concrete provider profile used by the parent session.
- Added unit tests for runner factory injection, child-process completion, cancellation, follow-up prompt forwarding, IPC validation, and provider reconstruction from serialized profiles.
- Verified targeted SDK/CLI tests, SDK/CLI typecheck, CLI build, package lint with warnings only, package harness verification for `agent-sdk`/`agent-cli`, full `harness:scan`, and `git diff --check`.

### 2026-05-01 continued

- Started the progress-event projection slice. The child worker already emits text/tool IPC messages; the missing layer is a runner-to-manager emit port plus TUI preview accumulation.
- Added `TBackgroundTaskRunnerEvent` as the runner emit port, projected runner text/tool events through `BackgroundTaskManager`, and accumulated background text deltas/current tool action in `TuiStateManager`.
- Extended child-process subagent IPC tests, background manager tests, TUI projection tests, and Agent tool callback tests for the new progress event behavior.
- Verified targeted SDK/CLI builds and tests, SDK/CLI package harness verification, full `harness:scan`, and `git diff --check`.
- Committed and pushed progress projection as `76820a909 feat(agent): project subagent progress events`.
- Started the transport projection slice. WebSocket should forward `background_task_event` and expose list/get/cancel/close/send/read-log controls; headless should surface background events in `stream-json` output without adding interactive controls.
- Added WebSocket `background_task_event` forwarding plus list/get/cancel/close/send/read-log client messages with unit tests.
- Added headless `stream-json` background task event output with unit tests.

## Decisions

- Start with the SDK-owned generic manager and in-process agent integration before child-process/process runners. This gives TUI and transport layers one lifecycle contract before Node-specific runner adapters are added.
- Keep child-process agent isolation as the next slice. The current change establishes the shared lifecycle, TUI/API surface, and managed shell process runner first.
- The child-process runner will live in `agent-cli`, not `agent-sdk`, because it depends on Node process management and provider reconstruction from CLI-owned settings.
- The SDK will expose a runner-factory seam that receives the same dependency bundle as the in-process runner. This keeps SDK defaults unchanged while allowing CLI production runtime to supply a process-backed runner.

## Test Plan

- Unit-test the pure background task transition table for every allowed transition and invalid terminal transitions.
- Unit-test `BackgroundTaskManager` queueing, targeted cancellation, terminal close, unsupported `send`, unsupported `readLog`, and lifecycle event emission with fake runners.
- Unit-test the `SubagentManager` compatibility path to ensure existing foreground subagent behavior still queues, waits, cancels, and closes correctly through the generic manager.
- Unit-test the Agent tool background mode so it calls `spawn()` with `mode: 'background'`, returns metadata immediately, and does not wait for completion.
- Unit-test `InteractiveSession` background task event forwarding and control APIs with an injected background manager.
- Unit-test `TuiStateManager` background task projection without React, and run package build/test/lint/typecheck plus harness verification for `agent-sdk` and `agent-cli`.
- Unit-test `BackgroundProcess` tool request mapping and error shaping.
- Unit-test `ManagedShellProcessRunner` command execution, stdin forwarding, stdout/stderr log capture, and paged log reads.
- Unit-test that `createSession` uses an injected subagent runner factory and still defaults to the in-process runner when no factory is supplied.
- Unit-test the child-process runner with a fixture worker for successful completion, cancellation, and follow-up prompt forwarding.
- Unit-test worker IPC parsing so malformed parent/child messages fail deterministically instead of crashing silently.

## Blockers

- None.

## Result

Implemented the background agent/process jobs foundation on `feat/background-agent-jobs`. The shared SDK background task manager, subagent facade migration, Agent tool background mode, `BackgroundProcess` tool composition, CLI shell process runner, session APIs/events, `/background` controls, and thin TUI projection are in place with focused unit tests and package spec updates.

Child-process subagent isolation is now also connected for CLI runtime: SDK consumers can inject a `TSubagentRunnerFactory`, and Robota CLI uses a worker-process runner that reconstructs provider/session state inside the child process. Worker text/tool progress is projected into `BackgroundTaskManager` progress events, and the TUI accumulates partial output previews plus current tool action from those events.

Transport projection is connected for the generic background task layer: WebSocket clients receive pushed `background_task_event` messages and can list/get/cancel/close/send/read task logs, while headless `stream-json` callers receive background task events as stream events.
