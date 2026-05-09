# SDK Background Task Layering Upgrade

## Status

Completed.

## Created

2026-05-09

## Branch

feat/sdk-background-workspace

## Scope

packages/agent-runtime, packages/agent-sdk, .agents/tasks, .agents/backlog

## Recommendation

Implement this backlog as the first PR before any CLI switcher work.

Reason: the current `BackgroundTaskManager` is already the lifecycle source of truth, and the CLI
must not build a private task registry or retention policy. A SDK-owned execution workspace
projection lets `agent-cli`, headless transports, and future clients consume the same main-thread,
agent-task, process-task, and group read model while the runtime continues to own flat lifecycle
state.

## Plan

- [x] Record research-supported architecture decisions.
- [x] Update package specs before changing public contracts.
- [x] Add runtime request/state metadata passthrough for SDK origin projection.
- [x] Add SDK execution workspace entry/detail projection and InteractiveSession APIs.
- [x] Add focused regression tests for main thread, task, group, detail, and events.
- [x] Run affected package verification.

## Progress

### 2026-05-09

- Promoted from backlog to active task after merging the backlog architecture PR.
- Chose SDK execution workspace projection first because CLI/TUI must remain render-only.
- Added runtime task metadata passthrough so SDK callers can preserve origin, command, tool, skill,
  and transport attribution without changing runner contracts.
- Added SDK execution workspace projection, detail readers, task spawner, InteractiveSession APIs,
  and presentation-neutral update events.
- Verified the affected runtime and SDK scopes, including harness checks for both packages.

## Decisions

- Keep `BackgroundTaskManager` flat. Workspace hierarchy, selection, attention, and host-visible
  retention are SDK projections over runtime snapshots/events.
- Carry origin metadata through generic runtime request/state metadata instead of adding
  CLI-specific fields to task runners.
- Treat view selection as non-mutating. Task controls remain explicit lifecycle APIs.

## Blockers

- None.

## Test Plan

- `pnpm --filter @robota-sdk/agent-runtime test`
- `pnpm --filter @robota-sdk/agent-runtime typecheck`
- `pnpm --filter @robota-sdk/agent-runtime build`
- `pnpm --filter @robota-sdk/agent-runtime lint`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm harness:verify -- --scope packages/agent-runtime --base-ref origin/develop --skip-record-check`
- `pnpm harness:verify -- --scope packages/agent-sdk --base-ref origin/develop --skip-record-check`

## Result

Implemented the SDK-owned execution workspace layer that the CLI switcher can consume without
building a private task registry. Runtime background tasks remain the lifecycle source of truth;
SDK now projects main-thread, background task, and group entries, reads selected-entry details,
emits workspace update events, and provides origin-bound process/agent task spawning.

CLI rendering remains in the follow-up CLI switcher backlog and must consume these SDK interfaces
instead of adding task lifecycle or retention behavior to `agent-cli`.

## Priority

P1 - prerequisite for richer CLI and transport background-task experiences.

## Problem

Robota already has a shared runtime background task layer: `agent-runtime` owns
`BackgroundTaskManager`, task lifecycle state, runner ports, and task events, while `agent-sdk`
re-exports and composes those primitives through `InteractiveSession`.

That is enough for task creation, lifecycle control, logs, and command-level inspection. It is not
yet enough as a clean product-facing layer for richer UI surfaces that need to treat the main
conversation thread, background shell/process work, and background agent work as switchable
execution views.

The CLI background task switcher must not solve this by building a private TUI task registry, by
inferring lifecycle from raw event streams in React components, or by duplicating background
retention rules. The reusable background management layer needs an SDK-owned interface that projects
runtime task state into presentation-neutral task workspaces/views. `agent-cli` should consume that
interface and only handle terminal rendering and input.

## Non-Negotiable CLI Boundary

`agent-cli` is a TUI host, not a feature owner.

For this backlog and its follow-up implementation, any capability that changes behavior, state,
policy, lifecycle, task spawning, task grouping, retention, permission handling, persistence,
logging, or transport-visible semantics must be implemented in `agent-sdk` or a lower reusable layer
first. `agent-cli` may only add terminal UI, input handling, navigation state, and adapters that
render or invoke SDK-owned capabilities.

If a proposed CLI change needs data or behavior that the SDK does not expose, implementation must
stop and add the SDK/runtime/command-layer capability before touching the TUI.

## Architectural Direction

Preserve the existing package layering:

```text
agent-cli
  renders SDK task workspace/view models

agent-sdk
  owns InteractiveSession integration, task workspace projection, group/read-model APIs,
  main-thread entry projection, and presentation-neutral retention/selection contracts

