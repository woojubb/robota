---
title: CLI-BL-031 Background Task Terminal Visibility
status: completed
priority: high
urgency: next
created: 2026-05-01
packages:
  - agent-cli
  - agent-sdk
  - agent-runtime
branch: fix/background-task-terminal-visibility
completed: 2026-05-01
---

## Summary

Define when terminal-state background tasks should remain visible in the Robota CLI TUI after they complete, fail, or are cancelled.

The recommended behavior is to separate runtime retention from TUI visibility. The runtime registry must keep terminal-state task records until explicit close or session cleanup, while the TUI main panel should stop showing clean completed tasks after the next user turn. Actionable terminal states must remain visible until the user closes or acknowledges them.

## Prior Art Research

- Claude Code exposes background bash commands with unique task IDs, output retrieval, and automatic cleanup when the CLI exits. Its task list is a toggled status-area view, and users can ask to show or clear tasks rather than having every completed item permanently occupy the main screen.
- Claude Code documents `/tasks` as a command to list and manage background tasks, which implies a management surface distinct from the always-visible prompt area.
- Codex documents subagents as visible in the app and CLI, with `/agent` for switching between active agent threads and natural-language control for stopping or closing completed agent threads.
- Codex CLI 0.120.0 release notes describe live background agent progress while work is running and keeping completed hook output only when useful, which matches an active-work-first display policy.
- Cursor Background Agents keep agents addressable through a sidebar/API list with statuses such as `RUNNING`, `FINISHED`, `ERROR`, and `EXPIRED`, plus separate delete semantics. The management list persists longer than the immediate working surface.

References:

- https://code.claude.com/docs/en/interactive-mode
- https://code.claude.com/docs/en/commands
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/changelog
- https://docs.cursor.com/en/background-agents
- https://docs.cursor.com/background-agent/api/list-agents

## Problem

The current TUI projection keeps a completed background task row visible across later conversation turns until `/background close <task-id>` emits `background_task_closed`.

That behavior is correct for the runtime registry but too noisy for the main TUI panel. A successful background task should be noticeable when it completes, then move out of the active visual surface while remaining inspectable through `/background list` and `/background read`.

## Goals

- Keep active background work visible at all times.
- Show successful completion long enough for the user to notice.
- Remove clean completed tasks from the main TUI panel at the next deterministic turn boundary.
- Preserve completed task records for slash commands until explicit close or session cleanup.
- Keep failed, cancelled, or artifact-bearing tasks visible because they require user attention.
- Keep React/Ink components as thin renderers; visibility policy belongs in pure TUI state/flow code.

## Non-Goals

- Do not delete terminal-state runtime records immediately on completion.
- Do not add a full task history browser in this slice.
- Do not make runtime lifecycle transitions depend on TUI visibility.
- Do not introduce timer-based cleanup as the primary behavior; timers are harder to test than turn boundaries.

## Visibility Policy

Definitions:

| Term                     | Meaning                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Runtime registry         | `BackgroundTaskManager` state returned by `list`, `get`, `readLog`, and removed by `close`.                       |
| Main panel               | The always-visible `BackgroundTaskPanel` projection in the interactive TUI.                                       |
| Terminal state           | `completed`, `failed`, or `cancelled`.                                                                            |
| Clean completed task     | A `completed` task with no error, no preserved worktree/branch, and no follow-up action required.                 |
| Actionable terminal task | A terminal task that failed, was cancelled, preserved artifacts, or contains metadata that the user must inspect. |
| Turn boundary            | The next accepted user prompt submission after the terminal-state event has been rendered once.                   |

Required behavior:

| Task state                           | Main panel behavior                                                                                        | Runtime registry behavior                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `queued`                             | Visible                                                                                                    | Retained                                                                  |
| `running`                            | Visible                                                                                                    | Retained                                                                  |
| `waiting_permission`                 | Visible                                                                                                    | Retained                                                                  |
| `completed` clean                    | Visible as an unread completion notification until the next turn boundary, then hidden from the main panel | Retained until `/background close`, session cleanup, or future TTL policy |
| `completed` with preserved artifacts | Visible until explicit close or acknowledge                                                                | Retained until `/background close`, session cleanup, or future TTL policy |
| `failed`                             | Visible until explicit close or acknowledge                                                                | Retained until `/background close`, session cleanup, or future TTL policy |
| `cancelled`                          | Visible until explicit close or acknowledge                                                                | Retained until `/background close`, session cleanup, or future TTL policy |
| closed                               | Hidden                                                                                                     | Removed                                                                   |

The TUI must not call `closeBackgroundTask()` when it auto-hides a clean completed task. Auto-hide is presentation-only. `/background list`, `/background read <task-id>`, and transports must still be able to access the task until the runtime registry receives an explicit close.

## Architecture

### agent-runtime

`agent-runtime` keeps the authoritative task lifecycle. It must continue to:

- transition tasks into terminal states;
- retain terminal-state tasks until `close(taskId)` or session-level cleanup;
- emit `background_task_closed` only for explicit close/removal;
- stay unaware of TUI visibility, unread markers, and turn boundaries.

### agent-sdk

`agent-sdk` exposes the runtime registry through `InteractiveSession`:

- `listBackgroundTasks()` returns registry records, including hidden-from-TUI completed tasks;
- `readBackgroundTaskLog()` works for hidden completed tasks;
- `closeBackgroundTask()` removes a terminal task from the registry and emits `background_task_closed`;
- slash command output should make no assumption about main panel visibility.

