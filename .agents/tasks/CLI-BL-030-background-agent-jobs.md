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

## Decisions

- Start with the SDK-owned generic manager and in-process agent integration before child-process/process runners. This gives TUI and transport layers one lifecycle contract before Node-specific runner adapters are added.
- Keep child-process agent isolation as the next slice. The current change establishes the shared lifecycle, TUI/API surface, and managed shell process runner first.

## Test Plan

- Unit-test the pure background task transition table for every allowed transition and invalid terminal transitions.
- Unit-test `BackgroundTaskManager` queueing, targeted cancellation, terminal close, unsupported `send`, unsupported `readLog`, and lifecycle event emission with fake runners.
- Unit-test the `SubagentManager` compatibility path to ensure existing foreground subagent behavior still queues, waits, cancels, and closes correctly through the generic manager.
- Unit-test the Agent tool background mode so it calls `spawn()` with `mode: 'background'`, returns metadata immediately, and does not wait for completion.
- Unit-test `InteractiveSession` background task event forwarding and control APIs with an injected background manager.
- Unit-test `TuiStateManager` background task projection without React, and run package build/test/lint/typecheck plus harness verification for `agent-sdk` and `agent-cli`.
- Unit-test `BackgroundProcess` tool request mapping and error shaping.
- Unit-test `ManagedShellProcessRunner` command execution, stdin forwarding, stdout/stderr log capture, and paged log reads.

## Blockers

- None.

## Result

Implemented the background agent/process jobs foundation on `feat/background-agent-jobs`. The shared SDK background task manager, subagent facade migration, Agent tool background mode, `BackgroundProcess` tool composition, CLI shell process runner, session APIs/events, `/background` controls, and thin TUI projection are in place with focused unit tests and package spec updates.
