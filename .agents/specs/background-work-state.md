# Background Work State Management Contract

## Status

Design contract.

This specification defines the shared background work state model used by clients that let users
inspect and switch between the main conversation, shell/process work, agent jobs, grouped jobs, and
future skill-spawned agent work.

## Scope

This contract covers presentation-neutral state for:

- the main conversation thread;
- local shell or process tasks;
- agent tasks;
- background job groups;
- future skill-spawned agent tasks registered through the same SDK/runtime task layer.

It applies to SDK clients, command modules, runtime task projections, `agent-cli`, and future
transports that render or control background work.

## Non-Goals

- Making `agent-cli` own lifecycle state, retention policy, task grouping, or terminal result
  interpretation.
- Creating a repo-local background state schema.
- Requiring Robota files, package dependencies, hooks, or manifests in a user's repository.
- Inferring which repository commands should run.
- Treating process output as correctness evidence by default.

## Current Capability Audit

| Area                    | Current capability                                                                                                                                 | Gap before full feature                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Runtime lifecycle       | `BackgroundTaskManager` owns queued/running/waiting_permission/completed/failed/cancelled states, events, cancel, close, send, wait, and log read. | No explicit archive retention projection, elapsed/duration projection contract, or input-needed alias at runtime surface. |
| SDK execution workspace | `IExecutionWorkspaceSnapshot` and `IExecutionWorkspaceEntry` project main-thread, task, and group entries with origin, status, preview, controls.  | Entries do not yet expose all contract fields such as started time, elapsed time, terminal result, or archive/clear.      |
| SDK task spawning       | `createExecutionWorkspaceTaskSpawner(...)` provides an origin-bound spawn port for commands, skills, and transports.                               | Skill-spawned agent registration needs contract tests proving it uses this same path.                                     |
| CLI workspace switcher  | `ExecutionWorkspaceSwitcher`, `ExecutionWorkspaceDetailPane`, `BackgroundTaskPanel`, and `TuiStateManager` render SDK snapshots.                   | TUI tests must cover new fields once SDK projections exist.                                                               |
| Command controls        | `/background` can list, read, cancel, and close task records through SDK/runtime APIs.                                                             | No archive, clear, switch, or follow command contract yet.                                                                |

## Common Entry Model

Background work entries must share one SDK-owned projection model. The current
`IExecutionWorkspaceEntry` is the starting point and must remain presentation-neutral.

Required projection fields for the full feature:

| Field                 | Owner          | Requirement                                                                                      |
| --------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `id`                  | SDK projection | Stable selectable entry id.                                                                      |
| `type`                | SDK projection | Main thread, background task, or background group.                                               |
| `title`               | SDK projection | Bounded human-readable label.                                                                    |
| `origin`              | SDK projection | Visible source such as user command, tool call, skill, transport, or system work.                |
| `selected`            | Client view    | Ephemeral view state. Selection is never a lifecycle transition.                                 |
| `status`              | SDK/runtime    | Shared transparent workflow status. Runtime raw statuses are mapped by SDK when needed.          |
| `cwd`                 | SDK projection | Working directory or workspace context when applicable.                                          |
| `startedAt`           | SDK projection | Start timestamp when available.                                                                  |
| `elapsedMs`           | SDK projection | Derived live or terminal elapsed duration.                                                       |
| `latestOutputSummary` | SDK projection | Bounded stdout/stderr, agent transcript, group summary, or current action preview.               |
| `inputNeeded`         | SDK projection | User-facing boolean or reason for permission/input wait.                                         |
| `controls`            | SDK projection | Explicit available controls such as select, cancel, send, wait, read-log, close, archive, clear. |
| `terminalResult`      | SDK projection | Completed, failed, cancelled, timeout, exit code, signal, or result summary when terminal.       |
| `visibility`          | SDK projection | Default-visible, collapsed/recent, archived, or hidden after explicit clear/delete.              |
| `retentionState`      | SDK projection | Whether the entry is retained for inspection, archived, clearable, or expired.                   |

Clients may keep `selected` outside the SDK snapshot as terminal-local state, but they must use SDK
entry ids and must not derive lifecycle, terminal, origin, or retention fields from raw runtime
events when the SDK projection is available.

## State And Retention

Execution states follow [transparent-workflow.md](transparent-workflow.md):

