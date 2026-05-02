# @robota-sdk/agent-runtime

Composable runtime primitives for Robota background tasks and subagent orchestration.

This package owns lifecycle/state/port contracts that are reused by SDK assembly, transports, and runtime shells. It does not create providers, sessions, child processes, Git worktrees, or UI state directly.

Background task handles may expose `logPath` and `transcriptPath` for append-only diagnostic streams. The runtime projects those paths into task state so SDK/CLI layers can persist resumable snapshots while high-frequency output stays in JSONL logs.

## Current Responsibilities

- Own background task state transitions, terminal status, watchdog behavior, and task snapshots.
- Own subagent manager contracts used by SDK Agent tool execution and CLI background work display.
- Keep process execution, provider calls, Git worktree I/O, and UI rendering outside the runtime boundary.
- Surface `logPath` and `transcriptPath` so session records can store resumable references while logs remain append-only.

## Subagent Orchestration

The SDK composes these runtime primitives to spawn subagent jobs for the model-visible Agent tool and `/agent` command flows. A parent session can track running, completed, failed, and timed-out work without coupling the runtime to React, Ink, provider SDKs, or filesystem-specific worktree code.