### agent-cli

`agent-cli` owns presentation visibility:

- `TuiStateManager` projects runtime events into a visible task list for `BackgroundTaskPanel`;
- `TuiStateManager` tracks presentation-only hidden or acknowledged task IDs;
- the turn-boundary hook lives in pure state/flow code, not inside React components;
- `BackgroundTaskPanel` renders only the visible projection it receives.

Implementation should prefer a deterministic method such as:

```ts
onUserTurnAccepted(): void
```

This method hides clean completed tasks that were already rendered before the newly accepted prompt. It must not hide newly completed tasks in the same render cycle in which the user first sees them.

## Command Semantics

Existing commands remain valid:

| Command                               | Required behavior                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `/background list`                    | Lists runtime registry tasks, including tasks hidden from the main TUI panel. |
| `/background read <task-id> [offset]` | Reads logs for visible or hidden retained tasks.                              |
| `/background cancel <task-id>`        | Cancels queued/running tasks.                                                 |
| `/background close <task-id>`         | Removes one terminal task from both runtime registry and TUI projection.      |

Recommended later command:

| Command                       | Behavior                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `/background clear-completed` | Closes all clean completed terminal tasks after confirming none are actionable. |

## Implementation Plan

1. [x] Add characterization tests for the current TUI projection so the existing completed-task persistence is explicit.
2. [x] Add a pure TUI visibility policy helper that classifies clean completed vs actionable terminal tasks.
3. [x] Add a turn-boundary method to `TuiStateManager` or the prompt flow bridge that hides clean completed tasks from the main panel.
4. [x] Keep `/background list/read/close` backed by `InteractiveSession`, not by the TUI visible projection.
5. [x] Update package SPEC files after implementation so `agent-cli`, `agent-sdk`, and `agent-runtime` reflect the final code behavior.

## Progress

### 2026-05-01

- Started implementation on `fix/background-task-terminal-visibility` after PR #103 merged to `develop`.
- Confirmed `agent-runtime` and `agent-sdk` already retain terminal-state task records; the missing behavior is TUI-only presentation auto-hide.
- Added TUI state tests for clean completed auto-hide, actionable terminal visibility, preserved worktree visibility, non-zero process exit visibility, and hidden task close cleanup.
- Implemented `TuiStateManager.onUserTurnAccepted()` and wired slash/normal prompt submission to trigger the turn-boundary visibility policy.
- Extracted background task view-model and visibility classification helpers to keep `tui-state-manager.ts` below the production file-size guard.
- Updated background task and CLI package specs with the runtime-retention vs TUI-visibility contract.
- Added process rules requiring structural architecture documentation updates when package responsibilities or cross-package architecture change.

## Result

Implemented deterministic TUI-only auto-hide for clean completed background tasks at the next accepted user turn.
Runtime background task records remain retained for `/background list`, `/background read`, and explicit close flows.
Actionable terminal tasks remain visible when they failed, were cancelled, exited non-zero, ended by signal, or preserved worktree/branch artifacts.

## Test Plan

The implementation must start with pure state-manager tests that prove the visible TUI projection diverges from the retained runtime registry only at the documented turn boundary.

### Unit Tests

- Given a `running` background task, when a user turn is accepted, then the task remains visible in `TuiStateManager.backgroundTasks`.
- Given a clean `completed` task that has just emitted a terminal event, when the main panel renders before the next user turn, then the task remains visible and unread.
- Given a clean `completed` task that was already rendered, when the next user prompt is accepted, then the task is removed from the main panel projection.
- Given a clean `completed` task hidden from the main panel, when `/background list` runs, then the SDK command still lists the retained runtime task.
- Given a clean `completed` task hidden from the main panel, when `/background read <task-id>` runs, then logs remain readable.
- Given a `failed` task, when the next user prompt is accepted, then the task remains visible until `/background close <task-id>`.
- Given a `cancelled` task, when the next user prompt is accepted, then the task remains visible until `/background close <task-id>`.
- Given a `completed` task with `worktreePath` or `branchName`, when the next user prompt is accepted, then the task remains visible because preserved artifacts require review.
- Given a terminal task, when `/background close <task-id>` runs, then the task disappears from the main panel and is removed from runtime registry output.
- Given a hidden clean completed task, when `background_task_closed` is emitted, then presentation-only hidden state is also cleared.

### Integration Tests

- Start a background agent that completes successfully, submit another prompt, and verify the main TUI state no longer shows the clean completed row while `/background list` still reports it.
- Start a background process that fails, submit another prompt, and verify the failure row remains visible.
- Start a worktree-isolated background agent that preserves a dirty worktree, submit another prompt, and verify the result row remains visible with branch/worktree metadata.

### Verification Commands

```bash
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-runtime test
pnpm --filter @robota-sdk/agent-cli typecheck
pnpm --filter @robota-sdk/agent-sdk typecheck
pnpm --filter @robota-sdk/agent-runtime typecheck
pnpm harness:scan
```

## Acceptance Criteria

- Clean completed background tasks leave the main TUI panel at the next accepted user turn.
- Failed, cancelled, permission-related, and artifact-bearing terminal tasks remain visible until explicit close or acknowledge.
- Auto-hide never removes the runtime registry record.
- Slash commands operate on runtime registry records, not only on visible TUI rows.
- Unit tests cover the visibility policy without Ink.
- Package SPEC files are updated in the implementation PR after code matches the policy.
