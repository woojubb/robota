# Transparent Process Execution Contract

## Status

Design contract.

This specification defines transparent local process execution before new user-facing command or TUI
surfaces are added.

## Scope

This contract covers process execution started by Robota when the command is user-directed:

- user-entered commands;
- assistant-suggested commands accepted by the user or current permission policy;
- foreground or background process tasks;
- stdout/stderr output pages and summaries;
- timeout, cancellation, exit status, signal status, and duration;
- visible provenance and working directory.

It does not define command meaning. Build, test, lint, typecheck, release, and custom harness
semantics belong to the user's repository and the user's current request.

## Non-Goals

- Inferring canonical repository commands.
- Ranking likely commands from package metadata or file scans.
- Persisting command history as reusable execution preferences.
- Judging command output as correctness evidence by default.
- Starting automatic repair loops after failure.
- Requiring repo-side Robota manifests, adapters, scripts, hooks, package dependencies, or CI.

## Current Capability Audit

| Area                 | Current capability                                                                                                                             | Gap before transparent process UI                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Runtime task request | `IProcessBackgroundTaskRequest` carries `command`, `cwd`, `shell`, `env`, `stdin`, `timeoutMs`, and `outputLimitBytes`.                        | Request lacks typed action provenance, environment summary, stdin policy, and retention policy fields.   |
| Runtime lifecycle    | `BackgroundTaskManager` manages queued/running/completed/failed/cancelled states, cancellation, wait, close, send, and log read.               | User-facing `waiting-for-input`, `archived`, duration, and disclosure mapping need SDK projection tests. |
| CLI process adapter  | `createManagedShellProcessRunner()` starts a Node child process, captures stdout/stderr, supports timeout, cancellation, stdin, and log pages. | It is an adapter only; it must not become owner of command semantics, provenance, or retention.          |
| SDK tool route       | `BackgroundProcess` starts a background process tool with opaque runtime metadata.                                                             | Tool-call origin is not enough for user-directed command authorization provenance.                       |
| Command route        | `/background` can list, read, cancel, and close tasks.                                                                                         | No shared user-directed process-run command contract exists yet.                                         |
| TUI route            | Background task panel and execution workspace render SDK projections.                                                                          | Process detail disclosure must come from SDK/runtime fields, not raw CLI inference.                      |

## Request Contract

SDK-owned process execution APIs must accept a structured request with these fields:

| Field                | Owner                 | Requirement                                                            |
| -------------------- | --------------------- | ---------------------------------------------------------------------- |
| `command`            | SDK request           | Opaque shell command text selected by the user or accepted suggestion. |
| `origin`             | SDK action provenance | Must be `user-input` or `accepted-assistant-suggestion` for execution. |
| `cwd`                | SDK/runtime request   | Absolute or workspace-resolved working directory shown to the user.    |
| `environmentSummary` | SDK projection        | Display-safe summary of environment changes without secrets.           |
| `env`                | Runtime adapter input | Optional raw environment overrides passed only to the runner adapter.  |
| `stdinPolicy`        | SDK/runtime request   | `none`, `initial`, or `interactive` to describe input behavior.        |
| `stdin`              | Runtime adapter input | Optional initial stdin when policy allows it.                          |
| `timeoutMs`          | Runtime request       | Wall-clock timeout for process execution.                              |
| `mode`               | Runtime request       | `foreground` or `background`.                                          |
| `cancellable`        | SDK projection        | Whether a user-visible cancel action is available.                     |
| `outputLimitBytes`   | Runtime request       | Bounded captured output for result summaries.                          |
| `retentionPolicy`    | SDK projection        | How terminal records remain visible, archived, or removable.           |

The command string is opaque. SDK/runtime/CLI code may execute, display, cancel, and summarize the
process result, but must not infer that the command is the repository's canonical harness action.

## Status Contract

Process status projections must include:

| Field                 | Requirement                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `taskId`              | Stable id for controls and log reads.                                                                                    |
| `state`               | Transparent workflow state: `queued`, `running`, `waiting-for-input`, `completed`, `failed`, `cancelled`, or `archived`. |
| `commandSummary`      | Bounded command label safe for UI rows.                                                                                  |
| `origin`              | Action provenance visible to clients.                                                                                    |
| `cwd`                 | Working directory.                                                                                                       |
| `environmentSummary`  | Display-safe environment summary.                                                                                        |
| `mode`                | Foreground/background mode.                                                                                              |
| `startedAt`           | Start timestamp when available.                                                                                          |
| `completedAt`         | Terminal timestamp when available.                                                                                       |
| `durationMs`          | Derived elapsed time for terminal results and live display.                                                              |
| `exitCode`            | Process exit code when available.                                                                                        |
| `signalCode`          | Signal when the process ended by signal.                                                                                 |
| `latestOutputSummary` | Bounded stdout/stderr summary.                                                                                           |
| `transcriptPointer`   | Log or cursor pointer for retained output.                                                                               |
| `controls`            | Available explicit controls such as cancel, send, read-log, close, or archive.                                           |

Selecting a process entry is never a lifecycle mutation. Cancel, send, close, archive, and read-log
must remain explicit controls.

## Output Contract

Process output is diagnostic data, not correctness evidence by default.

Rules:

- stdout and stderr must remain distinguishable in retained logs.
- Visible previews must be bounded and disclose truncation or omitted lines.
- Full retained output must be reachable through SDK/runtime log-page APIs when retention allows it.
- Output limit failures or truncation must be visible as process metadata.
- Non-zero exit code, timeout, signal termination, and cancellation are process results. They must
  not start diagnosis or repair loops unless the user asks for advisory analysis.

## Command Source Rules

Commands may execute only from:

- current user input;
- an assistant suggestion accepted through explicit UI approval or current user-selected permission
  policy.

Commands must not execute from:

- remembered command history;
- session recall;
- user-local preferences;
- package-manager guessing;
- repository file scans;
- inferred workflow readiness.

## Ownership

| Concern                                                                                 | Owner                                     | Rule                                                               |
| --------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Process lifecycle, stdout/stderr, timeout, cancellation, send/read controls             | `agent-runtime`                           | Own generic process task contracts and state transitions.          |
| Action provenance, process request/status projection, env summary, retention projection | `agent-sdk`                               | Own reusable contracts consumed by commands, transports, and CLIs. |
| User-visible run/status command behavior                                                | `agent-command-*`                         | Execute through SDK/runtime APIs; do not infer command meaning.    |
| Node child process spawning                                                             | Runtime shell such as `agent-cli` adapter | Implement host I/O only.                                           |
| TUI rendering                                                                           | `agent-cli`                               | Render SDK projections, output panes, and controls only.           |

## Implementation Gates

Before adding a user-facing process-run UI, implementation PRs must add:

- runtime tests for process cancellation, timeout, exit code, signal, duration, log paging, and
  output truncation;
- SDK tests for action provenance, cwd, environment summary, status projection, and retention
  projection;
- command tests proving remembered history, session recall, and user-local preferences cannot start
  processes;
- CLI rendering tests proving command summary, origin, cwd, state, latest output, and terminal
  result are visible;
- tests or fixtures proving no repo-side Robota file is required.

## Relationship To Other Specs

- [transparent-workflow.md](transparent-workflow.md) owns shared action provenance and state
  vocabulary.
- [user-local-storage.md](user-local-storage.md) forbids remembered commands as executable
  preferences.
- [user-local-memory.md](user-local-memory.md) owns remembered display/navigation values and keeps
  them ineligible as command sources.
- [background-work-state.md](background-work-state.md) owns how process tasks appear in switchable
  main-thread/background work views.
- [background-task-layer.md](background-task-layer.md) owns generic background process task
  lifecycle primitives.