agent-runtime
  owns BackgroundTaskManager, lifecycle state machine, runner ports, logs, cancellation,
  send/read/close controls, watchdogs, and immutable task snapshots
```

The upgrade should introduce or clarify an SDK-level background workspace/read-model interface that:

- projects the main conversation thread as a first-class selectable entry;
- projects background `agent` and `process` tasks through one task-entry shape;
- derives task title, kind, status, recency, unread/completed/error markers, preview text, current
  action, output references, and available controls without exposing runner internals;
- provides a detail/read interface for the selected entry that can return transcript/log/progress
  slices without the CLI knowing whether the entry is the main thread, a shell process, or an agent;
- defines retention policy boundaries: what is hidden from an always-visible panel, what remains
  queryable, what is explicitly closed, and what is preserved in session/debug logs;
- forwards live update events in a presentation-neutral form that TUI and transports can consume;
- keeps lifecycle mutation APIs explicit: cancel, close, send input, read logs, wait, or group
  summary must remain separate from view selection.

## Proposed Architecture

Model the feature as a layered execution workspace, not as a CLI task list.

```text
agent-cli / transports
  render and navigate execution workspace entries

agent-sdk
  ExecutionWorkspaceProjection
  - main-thread entry source
  - background task entry source
  - background group entry source
  - selected-entry detail readers
  - origin/parent/group projection
  - host-neutral retention policy

agent-runtime
  BackgroundTaskManager
  - flat task registry
  - lifecycle state machine
  - runner ports
  - logs, send, cancel, close, wait

runner adapters
  - agent runner
  - process runner
  - future task-kind runners
```

The runtime manager should remain a flat lifecycle registry. Tree, tab, or workspace concepts should
be SDK projections over runtime snapshots and events. This keeps task execution simple while giving
hosts a richer view model.

The CLI may keep only ephemeral selection/navigation state, such as the currently highlighted entry
or whether the switcher menu is open. It must not own task list membership, task status, lifecycle
transitions, retention rules, unread/attention semantics, or task control availability.

### Execution Entries

The SDK projection should expose one presentation-neutral list of selectable execution entries:

```ts
type TExecutionEntryKind = 'main_thread' | 'background_task' | 'background_group';

interface IExecutionWorkspaceEntry {
  readonly id: string;
  readonly kind: TExecutionEntryKind;
  readonly parentId?: string;
  readonly groupId?: string;
  readonly origin: IExecutionOrigin;
  readonly taskKind?: 'agent' | 'process';
  readonly status:
    | 'active'
    | 'queued'
    | 'running'
    | 'waiting_permission'
    | 'completed'
    | 'failed'
    | 'cancelled';
  readonly title: string;
  readonly subtitle?: string;
  readonly preview?: string;
  readonly currentAction?: string;
  readonly unread: boolean;
  readonly attention: 'none' | 'unread' | 'failed' | 'permission' | 'completed';
  readonly updatedAt: string;
  readonly controls: readonly TExecutionControl[];
}
```

`main_thread` is not a runtime background task. It is an SDK-projected entry backed by the current
`InteractiveSession` transcript and foreground execution state. `background_task` entries are backed
by `BackgroundTaskManager` snapshots. `background_group` entries are backed by
`BackgroundJobOrchestrator` state when a user command, model command, or skill starts multiple
related tasks.

### Origin and Parentage

Every background task should carry origin metadata that explains why it exists without coupling the
runner to the caller:

```ts
type TExecutionOriginKind =
  | 'user_prompt'
  | 'slash_command'
  | 'model_command'
  | 'tool_call'
  | 'skill'
  | 'transport'
  | 'system';

