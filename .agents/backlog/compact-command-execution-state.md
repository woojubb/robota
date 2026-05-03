# Compact Command Execution State

## What

Make manual `/compact` behave like other blocking long-running commands in the CLI: show an in-progress state such as `Thinking`, block unrelated input while compaction is running, and emit a clear completion result.

## Why

Manual `/compact` currently can appear to do nothing while the compaction request is running. The user can keep typing other commands, which makes it unclear whether compaction started, whether it is still running, or whether subsequent commands will race with the compaction result. Compaction should follow the same execution-state path as normal assistant work because it calls the model and mutates session history.

## Current Signals

- `packages/agent-sdk/src/commands/system-command.ts` executes the `compact` system command and returns `Context compacted: before -> after`.
- `packages/agent-sessions/src/session.ts` exposes `compact()` as an async operation.
- `packages/agent-sessions/src/session-history-ops.ts` runs model-backed summarization and updates history after completion.
- `packages/agent-cli/src/ui/hooks/useSideEffects.ts` and related TUI state manage command side effects and thinking/input state for normal runs.

## Scope

- Trace the manual `/compact` path from slash input through SDK command execution to TUI state updates.
- Ensure `/compact` sets the same busy/thinking state used by normal assistant execution before awaiting compaction.
- Prevent new prompt or slash-command submission while manual compaction is in flight.
- Show an explicit start/progress signal before the model-backed compaction call begins.
- Preserve the existing completion message with before/after context percentages.
- Handle failures by clearing the busy state and showing an actionable error.

## Recommendation

Treat manual compaction as a session-level execution job, not a lightweight slash-command side effect.

Rationale: compaction calls the provider and rewrites session history. It has the same concurrency risks as a normal prompt run, so it should share the same UI lock and lifecycle events instead of using a detached command path.

## Non-Goals

- Do not stream the compact summary into the normal assistant response.
- Do not allow another prompt to run concurrently with manual compaction.
- Do not special-case `/compact` in a way that bypasses the shared command descriptor path.
- Do not change auto-compaction timing in this task.

## Acceptance Criteria

- [ ] Entering `/compact` immediately shows a running state such as `Thinking`.
- [ ] The input surface is blocked or queued consistently with normal assistant execution while compaction runs.
- [ ] Starting another command during compaction is not accepted as an independent concurrent operation.
- [ ] Successful completion reports before/after context percentages.
- [ ] Failure clears the running state and reports the error.
- [ ] Tests cover UI state, command lifecycle, and concurrency prevention.

## Test Plan

- Add CLI hook/view-model tests for `/compact` busy-state transitions.
- Add a regression test where `/compact` is unresolved and a second command is submitted.
- Add SDK command tests ensuring compact remains descriptor-owned and returns completion metadata.
- Add session tests proving compaction still avoids normal answer streaming.

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-compact-command-execution-state.md`.
2. Start with a failing CLI regression test that keeps compaction pending.
3. Wire manual compaction into the shared execution lifecycle before changing visual copy.
