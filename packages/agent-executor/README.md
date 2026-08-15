# @robota-sdk/agent-executor

Composable runtime primitives for Robota background tasks and subagent orchestration.

This package owns lifecycle/state/port contracts reused by SDK assembly, transports, and runtime shells.
Its two concrete command runners spawn child processes; provider/session creation, Git worktrees, and UI
state remain outside this package.

Background task handles may expose `logPath` and `transcriptPath` for append-only diagnostic streams. The runtime projects those paths into task state so SDK/CLI layers can persist resumable snapshots while high-frequency output stays in JSONL logs.

## Current Responsibilities

- Own background task state transitions, terminal status, watchdog behavior, and task snapshots.
- Own subagent manager contracts used by SDK `/agent` command execution and CLI background work display.
- Keep process execution, provider calls, Git worktree I/O, and UI rendering outside the runtime boundary.
- Surface `logPath` and `transcriptPath` so session records can store resumable references while logs remain append-only.
- Resolve managed and scheduled command requests through one `resolveBackgroundTaskShellCommand` adapter.
  The adapter returns an executable together with its matching `sh`/`bash`, PowerShell/`pwsh`, or `cmd`
  arguments and rejects unknown explicit shells before spawn.

## Subagent Orchestration

The SDK composes these runtime primitives to spawn subagent jobs for `/agent` command flows. A parent session can track running, completed, failed, and timed-out work without coupling the runtime to React, Ink, provider SDKs, or filesystem-specific worktree code.
