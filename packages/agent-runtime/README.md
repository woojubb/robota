# @robota-sdk/agent-runtime

Composable runtime primitives for Robota background tasks and subagent orchestration.

This package owns lifecycle/state/port contracts that are reused by SDK assembly, transports, and runtime shells. It does not create providers, sessions, child processes, Git worktrees, or UI state directly.

Background task handles may expose `logPath` and `transcriptPath` for append-only diagnostic streams. The runtime projects those paths into task state so SDK/CLI layers can persist resumable snapshots while high-frequency output stays in JSONL logs.