- `queued`
- `running`
- `waiting-for-input`
- `completed`
- `failed`
- `cancelled`
- `archived`

Runtime `waiting_permission` is projected as user-facing `waiting-for-input` for normal clients.
`archived` is a visibility and retention projection over terminal work. It is not a running
execution state and must not restart or resume work.

Retention behavior:

- active, waiting, failed, cancelled, and unread-completed entries are default-visible;
- clean completed entries may move to a collapsed or recent section while remaining inspectable;
- archive hides terminal entries from default lists while preserving an inspectable record until
  owner policy expires or the user clears it;
- clear/delete removes an inspectable record through an explicit control and must not be triggered
  by selection changes;
- `close()` remains the current mechanical terminal-record dismissal operation until explicit
  archive/clear APIs exist.

## Action Contract

Available actions are explicit controls, never side effects of selecting a row:

| Action           | Owner                      | Rule                                                                 |
| ---------------- | -------------------------- | -------------------------------------------------------------------- |
| `select`         | Client view over SDK entry | Switch visible detail pane only.                                     |
| `return-to-main` | Client view over SDK entry | Select the main conversation entry.                                  |
| `follow`         | SDK/client contract        | Keep the selected detail pane pinned to live updates when supported. |
| `cancel`         | Runtime through SDK        | Stop a queued or running task.                                       |
| `send`           | Runtime through SDK        | Provide follow-up input only when the runner supports it.            |
| `wait`           | SDK/runtime                | Wait for one task or group without changing ownership.               |
| `read-log`       | Runtime through SDK        | Read retained output or transcript pages.                            |
| `close`          | Runtime through SDK        | Dismiss a terminal runtime record under current APIs.                |
| `archive`        | SDK/runtime retention      | Hide terminal retained work from default lists.                      |
| `clear`          | SDK/runtime retention      | Explicitly remove retained work when owner policy allows it.         |

## Ownership

| Concern                                                                      | Owner             | Rule                                                                 |
| ---------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| Task lifecycle, transitions, cancellation, wait, send, close, logs           | `agent-runtime`   | Own mechanical state and runner-facing controls.                     |
| Main/task/group entry projection, origin, controls, visibility, detail pages | `agent-sdk`       | Own presentation-neutral read models and task spawning ports.        |
| `/background`, `/agent`, and future status/switch/archive commands           | `agent-command-*` | Expose user-visible commands through SDK/runtime contracts.          |
| TUI switcher, row indicators, keyboard navigation, detail pane rendering     | `agent-cli`       | Render SDK projections and keep only ephemeral selected-entry state. |
| Skill-spawned background work registration                                   | SDK skill runtime | Register through SDK/runtime task ports, never CLI UI state.         |

`agent-cli` may render filled and empty indicators, maintain the focused menu row, and decide which
detail pane is visible. It must not decide task completion, grouping, retention timeout, archive
rules, input-needed semantics, or whether a task is cancellable.

## Implementation Gates

Before adding additional TUI behavior beyond the existing switcher, implementation PRs must add:

- runtime tests for lifecycle transitions, cancellation, input wait, terminal retention, archive,
  and clear behavior when those APIs are introduced;
- SDK projection tests for main-thread, process task, agent task, grouped task, and skill-spawned
  agent task entries;
- SDK tests proving selected-entry changes do not mutate task lifecycle state;
- command tests for `/background` or future status/switch/archive/clear commands;
- CLI rendering tests for selected and unselected indicators, latest output, elapsed time,
  input-needed state, terminal result, and available controls;
- negative tests proving `agent-cli` does not duplicate lifecycle or retention decisions.

## Relationship To Other Specs

- [transparent-workflow.md](transparent-workflow.md) owns shared state vocabulary and disclosure
  requirements.
- [process-execution.md](process-execution.md) owns process request, output, and terminal result
  contracts projected into background entries.
- [user-local-storage.md](user-local-storage.md) owns user-local storage rules for baseline
  preferences and retained inspectable metadata.
- [user-local-memory.md](user-local-memory.md) owns remembered display/navigation preferences such
  as the last selected background entry.
- [repository-situational-awareness.md](repository-situational-awareness.md) owns passive display of
  active background workspace context alongside cwd and Git summaries.
- [background-task-layer.md](background-task-layer.md) owns generic background task lifecycle
  primitives.