interface IExecutionOrigin {
  readonly kind: TExecutionOriginKind;
  readonly sessionId: string;
  readonly turnId?: string;
  readonly commandName?: string;
  readonly toolCallId?: string;
  readonly skillId?: string;
  readonly label?: string;
}
```

This is the key to supporting skill-spawned agents. A skill must not call CLI-specific background
APIs or create a private task registry. If a skill can spawn agents, it should receive an SDK-owned
task spawning capability through its execution context, such as an `IAgentTaskSpawner` or narrower
`IBackgroundTaskSpawner` port. The spawned agent task then enters the same runtime
`BackgroundTaskManager` as any `/agent` or model-command task, with `origin.kind = 'skill'` and
`origin.skillId` set.

Nested work uses `parentId` and optional `groupId`:

- A main-thread prompt can spawn a skill invocation.
- A skill can spawn one or more background agents.
- An agent can trigger tools or nested agent work when the SDK policy allows it.
- A slash command such as `/agent parallel` can create a group with multiple child agent tasks.

The SDK projection can render these relationships as a tree, grouped list, or flat tab list. The
runtime remains the source of lifecycle truth.

### Task Spawning Ports

All task creation should pass through SDK-owned ports:

```ts
interface IBackgroundTaskSpawner {
  spawnAgent(request: ISpawnAgentTaskRequest): Promise<IBackgroundTaskState>;
  spawnProcess(request: ISpawnProcessTaskRequest): Promise<IBackgroundTaskState>;
  createGroup(request: IBackgroundGroupRequest): Promise<IBackgroundJobGroupState>;
}
```

Command modules, model-command bridges, skill runtimes, and transport handlers consume this
capability from SDK host context. They do not import `agent-cli` and do not know whether the concrete
runner is in-process, child-process, local shell, remote worker, or a test fake.

Runner adapters remain narrow:

- Agent runner: execute one agent task and stream progress events.
- Process runner: execute one process task and stream stdout/stderr/log events.
- Future runners: add a new task `kind` only when they can fit the same lifecycle, control, and log
  model.

### Detail Readers

The SDK workspace should also expose a detail reader so hosts can switch views without branching on
runtime internals:

```ts
interface IExecutionWorkspaceReader {
  listEntries(filter?: IExecutionWorkspaceFilter): readonly IExecutionWorkspaceEntry[];
  getEntry(entryId: string): IExecutionWorkspaceEntry | undefined;
  readDetail(entryId: string, cursor?: IExecutionDetailCursor): Promise<IExecutionDetailPage>;
  subscribe(listener: TExecutionWorkspaceListener): () => void;
}
```

Detail reading should normalize:

- main-thread transcript slices;
- agent task transcript/output/progress;
- process task stdout/stderr/log pages;
- group summaries and child task references.

The detail model should identify records as assistant text, tool activity, process output, progress
metadata, error, or result summary. It should not expose process handles, provider objects, or
React/Ink state.

### Retention and Visibility

Separate runtime retention from host visibility:

- Runtime retention: terminal tasks remain queryable until explicit `close`, session cleanup, or a
  documented retention limit. `close` is a lifecycle registry operation and must not be triggered by
  merely switching views.
- SDK visibility: the workspace projection decides which queryable entries are shown by default,
  hidden, unread, or attention-worthy.
- Host selection: CLI or transports may remember which entry is selected, but selection is not
  lifecycle state.

Recommended default:

- Running, queued, waiting-permission, failed, cancelled, and unread-completed tasks appear in the
  switcher.
- Clean completed tasks can move to a collapsed recent/history section after the user returns to the
  main thread or accepts the next turn.
- Explicit close removes terminal runtime records from the registry and from the workspace.
- Failed or permission-blocked tasks stay visible until acknowledged or closed.

### Control Semantics

Selection is read-only. Mutations stay explicit:

| Control   | Owner API                         | Notes                                                        |
| --------- | --------------------------------- | ------------------------------------------------------------ |
| select    | host UI state                     | Switches visible detail only                                 |
| cancel    | `cancelBackgroundTask`            | Running/queued tasks only                                    |
| close     | `closeBackgroundTask`             | Terminal tasks only                                          |
| send      | `sendBackgroundTask`              | Only if runner handle supports input                         |
| read log  | `readBackgroundTaskLog` or reader | Cursor-based, bounded output                                 |
| wait      | group/task wait API               | Does not make the task foreground unless a caller chooses it |
| summarize | SDK group/detail reader           | Presentation-neutral summary, no CLI-only aggregation        |

### Concurrency and Cancellation

The runtime manager keeps bounded concurrency and per-runner cancellation. The SDK projection should
add source-aware policies:

- A parent command or skill may create a task group with `wait_all`, `wait_any`, `manual`, or
  `detached` policy.
- Detached child tasks may outlive the command or skill that spawned them, but their origin and
  parent metadata remain visible.
- Cancelling a group should have an explicit cascade policy. Default task cancellation should target
  only the selected task.
- Background permission requests must include origin, parent, and task labels. If a host cannot
  surface the permission prompt safely, the background action fails closed.

### Research Questions

Online research should validate this architecture against other assistant products before
implementation:

- Do established assistants treat background agents as tabs, task lists, transcripts, or command
  history?
- Do they keep completed tasks visible, archived, or ephemeral?
- How do they attribute sub-work started by skills, commands, or model tool calls?
- Do they expose grouped parallel work as a parent entry or only as child tasks?
- What controls are safe in a task switcher versus a separate task management command?
- How do they represent nested agent work without making the UI feel like a process manager?

## Scope

- Audit the current `agent-runtime` background task manager, `agent-sdk` InteractiveSession APIs,
  background job group orchestration, `/background` command common APIs, and CLI `TuiStateManager`
  projection.
- Define the SDK-owned task workspace/read-model contract that can support UI tab-style switching
  without moving lifecycle ownership into the CLI.
- Decide whether the existing `BackgroundJobOrchestrator` should provide part of this read model or
  whether a separate SDK projection service is cleaner.
- Define how the main conversation thread appears beside background task entries.
- Define terminal retention semantics in SDK-visible state so CLI components do not invent their own
  cleanup policy.
- Define origin metadata for user prompts, slash commands, model commands, tool calls, skills,
  transports, and system-created tasks.
- Define SDK task-spawning ports that command modules, skills, and transports can consume without
  depending on CLI code.
- Define nested task and group projection semantics for skill-spawned agents and parallel agent
  groups.
- Add focused unit tests for pure projection logic and event-to-view updates.
- Update `packages/agent-sdk/docs/SPEC.md`, `.agents/specs/background-task-layer.md`, and
  `packages/agent-cli/docs/SPEC.md` before production code changes.

## Non-Goals

- Do not redesign the runtime lifecycle state machine unless the audit finds a concrete gap.
- Do not move Node child-process runners, provider creation, worktree filesystem I/O, or Ink
  rendering into `agent-sdk`.
- Do not make `agent-cli` own a second background registry or task lifecycle source of truth.
- Do not add feature behavior directly to `agent-cli` just because the first visible consumer is the
  TUI.
- Do not implement the full task switcher UI in this backlog.
- Do not make task view selection imply cancellation, foreground promotion, or execution mutation.

## Open Decisions

- Whether the SDK contract should be named around a "task workspace", "execution views", "task
  panes", or a narrower background-task read model.
- Whether view selection state belongs entirely to each host UI or should be represented as an
  optional SDK helper.
- Whether completed task retention should be SDK policy, host policy with SDK defaults, or a split
  between query retention and visible-panel retention.
- Whether main-thread transcript reads should use existing session history APIs directly or be
  wrapped by the same selected-entry detail interface.
- How background job groups should appear: as separate group entries, task metadata, or summary-only
  data.
- Whether skill-spawned agents should always create a group entry or only use parent/origin metadata
  when there is a single child task.
- Whether detached tasks created by skills should stay visible after the skill invocation itself has
  completed.

## Acceptance Criteria

- [ ] Current background runtime, SDK, command, transport, and CLI projection responsibilities are
      audited against `.agents/specs/background-task-layer.md`.
- [ ] A SPEC update defines the SDK-owned background task workspace/read-model interface and its
      relationship to `BackgroundTaskManager`.
- [ ] The main conversation thread can be represented by the same presentation-neutral entry list as
      background shell/process and agent tasks.
- [ ] The contract supports reading selected-entry details without exposing runner-specific
      internals to the CLI.
- [ ] Retention and close/dismiss responsibilities are explicit.
- [ ] Lifecycle mutation APIs remain separate from view selection.
- [ ] SDK-owned task-spawning ports are available to command modules, model-command bridges, skills,
      and transports without importing `agent-cli`.
- [ ] Origin metadata can attribute tasks to user prompts, slash commands, model commands, tool
      calls, skills, transports, and system-created work.
- [ ] Skill-spawned agents enter the same background task manager and workspace projection as
      `/agent` and model-command-spawned agents.
- [ ] Any new behavior needed by the CLI switcher is exposed through SDK/runtime/command-layer APIs
      before the TUI consumes it.
- [ ] `agent-cli` changes are limited to rendering, terminal input, view selection, and composition
      adapters over SDK-owned capabilities.
- [ ] Tests cover projection of main-thread, running process task, running agent task, terminal
      task, failed task, unread completion, grouped parallel work, skill-spawned child task, and
      close/dismiss behavior.
- [ ] `agent-cli` can consume the SDK read model without maintaining a private task registry.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-runtime test`
- `pnpm --filter @robota-sdk/agent-cli test -- background`
- `pnpm harness:verify -- --scope packages/agent-sdk --base-ref origin/develop --skip-record-check`
- `pnpm harness:verify -- --scope packages/agent-cli --base-ref origin/develop --skip-record-check`

## Follow-Up

This backlog was completed before
[`CLI Background Task Switcher`](CLI-BL-056-background-task-switcher.md) moved to implementation.
